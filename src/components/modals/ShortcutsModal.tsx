import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { FUNCTION_TOOLBAR_ITEMS } from '../../core/plcModels';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      className="fixed inset-0 z-50 bg-[#0F172A]/45 flex items-center justify-center p-3 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-[#BFC7D5] rounded-md shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 bg-[#F4F6F9] border-b border-[#CBD2DC] flex items-center justify-between gap-3">
          <h2 id="shortcuts-modal-title" className="text-sm font-bold text-[#0F172A]">
            WPLSoft Klavye Kısayolları ve Desteklenen Delta Komutları
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kısayollar penceresini kapat"
            className="w-8 h-8 rounded flex items-center justify-center text-[#475569] hover:bg-[#E2E8F0] hover:text-[#0F172A] cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto wpl-scrollbar space-y-4 text-xs text-[#1E293B]">
          <section>
            <h3 className="font-bold text-[#0F172A] mb-2">F1 – F12 Sembol Kısayolları</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {FUNCTION_TOOLBAR_ITEMS.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <kbd className="font-mono font-bold text-[#0B4EA2] bg-white border border-[#CBD2DC] rounded px-1.5 py-0.5 text-[11px]">
                      {item.shortcut}
                    </kbd>
                    <span className="truncate font-medium">{item.label}</span>
                  </div>
                  <span className="font-mono text-[11px] text-[#64748B] shrink-0">
                    {item.mnemonic}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border border-[#DDE3EC] rounded p-3 space-y-1.5">
              <h3 className="font-bold text-[#0F172A]">Izgara Gezinme Tuşları</h3>
              <div className="flex justify-between">
                <span className="text-[#475569]">Hücreler arası gezinme</span>
                <kbd className="font-mono font-semibold text-[#0B4EA2]">↑ ↓ ← →</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-[#475569]">Satır başı / Çıkış sütunu</span>
                <kbd className="font-mono font-semibold text-[#0B4EA2]">Home / End</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-[#475569]">Yeni satır ekle</span>
                <kbd className="font-mono font-semibold text-[#0B4EA2]">F11</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-[#475569]">Ara &amp; Kullanılan Adresler</span>
                <kbd className="font-mono font-semibold text-[#0B4EA2]">Ctrl+F</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-[#475569]">Geri Al / İleri Al</span>
                <kbd className="font-mono font-semibold text-[#0B4EA2]">Ctrl+Z / Ctrl+Y</kbd>
              </div>
            </div>

            <div className="border border-[#DDE3EC] rounded p-3 space-y-1.5">
              <h3 className="font-bold text-[#0F172A]">PC WPLSoft IL Uyumluluğu</h3>
              <p className="text-[#475569] leading-relaxed">
                Desteklenen komutlar:{' '}
                <span className="font-mono text-[#0F172A]">
                  LD, LDI, LDP, LDF, AND, ANI, ANDP, ANDF, OR, ORI, ORP, ORF, ANB, ORB, MPS, MRD, MPP, LD=..LD&lt;&gt;, OUT, SET, RST, TMR, CNT, MOV, ALT, ZRST, CMP, ADD, SUB, MUL, DIV, SQR, DMOVR, DADDR..DDIVR, DESQR, FLT, INC, INCP, DEC, DECP, TRD, TWR, TWRP, TZCP, END
                </span>
                . Kopyalanan / dışa aktarılan IL çıktıları PC WPLSoft&apos;a doğrudan{' '}
                <span className="font-mono">Ctrl+V</span> ile yapıştırılabilmesi için satır numarasız saf komut formatında üretilir.
              </p>
            </div>
          </section>
        </div>

        <div className="px-4 py-2.5 bg-[#F4F6F9] border-t border-[#CBD2DC] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded bg-[#0B4EA2] text-white text-xs font-medium hover:bg-[#073878] transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
