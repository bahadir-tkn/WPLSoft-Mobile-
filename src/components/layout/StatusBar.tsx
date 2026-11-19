import React from 'react';
import type { CursorPosition, FunctionToolDefinition, PlcModelSpec } from '../../types/plc';

interface StatusBarProps {
  modelSpec: PlcModelSpec;
  cursor: CursorPosition;
  activeToolDef: FunctionToolDefinition;
  editableRungCount: number;
  stepCount: number;
  errorCount: number;
  warningCount: number;
  isOnline: boolean;
  isRunning: boolean;
  scanCount: number;
  scanTimeMs: number;
  storageError?: string | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  modelSpec,
  cursor,
  activeToolDef,
  editableRungCount,
  stepCount,
  errorCount,
  warningCount,
  isOnline,
  isRunning,
  scanCount,
  scanTimeMs,
  storageError,
}) => {
  return (
    <footer className="shrink-0 bg-[#E6E9EF] border-t border-[#BFC7D5] px-2.5 sm:px-3 py-1.5 text-[11px] text-[#334155] flex items-center justify-between gap-2 overflow-hidden">
      <div className="flex items-center gap-2 sm:gap-3 whitespace-nowrap min-w-0">
        <span className="font-mono font-bold text-[#0B4EA2]">{modelSpec.label}</span>
        <span className="text-[#94A3B8]" aria-hidden="true">
          |
        </span>
        {isOnline ? (
          <>
            <span
              className={`font-mono font-bold ${
                isRunning ? 'text-[#007A33]' : 'text-[#B91C1C]'
              }`}
              title="Tarayıcı içi sanal PLC simülasyonu (gerçek PLC bağlantısı değildir)"
            >
              {isRunning ? 'SİMÜLASYON · RUN' : 'SİMÜLASYON · STOP'}
            </span>
            <span className="hidden sm:inline text-[#94A3B8]" aria-hidden="true">
              |
            </span>
            <span className="hidden sm:inline font-mono">
              Tarama #{scanCount} ({scanTimeMs}ms)
            </span>
          </>
        ) : (
          <>
            <span className="font-mono sm:hidden">
              {modelSpec.onboardInputCount}I/{modelSpec.onboardOutputCount}O
            </span>
            <span className="hidden sm:inline font-mono">
              {modelSpec.onboardInputCount} DI (X0–X7) / {modelSpec.onboardOutputCount} DO (Y0–
              {modelSpec.onboardOutputs[modelSpec.onboardOutputs.length - 1]})
            </span>
            <span className="text-[#94A3B8]" aria-hidden="true">
              |
            </span>
            <span className="font-mono">
              Ağ {String(cursor.rungIndex).padStart(3, '0')}:{cursor.rowIndex} · Sütun {cursor.colIndex}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3 whitespace-nowrap shrink-0">
        {!isOnline && (
          <>
            <span className="hidden md:inline font-mono text-[#0F172A]">
              {activeToolDef.shortcut} ({activeToolDef.mnemonic})
            </span>
            <span className="hidden md:inline text-[#94A3B8]" aria-hidden="true">
              |
            </span>
          </>
        )}
        <span className="font-mono">{stepCount} Step</span>
        <span className="hidden sm:inline text-[#94A3B8]" aria-hidden="true">
          |
        </span>
        <span className="hidden sm:inline font-mono">{editableRungCount} Ağ</span>
        {(errorCount > 0 || warningCount > 0) && (
          <>
            <span className="text-[#94A3B8]" aria-hidden="true">
              |
            </span>
            <span
              className={`font-mono font-semibold ${
                errorCount > 0 ? 'text-[#B91C1C]' : 'text-[#92400E]'
              }`}
            >
              {errorCount > 0 ? `${errorCount} Hata` : `${warningCount} Uyarı`}
            </span>
          </>
        )}
        {storageError && (
          <>
            <span className="text-[#94A3B8]" aria-hidden="true">
              |
            </span>
            <span
              role="alert"
              title={storageError}
              className="font-mono font-semibold text-[#B91C1C] truncate max-w-[160px]"
            >
              Kayıt Hatası
            </span>
          </>
        )}
      </div>
    </footer>
  );
};
