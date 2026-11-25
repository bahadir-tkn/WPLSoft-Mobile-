import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  InputSwitchMode,
  LadderProgram,
  SimSpeedMultiplier,
  SimState,
} from '../types/plc';
import {
  ALL_OCTAL_INPUTS,
  SPECIAL_RELAYS,
} from '../core/plcModels';
import {
  createInitialSimState,
  executeScanCycle,
  getTimerTimeBaseMs,
  writeRtcRegistersFromEpoch,
} from '../core/scanner';

const SCAN_INTERVAL_MS = 20;
const MAX_DELTA_MS = 250;

function createDefaultInputModes(): Record<string, InputSwitchMode> {
  const modes: Record<string, InputSwitchMode> = {};
  for (const addr of ALL_OCTAL_INPUTS) {
    modes[addr] = 'toggle';
  }
  return modes;
}

export function usePlcSimulator(
  program: LadderProgram,
  isOnline: boolean,
  setIsOnline: (online: boolean) => void,
  onNotify: (message: string) => void
) {
  const [simState, setSimState] = useState<SimState>(() => createInitialSimState());
  const [inputModes, setInputModes] = useState<Record<string, InputSwitchMode>>(() =>
    createDefaultInputModes()
  );
  const [speedMultiplier, setSpeedMultiplierState] = useState<SimSpeedMultiplier>(1);
  const [isMonitorOpen, setIsMonitorOpen] = useState(false);

  const programRef = useRef(program);
  const speedRef = useRef<SimSpeedMultiplier>(1);
  const lastTickRef = useRef<number>(0);
  const pulseTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timersMap = pulseTimersRef.current;
    return () => {
      for (const tid of timersMap.values()) {
        window.clearTimeout(tid);
      }
      timersMap.clear();
    };
  }, []);

  useEffect(() => {
    programRef.current = program;
  }, [program]);

  const setSpeedMultiplier = useCallback(
    (nextSpeed: SimSpeedMultiplier) => {
      speedRef.current = nextSpeed;
      setSpeedMultiplierState(nextSpeed);
      onNotify(`Simülasyon zaman hızı ${nextSpeed}x olarak ayarlandı.`);
    },
    [onNotify]
  );

  // Real-time 20ms scan cycle using performance.now() delta-time for drift-free 100ms timers & RTC.
  // Automatically pauses ticks when mobile tab/PWA is backgrounded (iOS/Android battery protection).
  useEffect(() => {
    if (!isOnline || !simState.running) return;

    let timerId: number | null = null;

    const startLoop = () => {
      if (timerId !== null || document.hidden) return;
      lastTickRef.current = performance.now();
      timerId = window.setInterval(() => {
        if (document.hidden) return;
        const now = performance.now();
        const rawDelta = now - lastTickRef.current;
        lastTickRef.current = now;
        const safeDelta = Math.min(MAX_DELTA_MS, Math.max(0, rawDelta));

        setSimState((prev) => {
          if (!prev.running) return prev;
          return executeScanCycle(
            programRef.current,
            prev,
            safeDelta,
            speedRef.current
          );
        });
      }, SCAN_INTERVAL_MS);
    };

    const stopLoop = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopLoop();
      } else {
        lastTickRef.current = performance.now();
        startLoop();
      }
    };

    startLoop();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopLoop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOnline, simState.running]);

  const enterOnline = useCallback(
    (hasCompileErrors: boolean, overrideProgram?: LadderProgram): boolean => {
      if (hasCompileErrors) {
        onNotify(
          'Derleme hatası varken simülasyon başlatılamaz. Önce IL panelindeki hataları giderin.'
        );
        return false;
      }

      const targetProgram = overrideProgram ?? programRef.current;
      programRef.current = targetProgram;

      const fresh = createInitialSimState();
      // Execute initial Scan #1 (M1002 = ON, M1003 = OFF) immediately so rails and initial contacts light up on first frame
      const scannedFirst = executeScanCycle(
        targetProgram,
        { ...fresh, running: true },
        0,
        speedRef.current
      );

      lastTickRef.current = performance.now();
      setSimState({ ...scannedFirst, running: true });
      setIsOnline(true);
      setIsMonitorOpen(true);
      onNotify(
        'Sanal PLC Simülasyonu (RUN) başlatıldı — gerçek PLC bağlantısı değildir. Düzenleme kilitlendi.'
      );
      return true;
    },
    [onNotify, setIsOnline]
  );

  const exitOnline = useCallback(() => {
    for (const tid of pulseTimersRef.current.values()) {
      window.clearTimeout(tid);
    }
    pulseTimersRef.current.clear();
    setIsOnline(false);
    setIsMonitorOpen(false);
    speedRef.current = 1;
    setSpeedMultiplierState(1);
    setSimState(createInitialSimState());
    onNotify('Simülasyon durduruldu; Düzenleme Moduna dönüldü.');
  }, [onNotify, setIsOnline]);

  const setRunning = useCallback(
    (nextRunning: boolean) => {
      if (!isOnline) return;
      if (nextRunning) {
        lastTickRef.current = performance.now();
        setSimState((prev) => ({ ...prev, running: true }));
        onNotify('PLC RUN moduna alındı (20ms tarama döngüsü aktif).');
      } else {
        setSimState((prev) => ({ ...prev, running: false }));
        onNotify('PLC STOP moduna alındı. Değerleri inceleyebilir veya Tek Adım atabilirsiniz.');
      }
    },
    [isOnline, onNotify]
  );

  const singleStep = useCallback(() => {
    if (!isOnline) return;
    setSimState((prev) =>
      executeScanCycle(
        programRef.current,
        { ...prev, running: false },
        SCAN_INTERVAL_MS,
        speedRef.current
      )
    );
  }, [isOnline]);

  const resetMemory = useCallback(() => {
    if (!isOnline) return;
    setSimState(createInitialSimState());
    onNotify('PLC belleği sıfırlandı (STOP). M1002 ilk tarama palsi yeniden hazır.');
  }, [isOnline, onNotify]);

  const setInputBit = useCallback((address: string, value: boolean) => {
    const norm = address.trim().toUpperCase();
    setSimState((prev) => {
      if (prev.inputs[norm] === value) return prev;
      return {
        ...prev,
        inputs: {
          ...prev.inputs,
          [norm]: value,
        },
      };
    });
  }, []);

  const toggleInputBit = useCallback((address: string) => {
    const norm = address.trim().toUpperCase();
    setSimState((prev) => ({
      ...prev,
      inputs: {
        ...prev.inputs,
        [norm]: !prev.inputs[norm],
      },
    }));
  }, []);

  const setInputMode = useCallback((address: string, mode: InputSwitchMode) => {
    const norm = address.trim().toUpperCase();
    setInputModes((prev) => ({ ...prev, [norm]: mode }));
    if (mode === 'momentary') {
      // Ensure momentary push button starts released (OFF)
      setSimState((prev) => ({
        ...prev,
        inputs: {
          ...prev.inputs,
          [norm]: false,
        },
      }));
    }
  }, []);

  const setRelayBit = useCallback((address: string, value: boolean) => {
    const norm = address.trim().toUpperCase();
    if (SPECIAL_RELAYS[norm]?.readOnly) return;
    setSimState((prev) => ({
      ...prev,
      relays: {
        ...prev.relays,
        [norm]: value,
      },
    }));
  }, []);

  const toggleRelayBit = useCallback((address: string) => {
    const norm = address.trim().toUpperCase();
    if (SPECIAL_RELAYS[norm]?.readOnly) return;
    setSimState((prev) => ({
      ...prev,
      relays: {
        ...prev.relays,
        [norm]: !prev.relays[norm],
      },
    }));
  }, []);

  /**
   * Triggers a clean 0 -> 1 -> 0 momentary rising-edge pulse on X or M bit.
   * Works reliably in both RUN mode (120ms pulse width) and STOP mode (immediate 2-scan edge).
   */
  const pulseBit = useCallback(
    (address: string) => {
      const norm = address.trim().toUpperCase();
      const prefix = norm[0];
      if (prefix !== 'X' && prefix !== 'M' && prefix !== 'S') return;
      if (prefix === 'M' && SPECIAL_RELAYS[norm]?.readOnly) return;

      const existingTimer = pulseTimersRef.current.get(norm);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        pulseTimersRef.current.delete(norm);
      }

      setSimState((prev) => {
        const setTarget = (s: SimState, val: boolean): SimState =>
          prefix === 'X'
            ? { ...s, inputs: { ...s.inputs, [norm]: val } }
            : { ...s, relays: { ...s.relays, [norm]: val } };

        if (!prev.running) {
          // Deterministic rising-edge pulse while PLC is in STOP mode
          const afterOn = executeScanCycle(
            programRef.current,
            setTarget(prev, true),
            SCAN_INTERVAL_MS,
            speedRef.current
          );
          return executeScanCycle(
            programRef.current,
            setTarget(afterOn, false),
            0,
            speedRef.current
          );
        }

        // In RUN mode: immediately execute 1 scan with bit ON so edge fires on first frame, then auto-release
        const immediateOn = executeScanCycle(
          programRef.current,
          setTarget(prev, true),
          0,
          speedRef.current
        );
        const tid = window.setTimeout(() => {
          pulseTimersRef.current.delete(norm);
          setSimState((cur) => setTarget(cur, false));
        }, 120);
        pulseTimersRef.current.set(norm, tid);
        return immediateOn;
      });
      onNotify(`${norm} için yükselen kenar palsi (anlık tetik) uygulandı.`);
    },
    [onNotify]
  );

  const setRegisterValue = useCallback((address: string, value: number) => {
    const norm = address.trim().toUpperCase();
    const clamped = Math.max(-32768, Math.min(32767, Math.trunc(value)));
    if (Number.isNaN(clamped)) return;
    setSimState((prev) => ({
      ...prev,
      registers: {
        ...prev.registers,
        [norm]: clamped,
      },
    }));
  }, []);

  const setTimerValue = useCallback((address: string, value: number) => {
    const norm = address.trim().toUpperCase();
    if (!norm.startsWith('T')) return;
    const clamped = Math.max(0, Math.min(32767, Math.trunc(value)));
    if (Number.isNaN(clamped)) return;
    const baseMs = getTimerTimeBaseMs(norm);
    setSimState((prev) => {
      const existing = prev.timers[norm];
      const preset = existing?.presetValue ?? 0;
      return {
        ...prev,
        timers: {
          ...prev.timers,
          [norm]: {
            currentValue: clamped,
            presetValue: preset,
            accumulatedMs: clamped * baseMs,
            coilEnergized: existing?.coilEnergized ?? false,
            done: preset > 0 ? clamped >= preset : existing?.done ?? false,
          },
        },
      };
    });
  }, []);

  const setCounterValue = useCallback((address: string, value: number) => {
    const norm = address.trim().toUpperCase();
    if (!norm.startsWith('C')) return;
    const clamped = Math.max(0, Math.min(32767, Math.trunc(value)));
    if (Number.isNaN(clamped)) return;
    setSimState((prev) => {
      const existing = prev.counters[norm];
      const preset = existing?.presetValue ?? 0;
      return {
        ...prev,
        counters: {
          ...prev.counters,
          [norm]: {
            currentValue: clamped,
            presetValue: preset,
            previousInput: existing?.previousInput ?? false,
            done: preset > 0 ? clamped >= preset : existing?.done ?? false,
          },
        },
      };
    });
  }, []);

  const syncRtcNow = useCallback(() => {
    const nowEpoch = Date.now();
    setSimState((prev) => {
      const nextRegisters = { ...prev.registers };
      writeRtcRegistersFromEpoch(nextRegisters, nowEpoch);
      return {
        ...prev,
        rtcEpochMs: nowEpoch,
        registers: nextRegisters,
      };
    });
    onNotify('SX2 RTC saati (D1313–D1319) sistem saatine eşitlendi.');
  }, [onNotify]);

  const shiftRtcSeconds = useCallback((deltaSeconds: number) => {
    setSimState((prev) => {
      const nextEpoch = prev.rtcEpochMs + deltaSeconds * 1000;
      const nextRegisters = { ...prev.registers };
      writeRtcRegistersFromEpoch(nextRegisters, nextEpoch);
      return {
        ...prev,
        rtcEpochMs: nextEpoch,
        registers: nextRegisters,
      };
    });
  }, []);

  return {
    isOnline,
    simState,
    inputModes,
    speedMultiplier,
    setSpeedMultiplier,
    isMonitorOpen,
    setIsMonitorOpen,
    enterOnline,
    exitOnline,
    setRunning,
    singleStep,
    resetMemory,
    setInputBit,
    toggleInputBit,
    setInputMode,
    setRelayBit,
    toggleRelayBit,
    pulseBit,
    setRegisterValue,
    setTimerValue,
    setCounterValue,
    syncRtcNow,
    shiftRtcSeconds,
  };
}
