/**
 * Settings Helper Components
 *
 * Shared presentational components used across all settings sections.
 */

export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      <p className="text-sm text-text-tertiary">{description}</p>
    </div>
  );
}

export function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary p-4">
      <label className="mb-2 block text-sm font-medium text-text-primary">{title}</label>
      {children}
    </div>
  );
}

export function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between rounded-xl border border-border-primary bg-background-secondary p-4 ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <p className="font-medium text-text-primary">{label}</p>
        <p className="text-sm text-text-tertiary">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? 'bg-brand-primary' : 'bg-background-tertiary'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
