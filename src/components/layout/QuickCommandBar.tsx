import React, { useState } from 'react';
import { CornerDownLeft, Terminal } from 'lucide-react';

interface QuickCommandBarProps {
  onExecuteCommand: (command: string) => { ok: boolean; error?: string };
}

export const QuickCommandBar: React.FC<QuickCommandBarProps> = ({
  onExecuteCommand,
}) => {
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    const res = onExecuteCommand(trimmed);
    if (res.ok) {
      setCommand('');
      setError(null);
    } else {
      setError(res.error ?? 'Geçersiz komut.');
    }
  };

  return (
    <div className="shrink-0 bg-[#F8FAFC] border-b border-[#CBD2DC] px-2.5 sm:px-3.5 py-1.5">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 max-w-[1440px]"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#475569] shrink-0">
          <Terminal className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
          <label htmlFor="quick-cmd-input" className="hidden sm:inline">
            Komut Girişi:
          </label>
        </div>

        <input
          id="quick-cmd-input"
          type="text"
          data-testid="quick-command-input"
          value={command}
          onChange={(e) => {
            setCommand(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Örn: LD X0, ANI X1, OR Y0, OUT Y0, TMR T0 K50, MOV K10 D0"
          autoComplete="off"
          spellCheck={false}
          className={`flex-1 min-w-0 h-7 px-2.5 rounded border font-mono text-xs bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 ${
            error
              ? 'border-[#DC2626] focus:ring-[#DC2626]/25'
              : 'border-[#B8C2D1] focus:border-[#0B4EA2] focus:ring-[#0B4EA2]/20'
          }`}
        />

        <button
          type="submit"
          data-testid="quick-command-submit"
          disabled={!command.trim()}
          className="h-7 px-2.5 rounded bg-[#0B4EA2] hover:bg-[#073878] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
        >
          <CornerDownLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Uygula</span>
        </button>
      </form>

      {error && (
        <p
          role="alert"
          data-testid="quick-command-error"
          className="mt-1 text-[11px] text-[#B91C1C] font-medium"
        >
          {error}
        </p>
      )}
    </div>
  );
};
