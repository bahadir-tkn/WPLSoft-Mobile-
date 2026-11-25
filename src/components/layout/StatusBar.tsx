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
  hidden?: boolean;
  /**
   * Masaüstünde Ağ / Step / Lojik bilgisi zaten diyagramın sol üstünde gösterildiği için
   * alt çubukta tekrar edilmez. Sadece telefon/tablet görünümünde burada gösterilir.
   */
  showCursorInfo?: boolean;
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
  hidden = false,
  showCursorInfo = true,
}) => {
  if (hidden) return null;

  return (
    <footer className="shrink-0 bg-[#ECEFF4] border-t border-[#CBD2DC] px-2.5 sm:px-3.5 py-1 text-[11px] text-[#475569] flex items-center justify-between gap-2 overflow-hidden">
      <div className="flex items-center gap-2 sm:gap-2.5 whitespace-nowrap min-w-0">
        {isOnline ? (
          <>
            <span
              className={`font-mono font-semibold ${
                isRunning ? 'text-[#007A33]' : 'text-[#B91C1C]'
              }`}
            >
              {isRunning ? 'RUN' : 'STOP'}
            </span>
            <span className="text-[#94A3B8]" aria-hidden="true">
              ·
            </span>
            <span className="font-mono">
              Tarama #{scanCount} ({scanTimeMs}ms)
            </span>
          </>
        ) : (
          <>
            {showCursorInfo && (
              <>
                <span className="font-mono text-[#0F172A]">
                  Ağ {String(cursor.rungIndex).padStart(3, '0')}:{cursor.rowIndex} · Sütun {cursor.colIndex}
                </span>
                <span className="hidden sm:inline text-[#94A3B8]" aria-hidden="true">
                  ·
                </span>
              </>
            )}
            <span className="hidden sm:inline font-mono">
              {modelSpec.onboardInputCount} DI / {modelSpec.onboardOutputCount} DO
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-2.5 whitespace-nowrap shrink-0">
        {!isOnline && (
          <>
            <span className="hidden md:inline font-mono text-[#0B4EA2] font-medium">
              {activeToolDef.shortcut} {activeToolDef.shortLabel}
            </span>
            <span className="hidden md:inline text-[#94A3B8]" aria-hidden="true">
              ·
            </span>
          </>
        )}
        <span className="font-mono">{stepCount} Step</span>
        <span className="hidden sm:inline text-[#94A3B8]" aria-hidden="true">
          ·
        </span>
        <span className="hidden sm:inline font-mono">{editableRungCount} Ağ</span>
        {(errorCount > 0 || warningCount > 0) && (
          <>
            <span className="text-[#94A3B8]" aria-hidden="true">
              ·
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
              ·
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
