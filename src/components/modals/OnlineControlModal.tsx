import React, { useEffect, useState } from 'react';
import { Power, PowerOff, Sliders, X, Zap } from 'lucide-react';
import type { SimState } from '../../types/plc';
import { SPECIAL_RELAYS } from '../../core/plcModels';
import { getTimerTimeBaseMs } from '../../core/scanner';
import { shouldAutoFocusInput } from '../../core/clipboard';

export type OnlineTargetDescriptor =
  | {
      mode: 'bit';
      address: string;
      comment?: string;
    }
  | {
      mode: 'value';
      /** One or more editable D / T / C addresses referenced by the clicked Ladder element */
      addresses: string[];
      comment?: string;
    };

interface OnlineControlModalProps {
  target: OnlineTargetDescriptor | null;
  simState: SimState;
  onSetInputBit: (address: string, value: boolean) => void;
  onSetRelayBit: (address: string, value: boolean) => void;
  onPulseBit: (address: string) => void;
  onSetRegisterValue: (address: string, value: number) => void;
  onSetTimerValue: (address: string, value: number) => void;
  onSetCounterValue: (address: string, value: number) => void;
  onNotify: (message: string) => void;
  onClose: () => void;
}

function readLiveBit(address: string, simState: SimState): boolean {
  const norm = address.trim().toUpperCase();
  if (norm.startsWith('X')) return Boolean(simState.inputs[norm]);
  if (norm.startsWith('Y')) return Boolean(simState.outputs[norm]);
  if (norm.startsWith('M') || norm.startsWith('S')) return Boolean(simState.relays[norm]);
  if (norm.startsWith('T')) return Boolean(simState.timers[norm]?.done);
  if (norm.startsWith('C')) return Boolean(simState.counters[norm]?.done);
  return false;
}

function readLiveNumericValue(address: string, simState: SimState): number {
  const norm = address.trim().toUpperCase();
  if (norm.startsWith('D')) return simState.registers[norm] ?? 0;
  if (norm.startsWith('T')) return simState.timers[norm]?.currentValue ?? 0;
  if (norm.startsWith('C')) return simState.counters[norm]?.currentValue ?? 0;
  return 0;
}

