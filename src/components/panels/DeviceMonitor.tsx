import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type {
  InputSwitchMode,
  LadderProgram,
  PlcModelSpec,
  SimState,
} from '../../types/plc';
import {
  ALL_OCTAL_INPUTS,
  ALL_OCTAL_OUTPUTS,
  SPECIAL_RELAYS,
  SX2_ANALOG_INPUT_CHANNELS,
  SX2_RTC_REGISTERS,
} from '../../core/plcModels';
import { collectReferencedDevices, getTimerTimeBaseMs } from '../../core/scanner';

type MonitorTab = 'io' | 'rtc' | 'registers' | 'sx2';

interface DeviceMonitorProps {
  program: LadderProgram;
  modelSpec: PlcModelSpec;
  simState: SimState;
  inputModes: Record<string, InputSwitchMode>;
  isOpen: boolean;
  dockMode?: 'bottom' | 'right';
  onToggleOpen: () => void;
  onSetInputBit: (address: string, value: boolean) => void;
  onToggleInputBit: (address: string) => void;
  onSetInputMode: (address: string, mode: InputSwitchMode) => void;
  onToggleRelayBit: (address: string) => void;
  onSetRegisterValue: (address: string, value: number) => void;
  onSyncRtcNow: () => void;
  onShiftRtcSeconds: (deltaSeconds: number) => void;
}

const DEFAULT_RELAYS = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'];
const DEFAULT_TIMERS = ['T0', 'T1', 'T2', 'T3'];
const DEFAULT_COUNTERS = ['C0', 'C1', 'C2', 'C3'];
const DEFAULT_REGISTERS = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'];

function mergeUniqueDevices(primary: string[], defaults: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const addr of [...primary, ...defaults]) {
    if (!seen.has(addr)) {
      seen.add(addr);
      result.push(addr);
    }
  }
  return result;
}

