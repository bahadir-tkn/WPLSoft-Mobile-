import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cable,
  Check,
  CheckCheck,
  Cpu,
  Lightbulb,
  RotateCcw,
  X,
} from 'lucide-react';
import type { LadderProgram } from '../../types/plc';
import {
  analyzeProgramWiring,
  type OutputWiringTarget,
  type WireColor,
  type WiringConnection,
} from '../../core/wiringAnalyzer';

interface WiringDiagramModalProps {
  isOpen: boolean;
  program: LadderProgram;
  onClose: () => void;
}

interface PinCoord {
  x: number;
  y: number;
  label: string;
}

const WIRE_STYLES: Record<
  WireColor,
  { stroke: string; badgeBg: string; badgeText: string; border: string; swatch: string }
> = {
  red: {
    stroke: '#DC2626',
    badgeBg: 'bg-[#FEF2F2]',
    badgeText: 'text-[#B91C1C]',
    border: 'border-[#FCA5A5]',
    swatch: '#DC2626',
  },
  blue: {
    stroke: '#1D4ED8',
    badgeBg: 'bg-[#EFF6FF]',
    badgeText: 'text-[#1D4ED8]',
    border: 'border-[#93C5FD]',
    swatch: '#1D4ED8',
  },
  yellow: {
    stroke: '#D97706',
    badgeBg: 'bg-[#FFFBEB]',
    badgeText: 'text-[#92400E]',
    border: 'border-[#FCD34D]',
    swatch: '#EAB308',
  },
  green: {
    stroke: '#15803D',
    badgeBg: 'bg-[#F0FDF4]',
    badgeText: 'text-[#166534]',
    border: 'border-[#86EFAC]',
    swatch: '#16A34A',
  },
  purple: {
    stroke: '#7C3AED',
    badgeBg: 'bg-[#F5F3FF]',
    badgeText: 'text-[#6D28D9]',
    border: 'border-[#C4B5FD]',
    swatch: '#7C3AED',
  },
};

