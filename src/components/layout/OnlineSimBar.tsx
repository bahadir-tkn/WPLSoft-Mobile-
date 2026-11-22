import React from 'react';
import {
  Gauge,
  PanelRight,
  Play,
  RotateCcw,
  Square,
  StepForward,
} from 'lucide-react';
import type { SimSpeedMultiplier } from '../../types/plc';

export type ZoomDensity = 'compact' | 'normal' | 'large';

interface OnlineSimBarProps {
  running: boolean;
  scanCount: number;
  scanTimeMs: number;
  speedMultiplier: SimSpeedMultiplier;
  zoomDensity: ZoomDensity;
  isMonitorOpen: boolean;
  compactHeight?: boolean;
  sideDockMonitor?: boolean;
  onChangeSpeed: (speed: SimSpeedMultiplier) => void;
  onChangeZoom: (zoom: ZoomDensity) => void;
  onToggleMonitor: () => void;
  onRun: () => void;
  onStop: () => void;
  onSingleStep: () => void;
  onResetMemory: () => void;
}

const SPEED_OPTIONS: SimSpeedMultiplier[] = [1, 2, 10];

export const OnlineSimBar: React.FC<OnlineSimBarProps> = ({
  running,
  scanCount,
  scanTimeMs,
  speedMultiplier,
  zoomDensity,
  isMonitorOpen,
  compactHeight = false,
  sideDockMonitor = false,
  onChangeSpeed,
  onChangeZoom,
  onToggleMonitor,
  onRun,
  onStop,
  onSingleStep,
  onResetMemory,
}) => {
  const btnHeight = compactHeight ? 'h-7' : 'h-8';

  return (
    <div
      role="toolbar"
      aria-label="Sanal PLC Simülasyon Kontrol Çubuğu"
      data-testid="online-sim-bar"
      className={`shrink-0 bg-[#E8ECF2] border-b border-[#CBD2DC] px-2 sm:px-3.5 ${
        compactHeight ? 'py-1' : 'py-1.5'
      } flex items-center justify-between gap-1.5 sm:gap-2 overflow-x-auto wpl-no-scrollbar`}
    >
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* Segmented RUN / STOP */}
        <div
          role="group"
          aria-label="PLC çalışma durumu"
          className="flex items-center bg-[#D8DEE8] p-0.5 rounded border border-[#C5CDD9] shrink-0"
        >
          <button
            type="button"
            onClick={onRun}
            aria-pressed={running}
            data-testid="sim-run-btn"
            className={`${
              compactHeight ? 'h-6 px-2' : 'h-7 px-2.5'
            } rounded-[3px] text-xs font-bold flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
              running
                ? 'bg-[#00A846] text-white shadow-xs'
                : 'text-[#166534] hover:bg-white/70'
            }`}
          >
            <Play className="w-3 h-3 fill-current" aria-hidden="true" />
            <span>RUN</span>
          </button>

          <button
            type="button"
            onClick={onStop}
            aria-pressed={!running}
            data-testid="sim-stop-btn"
            className={`${
              compactHeight ? 'h-6 px-2' : 'h-7 px-2.5'
            } rounded-[3px] text-xs font-bold flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
              !running
                ? 'bg-[#DC2626] text-white shadow-xs'
                : 'text-[#B91C1C] hover:bg-white/70'
            }`}
          >
            <Square className="w-3 h-3 fill-current" aria-hidden="true" />
            <span>STOP</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onSingleStep}
          data-testid="sim-step-btn"
          title="Tek tarama döngüsü (1 Scan) ilerlet"
          className={`${btnHeight} px-2 sm:px-2.5 rounded border border-[#B8C2D1] bg-white hover:bg-[#EDF4FC] hover:border-[#0B4EA2] text-xs font-semibold text-[#0B4EA2] flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
        >
          <StepForward className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Tek Adım</span>
        </button>

        <button
          type="button"
          onClick={onResetMemory}
          data-testid="sim-reset-btn"
          title="Tüm PLC çıkış, röle, TMR, CNT ve D belleğini sıfırla"
          className={`${btnHeight} px-2 sm:px-2.5 rounded border border-[#B8C2D1] bg-white hover:bg-[#FEF2F2] hover:border-[#DC2626]/50 text-xs font-semibold text-[#334155] hover:text-[#B91C1C] flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Sıfırla</span>
        </button>

        {/* Speed Multiplier (1x / 2x / 10x) */}
        <div
          role="group"
          aria-label="Simülasyon zaman hızı çarpanı"
          className="flex items-center bg-[#D8DEE8] p-0.5 rounded border border-[#C5CDD9] shrink-0"
        >
          <Gauge
            className="w-3.5 h-3.5 text-[#475569] mx-1 hidden md:block shrink-0"
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
              className={`${
                compactHeight ? 'h-6 px-1.5' : 'h-7 px-2'
              } rounded-[3px] font-mono text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
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

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <span className="hidden xl:inline font-mono text-[11px] text-[#475569] whitespace-nowrap">
          Tarama #{scanCount} · {scanTimeMs}ms
        </span>

        {/* Compact single-tap zoom cycle on narrow portrait (<sm) to prevent right-edge clipping */}
        <button
          type="button"
          data-testid="sim-cycle-zoom-btn"
          onClick={() =>
            onChangeZoom(
              zoomDensity === 'compact'
                ? 'normal'
                : zoomDensity === 'normal'
                  ? 'large'
                  : 'compact'
            )
          }
          aria-label={`Yakınlaştırma: ${zoomDensity === 'compact' ? '75%' : zoomDensity === 'large' ? '125%' : '100%'}`}
          className={`sm:hidden ${btnHeight} px-2 rounded border border-[#B8C2D1] bg-white font-mono text-[11px] font-bold text-[#0B4EA2] shrink-0 cursor-pointer`}
        >
          {zoomDensity === 'compact' ? '75%' : zoomDensity === 'large' ? '125%' : '100%'}
        </button>

        {/* Full Zoom Presets on sm+ (Phone Landscape & Desktop) */}
        <div
          role="group"
          aria-label="Ladder görünüm yakınlaştırma"
          className="hidden sm:flex items-center bg-[#D8DEE8] p-0.5 rounded border border-[#C5CDD9] shrink-0"
        >
          {(
            [
              { id: 'compact', label: '75%' },
              { id: 'normal', label: '100%' },
              { id: 'large', label: '125%' },
            ] as const
          ).map((preset) => (
            <button
              key={preset.id}
              type="button"
              data-testid={`zoom-${preset.id}-btn`}
              aria-pressed={zoomDensity === preset.id}
              onClick={() => onChangeZoom(preset.id)}
              className={`${
                compactHeight ? 'h-6 px-1.5' : 'h-7 px-1.5'
              } rounded-[3px] font-mono text-[10px] font-bold transition-colors cursor-pointer ${
                zoomDensity === preset.id
                  ? 'bg-[#0B4EA2] text-white'
                  : 'text-[#334155] hover:bg-white/70'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Side-panel Device Monitor Toggle (only shown in landscape side-dock mode where collapsed drawer hides its header; bottom-docked mode already has its own ^/v bar) */}
        {sideDockMonitor && (
          <button
            type="button"
            data-testid="sim-toggle-monitor-btn"
            aria-pressed={isMonitorOpen}
            onClick={onToggleMonitor}
            title={isMonitorOpen ? 'I/O İzleme Panelini gizle' : 'I/O İzleme Panelini göster'}
            className={`flex ${btnHeight} px-2 sm:px-2.5 rounded border text-xs font-semibold items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isMonitorOpen
                ? 'border-[#0B4EA2] bg-[#EEF4FC] text-[#0B4EA2]'
                : 'border-[#B8C2D1] bg-white text-[#334155] hover:bg-[#EDF4FC]'
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" aria-hidden="true" />
            <span>I/O</span>
          </button>
        )}
      </div>
    </div>
  );
};
