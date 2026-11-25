import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileCode2,
  X,
  XCircle,
} from 'lucide-react';
import type { CompileResult, IlOpcode } from '../../types/plc';
import { copyTextToClipboard } from '../../core/clipboard';

import { commentForInstruction } from '../../core/commentExport';

interface IlCodeDrawerProps {
  compileResult: CompileResult;
  /** Aygıt açıklamaları: WPLSoft komut ekranındaki gibi satırın sağında gösterilir. */
  deviceComments?: Record<string, string>;
  activeRungIndex: number;
  isOnline?: boolean;
  onSelectRung: (rungIndex: number) => void;
  onSelectDiagnosticCell?: (rungIndex: number, rowIndex: number, colIndex: number) => void;
  onOpenProjectIo?: () => void;
  onClose?: () => void;
  onNotify: (msg: string) => void;
}

function opcodeColorClass(opcode: IlOpcode): string {
  if (opcode === 'END') return 'text-[#64748B] font-bold';
  if (
    opcode === 'OUT' ||
    opcode === 'SET' ||
    opcode === 'RST' ||
    opcode === 'TMR' ||
    opcode === 'CNT' ||
    opcode === 'MOV' ||
    opcode === 'ALT' ||
    opcode === 'ALTP' ||
    opcode === 'ZRST' ||
    opcode === 'CMP' ||
    opcode === 'ADD' ||
    opcode === 'SUB' ||
    opcode === 'MUL' ||
    opcode === 'DIV' ||
    opcode === 'SQR' ||
    opcode === 'DMOVR' ||
    opcode === 'DADDR' ||
    opcode === 'DSUBR' ||
    opcode === 'DMULR' ||
    opcode === 'DDIVR' ||
    opcode === 'DESQR' ||
    opcode === 'FLT' ||
    opcode === 'INC' ||
    opcode === 'INCP' ||
    opcode === 'DEC' ||
    opcode === 'DECP' ||
    opcode === 'TRD' ||
    opcode === 'TWR' ||
    opcode === 'TWRP' ||
    opcode === 'TZCP'
  ) {
    return 'text-[#0F766E] font-bold';
  }
  return 'text-[#0B4EA2] font-bold';
}