export const OnlineControlModal: React.FC<OnlineControlModalProps> = ({
  target,
  simState,
  onSetInputBit,
  onSetRelayBit,
  onPulseBit,
  onSetRegisterValue,
  onSetTimerValue,
  onSetCounterValue,
  onNotify,
  onClose,
}) => {
  const [selectedAddr, setSelectedAddr] = useState<string>('');
  const [valueInput, setValueInput] = useState<string>('0');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    if (target.mode === 'value' && target.addresses.length > 0) {
      const first = target.addresses[0];
      setSelectedAddr(first);
      setValueInput(String(readLiveNumericValue(first, simState)));
      setError(null);
    }
    // Only reset draft when opening a new target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, target]);

  if (!target) return null;

  if (target.mode === 'bit') {
    const addr = target.address.trim().toUpperCase();
    const isInput = addr.startsWith('X');
    const isRelay = addr.startsWith('M') || addr.startsWith('S');
    const isReadOnly =
      (!isInput && !isRelay) || (isRelay && Boolean(SPECIAL_RELAYS[addr]?.readOnly));
    const currentOn = readLiveBit(addr, simState);

    const handleSet = (val: boolean) => {
      if (isReadOnly) return;
      if (isInput) onSetInputBit(addr, val);
      else if (isRelay) onSetRelayBit(addr, val);
      onNotify(`${addr} → ${val ? 'ON (1)' : 'OFF (0)'} olarak ayarlandı.`);
      onClose();
    };

    const handlePulse = () => {
      if (isReadOnly) return;
      onPulseBit(addr);
      onClose();
    };

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="online-bit-ctrl-title"
        data-testid="online-control-modal"
        className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="w-full max-w-sm bg-white border border-[#BFC7D5] rounded shadow-xl overflow-hidden">
          <div className="bg-[#0B4EA2] text-white px-4 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
              <h2 id="online-bit-ctrl-title" className="text-sm font-semibold truncate">
                Simülasyon Kontak Kontrolü · <span className="font-mono">{addr}</span>
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Kontrol penceresini kapat"
              className="p-1 rounded hover:bg-white/15 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="p-4 space-y-3">
            <p className="text-[11px] text-[#475569]">
              Sanal simülasyon belleğini değiştirir (gerçek PLC bağlantısı değildir).
            </p>
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-[#CBD2DC] bg-[#F8FAFC]">
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-[#0F172A]">{addr}</div>
                {target.comment && (
                  <div className="text-xs text-[#475569] truncate">{target.comment}</div>
                )}
              </div>
              <span
                data-testid="online-bit-status"
                className={`px-2 py-0.5 rounded font-mono text-xs font-bold ${
                  currentOn
                    ? 'bg-[#DCFCE7] text-[#166534] border border-[#86EFAC]'
                    : 'bg-[#E2E8F0] text-[#475569]'
                }`}
              >
                {currentOn ? 'ON (1)' : 'OFF (0)'}
              </span>
            </div>

            {isReadOnly ? (
              <p className="text-xs text-[#475569] bg-[#FFFBEB] border border-[#FDE68A] rounded p-2.5 leading-relaxed">
                <strong className="font-mono text-[#92400E]">{addr}</strong> salt okunur özel röle veya program bobini tarafından sürülen çıkış olduğu için doğrudan zorlanamaz.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="online-set-on-btn"
                    onClick={() => handleSet(true)}
                    className="h-10 px-3 rounded border border-[#00963F] bg-[#00C853] hover:bg-[#00B248] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Power className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Set On</span>
                  </button>
                  <button
                    type="button"
                    data-testid="online-set-off-btn"
                    onClick={() => handleSet(false)}
                    className="h-10 px-3 rounded border border-[#CBD2DC] bg-white hover:bg-[#F1F5F9] text-[#1E293B] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <PowerOff className="w-3.5 h-3.5 text-[#DC2626]" aria-hidden="true" />
                    <span>Set Off</span>
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="online-pulse-btn"
                  onClick={handlePulse}
                  className="w-full h-10 px-3 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-[#0B4EA2] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Yükselen Kenar Pals (Anlık Tetikle)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Value editor mode for D / T / C devices
  const activeAddr = selectedAddr || target.addresses[0];
  const liveVal = readLiveNumericValue(activeAddr, simState);
  const isTimer = activeAddr.startsWith('T');
  const isCounter = activeAddr.startsWith('C');
  const timerBaseMs = isTimer ? getTimerTimeBaseMs(activeAddr) : null;

  const handleSelectAddress = (addr: string) => {
    setSelectedAddr(addr);
    setValueInput(String(readLiveNumericValue(addr, simState)));
    setError(null);
  };

  const applyNumericValue = (rawVal: number) => {
    const min = isTimer || isCounter ? 0 : -32768;
    const max = 32767;
    if (!Number.isFinite(rawVal) || rawVal < min || rawVal > max) {
      setError(`Geçerli aralık: ${min} .. ${max}`);
      return;
    }
    const intVal = Math.trunc(rawVal);
    if (activeAddr.startsWith('D')) {
      onSetRegisterValue(activeAddr, intVal);
    } else if (isTimer) {
      onSetTimerValue(activeAddr, intVal);
    } else if (isCounter) {
      onSetCounterValue(activeAddr, intVal);
    }
    onNotify(`${activeAddr} aktif değeri ${intVal} olarak değiştirildi.`);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseInt(valueInput.trim(), 10);
    if (Number.isNaN(parsed)) {
      setError('Lütfen geçerli bir tam sayı girin.');
      return;
    }
    applyNumericValue(parsed);
  };

  const bumpDraft = (delta: number) => {
    const parsed = Number.parseInt(valueInput.trim(), 10);
    const base = Number.isNaN(parsed) ? liveVal : parsed;
    const min = isTimer || isCounter ? 0 : -32768;
    const next = Math.max(min, Math.min(32767, base + delta));
    setValueInput(String(next));
    setError(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="online-val-ctrl-title"
      data-testid="online-value-modal"
      className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-white border border-[#BFC7D5] rounded shadow-xl overflow-hidden">
        <div className="bg-[#0B4EA2] text-white px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sliders className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 id="online-val-ctrl-title" className="text-sm font-semibold truncate">
              Simülasyon Değerini Değiştir · <span className="font-mono">{activeAddr}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Değer değiştirme penceresini kapat"
            className="p-1 rounded hover:bg-white/15 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <p className="text-[11px] text-[#475569]">
            Sanal simülasyon belleğini değiştirir (gerçek PLC bağlantısı değildir).
          </p>
          {target.addresses.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {target.addresses.map((addr) => (
                <button
                  key={addr}
                  type="button"
                  onClick={() => handleSelectAddress(addr)}
                  className={`h-7 px-2.5 rounded border font-mono text-xs font-bold cursor-pointer ${
                    addr === activeAddr
                      ? 'border-[#0B4EA2] bg-[#0B4EA2] text-white'
                      : 'border-[#CBD2DC] bg-white text-[#334155] hover:bg-[#F1F5F9]'
                  }`}
                >
                  {addr}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-[#CBD2DC] bg-[#F8FAFC] text-xs">
            <div>
              <span className="font-mono font-bold text-[#0F172A]">{activeAddr}</span>
              {timerBaseMs && (
                <span className="ml-1.5 font-mono text-[11px] text-[#0B4EA2]">
                  ({timerBaseMs}ms taban)
                </span>
              )}
              {target.comment && (
                <div className="text-[11px] text-[#475569]">{target.comment}</div>
              )}
            </div>
            <div className="font-mono font-bold text-[#007A33] tabular-nums">
              Şu an: {liveVal}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="online-value-input"
              className="block text-xs font-semibold text-[#334155]"
            >
              Yeni Değer (16-bit)
            </label>
            <input
              id="online-value-input"
              type="number"
              inputMode="numeric"
              enterKeyHint="done"
              data-testid="online-value-input"
              value={valueInput}
              onChange={(e) => {
                setValueInput(e.target.value);
                if (error) setError(null);
              }}
              autoFocus={shouldAutoFocusInput()}
              className="w-full h-9 px-3 rounded border border-[#B8C2D1] font-mono text-sm font-bold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30 focus:border-[#0B4EA2]"
            />
            {error && <p className="text-[11px] text-[#B91C1C] font-medium">{error}</p>}
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {[-10, -1, 0, 1, 10].map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => (step === 0 ? setValueInput('0') : bumpDraft(step))}
                className="h-8 rounded border border-[#CBD2DC] bg-[#F8FAFC] hover:bg-[#EDF2F8] font-mono text-xs font-semibold text-[#334155] cursor-pointer"
              >
                {step === 0 ? '0' : step > 0 ? `+${step}` : step}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3.5 rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-xs font-medium text-[#334155] cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              data-testid="online-value-apply-btn"
              className="h-9 px-4 rounded bg-[#0B4EA2] hover:bg-[#073878] text-white text-xs font-semibold cursor-pointer"
            >
              Değeri Uygula
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
