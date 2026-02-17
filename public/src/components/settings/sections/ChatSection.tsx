/**
 * Chat Settings Section
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';

export function ChatSection() {
  const chat = useSettingsStore((state) => state.chat);
  const updateChatPreferences = useSettingsStore((state) => state.updateChatPreferences);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Chat Preferences"
        description="Customize the chat experience"
      />

      <SettingToggle
        label="Auto Scroll"
        description="Automatically scroll to new messages"
        checked={chat.autoScroll}
        onChange={(checked) => updateChatPreferences({ autoScroll: checked })}
      />

      <SettingToggle
        label="Show Timestamps"
        description="Display message timestamps"
        checked={chat.showTimestamps}
        onChange={(checked) => updateChatPreferences({ showTimestamps: checked })}
      />

      <SettingToggle
        label="Show Token Count"
        description="Display token usage for messages"
        checked={chat.showTokenCount}
        onChange={(checked) => updateChatPreferences({ showTokenCount: checked })}
      />

      <SettingToggle
        label="Show Thinking"
        description="Display AI reasoning process"
        checked={chat.showThinking}
        onChange={(checked) => updateChatPreferences({ showThinking: checked })}
      />

      <SettingToggle
        label="Markdown Rendering"
        description="Render markdown in messages"
        checked={chat.markdownRendering}
        onChange={(checked) => updateChatPreferences({ markdownRendering: checked })}
      />

      <SettingsCard title="Code Theme">
        <select
          value={chat.codeTheme}
          onChange={(e) => updateChatPreferences({ codeTheme: e.target.value as any })}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        >
          <option value="github-dark">GitHub Dark</option>
          <option value="monokai">Monokai</option>
          <option value="dracula">Dracula</option>
          <option value="nord">Nord</option>
        </select>
      </SettingsCard>

      <SettingToggle
        label="Line Numbers"
        description="Show line numbers in code blocks"
        checked={chat.lineNumbers}
        onChange={(checked) => updateChatPreferences({ lineNumbers: checked })}
      />

      <SettingToggle
        label="Word Wrap"
        description="Wrap long lines in code blocks"
        checked={chat.wordWrap}
        onChange={(checked) => updateChatPreferences({ wordWrap: checked })}
      />
    </div>
  );
}