const INPUT_NAMES = ['X0', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7'] as const;
const OUTPUT_NAMES = ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5'] as const;

/**
 * Fixed physical pin coordinates for the BETİ Delta PLC Training Set SVG (960 x 592).
 */
function buildPinMap(): Record<string, PinCoord> {
  const pins: Record<string, PinCoord> = {
    // Top-Center: +24V DC / GND Common Supply Block (x: 225..451, y: 18..134)
    'psu-24v-1': { x: 262, y: 112, label: '+24V' },
    'psu-24v-2': { x: 306, y: 112, label: '+24V' },
    // Ordered left-to-right spatially to eliminate GND wire crossings:
    // psu-gnd-4 (VI0- left), psu-gnd-2 (ZP center), psu-gnd-3 (LED/Relay), psu-gnd-1 (Button right)
    'psu-gnd-4': { x: 352, y: 112, label: 'GND' },
    'psu-gnd-2': { x: 378, y: 112, label: 'GND' },
    'psu-gnd-3': { x: 404, y: 112, label: 'GND' },
    'psu-gnd-1': { x: 430, y: 112, label: 'GND' },

    // Top-Center-Right: Signalization LED Module (x: 466..682, y: 18..134)
    'led-com': { x: 492, y: 112, label: 'COM-' },

    // Top-Right: Analog Potentiometer Module 0-10V (x: 702..942, y: 18..142)
    'pot-v0': { x: 734, y: 126, label: 'AD0' },
    'pot-v1': { x: 786, y: 126, label: 'AD1' },
    'pot-v2': { x: 838, y: 126, label: 'AD2' },
    'pot-v3': { x: 890, y: 126, label: 'AD3' },

    // Mid-Right: Switch / Push-Button Unit X0-X7 (x: 702..942, y: 170..388)
    'btn-com': { x: 722, y: 206, label: 'COM-' },

    // Bottom-Right: Relay Output Module Y0-Y5 (x: 702..942, y: 406..576)
    'relay-com': { x: 722, y: 442, label: 'COM-' },

    // Bottom-Left: DVP-20SX2 PLC (x: 28..534, y: 276..546)
    // Left Analog Terminal Strip
    'plc-v0p': { x: 44, y: 336, label: 'V0+' },
    'plc-vi0m': { x: 44, y: 370, label: 'VI0-' },
    'plc-ag': { x: 44, y: 404, label: 'AG' },
    'plc-v1p': { x: 44, y: 438, label: 'V1+' },
    'plc-vi1m': { x: 44, y: 468, label: 'VI1-' },
    'plc-v2p': { x: 44, y: 496, label: 'V2+' },
    'plc-vi2m': { x: 44, y: 518, label: 'VI2-' },
    'plc-v3p': { x: 44, y: 534, label: 'V3+' },
    'plc-vi3m': { x: 44, y: 548, label: 'VI3-' },

    // Top PLC Input Terminal Strip (S/S, X0..X7)
    'plc-ss': { x: 114, y: 294, label: 'S/S' },

    // Bottom PLC Output Terminal Strip (UP, ZP, Y0..Y5)
    'plc-up': { x: 120, y: 528, label: 'UP' },
    'plc-zp': { x: 164, y: 528, label: 'ZP' },
  };

  INPUT_NAMES.forEach((name, idx) => {
    pins[`plc-${name}`] = { x: 164 + idx * 46, y: 294, label: name };
    // Clean single-column vertical bank so every wire enters from the left edge with zero text crossings
    pins[`btn-${name}`] = {
      x: 722,
      y: 226 + idx * 20,
      label: name,
    };
  });

  OUTPUT_NAMES.forEach((name, idx) => {
    pins[`plc-${name}`] = { x: 216 + idx * 54, y: 528, label: name };
    pins[`led-${name}`] = { x: 528 + idx * 27, y: 112, label: `L${idx}` };
    // Clean single-column vertical relay bank
    pins[`relay-${name}`] = {
      x: 722,
      y: 462 + idx * 19,
      label: `R${idx}`,
    };
  });

  return pins;
}

const PIN_MAP = buildPinMap();

/**
 * Generates clean, non-overlapping orthogonal Manhattan wire paths between BETİ modules.
 */
function buildWirePath(conn: WiringConnection): { d: string; labelX: number; labelY: number } {
  const from = PIN_MAP[conn.fromPinId];
  const to = PIN_MAP[conn.toPinId];
  if (!from || !to) {
    return { d: '', labelX: 0, labelY: 0 };
  }

  // Red +24V -> PLC S/S
  if (conn.id === 'pwr-24v-ss') {
    const midY = 166;
    const d = `M ${from.x} ${from.y} V ${midY} H ${to.x} V ${to.y}`;
    return { d, labelX: 188, labelY: midY };
  }

  // Red +24V -> PLC UP (routes through center vertical duct x=554 then bottom duct y=566)
  if (conn.id === 'pwr-24v-up') {
    const ductX = 554;
    const botY = 566;
    const d = `M ${from.x} ${from.y} V 150 H ${ductX} V ${botY} H ${to.x} V ${to.y}`;
    return { d, labelX: ductX, labelY: 362 };
  }

  // Blue GND -> Button COM (-)
  if (conn.id === 'gnd-btn-com') {
    const ductX = 682;
    const d = `M ${from.x} ${from.y} V 162 H ${ductX} V ${to.y} H ${to.x}`;
    return { d, labelX: 610, labelY: 162 };
  }

  // Blue GND -> PLC ZP (routes through center vertical duct x=568 then bottom duct y=574)
  if (conn.id === 'gnd-plc-zp') {
    const ductX = 568;
    const botY = 574;
    const d = `M ${from.x} ${from.y} V 156 H ${ductX} V ${botY} H ${to.x} V ${to.y}`;
    return { d, labelX: ductX, labelY: 416 };
  }

  // Blue GND -> LED COM (-)
  if (conn.id === 'gnd-led-com') {
    const midY = 144;
    const d = `M ${from.x} ${from.y} V ${midY} H ${to.x} V ${to.y}`;
    return { d, labelX: (from.x + to.x) / 2, labelY: midY };
  }

  // Blue GND -> Relay COM (-)
  if (conn.id === 'gnd-relay-com') {
    const ductX = 668;
    const d = `M ${from.x} ${from.y} V 150 H ${ductX} V ${to.y} H ${to.x}`;
    return { d, labelX: ductX, labelY: 340 };
  }

  // Yellow Digital Inputs: Button Xn -> PLC Xn (clean staggered horizontal lanes y=200..263)
  if (conn.category === 'input' && conn.deviceAddress) {
    const idx = INPUT_NAMES.indexOf(conn.deviceAddress as (typeof INPUT_NAMES)[number]);
    const safeIdx = Math.max(0, idx);
    const laneY = 200 + safeIdx * 9;
    const exitX = 692 - (safeIdx % 4) * 5;
    const d = `M ${from.x} ${from.y} H ${exitX} V ${laneY} H ${to.x} V ${to.y}`;
    return { d, labelX: Math.max(to.x + 14, 332 + safeIdx * 24), labelY: laneY };
  }

  // Green Digital Outputs: PLC Yn -> LED Module or Relay Module
  if (conn.category === 'output' && conn.deviceAddress) {
    const idx = OUTPUT_NAMES.indexOf(conn.deviceAddress as (typeof OUTPUT_NAMES)[number]);
    const safeIdx = Math.max(0, idx);
    if (conn.toPinId.startsWith('led-')) {
      const botY = 554 + safeIdx * 4.5;
      const ductX = 584 + safeIdx * 12;
      const topY = 174 - safeIdx * 4;
      const d = `M ${from.x} ${from.y} V ${botY} H ${ductX} V ${topY} H ${to.x} V ${to.y}`;
      return { d, labelX: ductX, labelY: 390 - safeIdx * 22 };
    }
    // Relay module target
    const botY = 554 + safeIdx * 4.5;
    const ductX = 588 + safeIdx * 11;
    const d = `M ${from.x} ${from.y} V ${botY} H ${ductX} V ${to.y} H ${to.x}`;
    return { d, labelX: ductX, labelY: to.y };
  }

  // Purple Analog Vn+ (Potentiometer -> horizontal duct below top modules -> left outer rail -> PLC Vn+)
  if (conn.id.startsWith('ai-vplus-')) {
    const ch = Number.parseInt(conn.id.replace('ai-vplus-', ''), 10) || 0;
    const ductY = 178 + ch * 5;
    const leftX = 16 + ch * 3;
    const d = `M ${from.x} ${from.y} V ${ductY} H ${leftX} V ${to.y} H ${to.x}`;
    return { d, labelX: 50 + ch * 20, labelY: ductY };
  }

  // Purple Analog VIn- (GND -> horizontal duct below Vn+ -> far-left rail -> PLC VIn-)
  if (conn.id.startsWith('ai-vminus-')) {
    const ch = Number.parseInt(conn.id.replace('ai-vminus-', ''), 10) || 0;
    const ductY = 188 + ch * 5;
    const leftX = 9 + ch * 3;
    const d = `M ${from.x} ${from.y} V ${ductY} H ${leftX} V ${to.y} H ${to.x}`;
    return { d, labelX: 78 + ch * 20, labelY: ductY };
  }

  const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  return { d, labelX: (from.x + to.x) / 2, labelY: (from.y + to.y) / 2 };
}

export const WiringDiagramModal: React.FC<WiringDiagramModalProps> = ({
  isOpen,
  program,
  onClose,
}) => {
  const [outputTarget, setOutputTarget] = useState<OutputWiringTarget>('led');
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);

  const plan = useMemo(
    () => analyzeProgramWiring(program, outputTarget),
    [program, outputTarget]
  );

  const activeInputSet = useMemo(
    () => new Set(plan.usedInputs.filter((d) => d.onboard).map((d) => d.address)),
    [plan.usedInputs]
  );
  const activeOutputSet = useMemo(
    () => new Set(plan.usedOutputs.filter((d) => d.onboard).map((d) => d.address)),
    [plan.usedOutputs]
  );
  const activeAnalogSet = useMemo(
    () => new Set(plan.usedAnalogChannels.map((d) => d.index)),
    [plan.usedAnalogChannels]
  );

  const checkedCount = useMemo(
    () => plan.connections.filter((c) => Boolean(checkedIds[c.id])).length,
    [checkedIds, plan.connections]
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const totalCount = plan.connections.length;
  const allChecked = totalCount > 0 && checkedCount === totalCount;

  const toggleWire = (id: string) => {
    setCheckedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleCheckAll = () => {
    const next: Record<string, boolean> = {};
    for (const c of plan.connections) {
      next[c.id] = true;
    }
    setCheckedIds(next);
  };

  const handleResetChecks = () => {
    setCheckedIds({});
  };

  const commentOf = (addr: string): string | undefined => program.deviceComments?.[addr];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wiring-modal-title"
      data-testid="wiring-diagram-modal"
      className="fixed inset-0 z-50 bg-[#0F172A]/55 flex items-end sm:items-center justify-center p-0 sm:p-3 lg:p-5 [@media(max-height:500px)]:p-1!"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[1320px] bg-white border border-[#BFC7D5] sm:rounded shadow-2xl flex flex-col max-h-[94dvh] [@media(max-height:500px)]:max-h-[calc(100dvh-0.5rem)] overflow-hidden">
        {/* Top Modal Header */}
        <div className="bg-[#0B4EA2] text-white px-4 py-2.5 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Cable className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 id="wiring-modal-title" className="text-sm font-semibold truncate">
              BETİ Delta PLC Eğitim Seti — İnteraktif Kablolama Şeması
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kablolama şeması penceresini kapat"
            className="p-1.5 rounded hover:bg-white/15 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Sub-toolbar: Output target toggle + Summary + Progress */}
        <div className="px-4 py-2 bg-[#F8FAFC] border-b border-[#CBD2DC] flex items-center justify-between gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-3 flex-wrap text-xs text-[#334155]">
            <span className="font-semibold text-[#0F172A]">{plan.projectName}</span>
            <span aria-hidden="true" className="text-[#94A3B8]">·</span>
            <span className="font-mono tabular-nums">
              {plan.usedInputs.length} Giriş · {plan.usedOutputs.length} Çıkış
              {plan.usedAnalogChannels.length > 0
                ? ` · ${plan.usedAnalogChannels.length} Analog`
                : ''}
            </span>
            <span aria-hidden="true" className="hidden sm:inline text-[#94A3B8]">·</span>
            <span className="hidden sm:inline text-[#475569]">
              NPN / Sink (+24V → S/S &amp; UP)
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Output Module Selector: Sinyalizasyon LED vs Röle Çıkışı */}
            <div
              role="group"
              aria-label="Çıkış bağlantı hedefi"
              className="flex items-center rounded border border-[#CBD2DC] bg-white p-0.5"
            >
              <button
                type="button"
                data-testid="wiring-target-led"
                aria-pressed={outputTarget === 'led'}
                onClick={() => setOutputTarget('led')}
                className={`h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  outputTarget === 'led'
                    ? 'bg-[#0B4EA2] text-white'
                    : 'text-[#475569] hover:bg-[#F1F5F9]'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sinyalizasyon LED</span>
              </button>
              <button
                type="button"
                data-testid="wiring-target-relay"
                aria-pressed={outputTarget === 'relay'}
                onClick={() => setOutputTarget('relay')}
                className={`h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  outputTarget === 'relay'
                    ? 'bg-[#0B4EA2] text-white'
                    : 'text-[#475569] hover:bg-[#F1F5F9]'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Röle Çıkışı</span>
              </button>
            </div>
          </div>
        </div>

        {/* Main 2-Zone Body: Left Interactive SVG Trainer Panel + Right Interactive Checklist */}
        <div
          data-testid="wiring-modal-scroll-body"
          className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden wpl-scrollbar touch-pan-y bg-[#ECEEF2]"
        >
          {/* Left Zone: BETİ Delta PLC Training Set Vector Schematic */}
          <div className="shrink-0 lg:shrink lg:flex-1 lg:min-w-0 flex flex-col p-3 sm:p-4 lg:overflow-y-auto wpl-scrollbar">
            {/* Color Legend */}
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5 text-[11px] text-[#334155]">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="w-4 h-1 rounded-full bg-[#DC2626]" aria-hidden="true" />
                  Kırmızı: +24V (S/S, UP)
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="w-4 h-1 rounded-full bg-[#1D4ED8]" aria-hidden="true" />
                  Mavi: GND (COM, ZP)
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="w-4 h-1 rounded-full bg-[#D97706]" aria-hidden="true" />
                  Sarı: Giriş (X0–X7)
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="w-4 h-1 rounded-full bg-[#15803D]" aria-hidden="true" />
                  Yeşil: Çıkış (Y0–Y5)
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="w-4 h-1 rounded-full bg-[#7C3AED]" aria-hidden="true" />
                  Mor: Analog (V0+/VI0-)
                </span>
              </div>
              <span className="text-[#64748B]">
                Kabloya veya listeye dokunarak &ldquo;Bağlandı ✓&rdquo; işaretleyin
              </span>
            </div>

            {plan.modelMismatchWarning && (
              <div
                data-testid="wiring-model-mismatch"
                className="mb-2.5 px-3 py-2 rounded border border-[#F59E0B] bg-[#FFFBEB] text-xs text-[#92400E] flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{plan.modelMismatchWarning}</span>
              </div>
            )}

            {plan.expansionDevices.length > 0 && (
              <div className="mb-2.5 px-3 py-2 rounded border border-[#F59E0B] bg-[#FFFBEB] text-xs text-[#92400E] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Bu devrede seçili modelin ({program.model}) dahili klemensleri dışında adresler kullanılıyor:{' '}
                  <strong className="font-mono">{plan.expansionDevices.join(', ')}</strong>.
                </span>
              </div>
            )}

            <div
              data-testid="wiring-hardware-notice"
              className="mb-2.5 px-3 py-2 rounded border border-[#CBD2DC] bg-white text-[11px] text-[#334155] leading-relaxed"
            >
              <strong className="text-[#0F172A]">Donanım Doğrulama Notu:</strong>{' '}
              {plan.hardwareNotice}
            </div>

            {/* Mobile-only horizontal pan hint */}
            <div className="sm:hidden text-[11px] text-[#475569] mb-1.5 flex items-center justify-between">
              <span>Şemayı yatay kaydırarak tüm modülleri görebilirsiniz</span>
              <span className="font-mono text-[#0B4EA2]" aria-hidden="true">↔</span>
            </div>

            {/* Interactive SVG Board */}
            <div className="bg-white border border-[#BFC7D5] rounded p-2 sm:p-3 shadow-xs">
              <div data-testid="wiring-svg-scroll-x" className="w-full wpl-scrollbar-x">
                <svg
                  viewBox="0 0 960 592"
                  role="img"
                  aria-label="BETİ Delta DVP-20SX2 PLC Eğitim Seti fiziksel kablolama şeması"
                  data-testid="beti-wiring-svg"
                  className="w-full min-w-[680px] h-auto select-none block touch-pan-x touch-pan-y"
                >
                  {/* Panel Backdrop */}
                  <rect
                    x="2"
                    y="2"
                    width="956"
                    height="588"
                    rx="8"
                    fill="#F8FAFC"
                    stroke="#CBD5E1"
                    strokeWidth="1.5"
                  />

                  {/* Top-Left Trainer Nameplate (fits cleanly inside x: 18..210) */}
                  <rect
                    x="18"
                    y="18"
                    width="192"
                    height="116"
                    rx="6"
                    fill="#FFFFFF"
                    stroke="#CBD5E1"
                    strokeWidth="1.2"
                  />
                  <rect x="18" y="18" width="192" height="24" rx="5" fill="#0B4EA2" />
                  <text
                    x="114"
                    y="34"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="10.5"
                    fontWeight="700"
                    fontFamily="sans-serif"
                  >
                    BETİ EĞİTİM SETİ
                  </text>
                  <text
                    x="28"
                    y="58"
                    fill="#334155"
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="monospace"
                  >
                    DVP-20SX2 · NPN/Sink
                  </text>
                  <text x="28" y="76" fill="#0B4EA2" fontSize="9.5" fontWeight="700">
                    Aktif Devre Özeti
                  </text>
                  <text x="28" y="94" fill="#334155" fontSize="9" fontFamily="monospace">
                    DI: {plan.usedInputs.filter((d) => d.onboard).map((d) => d.address).join(', ') || 'Yok'}
                  </text>
                  <text x="28" y="110" fill="#334155" fontSize="9" fontFamily="monospace">
                    DO: {plan.usedOutputs.filter((d) => d.onboard).map((d) => d.address).join(', ') || 'Yok'}
                  </text>
                  <text x="28" y="125" fill="#5B21B6" fontSize="9" fontFamily="monospace">
                    AI: {plan.usedAnalogChannels.map((d) => `AD${d.index}`).join(', ') || 'Yok'}
                  </text>

                  {/* ========================================================== */}
                  {/* MODULE 1 (TOP-CENTER): +24V DC & GND POWER SUPPLY BLOCK    */}
                  {/* ========================================================== */}
                  <g>
                    <rect
                      x="225"
                      y="18"
                      width="226"
                      height="116"
                      rx="6"
                      fill="#FFFFFF"
                      stroke="#94A3B8"
                      strokeWidth="1.5"
                    />
                    <rect x="225" y="18" width="226" height="24" rx="5" fill="#1E293B" />
                    <text
                      x="338"
                      y="34"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="10.5"
                      fontWeight="700"
                    >
                      +24V DC / GND BESLEME
                    </text>

                    {/* +24V Zone */}
                    <rect
                      x="237"
                      y="50"
                      width="92"
                      height="74"
                      rx="4"
                      fill="#FEF2F2"
                      stroke="#FCA5A5"
                      strokeWidth="1"
                    />
                    <text
                      x="283"
                      y="67"
                      textAnchor="middle"
                      fill="#B91C1C"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="monospace"
                    >
                      +24V DC
                    </text>
                    <text x="262" y="96" textAnchor="middle" fill="#991B1B" fontSize="8.5" fontFamily="monospace">
                      S/S
                    </text>
                    <text x="306" y="96" textAnchor="middle" fill="#991B1B" fontSize="8.5" fontFamily="monospace">
                      UP
                    </text>
                    {(['psu-24v-1', 'psu-24v-2'] as const).map((pid) => {
                      const p = PIN_MAP[pid];
                      const active =
                        (pid === 'psu-24v-1' && plan.needsInputPower) ||
                        (pid === 'psu-24v-2' && plan.needsOutputPower);
                      return (
                        <circle
                          key={pid}
                          cx={p.x}
                          cy={p.y}
                          r={active ? 7 : 5.5}
                          fill={active ? '#DC2626' : '#FECACA'}
                          stroke="#7F1D1D"
                          strokeWidth="1.5"
                        />
                      );
                    })}

                    {/* GND Zone */}
                    <rect
                      x="338"
                      y="50"
                      width="105"
                      height="74"
                      rx="4"
                      fill="#EFF6FF"
                      stroke="#93C5FD"
                      strokeWidth="1"
                    />
                    <text
                      x="390"
                      y="67"
                      textAnchor="middle"
                      fill="#1D4ED8"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="monospace"
                    >
                      GND (0V)
                    </text>
                    {(['psu-gnd-4', 'psu-gnd-2', 'psu-gnd-3', 'psu-gnd-1'] as const).map(
                      (pid) => {
                        const p = PIN_MAP[pid];
                        const active =
                          (pid === 'psu-gnd-1' && plan.needsInputPower) ||
                          ((pid === 'psu-gnd-2' || pid === 'psu-gnd-3') && plan.needsOutputPower) ||
                          (pid === 'psu-gnd-4' && plan.needsAnalogWiring);
                        return (
                          <g key={pid}>
                            <text
                              x={p.x}
                              y="96"
                              textAnchor="middle"
                              fill="#1E40AF"
                              fontSize="7.5"
                              fontFamily="monospace"
                            >
                              0V
                            </text>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={active ? 6.5 : 5}
                              fill={active ? '#1D4ED8' : '#BFDBFE'}
                              stroke="#1E3A8A"
                              strokeWidth="1.5"
                            />
                          </g>
                        );
                      }
                    )}
                  </g>

                  {/* ========================================================== */}
                  {/* MODULE 2 (TOP-CENTER-RIGHT): SIGNALIZATION LED MODULE      */}
                  {/* ========================================================== */}
                  <g opacity={outputTarget === 'led' || !plan.needsOutputPower ? 1 : 0.45}>
                    <rect
                      x="466"
                      y="18"
                      width="216"
                      height="116"
                      rx="6"
                      fill="#FFFFFF"
                      stroke={outputTarget === 'led' && plan.needsOutputPower ? '#15803D' : '#94A3B8'}
                      strokeWidth={outputTarget === 'led' && plan.needsOutputPower ? '2' : '1.5'}
                    />
                    <rect x="466" y="18" width="216" height="24" rx="5" fill="#0B4EA2" />
                    <text
                      x="574"
                      y="34"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="10.5"
                      fontWeight="700"
                    >
                      SİNYALİZASYON LED (L0–L5)
                    </text>

                    {/* COM(-) pin */}
                    <text x="492" y="96" textAnchor="middle" fill="#1E40AF" fontSize="8" fontFamily="monospace">
                      COM-
                    </text>
                    <circle
                      cx={PIN_MAP['led-com'].x}
                      cy={PIN_MAP['led-com'].y}
                      r={outputTarget === 'led' && plan.needsOutputPower ? 6.5 : 5}
                      fill={outputTarget === 'led' && plan.needsOutputPower ? '#1D4ED8' : '#E2E8F0'}
                      stroke="#1E3A8A"
                      strokeWidth="1.5"
                    />

                    {/* L0..L5 LED Lamps */}
                    {OUTPUT_NAMES.map((yAddr, idx) => {
                      const p = PIN_MAP[`led-${yAddr}`];
                      const used = outputTarget === 'led' && activeOutputSet.has(yAddr);
                      const checked = Boolean(checkedIds[`out-${yAddr}`]);
                      return (
                        <g key={yAddr}>
                          <circle
                            cx={p.x}
                            cy="68"
                            r="8.5"
                            fill={checked ? '#00C853' : used ? '#BBF7D0' : '#F1F5F9'}
                            stroke={used ? '#15803D' : '#CBD5E1'}
                            strokeWidth="1.8"
                          />
                          <text
                            x={p.x}
                            y="92"
                            textAnchor="middle"
                            fill={used ? '#0F172A' : '#94A3B8'}
                            fontSize="8.5"
                            fontWeight={used ? '700' : '400'}
                            fontFamily="monospace"
                          >
                            L{idx}
                          </text>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={used ? 6 : 4.5}
                            fill={used ? '#16A34A' : '#E2E8F0'}
                            stroke={used ? '#14532D' : '#94A3B8'}
                            strokeWidth="1.5"
                          />
                        </g>
                      );
                    })}
                  </g>

                  {/* ========================================================== */}
                  {/* MODULE 3 (TOP-RIGHT): ANALOG POTENTIOMETER MODULE (0-10V)  */}
                  {/* ========================================================== */}
                  <g opacity={plan.needsAnalogWiring ? 1 : 0.45}>
                    <rect
                      x="702"
                      y="18"
                      width="240"
                      height="124"
                      rx="6"
                      fill="#FFFFFF"
                      stroke={plan.needsAnalogWiring ? '#7C3AED' : '#94A3B8'}
                      strokeWidth={plan.needsAnalogWiring ? '2' : '1.5'}
                    />
                    <rect x="702" y="18" width="240" height="24" rx="5" fill="#5B21B6" />
                    <text
                      x="822"
                      y="34"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="10.5"
                      fontWeight="700"
                    >
                      ANALOG POTANSİYOMETRE (0–10V)
                    </text>

                    {[0, 1, 2, 3].map((ch) => {
                      const p = PIN_MAP[`pot-v${ch}`];
                      const active = activeAnalogSet.has(ch);
                      return (
                        <g key={ch}>
                          {/* Rotary Pot Dial */}
                          <circle
                            cx={p.x}
                            cy="72"
                            r="15"
                            fill={active ? '#F5F3FF' : '#F8FAFC'}
                            stroke={active ? '#7C3AED' : '#CBD5E1'}
                            strokeWidth={active ? '2' : '1.2'}
                          />
                          <line
                            x1={p.x}
                            y1="72"
                            x2={p.x + 7}
                            y2="63"
                            stroke={active ? '#5B21B6' : '#94A3B8'}
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          />
                          <text
                            x={p.x}
                            y="102"
                            textAnchor="middle"
                            fill={active ? '#5B21B6' : '#94A3B8'}
                            fontSize="9"
                            fontWeight={active ? '700' : '400'}
                            fontFamily="monospace"
                          >
                            AD{ch}
                          </text>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={active ? 6.5 : 4.5}
                            fill={active ? '#7C3AED' : '#E2E8F0'}
                            stroke={active ? '#4C1D95' : '#94A3B8'}
                            strokeWidth="1.5"
                          />
                        </g>
                      );
                    })}
                  </g>

                  {/* ========================================================== */}
                  {/* MODULE 4 (MID-RIGHT): SWITCH / BUTTON UNIT (X0–X7)         */}
                  {/* ========================================================== */}
                  <g opacity={plan.needsInputPower ? 1 : 0.55}>
                    <rect
                      x="702"
                      y="170"
                      width="240"
                      height="218"
                      rx="6"
                      fill="#FFFFFF"
                      stroke={plan.needsInputPower ? '#D97706' : '#94A3B8'}
                      strokeWidth={plan.needsInputPower ? '2' : '1.5'}
                    />
                    <rect x="702" y="170" width="240" height="22" rx="5" fill="#334155" />
                    <text
                      x="822"
                      y="185"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="10"
                      fontWeight="700"
                    >
                      ANAHTAR / BUTON ÜNİTESİ (X0–X7)
                    </text>

                    {/* COM(-) terminal */}
                    <circle
                      cx={PIN_MAP['btn-com'].x}
                      cy={PIN_MAP['btn-com'].y}
                      r={plan.needsInputPower ? 6 : 4.5}
                      fill={plan.needsInputPower ? '#1D4ED8' : '#E2E8F0'}
                      stroke="#1E3A8A"
                      strokeWidth="1.5"
                    />
                    <text
                      x="736"
                      y="209"
                      fill="#1E40AF"
                      fontSize="9"
                      fontWeight="700"
                      fontFamily="monospace"
                    >
                      COM (-) → GND Ortak
                    </text>

                    {/* X0..X7 buttons in clean single column (all pins on left edge) */}
                    {INPUT_NAMES.map((xAddr) => {
                      const p = PIN_MAP[`btn-${xAddr}`];
                      const used = activeInputSet.has(xAddr);
                      const checked = Boolean(checkedIds[`in-${xAddr}`]);
                      const cmt = commentOf(xAddr);
                      return (
                        <g key={xAddr}>
                          <rect
                            x="712"
                            y={p.y - 8.5}
                            width="220"
                            height="17"
                            rx="3"
                            fill={checked ? '#FEF3C7' : used ? '#FFFBEB' : '#F8FAFC'}
                            stroke={used ? '#D97706' : '#E2E8F0'}
                            strokeWidth={used ? '1.3' : '0.9'}
                          />
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={used ? 5 : 3.8}
                            fill={used ? '#EAB308' : '#CBD5E1'}
                            stroke={used ? '#92400E' : '#94A3B8'}
                            strokeWidth="1.4"
                          />
                          <text
                            x="734"
                            y={p.y + 3}
                            fill={used ? '#0F172A' : '#94A3B8'}
                            fontSize="9"
                            fontWeight={used ? '700' : '400'}
                            fontFamily="monospace"
                          >
                            {xAddr}
                            {cmt ? ` · ${cmt.slice(0, 22)}` : ''}
                          </text>
                        </g>
                      );
                    })}
                  </g>

                  {/* ========================================================== */}
                  {/* MODULE 5 (BOTTOM-RIGHT): RELAY OUTPUT MODULE (Y0–Y5)       */}
                  {/* ========================================================== */}
                  <g opacity={outputTarget === 'relay' || !plan.needsOutputPower ? 1 : 0.45}>
                    <rect
                      x="702"
                      y="406"
                      width="240"
                      height="170"
                      rx="6"
                      fill="#FFFFFF"
                      stroke={outputTarget === 'relay' && plan.needsOutputPower ? '#15803D' : '#94A3B8'}
                      strokeWidth={outputTarget === 'relay' && plan.needsOutputPower ? '2' : '1.5'}
                    />
                    <rect x="702" y="406" width="240" height="22" rx="5" fill="#1E293B" />
                    <text
                      x="822"
                      y="421"
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="10"
                      fontWeight="700"
                    >
                      RÖLE ÇIKIŞ DEVRESİ (Y0–Y5)
                    </text>

                    {/* COM(-) pin */}
                    <circle
                      cx={PIN_MAP['relay-com'].x}
                      cy={PIN_MAP['relay-com'].y}
                      r={outputTarget === 'relay' && plan.needsOutputPower ? 6 : 4.5}
                      fill={outputTarget === 'relay' && plan.needsOutputPower ? '#1D4ED8' : '#E2E8F0'}
                      stroke="#1E3A8A"
                      strokeWidth="1.5"
                    />
                    <text
                      x="736"
                      y="445"
                      fill="#1E40AF"
                      fontSize="9"
                      fontWeight="700"
                      fontFamily="monospace"
                    >
                      COM (-) → GND Ortak
                    </text>

                    {/* R0..R5 relays in clean single column (all pins on left edge) */}
                    {OUTPUT_NAMES.map((yAddr, idx) => {
                      const p = PIN_MAP[`relay-${yAddr}`];
                      const used = outputTarget === 'relay' && activeOutputSet.has(yAddr);
                      const checked = Boolean(checkedIds[`out-${yAddr}`]);
                      const cmt = commentOf(yAddr);
                      return (
                        <g key={yAddr}>
                          <rect
                            x="712"
                            y={p.y - 8}
                            width="220"
                            height="16"
                            rx="3"
                            fill={checked ? '#DCFCE7' : used ? '#F0FDF4' : '#F8FAFC'}
                            stroke={used ? '#16A34A' : '#E2E8F0'}
                            strokeWidth={used ? '1.3' : '0.9'}
                          />
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={used ? 5 : 3.8}
                            fill={used ? '#16A34A' : '#CBD5E1'}
                            stroke={used ? '#14532D' : '#94A3B8'}
                            strokeWidth="1.4"
                          />
                          <text
                            x="734"
                            y={p.y + 3}
                            fill={used ? '#0F172A' : '#94A3B8'}
                            fontSize="9"
                            fontWeight={used ? '700' : '400'}
                            fontFamily="monospace"
                          >
                            R{idx} ({yAddr}){cmt ? ` · ${cmt.slice(0, 17)}` : ''}
                          </text>
                        </g>
                      );
                    })}
                  </g>

                  {/* ========================================================== */}
                  {/* MODULE 6 (BOTTOM-LEFT): DVP-20SX2 PLC ENCLOSURE            */}
                  {/* ========================================================== */}
                  <g>
                    {/* Main PLC Chassis */}
                    <rect
                      x="24"
                      y="274"
                      width="510"
                      height="270"
                      rx="8"
                      fill="#E5E7EB"
                      stroke="#475569"
                      strokeWidth="2"
                    />
                    {/* Left Analog Module Strip (V0+ / VI0- / AG) */}
                    <rect
                      x="28"
                      y="280"
                      width="56"
                      height="258"
                      rx="5"
                      fill={plan.needsAnalogWiring ? '#F5F3FF' : '#F1F5F9'}
                      stroke={plan.needsAnalogWiring ? '#7C3AED' : '#94A3B8'}
                      strokeWidth="1.5"
                    />
                    <text
                      x="56"
                      y="296"
                      textAnchor="middle"
                      fill="#5B21B6"
                      fontSize="8.5"
                      fontWeight="700"
                      fontFamily="monospace"
                    >
                      ANALOG
                    </text>
                    <text
                      x="56"
                      y="307"
                      textAnchor="middle"
                      fill="#64748B"
                      fontSize="7.5"
                      fontFamily="monospace"
                    >
                      AD0–AD3
                    </text>

                    {/* Primary Analog Pins (V0+, VI0-, AG, plus any active AD1-AD3) */}
                    {(
                      [
                        { id: 'plc-v0p', label: 'V0+', active: activeAnalogSet.has(0) },
                        { id: 'plc-vi0m', label: 'VI0-', active: activeAnalogSet.has(0) },
                        { id: 'plc-ag', label: 'AG', active: plan.needsAnalogWiring },
                        ...(activeAnalogSet.has(1)
                          ? [
                              { id: 'plc-v1p', label: 'V1+', active: true },
                              { id: 'plc-vi1m', label: 'VI1-', active: true },
                            ]
                          : []),
                        ...(activeAnalogSet.has(2)
                          ? [
                              { id: 'plc-v2p', label: 'V2+', active: true },
                              { id: 'plc-vi2m', label: 'VI2-', active: true },
                            ]
                          : []),
                        ...(activeAnalogSet.has(3)
                          ? [
                              { id: 'plc-v3p', label: 'V3+', active: true },
                              { id: 'plc-vi3m', label: 'VI3-', active: true },
                            ]
                          : []),
                      ] as const
                    ).map((ap) => {
                      const coord = PIN_MAP[ap.id];
                      return (
                        <g key={ap.id}>
                          <circle
                            cx={coord.x}
                            cy={coord.y}
                            r={ap.active ? 6 : 4.5}
                            fill={ap.active ? '#7C3AED' : '#CBD5E1'}
                            stroke={ap.active ? '#4C1D95' : '#64748B'}
                            strokeWidth="1.4"
                          />
                          <text
                            x={coord.x + 10}
                            y={coord.y + 3.5}
                            fill={ap.active ? '#4C1D95' : '#64748B'}
                            fontSize="8.5"
                            fontWeight={ap.active ? '700' : '400'}
                            fontFamily="monospace"
                          >
                            {ap.label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Top PLC Input Terminal Block (S/S, X0–X7) */}
                    <rect
                      x="92"
                      y="280"
                      width="434"
                      height="42"
                      rx="4"
                      fill="#1E293B"
                    />
                    <g>
                      <circle
                        cx={PIN_MAP['plc-ss'].x}
                        cy={PIN_MAP['plc-ss'].y}
                        r={plan.needsInputPower ? 6.5 : 5}
                        fill={plan.needsInputPower ? '#DC2626' : '#64748B'}
                        stroke="#FFFFFF"
                        strokeWidth="1.4"
                      />
                      <text
                        x={PIN_MAP['plc-ss'].x}
                        y="314"
                        textAnchor="middle"
                        fill="#FCA5A5"
                        fontSize="9.5"
                        fontWeight="700"
                        fontFamily="monospace"
                      >
                        S/S
                      </text>
                    </g>
                    {INPUT_NAMES.map((xAddr) => {
                      const p = PIN_MAP[`plc-${xAddr}`];
                      const used = activeInputSet.has(xAddr);
                      return (
                        <g key={xAddr}>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={used ? 6.5 : 4.8}
                            fill={used ? '#EAB308' : '#64748B'}
                            stroke="#FFFFFF"
                            strokeWidth="1.4"
                          />
                          <text
                            x={p.x}
                            y="314"
                            textAnchor="middle"
                            fill={used ? '#FDE047' : '#94A3B8'}
                            fontSize="9.5"
                            fontWeight={used ? '700' : '400'}
                            fontFamily="monospace"
                          >
                            {xAddr}
                          </text>
                        </g>
                      );
                    })}

                    {/* PLC Center Faceplate */}
                    <rect
                      x="92"
                      y="330"
                      width="434"
                      height="160"
                      rx="5"
                      fill="#FFFFFF"
                      stroke="#94A3B8"
                      strokeWidth="1.2"
                    />
                    <rect x="92" y="330" width="434" height="32" rx="4" fill="#0B4EA2" />
                    <text
                      x="110"
                      y="350"
                      fill="#FFFFFF"
                      fontSize="13"
                      fontWeight="700"
                      fontFamily="sans-serif"
                    >
                      DELTA DVP-20SX2
                    </text>
                    <text
                      x="512"
                      y="350"
                      textAnchor="end"
                      fill="#BFDBFE"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      8 DI · 6 DO · 4 AI · 2 AO
                    </text>

                    {/* Faceplate I/O Status Labels */}
                    <text x="110" y="384" fill="#334155" fontSize="10" fontWeight="700" fontFamily="monospace">
                      GİRİŞLER (S/S = +24V DC · NPN/Sink)
                    </text>
                    <g>
                      {INPUT_NAMES.map((xAddr, idx) => {
                        const used = activeInputSet.has(xAddr);
                        return (
                          <g key={`fp-${xAddr}`}>
                            <rect
                              x={110 + idx * 50}
                              y="392"
                              width="42"
                              height="22"
                              rx="3"
                              fill={used ? '#FEF3C7' : '#F8FAFC'}
                              stroke={used ? '#D97706' : '#E2E8F0'}
                            />
                            <text
                              x={131 + idx * 50}
                              y="406"
                              textAnchor="middle"
                              fill={used ? '#92400E' : '#94A3B8'}
                              fontSize="9.5"
                              fontWeight={used ? '700' : '400'}
                              fontFamily="monospace"
                            >
                              {xAddr}
                            </text>
                          </g>
                        );
                      })}
                    </g>

                    <text x="110" y="438" fill="#334155" fontSize="10" fontWeight="700" fontFamily="monospace">
                      ÇIKIŞLAR (UP = +24V · ZP = GND)
                    </text>
                    <g>
                      {OUTPUT_NAMES.map((yAddr, idx) => {
                        const used = activeOutputSet.has(yAddr);
                        return (
                          <g key={`fp-${yAddr}`}>
                            <rect
                              x={110 + idx * 58}
                              y="446"
                              width="50"
                              height="24"
                              rx="3"
                              fill={used ? '#DCFCE7' : '#F8FAFC'}
                              stroke={used ? '#16A34A' : '#E2E8F0'}
                            />
                            <text
                              x={135 + idx * 58}
                              y="461"
                              textAnchor="middle"
                              fill={used ? '#166534' : '#94A3B8'}
                              fontSize="9.5"
                              fontWeight={used ? '700' : '400'}
                              fontFamily="monospace"
                            >
                              {yAddr}
                            </text>
                          </g>
                        );
                      })}
                    </g>

                    {/* Bottom PLC Output Terminal Block (UP, ZP, Y0–Y5) */}
                    <rect
                      x="92"
                      y="498"
                      width="434"
                      height="40"
                      rx="4"
                      fill="#1E293B"
                    />
                    <g>
                      <text
                        x={PIN_MAP['plc-up'].x}
                        y="512"
                        textAnchor="middle"
                        fill="#FCA5A5"
                        fontSize="9.5"
                        fontWeight="700"
                        fontFamily="monospace"
                      >
                        UP
                      </text>
                      <circle
                        cx={PIN_MAP['plc-up'].x}
                        cy={PIN_MAP['plc-up'].y}
                        r={plan.needsOutputPower ? 6.5 : 5}
                        fill={plan.needsOutputPower ? '#DC2626' : '#64748B'}
                        stroke="#FFFFFF"
                        strokeWidth="1.4"
                      />
                    </g>
                    <g>
                      <text
                        x={PIN_MAP['plc-zp'].x}
                        y="512"
                        textAnchor="middle"
                        fill="#93C5FD"
                        fontSize="9.5"
                        fontWeight="700"
                        fontFamily="monospace"
                      >
                        ZP
                      </text>
                      <circle
                        cx={PIN_MAP['plc-zp'].x}
                        cy={PIN_MAP['plc-zp'].y}
                        r={plan.needsOutputPower ? 6.5 : 5}
                        fill={plan.needsOutputPower ? '#1D4ED8' : '#64748B'}
                        stroke="#FFFFFF"
                        strokeWidth="1.4"
                      />
                    </g>
                    {OUTPUT_NAMES.map((yAddr) => {
                      const p = PIN_MAP[`plc-${yAddr}`];
                      const used = activeOutputSet.has(yAddr);
                      return (
                        <g key={yAddr}>
                          <text
                            x={p.x}
                            y="512"
                            textAnchor="middle"
                            fill={used ? '#86EFAC' : '#94A3B8'}
                            fontSize="9.5"
                            fontWeight={used ? '700' : '400'}
                            fontFamily="monospace"
                          >
                            {yAddr}
                          </text>
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={used ? 6.5 : 4.8}
                            fill={used ? '#16A34A' : '#64748B'}
                            stroke="#FFFFFF"
                            strokeWidth="1.4"
                          />
                        </g>
                      );
                    })}
                  </g>

                  {/* ========================================================== */}
                  {/* COLOR-CODED INTERACTIVE WIRES LAYER                        */}
                  {/* ========================================================== */}
                  <g>
                    {plan.connections.map((conn) => {
                      const style = WIRE_STYLES[conn.color];
                      const { d, labelX, labelY } = buildWirePath(conn);
                      if (!d) return null;

                      const isChecked = Boolean(checkedIds[conn.id]);
                      const isHovered = hoveredWireId === conn.id;
                      const isDimmed = hoveredWireId !== null && !isHovered;

                      return (
                        <g
                          key={conn.id}
                          data-testid={`svg-wire-${conn.id}`}
                          onClick={() => toggleWire(conn.id)}
                          onMouseEnter={() => setHoveredWireId(conn.id)}
                          onMouseLeave={() => setHoveredWireId(null)}
                          className="cursor-pointer touch-pan-x touch-pan-y"
                          opacity={isDimmed ? 0.22 : 1}
                        >
                          {/* Invisible wider hit target for easy touch/mouse selection */}
                          <path
                            d={d}
                            fill="none"
                            stroke="transparent"
                            strokeWidth="14"
                            strokeLinejoin="round"
                          />
                          {/* Outer highlight halo when hovered or checked */}
                          {(isHovered || isChecked) && (
                            <path
                              d={d}
                              fill="none"
                              stroke={isChecked ? '#00C853' : style.stroke}
                              strokeWidth={isHovered ? '8' : '6'}
                              strokeOpacity={isHovered ? 0.35 : 0.22}
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          )}
                          {/* Main wire stroke */}
                          <path
                            d={d}
                            fill="none"
                            stroke={style.stroke}
                            strokeWidth={isHovered ? '3.6' : isChecked ? '3.1' : '2.3'}
                            strokeDasharray={isChecked || isHovered ? undefined : '6 3'}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                          {/* Step number badge on the wire */}
                          <g data-testid={`svg-wire-badge-${conn.id}`}>
                            <circle
                              cx={labelX}
                              cy={labelY}
                              r={isHovered ? 10 : 8.5}
                              fill={isChecked ? '#00C853' : '#FFFFFF'}
                              stroke={isChecked ? '#007A33' : style.stroke}
                              strokeWidth="1.8"
                            />
                            <text
                              x={labelX}
                              y={labelY + 3.2}
                              textAnchor="middle"
                              fill={isChecked ? '#FFFFFF' : '#0F172A'}
                              fontSize="8.5"
                              fontWeight="700"
                              fontFamily="monospace"
                            >
                              {isChecked ? '✓' : conn.stepNumber}
                            </text>
                          </g>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            </div>
          </div>

          {/* Right Zone: Interactive Lab Wiring Checklist */}
          <aside className="w-full lg:w-[390px] xl:w-[420px] shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-[#CBD2DC] flex flex-col lg:min-h-0">
            {/* Checklist Header & Progress */}
            <div className="px-4 py-3 border-b border-[#E2E8F0] space-y-2 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-[#0F172A]">
                  Adım Adım Bağlantı Kontrol Listesi
                </h3>
                <span
                  data-testid="wiring-progress-count"
                  className={`font-mono tabular-nums text-xs font-bold ${
                    allChecked ? 'text-[#007A33]' : 'text-[#0B4EA2]'
                  }`}
                >
                  {checkedCount} / {totalCount} Bağlandı
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
                <div
                  className="h-full bg-[#00C853] transition-all duration-200"
                  style={{
                    width: totalCount > 0 ? `${Math.round((checkedCount / totalCount) * 100)}%` : '0%',
                  }}
                />
              </div>

              {totalCount > 0 && (
                <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                  <span className="text-[11px] text-[#64748B]">
                    Taktığınız kabloyu işaretleyin (şemada vurgulanır)
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      data-testid="wiring-check-all-btn"
                      onClick={handleCheckAll}
                      disabled={allChecked}
                      className="h-7 px-2 rounded border border-[#CBD2DC] bg-white hover:bg-[#F1F5F9] disabled:opacity-40 text-[11px] font-medium text-[#334155] flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCheck className="w-3 h-3 text-[#007A33]" aria-hidden="true" />
                      <span>Tümü</span>
                    </button>
                    <button
                      type="button"
                      data-testid="wiring-reset-checks-btn"
                      onClick={handleResetChecks}
                      disabled={checkedCount === 0}
                      className="h-7 px-2 rounded border border-[#CBD2DC] bg-white hover:bg-[#F1F5F9] disabled:opacity-40 text-[11px] font-medium text-[#334155] flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                      <span>Sıfırla</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Checklist Items or Empty State */}
            <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto wpl-scrollbar p-3 space-y-2">
              {totalCount === 0 ? (
                <div
                  data-testid="wiring-empty-state"
                  className="rounded border border-[#CBD2DC] bg-[#F8FAFC] p-4 text-center space-y-2"
                >
                  <Cable className="w-6 h-6 text-[#94A3B8] mx-auto" aria-hidden="true" />
                  <p className="text-xs font-semibold text-[#334155]">
                    Fiziksel I/O bağlantısı tespit edilmedi
                  </p>
                  <p className="text-[11px] text-[#64748B] leading-relaxed">
                    Mevcut Ladder devresinde fiziksel giriş (<strong className="font-mono">X0–X7</strong>), çıkış (<strong className="font-mono">Y0–Y5</strong>) veya analog kanal (<strong className="font-mono">D1110–D1113</strong>) bulunduğunda gereken tüm BETİ eğitim seti kabloları burada otomatik listelenir.
                  </p>
                </div>
              ) : (
                plan.connections.map((conn) => {
                  const style = WIRE_STYLES[conn.color];
                  const isChecked = Boolean(checkedIds[conn.id]);
                  const isHovered = hoveredWireId === conn.id;

                  return (
                    <button
                      key={conn.id}
                      type="button"
                      data-testid={`wiring-step-${conn.id}`}
                      aria-pressed={isChecked}
                      onClick={() => toggleWire(conn.id)}
                      onMouseEnter={() => setHoveredWireId(conn.id)}
                      onMouseLeave={() => setHoveredWireId(null)}
                      className={`w-full text-left rounded border p-2.5 transition-colors cursor-pointer flex items-start gap-2.5 ${
                        isChecked
                          ? 'border-[#00C853] bg-[#F0FDF4]'
                          : isHovered
                            ? 'border-[#0B4EA2] bg-[#EEF4FC]'
                            : 'border-[#CBD2DC] bg-white hover:bg-[#F8FAFC]'
                      }`}
                    >
                      {/* Step checkbox indicator */}
                      <span
                        className={`mt-0.5 w-6 h-6 rounded border shrink-0 flex items-center justify-center font-mono text-[11px] font-bold transition-colors ${
                          isChecked
                            ? 'bg-[#00C853] border-[#00963F] text-white'
                            : 'bg-[#F8FAFC] border-[#94A3B8] text-[#334155]'
                        }`}
                        aria-hidden="true"
                      >
                        {isChecked ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : conn.stepNumber}
                      </span>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F172A]">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/15"
                              style={{ backgroundColor: style.swatch }}
                              aria-hidden="true"
                            />
                            <span>{conn.colorLabel}</span>
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
                              isChecked ? 'text-[#007A33]' : 'text-[#64748B]'
                            }`}
                          >
                            {isChecked ? 'Bağlandı ✓' : 'Bekliyor'}
                          </span>
                        </div>

                        <div className="font-mono text-xs font-bold text-[#0F172A] leading-snug break-words">
                          <span className="text-[#475569] font-normal">{conn.fromModule}</span>{' '}
                          {conn.fromTerminal}{' '}
                          <span className="text-[#0B4EA2]" aria-hidden="true">
                            →
                          </span>{' '}
                          <span className="text-[#475569] font-normal">{conn.toModule}</span>{' '}
                          {conn.toTerminal}
                        </div>

                        <p className="text-[11px] text-[#475569] leading-snug">
                          {conn.description}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Bottom Safety Note & Close */}
            <div className="px-4 py-2.5 bg-[#F8FAFC] border-t border-[#CBD2DC] flex items-center justify-between gap-2 shrink-0">
              <span className="text-[11px] text-[#475569]">
                {allChecked
                  ? 'Tüm kablolar bağlandı — enerji verebilirsiniz.'
                  : 'Enerji vermeden önce +24V / GND uçlarını kontrol edin.'}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-xs font-medium text-[#334155] cursor-pointer shrink-0"
              >
                Kapat
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