export const DeviceMonitor: React.FC<DeviceMonitorProps> = ({
  program,
  modelSpec,
  simState,
  inputModes,
  isOpen,
  dockMode = 'bottom',
  onToggleOpen,
  onSetInputBit,
  onToggleInputBit,
  onSetInputMode,
  onToggleRelayBit,
  onSetRegisterValue,
  onSyncRtcNow,
  onShiftRtcSeconds,
}) => {
  const [activeTab, setActiveTab] = useState<MonitorTab>('io');
  const [showExpansionInputs, setShowExpansionInputs] = useState(false);
  const [showExpansionOutputs, setShowExpansionOutputs] = useState(false);
  const [registerDrafts, setRegisterDrafts] = useState<Record<string, string>>({});

  // Track currently pressed momentary inputs so window pointerup/blur safely releases them on mobile
  const activeMomentaryRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const releaseAllMomentary = () => {
      if (activeMomentaryRef.current.size === 0) return;
      for (const addr of activeMomentaryRef.current) {
        onSetInputBit(addr, false);
      }
      activeMomentaryRef.current.clear();
    };

    window.addEventListener('pointerup', releaseAllMomentary);
    window.addEventListener('pointercancel', releaseAllMomentary);
    window.addEventListener('blur', releaseAllMomentary);
    return () => {
      window.removeEventListener('pointerup', releaseAllMomentary);
      window.removeEventListener('pointercancel', releaseAllMomentary);
      window.removeEventListener('blur', releaseAllMomentary);
    };
  }, [onSetInputBit]);

  const referenced = useMemo(() => collectReferencedDevices(program), [program]);

  const visibleInputs = useMemo(
    () => (showExpansionInputs ? ALL_OCTAL_INPUTS : modelSpec.onboardInputs),
    [modelSpec.onboardInputs, showExpansionInputs]
  );

  const visibleOutputs = useMemo(
    () => (showExpansionOutputs ? ALL_OCTAL_OUTPUTS : modelSpec.onboardOutputs),
    [modelSpec.onboardOutputs, showExpansionOutputs]
  );

  const relayList = useMemo(
    () => mergeUniqueDevices(referenced.relays, DEFAULT_RELAYS),
    [referenced.relays]
  );
  const timerList = useMemo(
    () => mergeUniqueDevices(referenced.timers, DEFAULT_TIMERS),
    [referenced.timers]
  );
  const counterList = useMemo(
    () => mergeUniqueDevices(referenced.counters, DEFAULT_COUNTERS),
    [referenced.counters]
  );
  const registerList = useMemo(
    () => mergeUniqueDevices(referenced.registers, DEFAULT_REGISTERS),
    [referenced.registers]
  );

  const handleMomentaryPress = (addr: string) => {
    activeMomentaryRef.current.add(addr);
    onSetInputBit(addr, true);
  };

  const handleMomentaryRelease = (addr: string) => {
    if (!activeMomentaryRef.current.has(addr) && !simState.inputs[addr]) return;
    activeMomentaryRef.current.delete(addr);
    onSetInputBit(addr, false);
  };

  const handleRegisterCommit = (addr: string) => {
    const raw = registerDrafts[addr];
    if (raw === undefined || raw.trim() === '') return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      onSetRegisterValue(addr, parsed);
    }
    setRegisterDrafts((prev) => {
      const next = { ...prev };
      delete next[addr];
      return next;
    });
  };

  const supportsSx2Hardware = modelSpec.analogInputCount > 0 || modelSpec.hasRtc;
  const isRightDock = dockMode === 'right';

  // In phone-landscape side dock, collapsing frees 100% width for the Ladder Diagram
  if (isRightDock && !isOpen) {
    return null;
  }

  return (
    <section
      aria-label="Giriş / çıkış izleme paneli"
      data-testid="device-monitor"
      data-dock-mode={dockMode}
      className={
        isRightDock
          ? 'w-[266px] sm:w-[292px] shrink-0 h-full bg-[#F7F8FA] border-l-2 border-[#0B4EA2] flex flex-col overflow-hidden shadow-[-2px_0_8px_rgba(15,23,42,0.08)]'
          : 'shrink-0 bg-[#F7F8FA] border-t-2 border-[#0B4EA2] flex flex-col shadow-[0_-2px_8px_rgba(15,23,42,0.08)]'
      }
    >
      {/* Monitor Header Bar (No redundant RUN/STOP or scan counter — OnlineSimBar already displays them) */}
      <div
        className={`shrink-0 bg-[#E6E9EF] border-b border-[#CBD2DC] flex items-center justify-between gap-1.5 ${
          isRightDock ? 'px-2 py-1' : 'px-2.5 sm:px-3.5 py-1'
        }`}
      >
        {!isRightDock && (
          <div className="flex items-center gap-1.5 min-w-0">
            <SlidersHorizontal
              className="w-3.5 h-3.5 text-[#0B4EA2] shrink-0"
              aria-hidden="true"
            />
            <span className="text-xs font-bold text-[#0F172A] whitespace-nowrap hidden sm:inline">
              Giriş / Çıkış İzleme
            </span>
            <span className="text-xs font-bold text-[#0F172A] whitespace-nowrap sm:hidden">
              I/O
            </span>
          </div>
        )}

        <div
          className={`flex items-center gap-1 ${
            isRightDock ? 'w-full justify-between' : ''
          }`}
        >
          {/* Tabs */}
          <div
            role="tablist"
            aria-label="İzleme kategorileri"
            className="flex items-center bg-[#DCE1EA] p-0.5 rounded border border-[#C5CDD9]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'io'}
              onClick={() => {
                setActiveTab('io');
                if (!isOpen) onToggleOpen();
              }}
              className={`h-6 ${
                isRightDock ? 'px-1.5' : 'px-2 sm:px-2.5'
              } rounded-[3px] text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'io'
                  ? 'bg-white text-[#0B4EA2] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              X·Y
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'rtc'}
              onClick={() => {
                setActiveTab('rtc');
                if (!isOpen) onToggleOpen();
              }}
              className={`h-6 ${
                isRightDock ? 'px-1.5' : 'px-2 sm:px-2.5'
              } rounded-[3px] text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'rtc'
                  ? 'bg-white text-[#0B4EA2] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              M·T·C
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'registers'}
              onClick={() => {
                setActiveTab('registers');
                if (!isOpen) onToggleOpen();
              }}
              className={`h-6 ${
                isRightDock ? 'px-1.5' : 'px-2 sm:px-2.5'
              } rounded-[3px] text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'registers'
                  ? 'bg-white text-[#0B4EA2] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              {isRightDock ? 'D' : 'D Reg'}
            </button>
            <button
              type="button"
              role="tab"
              data-testid="dm-tab-sx2"
              aria-selected={activeTab === 'sx2'}
              title={
                supportsSx2Hardware
                  ? 'DVP-SX2 Dahili Analog Girişler (AD0–AD3) ve Gerçek Zaman Saati (RTC)'
                  : `${modelSpec.label} modelinde dahili Analog Giriş ve RTC bulunmaz`
              }
              onClick={() => {
                setActiveTab('sx2');
                if (!isOpen) onToggleOpen();
              }}
              className={`h-6 ${
                isRightDock ? 'px-1.5' : 'px-2 sm:px-2.5'
              } rounded-[3px] text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'sx2'
                  ? 'bg-white text-[#0B4EA2] shadow-xs'
                  : supportsSx2Hardware
                    ? 'text-[#475569] hover:text-[#0F172A]'
                    : 'text-[#94A3B8] hover:text-[#475569]'
              }`}
            >
              {isRightDock ? (
                <span>AD</span>
              ) : (
                <>
                  <span className="hidden sm:inline">SX2 Analog / RTC</span>
                  <span className="sm:hidden">AD/RTC</span>
                </>
              )}
            </button>
          </div>

          <button
            type="button"
            data-testid="device-monitor-collapse-btn"
            onClick={onToggleOpen}
            aria-expanded={isOpen}
            aria-label={isOpen ? 'İzleme panelini kapat' : 'İzleme panelini aç'}
            title={isOpen ? 'Paneli daralt' : 'Paneli aç'}
            className="h-7 w-7 rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-[#334155] flex items-center justify-center shrink-0 cursor-pointer"
          >
            {isRightDock ? (
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            ) : isOpen ? (
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Content Area */}
      {isOpen && (
        <div
          className={
            isRightDock
              ? 'flex-1 min-h-0 overflow-y-auto wpl-scrollbar p-2'
              : 'max-h-[36dvh] sm:max-h-[230px] overflow-y-auto wpl-scrollbar p-2 sm:p-2.5'
          }
        >
          {activeTab === 'io' && (
            <div
              className={
                isRightDock
                  ? 'flex flex-col gap-2'
                  : 'grid grid-cols-1 lg:grid-cols-12 gap-2.5 sm:gap-3'
              }
            >
              {/* Digital Inputs X0–X17 */}
              <div
                className={
                  isRightDock
                    ? 'order-2 bg-white border border-[#CBD2DC] rounded p-1.5'
                    : 'order-2 lg:order-1 lg:col-span-7 bg-white border border-[#CBD2DC] rounded p-2 sm:p-2.5'
                }
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h2 className="text-xs font-bold text-[#0F172A] whitespace-nowrap">
                      {isRightDock ? 'Girişler (X)' : 'Giriş Anahtarları (X)'}
                    </h2>
                    {!isRightDock && (
                      <span className="text-[11px] font-mono text-[#64748B] truncate">
                        {showExpansionInputs ? 'X0–X17' : 'X0–X7 Dahili'}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowExpansionInputs((v) => !v)}
                    className="h-6 px-1.5 rounded border border-[#CBD2DC] bg-[#F8FAFC] hover:bg-[#EDF4FC] text-[10px] font-medium text-[#0B4EA2] whitespace-nowrap cursor-pointer"
                  >
                    {showExpansionInputs ? 'X0–X7' : '+ X10–X17'}
                  </button>
                </div>

                <div
                  className={
                    isRightDock
                      ? 'grid grid-cols-2 gap-1.5'
                      : 'grid grid-cols-2 sm:grid-cols-4 gap-1.5'
                  }
                >
                  {visibleInputs.map((addr) => {
                    const isOn = Boolean(simState.inputs[addr]);
                    const mode: InputSwitchMode = inputModes[addr] ?? 'toggle';
                    const isMomentary = mode === 'momentary';
                    const comment = program.deviceComments[addr];

                    return (
                      <div
                        key={addr}
                        className={`rounded border p-1.5 flex flex-col gap-1 transition-colors ${
                          isOn
                            ? 'border-[#00C853] bg-[#F0FDF4]'
                            : 'border-[#D1D8E3] bg-[#FAFBFD]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-xs font-bold text-[#0F172A]">
                            {addr}
                          </span>
                          <button
                            type="button"
                            data-testid={`input-mode-${addr}`}
                            onClick={() =>
                              onSetInputMode(addr, isMomentary ? 'toggle' : 'momentary')
                            }
                            aria-label={`${addr} anahtar modunu değiştir (şu an: ${
                              isMomentary ? 'Anlık Bas-Çek' : 'Kalıcı Anahtar'
                            })`}
                            title={
                              isMomentary
                                ? 'Anlık Buton (Bas-Çek) — Kalıcı moda geçmek için tıkla'
                                : 'Kalıcı Anahtar (Toggle) — Anlık Bas-Çek moduna geçmek için tıkla'
                            }
                            className={`h-5 px-1.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                              isMomentary
                                ? 'border-[#0B4EA2] bg-[#EEF4FC] text-[#0B4EA2]'
                                : 'border-[#CBD2DC] bg-white text-[#475569] hover:border-[#94A3B8]'
                            }`}
                          >
                            {isMomentary ? 'Anlık' : 'Kalıcı'}
                          </button>
                        </div>

                        <button
                          type="button"
                          data-testid={`input-btn-${addr}`}
                          aria-pressed={isOn}
                          aria-label={`${addr}${comment ? ` ${comment}` : ''} (${
                            isMomentary ? 'Anlık buton' : 'Kalıcı anahtar'
                          }) — ${isOn ? 'ON' : 'OFF'}`}
                          onClick={isMomentary ? undefined : () => onToggleInputBit(addr)}
                          onContextMenu={
                            isMomentary ? (e) => e.preventDefault() : undefined
                          }
                          onPointerDown={
                            isMomentary
                              ? (e) => {
                                  e.preventDefault();
                                  try {
                                    e.currentTarget.setPointerCapture(e.pointerId);
                                  } catch {
                                    // Synthetic pointer events may not support capture
                                  }
                                  handleMomentaryPress(addr);
                                }
                              : undefined
                          }
                          onPointerUp={
                            isMomentary ? () => handleMomentaryRelease(addr) : undefined
                          }
                          onPointerLeave={
                            isMomentary ? () => handleMomentaryRelease(addr) : undefined
                          }
                          onPointerCancel={
                            isMomentary ? () => handleMomentaryRelease(addr) : undefined
                          }
                          onKeyDown={
                            isMomentary
                              ? (e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    handleMomentaryPress(addr);
                                  }
                                }
                              : undefined
                          }
                          onKeyUp={
                            isMomentary
                              ? (e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    handleMomentaryRelease(addr);
                                  }
                                }
                              : undefined
                          }
                          className={`${
                            isRightDock ? 'min-h-[34px] py-0.5' : 'min-h-[42px] py-1'
                          } w-full rounded border px-1.5 flex flex-col items-center justify-center ${
                            isMomentary ? 'wpl-touch-hold' : 'touch-manipulation select-none'
                          } transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B4EA2] ${
                            isOn
                              ? 'bg-[#00C853] border-[#00963F] text-white'
                              : 'bg-white border-[#B8C2D1] text-[#334155] hover:bg-[#F1F5F9]'
                          }`}
                        >
                          <span className="font-mono text-xs font-bold leading-tight">
                            {isOn
                              ? isMomentary
                                ? 'BASILI · ON'
                                : 'ON'
                              : isMomentary
                                ? 'BAS · OFF'
                                : 'OFF'}
                          </span>
                          {comment && (
                            <span
                              className={`text-[10px] leading-tight truncate max-w-full ${
                                isOn ? 'text-white/95' : 'text-[#64748B]'
                              }`}
                            >
                              {comment}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Digital Outputs Y0–Y17 (Shown above X inputs on mobile & right-dock for instant LED visibility) */}
              <div
                className={
                  isRightDock
                    ? 'order-1 bg-white border border-[#CBD2DC] rounded p-1.5'
                    : 'order-1 lg:order-2 lg:col-span-5 bg-white border border-[#CBD2DC] rounded p-2 sm:p-2.5'
                }
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h2 className="text-xs font-bold text-[#0F172A] whitespace-nowrap">
                      {isRightDock ? 'Çıkışlar (Y)' : "Çıkış LED'leri (Y)"}
                    </h2>
                    {!isRightDock && (
                      <span className="text-[11px] font-mono text-[#64748B] truncate">
                        {showExpansionOutputs
                          ? 'Y0–Y17'
                          : `Y0–${modelSpec.onboardOutputs[modelSpec.onboardOutputs.length - 1]} Dahili`}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowExpansionOutputs((v) => !v)}
                    className="h-6 px-1.5 rounded border border-[#CBD2DC] bg-[#F8FAFC] hover:bg-[#EDF4FC] text-[10px] font-medium text-[#0B4EA2] whitespace-nowrap cursor-pointer"
                  >
                    {showExpansionOutputs ? 'Dahili' : '+ Y10–Y17'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1">
                  {visibleOutputs.map((addr) => {
                    const isOn = Boolean(simState.outputs[addr]);
                    const comment = program.deviceComments[addr];
                    return (
                      <div
                        key={addr}
                        data-testid={`output-led-${addr}`}
                        aria-label={`Çıkış ${addr} durumu: ${isOn ? 'ON' : 'OFF'}`}
                        className={`${
                          isRightDock
                            ? 'min-h-[34px] px-1.5 py-1 gap-1'
                            : 'min-h-[38px] sm:min-h-[50px] px-2 sm:px-2.5 py-1.5 gap-1.5 sm:gap-2'
                        } rounded border flex items-center transition-colors ${
                          isOn
                            ? 'bg-[#E6F9EE] border-[#00C853]'
                            : 'bg-[#FAFBFD] border-[#D1D8E3]'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-3.5 h-3.5 rounded-[3px] border shrink-0 ${
                            isOn
                              ? 'bg-[#00C853] border-[#008C3A] shadow-[0_0_6px_rgba(0,200,83,0.55)]'
                              : 'bg-[#CBD5E1] border-[#94A3B8]'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-xs font-bold text-[#0F172A]">
                              {addr}
                            </span>
                            <span
                              className={`font-mono text-[11px] font-bold ${
                                isOn ? 'text-[#007A33]' : 'text-[#64748B]'
                              }`}
                            >
                              {isOn ? 'ON' : 'OFF'}
                            </span>
                          </div>
                          {comment && (
                            <div className="text-[10px] text-[#475569] truncate">
                              {comment}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rtc' && (
            <div
              className={
                isRightDock
                  ? 'grid grid-cols-1 gap-2'
                  : 'grid grid-cols-1 lg:grid-cols-3 gap-3'
              }
            >
              {/* Special & Auxiliary Relays (M) */}
              <div className="bg-white border border-[#CBD2DC] rounded p-2.5 space-y-2">
                <h2 className="text-xs font-bold text-[#0F172A]">
                  Özel &amp; Yardımcı Röleler (M)
                </h2>
                <div className="grid grid-cols-2 gap-1">
                  {Object.values(SPECIAL_RELAYS).map((sr) => {
                    const isOn = Boolean(simState.relays[sr.address]);
                    return (
                      <div
                        key={sr.address}
                        data-testid={`relay-${sr.address}`}
                        title={sr.description}
                        className={`px-1.5 py-1 rounded border flex items-center justify-between gap-1 text-[11px] ${
                          isOn
                            ? 'bg-[#E6F9EE] border-[#00C853]'
                            : 'bg-[#F8FAFC] border-[#DDE3EC]'
                        }`}
                      >
                        <div className="min-w-0 truncate">
                          <span className="font-mono font-bold text-[#0B4EA2]">
                            {sr.address}
                          </span>
                          <span className="ml-1 text-[10px] text-[#475569]">
                            {sr.name.split(' ')[0]}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-[10px] font-bold shrink-0 ${
                            isOn ? 'text-[#007A33]' : 'text-[#64748B]'
                          }`}
                        >
                          {isOn ? '1' : '0'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {relayList.map((addr) => {
                    const isOn = Boolean(simState.relays[addr]);
                    return (
                      <button
                        key={addr}
                        type="button"
                        data-testid={`relay-${addr}`}
                        onClick={() => onToggleRelayBit(addr)}
                        title={`${addr} yardımcı rölesini zorla (Force)`}
                        className={`min-h-[38px] rounded border px-1.5 py-1 flex flex-col items-center justify-center font-mono text-[11px] transition-colors cursor-pointer ${
                          isOn
                            ? 'bg-[#00C853] border-[#00963F] text-white font-bold'
                            : 'bg-[#FAFBFD] border-[#CBD2DC] text-[#334155] hover:bg-[#EEF4FC]'
                        }`}
                      >
                        <span>{addr}</span>
                        <span className="text-[9px]">{isOn ? 'ON' : 'OFF'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Timers (T0–T199: 100ms, T200–T245: 10ms, T246–T249: 1ms) */}
              <div className="bg-white border border-[#CBD2DC] rounded p-2.5 space-y-2">
                <h2 className="text-xs font-bold text-[#0F172A]">
                  Zamanlayıcılar (TMR · 100ms / 10ms / 1ms)
                </h2>
                <div className="space-y-1.5">
                  {timerList.map((addr) => {
                    const rt = simState.timers[addr];
                    const cur = rt?.currentValue ?? 0;
                    const preset = rt?.presetValue ?? 0;
                    const done = Boolean(rt?.done);
                    const baseMs = getTimerTimeBaseMs(addr);
                    const secondsStr = ((cur * baseMs) / 1000).toFixed(
                      baseMs === 1 ? 3 : baseMs === 10 ? 2 : 1
                    );
                    const pct =
                      preset > 0 ? Math.min(100, Math.round((cur / preset) * 100)) : 0;

                    return (
                      <div
                        key={addr}
                        data-testid={`timer-${addr}`}
                        className={`rounded border p-2 space-y-1 ${
                          done
                            ? 'bg-[#E6F9EE] border-[#00C853]'
                            : rt?.coilEnergized
                              ? 'bg-[#EEF4FC] border-[#0B4EA2]/50'
                              : 'bg-[#FAFBFD] border-[#DDE3EC]'
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono text-xs">
                          <span className="font-bold text-[#0F172A]">
                            {addr}{' '}
                            <span className="text-[10px] font-normal text-[#64748B]">
                              {baseMs}ms
                            </span>
                          </span>
                          <span className="font-semibold text-[#0B4EA2]">
                            {cur} / {preset}{' '}
                            <span className="text-[10px] text-[#64748B]">
                              ({secondsStr}s)
                            </span>
                          </span>
                          <span
                            className={`text-[11px] font-bold ${
                              done ? 'text-[#007A33]' : 'text-[#64748B]'
                            }`}
                          >
                            {done ? 'ON' : 'OFF'}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-xs bg-[#E2E8F0] overflow-hidden">
                          <div
                            className="h-full transition-[width] duration-75"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: done ? '#00C853' : '#0B4EA2',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Counters (C0–C127) */}
              <div className="bg-white border border-[#CBD2DC] rounded p-2.5 space-y-2">
                <h2 className="text-xs font-bold text-[#0F172A]">
                  Sayıcılar (CNT · Yükselen Kenar)
                </h2>
                <div className="space-y-1.5">
                  {counterList.map((addr) => {
                    const rt = simState.counters[addr];
                    const cur = rt?.currentValue ?? 0;
                    const preset = rt?.presetValue ?? 0;
                    const done = Boolean(rt?.done);
                    const pct =
                      preset > 0 ? Math.min(100, Math.round((cur / preset) * 100)) : 0;

                    return (
                      <div
                        key={addr}
                        data-testid={`counter-${addr}`}
                        className={`rounded border p-2 space-y-1 ${
                          done
                            ? 'bg-[#E6F9EE] border-[#00C853]'
                            : 'bg-[#FAFBFD] border-[#DDE3EC]'
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono text-xs">
                          <span className="font-bold text-[#0F172A]">{addr}</span>
                          <span className="font-semibold text-[#0B4EA2]">
                            {cur} / {preset}
                          </span>
                          <span
                            className={`text-[11px] font-bold ${
                              done ? 'text-[#007A33]' : 'text-[#64748B]'
                            }`}
                          >
                            {done ? 'ON' : 'OFF'}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-xs bg-[#E2E8F0] overflow-hidden">
                          <div
                            className="h-full transition-[width] duration-75"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: done ? '#00C853' : '#0B4EA2',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'registers' && (
            <div className="bg-white border border-[#CBD2DC] rounded p-2.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
                  <h2 className="text-xs font-bold text-[#0F172A]">
                    Veri Registerları (D0–D{modelSpec.registerRange.max} · 16-bit İşaretli)
                  </h2>
                </div>
                <span className="text-[11px] text-[#64748B] hidden sm:inline">
                  Değer yazıp Enter veya Yaz ile uygulayın
                </span>
              </div>

              <div
                className={
                  isRightDock
                    ? 'grid grid-cols-1 gap-1.5'
                    : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2'
                }
              >
                {registerList.map((addr) => {
                  const val = simState.registers[addr] ?? 0;
                  const draft = registerDrafts[addr];
                  return (
                    <div
                      key={addr}
                      data-testid={`register-${addr}`}
                      className="rounded border border-[#D1D8E3] bg-[#FAFBFD] p-2 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between font-mono text-xs">
                        <span className="font-bold text-[#0B4EA2]">{addr}</span>
                        <span className="font-bold text-[#0F172A]">{val}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          inputMode="numeric"
                          enterKeyHint="done"
                          min={-32768}
                          max={32767}
                          aria-label={`${addr} yeni değeri`}
                          value={draft ?? String(val)}
                          onChange={(e) =>
                            setRegisterDrafts((prev) => ({
                              ...prev,
                              [addr]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRegisterCommit(addr);
                          }}
                          className="h-8 min-w-0 flex-1 rounded border border-[#B8C2D1] bg-white px-2 font-mono text-xs text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0B4EA2]"
                        />
                        <button
                          type="button"
                          onClick={() => handleRegisterCommit(addr)}
                          className="h-8 px-2.5 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-xs font-semibold text-[#0B4EA2] shrink-0 cursor-pointer"
                        >
                          Yaz
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'sx2' && !supportsSx2Hardware && (
            <div
              data-testid="dm-sx2-unsupported"
              className="bg-[#FFFBEB] border border-[#FDE68A] rounded p-3 text-xs text-[#92400E] space-y-1"
            >
              <div className="font-bold">
                {modelSpec.label} Modelinde Dahili Analog Giriş ve RTC Bulunmaz
              </div>
              <p className="leading-relaxed">
                Dahili 4 kanal analog giriş (<span className="font-mono">AD0–AD3 · D1110–D1113</span>) ve dahili gerçek zaman saati (<span className="font-mono">RTC · D1313–D1319 / TRD</span>) yalnızca <span className="font-mono font-bold">DVP-SX2</span> modelinde standart olarak mevcuttur. Bu özellikleri simüle etmek için düzenleme modunda üst çubuktan <span className="font-mono font-bold">DVP-SX2</span> modelini seçebilirsiniz.
              </p>
            </div>
          )}

          {activeTab === 'sx2' && supportsSx2Hardware && (
            <div
              className={
                isRightDock
                  ? 'grid grid-cols-1 gap-2'
                  : 'grid grid-cols-1 lg:grid-cols-12 gap-2.5 sm:gap-3'
              }
            >
              {/* SX2 4-Channel Analog Inputs AD0-AD3 (D1110-D1113) */}
              <div
                className={`${
                  isRightDock ? '' : 'lg:col-span-7'
                } bg-white border border-[#CBD2DC] rounded p-2 space-y-2`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
                    <h2 className="text-xs font-bold text-[#0F172A]">
                      {isRightDock ? 'SX2 Analog (D1110–13)' : 'SX2 Analog Girişler (AD0–AD3 → D1110–D1113)'}
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-[#64748B]">
                    0–2000 (0–10V)
                  </span>
                </div>

                <div
                  className={
                    isRightDock
                      ? 'grid grid-cols-1 gap-1.5'
                      : 'grid grid-cols-1 sm:grid-cols-2 gap-2'
                  }
                >
                  {SX2_ANALOG_INPUT_CHANNELS.map((ch) => {
                    const rawVal = Math.max(
                      ch.min,
                      Math.min(ch.max, simState.registers[ch.register] ?? 0)
                    );
                    const voltage = ((rawVal / ch.max) * 10).toFixed(2);
                    // LM35 (10mV/°C) on DVP-SX2 12-bit 0–10V ADC (5mV/birim) -> T(°C) = D1110 / 2
                    const tempC = (rawVal / 2).toFixed(1);
                    return (
                      <div
                        key={ch.register}
                        data-testid={`analog-card-${ch.register}`}
                        className="rounded border border-[#D1D8E3] bg-[#FAFBFD] p-2 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-1 font-mono text-xs">
                          <span className="font-bold text-[#0B4EA2]">
                            {ch.channel}{' '}
                            <span className="text-[#475569] font-normal">({ch.register})</span>
                          </span>
                          <span
                            data-testid={`analog-value-${ch.register}`}
                            className="font-bold text-[#0F172A]"
                          >
                            {rawVal}
                          </span>
                        </div>

                        <input
                          type="range"
                          min={ch.min}
                          max={ch.max}
                          step={1}
                          value={rawVal}
                          data-testid={`analog-slider-${ch.register}`}
                          aria-label={`${ch.channel} ${ch.register} analog giriş değeri`}
                          onChange={(e) =>
                            onSetRegisterValue(ch.register, Number(e.target.value))
                          }
                          className="w-full h-2 accent-[#0B4EA2] cursor-pointer"
                        />

                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <span className="font-mono text-[10px] text-[#475569]">
                            {voltage}V · {tempC}°C (LM35)
                          </span>
                          <div className="flex items-center gap-1">
                            {[0, 50, 500, 1000, 2000].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => onSetRegisterValue(ch.register, preset)}
                                className={`h-5 px-1.5 rounded border font-mono text-[10px] cursor-pointer ${
                                  rawVal === preset
                                    ? 'bg-[#0B4EA2] border-[#0B4EA2] text-white font-bold'
                                    : 'bg-white border-[#CBD2DC] text-[#334155] hover:border-[#0B4EA2]'
                                }`}
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SX2 Built-in Real-Time Clock (RTC · D1313-D1319) */}
              <div
                className={`${
                  isRightDock ? '' : 'lg:col-span-5'
                } bg-white border border-[#CBD2DC] rounded p-2 space-y-2`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
                    <h2 className="text-xs font-bold text-[#0F172A]">
                      SX2 Dahili RTC (D1313–D1319)
                    </h2>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid="rtc-sync-now-btn"
                      onClick={onSyncRtcNow}
                      className="h-6 px-2 rounded border border-[#CBD2DC] bg-[#F8FAFC] hover:bg-[#EDF4FC] text-[10px] font-semibold text-[#0B4EA2] cursor-pointer"
                    >
                      Şimdi
                    </button>
                    <button
                      type="button"
                      data-testid="rtc-plus-1m-btn"
                      onClick={() => onShiftRtcSeconds(60)}
                      className="h-6 px-1.5 rounded border border-[#CBD2DC] bg-white hover:bg-[#EDF4FC] font-mono text-[10px] font-semibold text-[#334155] cursor-pointer"
                    >
                      +1dk
                    </button>
                    <button
                      type="button"
                      data-testid="rtc-plus-1h-btn"
                      onClick={() => onShiftRtcSeconds(3600)}
                      className="h-6 px-1.5 rounded border border-[#CBD2DC] bg-white hover:bg-[#EDF4FC] font-mono text-[10px] font-semibold text-[#334155] cursor-pointer"
                    >
                      +1sa
                    </button>
                  </div>
                </div>

                {/* Formatted Live Clock Readout */}
                <div
                  data-testid="rtc-formatted-clock"
                  className="rounded border border-[#BBD2F3] bg-[#EEF4FC] px-3 py-2 flex items-center justify-between font-mono"
                >
                  <span className="text-xs text-[#334155]">
                    {String(simState.registers['D1316'] ?? 1).padStart(2, '0')}.
                    {String(simState.registers['D1317'] ?? 1).padStart(2, '0')}.20
                    {String(simState.registers['D1319'] ?? 0).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-bold text-[#0B4EA2]">
                    {String(simState.registers['D1315'] ?? 0).padStart(2, '0')}:
                    {String(simState.registers['D1314'] ?? 0).padStart(2, '0')}:
                    {String(simState.registers['D1313'] ?? 0).padStart(2, '0')}
                  </span>
                </div>

                {/* 7 Individual RTC Registers */}
                <div
                  className={
                    isRightDock
                      ? 'grid grid-cols-4 gap-1'
                      : 'grid grid-cols-4 sm:grid-cols-7 lg:grid-cols-4 gap-1.5'
                  }
                >
                  {SX2_RTC_REGISTERS.map((rtc) => {
                    const val = simState.registers[rtc.register] ?? 0;
                    return (
                      <div
                        key={rtc.register}
                        data-testid={`rtc-${rtc.register}`}
                        className="rounded border border-[#DDE3EC] bg-[#FAFBFD] px-1.5 py-1 text-center"
                      >
                        <div className="font-mono text-[10px] font-bold text-[#0B4EA2]">
                          {rtc.register}
                        </div>
                        <div className="font-mono text-xs font-bold text-[#0F172A]">
                          {String(val).padStart(2, '0')}
                        </div>
                        <div className="text-[9px] text-[#64748B] truncate">
                          {rtc.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
