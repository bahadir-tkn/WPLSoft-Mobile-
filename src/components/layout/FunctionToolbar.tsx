import React from 'react';
import type { FunctionToolId } from '../../types/plc';
import { FUNCTION_TOOLBAR_ITEMS } from '../../core/plcModels';

interface FunctionToolbarProps {
  activeTool: FunctionToolId;
  onSelectTool: (toolId: FunctionToolId) => void;
  /** Hidden on mobile portrait and phone landscape where compact touch palette is used */
  hidden?: boolean;
}

const ToolSymbolGlyph: React.FC<{ toolId: FunctionToolId; active: boolean }> = ({
  toolId,
  active,
}) => {
  const strokeColor = active ? '#0B4EA2' : '#0B4EA2';
  const mutedStroke = '#334155';

  switch (toolId) {
    case 'F1':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="1" y1="9" x2="12" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <line x1="12" y1="2" x2="12" y2="16" stroke={strokeColor} strokeWidth="2.2" />
          <line x1="24" y1="2" x2="24" y2="16" stroke={strokeColor} strokeWidth="2.2" />
          <line x1="24" y1="9" x2="35" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
        </svg>
      );
    case 'F2':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="1" y1="9" x2="12" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <line x1="12" y1="2" x2="12" y2="16" stroke={strokeColor} strokeWidth="2.2" />
          <line x1="24" y1="2" x2="24" y2="16" stroke={strokeColor} strokeWidth="2.2" />
          <line x1="22" y1="3" x2="14" y2="15" stroke={strokeColor} strokeWidth="2" />
          <line x1="24" y1="9" x2="35" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
        </svg>
      );
    case 'F3':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="1" y1="9" x2="10" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <line x1="10" y1="2" x2="10" y2="16" stroke={strokeColor} strokeWidth="2.2" />
          <line x1="26" y1="2" x2="26" y2="16" stroke={strokeColor} strokeWidth="2.2" />
          <path d="M18 14V4M15 7l3-3 3 3" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="26" y1="9" x2="35" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
        </svg>
      );
    case 'F4':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="1" y1="9" x2="10" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <line x1="10" y1="2" x2="10" y2="16" stroke={strokeColor} strokeWidth="2.2" />
          <line x1="26" y1="2" x2="26" y2="16" stroke={strokeColor} strokeWidth="2.2" />
          <path d="M18 4v10M15 11l3 3 3-3" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="26" y1="9" x2="35" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
        </svg>
      );
    case 'F5':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="1" y1="9" x2="7" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <rect x="7" y="2" width="22" height="14" rx="1.5" stroke={strokeColor} strokeWidth="1.8" />
          <text x="18" y="12.5" textAnchor="middle" fill={strokeColor} fontSize="9" fontWeight="700" fontFamily="JetBrains Mono, monospace">
            = &gt;
          </text>
          <line x1="29" y1="9" x2="35" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
        </svg>
      );
    case 'F6':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="1" y1="9" x2="6" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <path d="M10 2H6v14h4M26 2h4v14h-4" stroke={strokeColor} strokeWidth="2" />
          <text x="18" y="12" textAnchor="middle" fill={strokeColor} fontSize="7.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
            TMR
          </text>
          <line x1="30" y1="9" x2="35" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
        </svg>
      );
    case 'F7':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="1" y1="9" x2="11" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <path d="M14 2.5C10.5 5 10.5 13 14 15.5" stroke={strokeColor} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M22 2.5C25.5 5 25.5 13 22 15.5" stroke={strokeColor} strokeWidth="2.2" strokeLinecap="round" />
          <line x1="25" y1="9" x2="35" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
        </svg>
      );
    case 'F8':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="1" y1="9" x2="7" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <path d="M10 2.5C7 5 7 13 10 15.5M26 2.5C29 5 29 13 26 15.5" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
          <text x="18" y="12" textAnchor="middle" fill={strokeColor} fontSize="7.5" fontWeight="700" fontFamily="JetBrains Mono, monospace">
            S/R
          </text>
          <line x1="29" y1="9" x2="35" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
        </svg>
      );
    case 'F9':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="3" y1="9" x2="33" y2="9" stroke={strokeColor} strokeWidth="2.4" />
        </svg>
      );
    case 'F10':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <rect x="12" y="2" width="18" height="9" stroke={mutedStroke} strokeWidth="1.4" strokeDasharray="3 2" />
          <line x1="12" y1="1" x2="12" y2="17" stroke={strokeColor} strokeWidth="2.4" />
        </svg>
      );
    case 'F11':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <line x1="4" y1="4" x2="4" y2="14" stroke={mutedStroke} strokeWidth="2" />
          <line x1="4" y1="9" x2="12" y2="9" stroke={mutedStroke} strokeWidth="1.8" />
          <path d="M22 4v10M17 9h10" stroke="#0B4EA2" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    case 'F12':
      return (
        <svg viewBox="0 0 36 18" className="w-8 h-4" fill="none" aria-hidden="true">
          <path d="M13 4l10 10M23 4L13 14" stroke="#B91C1C" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
  }
};

export const FunctionToolbar: React.FC<FunctionToolbarProps> = ({
  activeTool,
  onSelectTool,
  hidden = false,
}) => {
  if (hidden) return null;

  return (
    <div
      role="toolbar"
      aria-label="WPLSoft F1-F12 Sembol Araç Çubuğu"
      className="shrink-0 bg-[#EAECEF] border-b border-[#CBD2DC] px-2.5 py-1"
    >
      <div className="flex items-center gap-1 overflow-x-auto wpl-no-scrollbar">
        {FUNCTION_TOOLBAR_ITEMS.map((item) => {
          const isActive = activeTool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTool(item.id)}
              aria-pressed={isActive}
              aria-label={`${item.shortcut} ${item.label} (${item.mnemonic})`}
              title={`${item.shortcut} — ${item.label}: ${item.description}`}
              className={`group relative flex flex-col items-center justify-center flex-1 basis-0 min-w-[60px] max-w-[88px] min-h-[42px] px-1 py-0.5 rounded-[4px] border text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B4EA2] ${
                isActive
                  ? 'bg-white border-[#0B4EA2] shadow-[inset_0_0_0_1px_rgba(11,78,162,0.18)]'
                  : 'bg-[#F8FAFC] border-[#CBD2DC] hover:bg-white hover:border-[#8FA3BF]'
              }`}
            >
              <span
                className={`absolute top-0.5 left-1 text-[9px] font-mono font-bold leading-none ${
                  isActive ? 'text-[#0B4EA2]' : 'text-[#64748B]'
                }`}
              >
                {item.shortcut}
              </span>
              <div className="mt-1.5">
                <ToolSymbolGlyph toolId={item.id} active={isActive} />
              </div>
              <span
                className={`text-[10px] font-semibold leading-tight whitespace-nowrap ${
                  isActive ? 'text-[#0B4EA2]' : 'text-[#334155]'
                }`}
              >
                {item.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
