/**
 * Web Search Tool - Brave Search Integration
 *
 * Provides web search capabilities using Brave Search API.
 */

import type { Tool, ToolContext, ToolResult } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface WebSearchInput {
  query: string;
  count?: number;
  freshness?: 'day' | 'week' | 'month' | 'year';
  safesearch?: 'off' | 'moderate' | 'strict';
}

interface SearchResult {
  title: string;
  url: string;
  description: string;
  publishedDate?: string;
  source?: string;
}

// ============================================================================
// BRAVE SEARCH IMPLEMENTATION
// ============================================================================

async function searchBrave(
  query: string,
  apiKey: string,
  options: { count?: number; freshness?: string; safesearch?: string }
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(options.count || 10),
  });

  if (options.freshness) {
    params.set('freshness', options.freshness);
  }
  if (options.safesearch) {
    params.set('safesearch', options.safesearch);
  }

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Brave Search API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return (data.web?.results || []).map((result: any) => ({
    title: result.title,
    url: result.url,
    description: result.description,
    publishedDate: result.age,
    source: result.meta_url?.hostname,
  }));
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web for current information, news, facts, and research. Use this when you need up-to-date information or to verify facts.',
  category: 'web_search',
  riskLevel: 'low',
  requiresApproval: false,

  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Be specific and include relevant keywords.',
      },
      count: {
        type: 'number',
        description: 'Number of results to return (1-20)',
        default: 5,
      },
      freshness: {
        type: 'string',
        description: 'Time range for results',
        enum: ['day', 'week', 'month', 'year'],
      },
      safesearch: {
        type: 'string',
        description: 'Safe search setting',
        enum: ['off', 'moderate', 'strict'],
        default: 'moderate',
      },
    },
    required: ['query'],
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { query, count = 5, freshness, safesearch = 'moderate' } = input as WebSearchInput;
    const startTime = Date.now();

    context.onLog?.('info', `Searching web for: "${query}"`);
    context.onProgress?.(10, 'Initiating search...');

    try {
      // Get API key from environment
      const apiKey = import.meta.env.VITE_BRAVE_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          output: null,
          error: {
            code: 'API_KEY_MISSING',
            message: 'Brave Search API key not configured',
            recoverable: false,
            suggestedAction: 'Add VITE_BRAVE_API_KEY to your environment variables',
          },
        };
      }

      context.onProgress?.(30, 'Querying Brave Search...');

      const results = await searchBrave(query, apiKey, {
        count: Math.min(count, 20),
        freshness,
        safesearch,
      });

      context.onProgress?.(80, 'Processing results...');

      // Format results for AI consumption
      const formattedResults = results.map((r, i) => ({
        position: i + 1,
        ...r,
      }));

      const summary = `Found ${results.length} results for "${query}"`;

      context.onProgress?.(100, 'Search complete');
      context.onLog?.('info', summary);

      return {
        success: true,
        output: {
          query,
          resultCount: results.length,
          results: formattedResults,
          summary,
        },
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: 0,
          apiCallsMade: 1,
        },
      };
    } catch (error: any) {
      context.onLog?.('error', `Search failed: ${error.message}`);

      return {
        success: false,
        output: null,
        error: {
          code: 'SEARCH_ERROR',
          message: error.message,
          recoverable: true,
          suggestedAction: 'Try a different search query or check API connectivity',
        },
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: 0,
        },
      };
    }
  },
};

// ============================================================================
// NEWS SEARCH TOOL
// ============================================================================

export const newsSearchTool: Tool = {
  name: 'news_search',
  description:
    'Search for recent news articles. Use this for current events, breaking news, and recent developments.',
  category: 'web_search',
  riskLevel: 'low',
  requiresApproval: false,

  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The news search query',
      },
      count: {
        type: 'number',
        description: 'Number of articles to return (1-20)',
        default: 5,
      },
      freshness: {
        type: 'string',
        description: 'How recent the news should be',
        enum: ['day', 'week', 'month'],
        default: 'week',
      },
    },
    required: ['query'],
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { query, count = 5, freshness = 'week' } = input as {
      query: string;
      count?: number;
      freshness?: string;
    };
    const startTime = Date.now();

    try {
      const apiKey = import.meta.env.VITE_BRAVE_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          output: null,
          error: {
            code: 'API_KEY_MISSING',
            message: 'Brave Search API key not configured',
            recoverable: false,
          },
        };
      }

      const params = new URLSearchParams({
        q: query,
        count: String(Math.min(count, 20)),
        freshness,
      });

      const response = await fetch(`https://api.search.brave.com/res/v1/news/search?${params}`, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`News search failed: ${response.status}`);
      }

      const data = await response.json();

      const articles = (data.results || []).map((article: any, i: number) => ({
        position: i + 1,
        title: article.title,
        url: article.url,
        description: article.description,
        source: article.meta_url?.hostname || article.source,
        publishedAt: article.age || article.page_age,
        thumbnail: article.thumbnail?.src,
      }));

      return {
        success: true,
        output: {
          query,
          articleCount: articles.length,
          articles,
        },
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: 0,
          apiCallsMade: 1,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: {
          code: 'NEWS_SEARCH_ERROR',
          message: error.message,
          recoverable: true,
        },
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: 0,
        },
      };
    }
  },
};
