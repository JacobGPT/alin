/**
 * SSE Streaming AI Proxy endpoints
 * /api/chat/stream — Multi-provider SSE streaming (Claude, OpenAI, Gemini, DeepSeek)
 * /api/chat/continue — Tool result continuation endpoint
 */
import { assemblePrompt, detectMode } from '../prompts/index.js';

export function registerStreamingRoutes(ctx) {
  const { app, requireAuth, checkPlanLimits, setupSSE, sendSSE, DEFAULT_MODELS, MODEL_METADATA } = ctx;

  /**
   * Enhanced streaming proxy with full tool_use support, thinking, and auth.
   * SSE events: text, thinking, tool_use, usage, done, error
   */
  async function streamAnthropicToSSE(res, { model, messages, system, tools, thinking, thinkingBudget, maxTokens, temperature }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { sendSSE(res, 'error', { error: 'ANTHROPIC_API_KEY not set in server .env' }); return res.end(); }

    const body = {
      model: model || DEFAULT_MODELS.claudeSonnet,
      max_tokens: maxTokens || 16384,
      stream: true,
      messages,
    };
    if (system) body.system = system;
    if (tools && tools.length > 0) body.tools = tools;
    if (thinking) {
      body.thinking = { type: 'enabled', budget_tokens: thinkingBudget || 10000 };
      if (body.max_tokens <= (thinkingBudget || 10000)) {
        body.max_tokens = (thinkingBudget || 10000) + 16384;
      }
    } else if (temperature !== undefined) {
      body.temperature = temperature;
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    if (thinking) headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
    if (tools?.some(t => t.type === 'computer_20250124')) {
      headers['anthropic-beta'] = (headers['anthropic-beta'] ? headers['anthropic-beta'] + ',' : '') + 'computer-use-2025-01-24';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error(`[Anthropic] ${response.status} error:`, t.slice(0, 500));
      // Parse Anthropic error to extract the actual message
      let errorMsg = `Anthropic ${response.status}`;
      try {
        const errBody = JSON.parse(t);
        if (errBody.error?.message) errorMsg = errBody.error.message;
      } catch {}
      sendSSE(res, 'error', { error: errorMsg, details: t });
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', inputTokens = 0, outputTokens = 0;
    let stopReason = 'end_turn';
    let currentToolId = '', currentToolName = '', currentToolInput = '';

    sendSSE(res, 'start', { model, provider: 'anthropic' });

    let streamedAnyText = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === 'message_start' && ev.message?.usage) {
              inputTokens = ev.message.usage.input_tokens || 0;
            } else if (ev.type === 'content_block_start') {
              if (ev.content_block?.type === 'thinking') {
                sendSSE(res, 'thinking_start', {});
              } else if (ev.content_block?.type === 'tool_use') {
                currentToolId = ev.content_block.id || '';
                currentToolName = ev.content_block.name || '';
                currentToolInput = '';
              }
            } else if (ev.type === 'content_block_delta') {
              if (ev.delta?.type === 'thinking_delta') {
                sendSSE(res, 'thinking_delta', { thinking: ev.delta.thinking });
              } else if (ev.delta?.type === 'text_delta') {
                streamedAnyText = true;
                sendSSE(res, 'text_delta', { text: ev.delta.text });
              } else if (ev.delta?.type === 'input_json_delta') {
                currentToolInput += ev.delta.partial_json || '';
              } else if (ev.delta?.type === 'signature_delta') {
                // Signature for thinking block — pass through for API round-trips
                sendSSE(res, 'signature_delta', { signature: ev.delta.signature });
              }
            } else if (ev.type === 'content_block_stop') {
              if (currentToolId) {
                let parsedInput = {};
                try { parsedInput = JSON.parse(currentToolInput || '{}'); } catch {}
                sendSSE(res, 'tool_use', { id: currentToolId, name: currentToolName, input: parsedInput });
                currentToolId = '';
                currentToolName = '';
                currentToolInput = '';
              }
            } else if (ev.type === 'message_delta') {
              if (ev.usage) outputTokens = ev.usage.output_tokens || 0;
              if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
            }
          } catch {}
        }
      }
    } catch (streamErr) {
      // Stream terminated mid-response (connection dropped, provider closed, etc.)
      console.warn('[Anthropic] Stream terminated mid-response:', streamErr.message);
      if (streamedAnyText) {
        // Already sent partial text — send a note + done event so client preserves content
        sendSSE(res, 'text_delta', { text: '\n\n*(Connection to AI provider was interrupted. The response above may be incomplete.)*' });
        sendSSE(res, 'done', { inputTokens, outputTokens, model, stopReason: 'interrupted' });
        return res.end();
      }
      // No text was streamed yet — propagate as error
      throw streamErr;
    }
    sendSSE(res, 'done', { inputTokens, outputTokens, model, stopReason });
    res.end();
  }

  // Convert Claude-format tools to OpenAI function-calling format
  function convertToolsToOpenAI(tools) {
    if (!tools || !Array.isArray(tools)) return [];
    return tools
      .filter(t => t.name && t.input_schema) // skip non-standard tools (computer_use, text_editor)
      .map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || { type: 'object', properties: {} },
        },
      }));
  }

  // Convert Claude-format messages to OpenAI-format messages
  function convertMessagesToOpenAI(messages, system) {
    const oaiMessages = [];
    if (system) oaiMessages.push({ role: 'system', content: system });

    for (const m of messages) {
      // Handle string content directly
      if (typeof m.content === 'string') {
        oaiMessages.push({ role: m.role, content: m.content });
        continue;
      }
      if (!Array.isArray(m.content)) {
        oaiMessages.push({ role: m.role, content: String(m.content || '') });
        continue;
      }

      // Check if this message contains tool_result blocks (= tool response message)
      const toolResults = m.content.filter(b => b.type === 'tool_result');
      if (toolResults.length > 0) {
        // OpenAI expects each tool result as a separate {role:'tool'} message
        for (const tr of toolResults) {
          oaiMessages.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id || tr.toolUseId || '',
            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content || ''),
          });
        }
        continue;
      }

      // Check if this is an assistant message with tool_use blocks
      const toolUses = m.content.filter(b => b.type === 'tool_use');
      const textBlocks = m.content.filter(b => b.type === 'text');
      const imageBlocks = m.content.filter(b => b.type === 'image' || b.type === 'image_url');

      if (m.role === 'assistant' && toolUses.length > 0) {
        // OpenAI assistant messages with tool calls
        const textContent = textBlocks.map(b => b.text).join('') || null;
        oaiMessages.push({
          role: 'assistant',
          content: textContent,
          tool_calls: toolUses.map((tu, i) => ({
            id: tu.id || tu.toolUseId || `call_${i}`,
            type: 'function',
            function: {
              name: tu.name || tu.toolName || '',
              arguments: JSON.stringify(tu.input || tu.toolInput || {}),
            },
            // Gemini 3 thought_signature — must be passed back for tool continuations
            ...(tu.thought_signature ? { thought_signature: tu.thought_signature } : {}),
          })),
        });
        continue;
      }

      // Regular message — convert content blocks
      const oaiContent = [];
      for (const b of m.content) {
        if (b.type === 'text' && b.text) {
          oaiContent.push({ type: 'text', text: b.text });
        } else if (b.type === 'image_url') {
          oaiContent.push(b);
        } else if (b.type === 'image' && b.source) {
          // Convert Claude image format to OpenAI image_url format
          if (b.source.type === 'base64') {
            oaiContent.push({
              type: 'image_url',
              image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
            });
          } else if (b.source.type === 'url') {
            oaiContent.push({ type: 'image_url', image_url: { url: b.source.url } });
          }
        }
        // Skip thinking, redacted_thinking, tool_activity — not relevant for OpenAI
      }

      if (oaiContent.length > 0) {
        oaiMessages.push({ role: m.role, content: oaiContent.length === 1 && oaiContent[0].type === 'text' ? oaiContent[0].text : oaiContent });
      } else {
        oaiMessages.push({ role: m.role, content: '[empty message]' });
      }
    }

    return oaiMessages;
  }

  async function streamOpenAIToSSE(res, { model, messages, system, tools, maxTokens, temperature }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) { sendSSE(res, 'error', { error: 'OPENAI_API_KEY not set in server .env' }); return res.end(); }

    const oaiMessages = convertMessagesToOpenAI(messages, system);

    const isReasoning = model && (model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4'));
    const isGPT5 = model && model.startsWith('gpt-5');

    const body = {
      model: model || DEFAULT_MODELS.gpt4o,
      stream: true,
      messages: oaiMessages,
      max_completion_tokens: maxTokens || 16384,
    };
    if (!isReasoning && !isGPT5) {
      body.temperature = temperature ?? 0.7;
    }
    // GPT-5.x and o-series support reasoning_effort parameter
    if (isGPT5 || isReasoning) {
      // Values: 'none' (5.2 only), 'minimal', 'low', 'medium', 'high', 'xhigh' (5.2 Pro only)
      body.reasoning_effort = 'medium';
    }
    // Convert tools from Claude format to OpenAI function-calling format
    const oaiTools = convertToolsToOpenAI(tools);
    if (oaiTools.length > 0) body.tools = oaiTools;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const t = await response.text();
      sendSSE(res, 'error', { error: `OpenAI ${response.status}`, details: t });
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const toolCalls = {}; // index -> { id, name, arguments }
    let lastFinishReason = '';

    sendSSE(res, 'start', { model, provider: 'openai' });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          const choice = ev.choices?.[0];
          if (!choice) continue;
          if (choice.delta?.content) {
            sendSSE(res, 'text_delta', { text: choice.delta.content });
          }
          if (choice.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: '', name: '', arguments: '' };
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
            }
          }
          if (choice.finish_reason) {
            lastFinishReason = choice.finish_reason;
            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
              // Emit accumulated tool calls
              for (const idx of Object.keys(toolCalls)) {
                const tc = toolCalls[idx];
                let parsedArgs = {};
                try { parsedArgs = JSON.parse(tc.arguments || '{}'); } catch {}
                sendSSE(res, 'tool_use', { id: tc.id, name: tc.name, input: parsedArgs });
              }
            }
          }
        } catch {}
      }
    }
    let stopReason;
    if (Object.keys(toolCalls).length > 0) {
      stopReason = 'tool_use';
    } else if (lastFinishReason === 'length') {
      stopReason = 'max_tokens';
    } else {
      stopReason = 'end_turn';
    }
    sendSSE(res, 'done', { model, stopReason });
    res.end();
  }

  /**
   * Stream Gemini models via Google's OpenAI-compatible endpoint.
   * Endpoint: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
   * Same SSE data format as OpenAI — reuses convertMessagesToOpenAI and convertToolsToOpenAI.
   *
   * Gemini thinking models (2.5 Pro, 2.5 Flash, 3 Pro, 3 Flash) support reasoning_effort
   * parameter ('none', 'low', 'medium', 'high') which controls thinking budget.
   * NOTE: Gemini does NOT expose thinking tokens in the OpenAI-compat stream —
   * thinking happens internally and only the final output is streamed.
   */

  /**
   * Specialist Model Router — silently routes specific tasks to the best model.
   * Returns the specialist's analysis as a string to inject into context.
   */
  async function specialistRoute(task, content, options = {}) {
    const specialistConfigs = {
      // Gemini specialists
      'video_analysis': {
        model: 'gemini-2.5-pro', provider: 'gemini',
        system: 'You are analyzing a video for another AI assistant. Provide a thorough, structured analysis including: visual content, actions/events, spoken words (if any), text on screen, mood/tone, and any notable details. Be specific and detailed — your analysis will be passed to another model that cannot see the video.',
      },
      'audio_analysis': {
        model: 'gemini-2.5-flash', provider: 'gemini',
        system: 'You are analyzing audio content for another AI assistant. Provide: transcription of speech, description of non-speech sounds, tone/emotion, speaker identification if multiple speakers, and any notable audio qualities.',
      },
      'long_document_analysis': {
        model: 'gemini-2.5-pro', provider: 'gemini',
        system: 'You are analyzing a very long document for another AI assistant. Provide a comprehensive summary with: key themes, important details, structure overview, notable quotes/data, and actionable insights.',
      },
      'fact_verification': {
        model: 'gemini-2.5-pro', provider: 'gemini',
        system: 'Verify the following claims using your built-in search grounding. For each claim, state: VERIFIED, UNVERIFIED, or INCORRECT with a brief source citation. Be concise.',
        useNativeApi: true,
      },
      // DeepSeek specialists
      'math_verification': {
        model: 'deepseek-reasoner', provider: 'deepseek',
        system: 'Verify the following mathematical calculation or logical reasoning. Show your work step by step. State whether the original answer is CORRECT or INCORRECT, and provide the correct answer if wrong.',
      },
      'image_prompt_enhance': {
        model: 'deepseek-chat', provider: 'deepseek',
        system: 'You are an expert art director. Take the user\'s rough image description and expand it into a detailed, professional prompt for an AI image generator. Include: subject details, composition, lighting, color palette, style, mood, camera angle. Keep it under 200 words. Output ONLY the enhanced prompt, nothing else.',
      },
      'code_review': {
        model: 'deepseek-chat', provider: 'deepseek',
        system: 'Review the following code for: security vulnerabilities, bugs, performance issues, and best practice violations. Be concise — list only actual problems found with severity (critical/warning/info) and a one-line fix suggestion. If the code is clean, say "No issues found."',
      },
      'context_compression': {
        model: 'deepseek-chat', provider: 'deepseek',
        system: 'Compress the following conversation history into a concise summary that preserves all important context: user preferences, decisions made, key facts, ongoing tasks, and any unresolved questions. Target 20% of original length. Output ONLY the summary.',
      },
      // GPT specialists
      'creative_writing_enhance': {
        model: 'gpt-4o', provider: 'openai',
        system: 'You are a world-class editor. Enhance the following text for: natural flow, engaging prose, vivid descriptions, and emotional resonance. Maintain the original meaning and intent. Output ONLY the improved text.',
      },
      'structured_extraction': {
        model: 'gpt-4o', provider: 'openai',
        system: 'Extract structured data from the following content. Output valid JSON only, no markdown, no explanation. Match the schema the user requests or infer the most useful structure.',
      },
      'translation_check': {
        model: 'gpt-4o', provider: 'openai',
        system: 'Review the following translation for accuracy, natural phrasing, and cultural appropriateness. Note any errors or awkward phrasing. If the translation is good, say "Translation is accurate."',
      },
      // Claude specialists
      'deep_reasoning': {
        model: 'claude-opus-4-6', provider: 'anthropic',
        system: 'Think deeply about the following problem. Use extended reasoning to work through it step by step. Consider edge cases, alternative interpretations, and potential pitfalls. Provide a thorough analysis.',
      },
    };

    const config = specialistConfigs[task];
    if (!config) return { success: false, error: `Unknown specialist task: ${task}` };

    try {
      // Special handling for Gemini with search grounding (native API)
      if (config.useNativeApi && config.provider === 'gemini') {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) return { success: false, error: 'GEMINI_API_KEY not configured' };

        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: content }] }],
            systemInstruction: { parts: [{ text: config.system }] },
            tools: [{ googleSearch: {} }],
          }),
        });
        if (!resp.ok) return { success: false, error: `Specialist Gemini error: ${resp.status}` };
        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
        return { success: true, result: text, model: config.model, provider: config.provider };
      }

      // For Gemini with multimodal (video/audio), use native API with inline data
      if (config.provider === 'gemini' && options.inlineData) {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) return { success: false, error: 'GEMINI_API_KEY not configured' };

        const parts = [];
        if (options.inlineData) {
          parts.push({ inlineData: options.inlineData });
        }
        parts.push({ text: content });

        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            systemInstruction: { parts: [{ text: config.system }] },
          }),
        });
        if (!resp.ok) return { success: false, error: `Specialist Gemini multimodal error: ${resp.status}` };
        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
        return { success: true, result: text, model: config.model, provider: config.provider };
      }

      // Standard OpenAI-compatible call (works for all providers)
      const apiConfig = {
        'anthropic': { url: 'https://api.anthropic.com/v1/messages', keyEnv: 'ANTHROPIC_API_KEY', isAnthropic: true },
        'openai':    { url: 'https://api.openai.com/v1/chat/completions', keyEnv: 'OPENAI_API_KEY' },
        'gemini':    { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', keyEnv: 'GEMINI_API_KEY' },
        'deepseek':  { url: 'https://api.deepseek.com/chat/completions', keyEnv: 'DEEPSEEK_API_KEY' },
      };

      const api = apiConfig[config.provider];
      const apiKey = process.env[api.keyEnv];
      if (!apiKey) return { success: false, error: `${api.keyEnv} not configured for specialist ${task}` };

      if (api.isAnthropic) {
        const resp = await fetch(api.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: options.maxTokens || 4096,
            system: config.system,
            messages: [{ role: 'user', content }],
          }),
        });
        if (!resp.ok) return { success: false, error: `Specialist Anthropic error: ${resp.status}` };
        const data = await resp.json();
        const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
        return { success: true, result: text, model: config.model, provider: config.provider };
      }

      // OpenAI-compatible call (OpenAI, Gemini, DeepSeek)
      const resp = await fetch(api.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: config.system },
            { role: 'user', content },
          ],
          max_tokens: options.maxTokens || 4096,
          temperature: 0.3,
        }),
      });

      if (!resp.ok) return { success: false, error: `Specialist ${config.provider} error: ${resp.status}` };
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || '';
      return { success: true, result: text, model: config.model, provider: config.provider };

    } catch (error) {
      console.error(`[Specialist] ${task} failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // GEMINI NATIVE API — uses Google's native REST format (not OpenAI-compat)
  // so that thought_signatures are preserved for Gemini 3 tool continuations.
  // ============================================================================

  /**
   * Convert our internal message format to Gemini native format.
   * Handles: text, images, tool_use → functionCall, tool_result → functionResponse.
   * Gemini requires alternating user/model roles — consecutive same-role messages are merged.
   */
  function convertMessagesToGeminiNative(messages, system) {
    const contents = [];
    const toolIdToName = {};

    function addParts(role, parts) {
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts.push(...parts);
      } else {
        contents.push({ role, parts });
      }
    }

    for (const m of messages) {
      if (!m || !m.role) continue;
      const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';

      // String content
      if (typeof m.content === 'string') {
        addParts(role, [{ text: m.content || ' ' }]);
        continue;
      }

      // OpenAI 'tool' role → Gemini functionResponse on user role
      if (m.role === 'tool') {
        const name = toolIdToName[m.tool_call_id] || extractGeminiToolName(m.tool_call_id) || 'unknown';
        addParts('user', [{
          functionResponse: {
            name,
            response: { result: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '') }
          }
        }]);
        continue;
      }

      if (!Array.isArray(m.content)) {
        addParts(role, [{ text: String(m.content || ' ') }]);
        continue;
      }

      const parts = [];
      for (const b of m.content) {
        if (b.type === 'text' && b.text) {
          parts.push({ text: b.text });
        } else if (b.type === 'tool_use') {
          const name = b.name || b.toolName || '';
          const id = b.id || b.toolUseId || '';
          if (id && name) toolIdToName[id] = name;
          const part = { functionCall: { name, args: b.input || b.toolInput || {} } };
          if (b.thought_signature) part.thoughtSignature = b.thought_signature;
          parts.push(part);
        } else if (b.type === 'tool_result') {
          const trId = b.tool_use_id || b.toolUseId || '';
          const name = toolIdToName[trId] || extractGeminiToolName(trId) || 'unknown';
          parts.push({
            functionResponse: {
              name,
              response: { result: typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '') }
            }
          });
        } else if (b.type === 'image' && b.source?.type === 'base64') {
          parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
        }
        // Skip: thinking, redacted_thinking, tool_activity, video_embed, file
      }

      if (parts.length > 0) {
        // tool_result parts must be on 'user' role even if parent message was 'assistant'
        const hasFunctionResponse = parts.some(p => p.functionResponse);
        const hasFunctionCall = parts.some(p => p.functionCall);
        if (hasFunctionResponse && !hasFunctionCall) {
          addParts('user', parts);
        } else if (hasFunctionCall && !hasFunctionResponse) {
          addParts('model', parts);
        } else {
          // Mixed — split functionResponse parts to user, rest to model
          const frParts = parts.filter(p => p.functionResponse);
          const otherParts = parts.filter(p => !p.functionResponse);
          if (otherParts.length > 0) addParts(role, otherParts);
          if (frParts.length > 0) addParts('user', frParts);
        }
      }
    }

    // Gemini requires first message to be from user
    if (contents.length > 0 && contents[0].role !== 'user') {
      contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    return {
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    };
  }

  // Extract tool name from generated ID (format: gemini_toolName_timestamp_rand)
  function extractGeminiToolName(id) {
    if (!id) return null;
    const match = String(id).match(/^gemini_(.+?)_\d+/);
    return match ? match[1] : null;
  }

  /**
   * Convert ALIN tool definitions to Gemini native functionDeclarations.
   */
  function convertToolsToGeminiNative(tools) {
    if (!tools || tools.length === 0) return undefined;
    const decls = [];
    for (const t of tools) {
      if (!t.name) continue;
      const schema = JSON.parse(JSON.stringify(t.input_schema || t.parameters || { type: 'object', properties: {} }));
      sanitizeGeminiSchema(schema);
      decls.push({ name: t.name, description: t.description || '', parameters: schema });
    }
    if (decls.length === 0) return undefined;
    return [{ functionDeclarations: decls }];
  }

  // Recursively sanitize a JSON schema for Gemini's native API requirements:
  // - Remove unsupported fields (additionalProperties)
  // - Convert enum values to strings (Gemini requires TYPE_STRING)
  // - Convert 'integer' type to 'number' if enum has string-coerced values
  function sanitizeGeminiSchema(obj) {
    if (!obj || typeof obj !== 'object') return;
    delete obj.additionalProperties;
    if (Array.isArray(obj.enum)) {
      obj.enum = obj.enum.map(v => String(v));
      // If the original type was 'integer' but enum values are now strings, change type
      if (obj.type === 'integer') obj.type = 'string';
    }
    if (obj.properties) {
      for (const key of Object.keys(obj.properties)) {
        sanitizeGeminiSchema(obj.properties[key]);
      }
    }
    if (obj.items) sanitizeGeminiSchema(obj.items);
  }

  /**
   * Stream Gemini using the NATIVE API (not OpenAI-compat).
   * The native API correctly handles thought_signatures for Gemini 3 tool continuations.
   * Emits the same SSE events as other providers (start, text_delta, tool_use, done).
   */
  async function streamGeminiToSSE(res, { model, messages, system, tools, maxTokens, temperature, thinkingLevel }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) { sendSSE(res, 'error', { error: 'GEMINI_API_KEY not set in server .env' }); return res.end(); }

    const { contents, systemInstruction } = convertMessagesToGeminiNative(messages, system);
    const geminiTools = convertToolsToGeminiNative(tools);

    const generationConfig = {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens || 16384,
    };

    // Thinking config — if set, map to Gemini budget. If not set, omit entirely
    // so Gemini 3 Pro/Flash use their default thinking behavior.
    if (thinkingLevel) {
      const budgetMap = { low: 1024, medium: 8192, high: 24576 };
      generationConfig.thinkingConfig = { thinkingBudget: budgetMap[thinkingLevel] || 8192 };
    }

    const body = { contents, generationConfig };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (geminiTools) body.tools = geminiTools;

    const geminiModel = model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

    console.log(`[Gemini Native] Model: ${geminiModel}, messages: ${contents.length}, tools: ${geminiTools?.[0]?.functionDeclarations?.length || 0}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error(`[Gemini Native] Error ${response.status}:`, t.slice(0, 300));
      sendSSE(res, 'error', { error: `Gemini ${response.status}`, details: t });
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let hasToolCalls = false;
    let lastFinishReason = '';

    sendSSE(res, 'start', { model: geminiModel, provider: 'gemini' });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;

        try {
          const ev = JSON.parse(raw);
          const candidate = ev.candidates?.[0];
          if (!candidate) continue;

          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            // Text output (non-thinking)
            if (part.text != null && !part.thought) {
              sendSSE(res, 'text_delta', { text: part.text });
            }
            // Thinking output
            if (part.thought && part.text) {
              sendSSE(res, 'thinking_delta', { thinking: part.text });
            }
            // Function call — thoughtSignature is on the part alongside functionCall
            if (part.functionCall) {
              hasToolCalls = true;
              const toolId = `gemini_${part.functionCall.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              sendSSE(res, 'tool_use', {
                id: toolId,
                name: part.functionCall.name,
                input: part.functionCall.args || {},
                ...(part.thoughtSignature ? { thought_signature: part.thoughtSignature } : {}),
              });
            }
          }

          if (candidate.finishReason) {
            lastFinishReason = candidate.finishReason;
          }
        } catch {}
      }
    }

    let stopReason;
    if (hasToolCalls) stopReason = 'tool_use';
    else if (lastFinishReason === 'MAX_TOKENS') stopReason = 'max_tokens';
    else stopReason = 'end_turn';
    sendSSE(res, 'done', { model: geminiModel, stopReason });
    res.end();
  }

  /**
   * Stream DeepSeek models via their OpenAI-compatible endpoint.
   * Base URL: https://api.deepseek.com
   *
   * Two modes:
   *   - deepseek-chat: General chat (V3.2, non-thinking). Supports tools/function calling.
   *   - deepseek-reasoner: Thinking mode (V3.2, with CoT). Sends reasoning_content in deltas.
   *
   * IMPORTANT DeepSeek-specific behaviors:
   *   - deepseek-reasoner does NOT support temperature, top_p, presence_penalty, frequency_penalty
   *   - reasoning_content must NOT be sent back in conversation history (strip it)
   *   - When deepseek-reasoner uses tools, it internally falls back to deepseek-chat mode
   */
  async function streamDeepSeekToSSE(res, { model, messages, system, tools, maxTokens, temperature }) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) { sendSSE(res, 'error', { error: 'DEEPSEEK_API_KEY not set in server .env' }); return res.end(); }

    const dsMessages = convertMessagesToOpenAI(messages, system);

    const isReasoner = model === 'deepseek-reasoner';

    const body = {
      model: model || 'deepseek-chat',
      stream: true,
      messages: dsMessages,
      max_tokens: Math.min(maxTokens || (isReasoner ? 64000 : 8192), isReasoner ? 64000 : 8192),
    };

    // deepseek-reasoner ignores these params — only set for deepseek-chat
    if (!isReasoner) {
      body.temperature = temperature ?? 0.7;
    }

    // DeepSeek supports OpenAI-format function calling (deepseek-chat only)
    const dsTools = convertToolsToOpenAI(tools);
    if (dsTools.length > 0) body.tools = dsTools;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const t = await response.text();
      sendSSE(res, 'error', { error: `DeepSeek ${response.status}`, details: t });
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const toolCalls = {};
    let lastFinishReason = '';
    let inThinking = false;

    sendSSE(res, 'start', { model, provider: 'deepseek' });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          const choice = ev.choices?.[0];
          if (!choice) continue;

          // DeepSeek reasoner sends chain-of-thought via reasoning_content
          if (choice.delta?.reasoning_content) {
            if (!inThinking) {
              sendSSE(res, 'thinking_start', {});
              inThinking = true;
            }
            sendSSE(res, 'thinking_delta', { thinking: choice.delta.reasoning_content });
          }

          if (choice.delta?.content) {
            if (inThinking) {
              sendSSE(res, 'thinking_stop', {});
              inThinking = false;
            }
            sendSSE(res, 'text_delta', { text: choice.delta.content });
          }

          if (choice.delta?.tool_calls) {
            if (inThinking) { sendSSE(res, 'thinking_stop', {}); inThinking = false; }
            for (const tc of choice.delta.tool_calls) {
              if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: '', name: '', arguments: '' };
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
            }
          }

          if (choice.finish_reason) {
            if (inThinking) { sendSSE(res, 'thinking_stop', {}); inThinking = false; }
            lastFinishReason = choice.finish_reason;
            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
              for (const idx of Object.keys(toolCalls)) {
                const tc = toolCalls[idx];
                let parsedArgs = {};
                try { parsedArgs = JSON.parse(tc.arguments || '{}'); } catch {}
                sendSSE(res, 'tool_use', { id: tc.id, name: tc.name, input: parsedArgs });
              }
            }
          }
        } catch {}
      }
    }

    if (inThinking) sendSSE(res, 'thinking_stop', {});

    let stopReason;
    if (Object.keys(toolCalls).length > 0) stopReason = 'tool_use';
    else if (lastFinishReason === 'length') stopReason = 'max_tokens';
    else stopReason = 'end_turn';

    sendSSE(res, 'done', { model, stopReason });
    res.end();
  }

  // ── Consequence Engine: intercept streamed text for post-stream prediction extraction ──
  // We monkey-patch res.write to capture text_delta events, then run extraction on res.end.
  function attachConsequenceExtractor(res, userId, conversationId, model) {
    if (!ctx.consequenceEngine) return;

    let accumulatedText = '';
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    res.write = function (chunk, ...rest) {
      // Capture text from SSE text_delta events
      // Format: "event: text_delta\ndata: {"type":"text_delta","text":"..."}\n\n"
      if (typeof chunk === 'string' && chunk.includes('text_delta')) {
        try {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (parsed.type === 'text_delta' && parsed.text) {
              accumulatedText += parsed.text;
            }
          }
        } catch { /* ignore parse errors in hot path */ }
      }
      return originalWrite(chunk, ...rest);
    };

    res.end = function (...args) {
      // Fire-and-forget: extract predictions from accumulated text after stream completes
      if (accumulatedText.length > 80) {
        try {
          ctx.consequenceEngine.recordPredictionsFromStream(
            userId, conversationId || '', messageId, accumulatedText, model || ''
          );
        } catch (e) {
          console.warn('[ConsequenceEngine] Post-stream extraction error:', e.message);
        }
      }
      return originalEnd(...args);
    };
  }

  app.post('/api/chat/stream', requireAuth, checkPlanLimits, async (req, res) => {
    const { messages, model, provider, system, systemPrompt, tools, thinking, thinkingBudget, maxTokens, temperature } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    setupSSE(res);

    // Attach consequence engine prediction extraction (intercepts res.write/res.end)
    attachConsequenceExtractor(res, req.userId, req.body.conversationId, model);

    try {
      const isAnthropic = provider === 'anthropic' || model?.startsWith('claude');
      const isGemini = provider === 'gemini' || model?.startsWith('gemini-');
      const isDeepSeek = provider === 'deepseek' || model?.startsWith('deepseek');

      // Server-side prompt assembly: if frontend sends '[DEPRECATED]' or no system prompt,
      // assemble from modular prompts. Otherwise use provided system prompt (backward compat).
      let sysPrompt;
      if (system && system !== '[DEPRECATED]') {
        sysPrompt = system;
      } else if (systemPrompt && systemPrompt !== '[DEPRECATED]') {
        sysPrompt = systemPrompt;
      } else {
        const mode = req.body.mode || 'regular';
        sysPrompt = assemblePrompt(mode, { additionalContext: req.body.additionalContext || '' });
      }

      // Mode detection hint (only in chat/regular mode)
      if ((!req.body.mode || req.body.mode === 'regular') && messages?.length > 0) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        const lastText = typeof lastUser?.content === 'string' ? lastUser.content
          : Array.isArray(lastUser?.content) ? lastUser.content.filter(b => b.type === 'text').map(b => b.text).join('') : '';
        if (lastText) {
          const recentTexts = messages.filter(m => m.role === 'user').slice(-5)
            .map(m => typeof m.content === 'string' ? m.content : '');
          const hint = detectMode(lastText, 'chat', recentTexts);
          if (hint.shouldSwitch) {
            sendSSE(res, 'mode_hint', { suggestedMode: hint.mode, confidence: hint.confidence, reason: hint.reason });
          }
        }
      }

      // === SPECIALIST ROUTING — intercept before streaming ===
      let specialistContext = '';

      if (messages?.length > 0) {
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const lastContent = lastUserMsg?.content;

        if (Array.isArray(lastContent)) {
          // Check for video attachments → route to Gemini for analysis
          const videoBlock = lastContent.find(b =>
            (b.type === 'video' || b.type === 'file') &&
            (b.source?.media_type?.startsWith('video/') || b.mime_type?.startsWith('video/'))
          );
          if (videoBlock && !model?.startsWith('gemini-')) {
            console.log('[Specialist] Video detected — routing to Gemini 2.5 Pro for analysis');
            const videoData = videoBlock.source?.data || videoBlock.data;
            const mimeType = videoBlock.source?.media_type || videoBlock.mime_type || 'video/mp4';
            const textParts = lastContent.filter(b => b.type === 'text').map(b => b.text).join('\n');
            const specialist = await specialistRoute('video_analysis', textParts || 'Analyze this video in detail.', {
              inlineData: { mimeType, data: videoData },
            });
            if (specialist.success) {
              specialistContext += `\n\n[SPECIALIST CONTEXT — Video Analysis by ${specialist.model}]\n${specialist.result}\n[/SPECIALIST CONTEXT]\n`;
            }
          }

          // Check for audio attachments → route to Gemini for analysis
          const audioBlock = lastContent.find(b =>
            (b.type === 'audio' || b.type === 'file') &&
            (b.source?.media_type?.startsWith('audio/') || b.mime_type?.startsWith('audio/'))
          );
          if (audioBlock && !model?.startsWith('gemini-')) {
            console.log('[Specialist] Audio detected — routing to Gemini 2.5 Flash for analysis');
            const audioData = audioBlock.source?.data || audioBlock.data;
            const mimeType = audioBlock.source?.media_type || audioBlock.mime_type || 'audio/mpeg';
            const textParts = lastContent.filter(b => b.type === 'text').map(b => b.text).join('\n');
            const specialist = await specialistRoute('audio_analysis', textParts || 'Analyze this audio in detail.', {
              inlineData: { mimeType, data: audioData },
            });
            if (specialist.success) {
              specialistContext += `\n\n[SPECIALIST CONTEXT — Audio Analysis by ${specialist.model}]\n${specialist.result}\n[/SPECIALIST CONTEXT]\n`;
            }
          }
        }

        // Check for very long input (> 100K tokens estimated) → compress
        const totalTextLength = messages.reduce((sum, m) => {
          const text = typeof m.content === 'string' ? m.content :
            Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join('') : '';
          return sum + text.length;
        }, 0);
        const estimatedTokens = Math.ceil(totalTextLength / 4);

        if (estimatedTokens > 100000 && !model?.startsWith('gemini-')) {
          console.log(`[Specialist] Long context detected (~${estimatedTokens} tokens) — compressing`);
          const olderMessages = messages.slice(0, -3).map(m =>
            typeof m.content === 'string' ? m.content : ''
          ).join('\n').slice(0, 200000);

          if (olderMessages.length > 10000) {
            const specialist = await specialistRoute('context_compression', olderMessages);
            if (specialist.success) {
              specialistContext += `\n\n[SPECIALIST CONTEXT — Compressed Earlier Conversation]\n${specialist.result}\n[/SPECIALIST CONTEXT]\n`;
            }
          }
        }
      }

      // Inject specialist context into system prompt if we have any
      if (specialistContext) {
        sysPrompt += specialistContext;
      }
      // === END SPECIALIST ROUTING ===

      if (isAnthropic) {
        await streamAnthropicToSSE(res, { model, messages, system: sysPrompt, tools, thinking, thinkingBudget, maxTokens, temperature });
      } else if (isGemini) {
        const thinkingLevel = req.body.thinkingLevel || (thinking ? 'high' : undefined);
        await streamGeminiToSSE(res, { model, messages, system: sysPrompt, tools, maxTokens, temperature, thinkingLevel });
      } else if (isDeepSeek) {
        await streamDeepSeekToSSE(res, { model, messages, system: sysPrompt, tools, maxTokens, temperature });
      } else {
        await streamOpenAIToSSE(res, { model, messages, system: sysPrompt, tools, maxTokens, temperature });
      }
    } catch (error) {
      console.error('[Stream] Error:', error.message);
      try { sendSSE(res, 'error', { error: error.message }); } catch {}
      try { res.end(); } catch {}
    }
  });

  // Continuation endpoint (same as stream but for tool result follow-ups)
  app.post('/api/chat/continue', requireAuth, checkPlanLimits, async (req, res) => {
    const { messages, model, provider, system, systemPrompt, tools, thinking, thinkingBudget, maxTokens, temperature } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    // Note: No consequence extraction on continuations — predictions extracted on initial stream only

    setupSSE(res);

    try {
      const isAnthropic = provider === 'anthropic' || model?.startsWith('claude');
      const isGemini = provider === 'gemini' || model?.startsWith('gemini-');
      const isDeepSeek = provider === 'deepseek' || model?.startsWith('deepseek');

      // Server-side prompt assembly (same logic as /api/chat/stream, no mode detection on continuations)
      let sysPrompt;
      if (system && system !== '[DEPRECATED]') {
        sysPrompt = system;
      } else if (systemPrompt && systemPrompt !== '[DEPRECATED]') {
        sysPrompt = systemPrompt;
      } else {
        const mode = req.body.mode || 'regular';
        sysPrompt = assemblePrompt(mode, { additionalContext: req.body.additionalContext || '' });
      }

      if (isAnthropic) {
        await streamAnthropicToSSE(res, { model, messages, system: sysPrompt, tools, thinking, thinkingBudget, maxTokens, temperature });
      } else if (isGemini) {
        const thinkingLevel = req.body.thinkingLevel || (thinking ? 'high' : undefined);
        await streamGeminiToSSE(res, { model, messages, system: sysPrompt, tools, maxTokens, temperature, thinkingLevel });
      } else if (isDeepSeek) {
        await streamDeepSeekToSSE(res, { model, messages, system: sysPrompt, tools, maxTokens, temperature });
      } else {
        await streamOpenAIToSSE(res, { model, messages, system: sysPrompt, tools, maxTokens, temperature });
      }
    } catch (error) {
      console.error('[Continue] Error:', error.message);
      const errMsg = error.message === 'fetch failed'
        ? 'AI provider unreachable — the continuation request to the AI provider failed. This is usually a transient network issue. Please try again.'
        : error.message;
      try { sendSSE(res, 'error', { error: errMsg, details: error.message }); } catch {}
      try { res.end(); } catch {}
    }
  });

  // Expose specialistRoute on ctx for misc.js /api/specialist endpoint
  ctx.specialistRoute = specialistRoute;
}
