import React from 'react';
import {
  Edit3,
  Gauge,
  Play,
  RotateCcw,
  Square,
  StepForward,
} from 'lucide-react';
import type { SimSpeedMultiplier } from '../../types/plc';

interface OnlineSimBarProps {
  running: boolean;
  scanCount: number;
  scanTimeMs: number;
  speedMultiplier: SimSpeedMultiplier;
  onChangeSpeed: (speed: SimSpeedMultiplier) => void;
  onRun: () => void;
  onStop: () => void;
  onSingleStep: () => void;
  onResetMemory: () => void;
  onExitOnline: () => void;
}

const SPEED_OPTIONS: SimSpeedMultiplier[] = [1, 10, 60];

export const OnlineSimBar: React.FC<OnlineSimBarProps> = ({
  running,
  scanCount,
  scanTimeMs,
  speedMultiplier,
  onChangeSpeed,
  onRun,
  onStop,
  onSingleStep,
  onResetMemory,
  onExitOnline,
}) => {
  return (
    <div
      role="toolbar"
      aria-label="Sanal PLC Simülasyon Kontrol Çubuğu"
      data-testid="online-sim-bar"
      className="shrink-0 bg-[#E6E9EF] border-b border-[#BFC7D5] px-2.5 sm:px-3.5 py-1.5 flex items-center justify-between gap-2 overflow-x-auto wpl-no-scrollbar"
    >
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          title="Tarayıcı içi sanal PLC simülasyonu — gerçek PLC bağlantısı değildir"
          className="hidden md:inline-flex items-center px-2 py-1 rounded border border-[#93C5FD] bg-[#EFF6FF] text-[10px] font-bold uppercase tracking-wide text-[#0B4EA2] whitespace-nowrap shrink-0"
        >
          Sanal Simülasyon
        </span>
        <button
          type="button"
          onClick={onRun}
          aria-pressed={running}
          data-testid="sim-run-btn"
          className={`min-h-[38px] px-3 rounded border text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            running
              ? 'bg-[#00C853] border-[#00963F] text-white'
              : 'bg-white border-[#B8C2D1] text-[#007A33] hover:bg-[#E6F9EE] hover:border-[#00C853]'
          }`}
        >
          <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
          <span>RUN</span>
        </button>

        <button
          type="button"
          onClick={onStop}
          aria-pressed={!running}
          data-testid="sim-stop-btn"
          className={`min-h-[38px] px-3 rounded border text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            !running
              ? 'bg-[#DC2626] border-[#B91C1C] text-white'
              : 'bg-white border-[#B8C2D1] text-[#B91C1C] hover:bg-[#FEF2F2] hover:border-[#DC2626]'
          }`}
        >
          <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
          <span>STOP</span>
        </button>

        <button
          type="button"
          onClick={onSingleStep}
          data-testid="sim-step-btn"
          title="Tek tarama döngüsü (1 Scan) ilerlet"
          className="min-h-[38px] px-2.5 sm:px-3 rounded border border-[#B8C2D1] bg-white hover:bg-[#EDF4FC] hover:border-[#0B4EA2] text-xs font-semibold text-[#0B4EA2] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <StepForward className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Tek Adım</span>
        </button>

        <button
          type="button"
          onClick={onResetMemory}
          data-testid="sim-reset-btn"
          title="Tüm PLC çıkış, röle, TMR, CNT ve D belleğini sıfırla"
          className="min-h-[38px] px-2.5 sm:px-3 rounded border border-[#B8C2D1] bg-white hover:bg-[#FEF2F2] hover:border-[#DC2626]/50 text-xs font-semibold text-[#334155] hover:text-[#B91C1C] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Bellek Sıfırla</span>
          <span className="sm:hidden">Sıfırla</span>
        </button>

        {/* Time Speed Multiplier (1x / 10x / 60x) for long timer & RTC tests */}
        <div
          role="group"
          aria-label="Simülasyon zaman hızı çarpanı"
          className="flex items-center bg-[#DCE1EA] p-0.5 rounded border border-[#C5CDD9] shrink-0"
        >
          <Gauge
            className="w-3.5 h-3.5 text-[#475569] mx-1.5 hidden sm:block shrink-0"
            aria-hidden="true"
          />
          {SPEED_OPTIONS.map((spd) => (
            <button
              key={spd}
              type="button"
              data-testid={`sim-speed-${spd}`}
              aria-pressed={speedMultiplier === spd}
              onClick={() => onChangeSpeed(spd)}
              title={`Zamanlayıcı ve saat simülasyon hızı: ${spd}x`}
              className={`min-h-[32px] px-2 rounded-[3px] font-mono text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                speedMultiplier === spd
                  ? 'bg-[#0B4EA2] text-white'
                  : 'text-[#334155] hover:bg-white/70'
              }`}
            >
              {spd}x
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="hidden lg:flex items-center gap-2 font-mono text-xs text-[#334155] whitespace-nowrap">
          <span className="font-semibold text-[#0F172A]">
            Tarama #{scanCount}
          </span>
          <span className="text-[#94A3B8]" aria-hidden="true">
            ·
          </span>
          <span>{scanTimeMs}ms</span>
        </div>

        <button
          type="button"
          onClick={onExitOnline}
          data-testid="sim-exit-btn"
          className="flex min-h-[38px] px-2.5 sm:px-3 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-xs font-semibold text-[#0B4EA2] items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sm:hidden">Düzenle</span>
          <span className="hidden sm:inline">Düzenleme Modu</span>
        </button>
      </div>
    </div>
  );
};