export const IlCodeDrawer: React.FC<IlCodeDrawerProps> = ({
  compileResult,
  deviceComments = {},
  activeRungIndex,
  isOnline = false,
  onSelectRung,
  onSelectDiagnosticCell,
  onOpenProjectIo,
  onClose,
  onNotify,
}) => {
  const [copied, setCopied] = useState(false);

  const errorCount = compileResult.diagnostics.filter(
    (d) => d.severity === 'error'
  ).length;
  const warningCount = compileResult.diagnostics.filter(
    (d) => d.severity === 'warning'
  ).length;

  const handleCopyRawIl = async () => {
    const ok = await copyTextToClipboard(compileResult.rawIlText);
    if (ok) {
      setCopied(true);
      onNotify(
        'Saf Delta IL kodu panoya kopyalandı (satır numarasız). WPLSoft\'ta komut (Instruction) ekranına yapıştırın.'
      );
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      onNotify('Panoya erişilemedi; IL metnini manuel seçerek kopyalayabilirsiniz.');
    }
  };

  return (
    <aside
      aria-label="Instruction List (IL) ve Derleme Paneli"
      className="flex flex-col h-full bg-white border-l border-[#BFC7D5]"
    >
      {/* Header */}
      <div className="shrink-0 bg-[#F4F6F9] border-b border-[#CBD2DC] px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileCode2 className="w-4 h-4 text-[#0B4EA2] shrink-0" aria-hidden="true" />
          <h2 className="text-xs font-bold text-[#0F172A] whitespace-nowrap">
            IL Kodu
          </h2>
          <span className="text-[11px] font-mono text-[#64748B] whitespace-nowrap">
            · {compileResult.stepCount} Step
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopyRawIl}
            aria-label="PC WPLSoft için saf IL kodunu kopyala"
            className="h-7 px-2 rounded border border-[#B8C2D1] bg-white hover:bg-[#EDF4FC] hover:border-[#0B4EA2] text-[11px] font-semibold text-[#0B4EA2] flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#16A34A]" aria-hidden="true" />
                <span className="text-[#166534]">Kopyalandı</span>
              </>
            ) : (
              <>
                <ClipboardCopy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Kopyala</span>
              </>
            )}
          </button>
          {onOpenProjectIo && (
            <button
              type="button"
              disabled={isOnline}
              onClick={onOpenProjectIo}
              aria-label="IL veya JSON olarak dışa ya da içe aktar"
              title="PC WPLSoft .il / .txt / .json İçe-Dışa Aktar"
              className="h-7 w-7 rounded border border-[#B8C2D1] bg-white hover:bg-[#EDF4FC] hover:border-[#0B4EA2] disabled:opacity-35 disabled:pointer-events-none text-[#0B4EA2] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="IL panelini kapat"
              title="IL panelini kapat"
              className="h-7 w-7 rounded border border-[#B8C2D1] bg-white hover:bg-[#EDF2F8] text-[#475569] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* IL Instructions List */}
      <div
        className="flex-1 overflow-y-auto wpl-scrollbar bg-[#FAFBFD] font-mono text-xs divide-y divide-[#EEF2F6]"
        data-testid="il-code-list"
      >
        {compileResult.instructions.length === 0 ? (
          <div className="p-4 text-center text-[#64748B] font-sans text-xs">
            Henüz komut üretilmedi.
          </div>
        ) : (
          compileResult.instructions.map((inst, idx) => {
            const isActiveRung = inst.rungIndex === activeRungIndex;
            return (
              <button
                key={`${inst.stepAddress}-${idx}`}
                type="button"
                onClick={() => onSelectRung(inst.rungIndex)}
                className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors cursor-pointer ${
                  isActiveRung ? 'bg-[#E6F0FC]/70' : 'hover:bg-[#F1F5F9]'
                }`}
              >
                <span
                  className="w-10 text-right text-[11px] text-[#94A3B8] select-none shrink-0"
                  aria-hidden="true"
                >
                  {String(inst.stepAddress).padStart(4, '0')}
                </span>
                <span className={`w-14 shrink-0 ${opcodeColorClass(inst.opcode)}`}>
                  {inst.opcode}
                </span>
                <span className="text-[#0F172A] font-medium truncate">
                  {inst.operands.join(' ')}
                </span>
                {(() => {
                  const c = commentForInstruction(inst.opcode, inst.operands, deviceComments);
                  return c ? (
                    <span className="ml-auto pl-2 font-sans text-[11px] text-[#64748B] truncate max-w-[45%]">
                      {c}
                    </span>
                  ) : null;
                })()}
              </button>
            );
          })
        )}
      </div>

      {/* Paste compatibility note */}
      <div className="shrink-0 bg-[#F4F6F9] border-t border-[#E2E8F0] px-3 py-1.5 text-[11px] text-[#64748B]">
        Kopyalanan çıktı satır numarasızdır; WPLSoft&apos;un komut (Instruction) ekranı içindir. Aktarma adımları: Dosya / IL → Dışa Aktar.
      </div>

      {/* Compile Diagnostics Section */}
      <div
        className="shrink-0 max-h-[210px] overflow-y-auto wpl-scrollbar border-t border-[#CBD2DC] bg-white"
        data-testid="compile-diagnostics"
      >
        <div className="px-3 py-1.5 bg-[#F4F6F9] border-b border-[#E2E8F0] flex items-center justify-between text-[11px] font-semibold">
          <span className="text-[#0F172A]">Derleme Çıktısı</span>
          <span className="font-mono text-[#475569]">
            {errorCount} Hata · {warningCount} Uyarı
          </span>
        </div>

        {compileResult.diagnostics.length === 0 ? (
          <div className="px-3 py-2.5 flex items-center gap-2 text-xs text-[#166534]">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" aria-hidden="true" />
            <span>Derleme temiz. Sözdizimi veya çift bobin uyarısı yok.</span>
          </div>
        ) : (
          <ul className="divide-y divide-[#F1F5F9]">
            {compileResult.diagnostics.map((diag, idx) => (
              <li key={`${diag.code}-${idx}`}>
                <button
                  type="button"
                  data-testid={`diagnostic-item-${idx}`}
                  onClick={() => {
                    if (diag.rungIndex !== undefined) {
                      if (onSelectDiagnosticCell) {
                        onSelectDiagnosticCell(
                          diag.rungIndex,
                          diag.rowIndex ?? 0,
                          diag.colIndex ?? 0
                        );
                      } else {
                        onSelectRung(diag.rungIndex);
                      }
                    }
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-[#F8FAFC] flex items-start gap-2 text-[11px] cursor-pointer"
                >
                  {diag.severity === 'error' ? (
                    <XCircle
                      className="w-3.5 h-3.5 text-[#DC2626] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle
                      className="w-3.5 h-3.5 text-[#D97706] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div
                      className={
                        diag.severity === 'error' ? 'text-[#991B1B]' : 'text-[#92400E]'
                      }
                    >
                      {diag.message}
                    </div>
                    {diag.rungIndex !== undefined && (
                      <div className="font-mono text-[10px] text-[#64748B]">
                        Ağ {String(diag.rungIndex).padStart(3, '0')}
                        {diag.rowIndex !== undefined ? ` · Satır ${diag.rowIndex}` : ''}
                        {diag.colIndex !== undefined ? ` · Sütun ${diag.colIndex}` : ''} (Git)
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};
