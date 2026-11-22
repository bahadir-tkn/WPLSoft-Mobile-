import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, X, XCircle } from 'lucide-react';
import type { AddressRole, PlcModelId } from '../../types/plc';
import { PLC_MODELS, SPECIAL_RELAYS } from '../../core/plcModels';
import { validateAddress } from '../../core/addressing';

interface HardwareSpecModalProps {
  isOpen: boolean;
  model: PlcModelId;
  onClose: () => void;
}

const ROLE_OPTIONS: { value: AddressRole; label: string }[] = [
  { value: 'bit_contact', label: 'Kontak (LD/AND/OR)' },
  { value: 'bit_coil', label: 'Bobin (OUT/SET/RST)' },
  { value: 'timer', label: 'Zamanlayıcı (TMR)' },
  { value: 'counter', label: 'Sayıcı (CNT)' },
  { value: 'word_source', label: 'Veri Kaynağı (MOV / CMP)' },
  { value: 'word_dest', label: 'Veri Hedefi (MOV)' },
];

export const HardwareSpecModal: React.FC<HardwareSpecModalProps> = ({
  isOpen,
  model,
  onClose,
}) => {
  const [testInput, setTestInput] = useState('X10');
  const [testRole, setTestRole] = useState<AddressRole>('bit_contact');

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const spec = PLC_MODELS[model];
  const validation = validateAddress(testInput, testRole, model);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hardware-modal-title"
      className="fixed inset-0 z-50 bg-[#0F172A]/45 flex items-center justify-center p-3 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-[#BFC7D5] rounded-md shadow-xl w-full max-w-2xl max-h-[88dvh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#F4F6F9] border-b border-[#CBD2DC] flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 id="hardware-modal-title" className="text-sm font-bold text-[#0F172A]">
              {spec.label} Donanım Profili ve Sekizlik (Octal) Adresleme
            </h2>
            <p className="text-xs text-[#475569] mt-0.5">{spec.series}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Donanım penceresini kapat"
            className="w-8 h-8 rounded flex items-center justify-center text-[#475569] hover:bg-[#E2E8F0] hover:text-[#0F172A] cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 p-4 overflow-y-auto wpl-scrollbar touch-pan-y space-y-5 text-xs text-[#1E293B]">
          {/* Live Octal Address Validator */}
          <section className="bg-[#F8FAFC] border border-[#CBD2DC] rounded p-3.5">
            <h3 className="text-xs font-bold text-[#0F172A] mb-2">
              Canlı Delta Adres Doğrulayıcı
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="octal-test-input" className="block text-[11px] font-medium text-[#475569] mb-1">
                  Aygıt Adresi (örn. X7, X8, X10, Y5, M1002, D0)
                </label>
                <input
                  id="octal-test-input"
                  type="text"
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  placeholder="X10"
                  className="w-full h-9 px-2.5 rounded border border-[#B8C2D1] bg-white font-mono text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]"
                />
              </div>
              <div>
                <label htmlFor="octal-test-role" className="block text-[11px] font-medium text-[#475569] mb-1">
                  Kullanım Rolü
                </label>
                <select
                  id="octal-test-role"
                  value={testRole}
                  onChange={(e) => setTestRole(e.target.value as AddressRole)}
                  className="w-full h-9 px-2.5 rounded border border-[#B8C2D1] bg-white text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-2.5 min-h-[36px] flex items-start gap-2">
              {validation.valid ? (
                <div className="flex items-start gap-2 text-[#166534]">
                  {validation.warning ? (
                    <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <div>
                    <span className="font-mono font-bold text-[#0F172A]">
                      {validation.parsed?.normalized}
                    </span>{' '}
                    geçerli adres
                    {validation.parsed?.isOctal && (
                      <span className="text-[#475569]">
                        {' '}
                        (Sekizlik indeks: {validation.parsed.numericText} · Kanal #{validation.parsed.numericValue})
                      </span>
                    )}
                    {validation.warning && (
                      <p className="text-[#B45309] mt-0.5">{validation.warning}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-[#B91C1C]">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{validation.error}</span>
                </div>
              )}
            </div>
          </section>

          {/* Octal I/O Table */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-bold text-[#0F172A]">
              Sekizlik (Octal) Giriş / Çıkış Haritası — {spec.label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-[#DDE3EC] rounded p-3">
                <div className="font-semibold text-[#0B4EA2] mb-1.5">
                  Dijital Girişler (X0–X17 · X7 → X10)
                </div>
                <div className="grid grid-cols-4 gap-1 font-mono text-[11px]">
                  {spec.allInputs.map((addr) => {
                    const isOnboard = spec.onboardInputs.includes(addr);
                    return (
                      <div
                        key={addr}
                        className={`px-2 py-1 rounded text-center border ${
                          isOnboard
                            ? 'bg-[#EEF4FC] border-[#BBD2F3] text-[#0B4EA2] font-semibold'
                            : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B]'
                        }`}
                      >
                        {addr}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[#64748B] mt-2">
                  Mavi: Dahili CPU ({spec.onboardInputCount} DI) · Gri: Genişleme modülü
                </p>
              </div>

              <div className="border border-[#DDE3EC] rounded p-3">
                <div className="font-semibold text-[#0B4EA2] mb-1.5">
                  Dijital Çıkışlar (Y0–Y17 · Y7 → Y10)
                </div>
                <div className="grid grid-cols-4 gap-1 font-mono text-[11px]">
                  {spec.allOutputs.map((addr) => {
                    const isOnboard = spec.onboardOutputs.includes(addr);
                    return (
                      <div
                        key={addr}
                        className={`px-2 py-1 rounded text-center border ${
                          isOnboard
                            ? 'bg-[#EEF4FC] border-[#BBD2F3] text-[#0B4EA2] font-semibold'
                            : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B]'
                        }`}
                      >
                        {addr}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[#64748B] mt-2">
                  Mavi: Dahili CPU ({spec.onboardOutputCount} DO) · Gri: Genişleme modülü
                </p>
              </div>
            </div>
          </section>

          {/* Device Ranges & Special Relays */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border border-[#DDE3EC] rounded p-3">
              <h3 className="font-semibold text-[#0F172A] mb-2">
                Bellek ve Donanım Aralıkları ({spec.label})
              </h3>
              <dl className="space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-[#475569]">Sekizlik I/O Sınırı</dt>
                  <dd className="font-semibold">
                    X/Y0 – X/Y{spec.maxOctalIo.toString(8)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#475569]">Yardımcı Röleler</dt>
                  <dd className="font-semibold">
                    M{spec.relayRange.min} – M{spec.relayRange.max}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#475569]">Zamanlayıcılar (100ms)</dt>
                  <dd className="font-semibold">
                    T{spec.timerRange.min} – T{spec.timerRange.max}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#475569]">Sayıcılar (16-bit)</dt>
                  <dd className="font-semibold">
                    C{spec.counterRange.min} – C{spec.counterRange.max}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#475569]">Veri Registerları</dt>
                  <dd className="font-semibold">
                    D{spec.registerRange.min} – D{spec.registerRange.max}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#475569]">Analog Giriş / Çıkış</dt>
                  <dd className="font-semibold">
                    {spec.analogInputCount > 0
                      ? `${spec.analogInputCount} AI (D1110–D1113) · ${spec.analogOutputCount} AO`
                      : 'Genişleme Modülü ile'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#475569]">Dahili Saat (RTC)</dt>
                  <dd className="font-semibold">
                    {spec.hasRtc ? 'D1313 – D1319 (TRD)' : 'Yok'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#475569]">Program Kapasitesi</dt>
                  <dd className="font-semibold">
                    {spec.programCapacitySteps.toLocaleString('tr-TR')} Step
                  </dd>
                </div>
              </dl>
            </div>

            <div className="border border-[#DDE3EC] rounded p-3">
              <h3 className="font-semibold text-[#0F172A] mb-2">Özel Sistem Röleleri</h3>
              <ul className="space-y-1.5 max-h-[240px] overflow-y-auto wpl-scrollbar pr-1">
                {Object.values(SPECIAL_RELAYS).map((relay) => (
                  <li key={relay.address} className="text-[11px]">
                    <span className="font-mono font-bold text-[#0B4EA2]">{relay.address}</span>{' '}
                    <span className="font-medium text-[#0F172A]">{relay.name}</span>
                    <p className="text-[#64748B]">{relay.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        {/* Footer */}
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
