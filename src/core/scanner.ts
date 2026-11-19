import type {
  CompareOperator,
  ContactKind,
  CounterRuntime,
  LadderProgram,
  SimState,
  TimerRuntime,
} from '../types/plc';
import {
  ALL_OCTAL_INPUTS,
  ALL_OCTAL_OUTPUTS,
  LADDER_COIL_COLUMN,
  SPECIAL_RELAY_ADDRESSES,
} from './plcModels';
import { offsetDeviceAddress } from './addressing';

/**
 * Delta DVP-SX2 timer timebases:
 * - T0–T199: 100 ms base
 * - T200–T245: 10 ms base
 * - T246–T255: 100 ms fallback
 */
export function getTimerTimeBaseMs(address: string): number {
  const norm = address.trim().toUpperCase();
  if (!norm.startsWith('T')) return 100;
  const num = Number.parseInt(norm.slice(1), 10);
  if (!Number.isNaN(num) && num >= 200 && num <= 245) {
    return 10;
  }
  return 100;
}

export function writeRtcRegistersFromEpoch(
  registers: Record<string, number>,
  epochMs: number
): void {
  const date = new Date(epochMs);
  const jsDay = date.getDay(); // 0=Sun..6=Sat
  const deltaDayOfWeek = jsDay === 0 ? 7 : jsDay; // Delta DVP: 1=Mon..7=Sun

  registers['D1313'] = date.getSeconds();
  registers['D1314'] = date.getMinutes();
  registers['D1315'] = date.getHours();
  registers['D1316'] = date.getDate();
  registers['D1317'] = date.getMonth() + 1;
  registers['D1318'] = deltaDayOfWeek;
  registers['D1319'] = date.getFullYear() % 100;
}

export function createInitialSimState(
  initialInputs: Record<string, boolean> = {},
  initialRtcEpochMs = Date.now()
): SimState {
  const inputs: Record<string, boolean> = {};
  for (const addr of ALL_OCTAL_INPUTS) {
    inputs[addr] = Boolean(initialInputs[addr]);
  }
  const outputs: Record<string, boolean> = {};
  for (const addr of ALL_OCTAL_OUTPUTS) {
    outputs[addr] = false;
  }

  const registers: Record<string, number> = {
    D1110: 0,
    D1111: 0,
    D1112: 0,
    D1113: 0,
  };
  writeRtcRegistersFromEpoch(registers, initialRtcEpochMs);

  return {
    running: false,
    scanCount: 0,
    scanTimeMs: 20,
    elapsedSimMs: 0,
    rtcEpochMs: initialRtcEpochMs,
    inputs,
    outputs,
    relays: {
      M1000: false,
      M1001: false,
      M1002: false,
      M1003: false,
      M1011: false,
      M1012: false,
      M1013: false,
      M1014: false,
      M1020: false,
      M1021: false,
      M1022: false,
    },
    previousBitStates: {},
    instructionEdgeStates: {},
    timers: {},
    counters: {},
    registers,
    energizedCells: {},
    energizedWires: {},
    conductingCells: {},
  };
}

function clampSigned16(value: number): number {
  const intVal = Math.trunc(value);
  if (intVal > 32767) return 32767;
  if (intVal < -32768) return -32768;
  return intVal;
}

function wrapSigned16(value: number): number {
  return (Math.trunc(value) << 16) >> 16;
}

function compareValues(op: CompareOperator, a: number, b: number): boolean {
  switch (op) {
    case '=':
      return a === b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '<>':
      return a !== b;
  }
}

export function cellKey(rungIndex: number, rowIndex: number, colIndex: number): string {
  return `${rungIndex}-${rowIndex}-${colIndex}`;
}

export function leftWireKey(rungIndex: number, rowIndex: number, colIndex: number): string {
  return `left-${rungIndex}-${rowIndex}-${colIndex}`;
}

export function branchWireKey(rungIndex: number, rowIndex: number, colIndex: number): string {
  return `branch-${rungIndex}-${rowIndex}-${colIndex}`;
}

function computeClockPulse(
  nextElapsedMs: number,
  effectiveDeltaMs: number,
  periodMs: number,
  prevValue: boolean
): boolean {
  const halfPeriod = periodMs / 2;
  if (effectiveDeltaMs >= periodMs) {
    return !prevValue;
  }
  return Math.floor(nextElapsedMs / halfPeriod) % 2 === 1;
}

/**
 * Executes a single deterministic Delta DVP PLC scan cycle:
 * 1. Updates special system & clock relays (M1000–M1003, M1011–M1014) and live SX2 RTC (D1313–D1319).
 * 2. Evaluates each rung's electrical network left-to-right (including parallel OR / MPS branches).
 * 3. Updates OUT, SET, RST, real-time 100ms TMR, rising-edge CNT (with RST/ZRST priority), MOV,
 *    ALT, ZRST, CMP, ADD/SUB/MUL/DIV (with M1020/M1021/M1022 flags), INC/INCP/DEC/DECP, and TRD.
 * 4. Snapshots bit & instruction edge states for the next scan.
 */
export function executeScanCycle(
  program: LadderProgram,
  prevState: SimState,
  deltaMs: number,
  speedMultiplier = 1
): SimState {
  const safeDeltaMs = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
  const safeSpeed = Number.isFinite(speedMultiplier) && speedMultiplier > 0 ? speedMultiplier : 1;
  const effectiveDeltaMs = safeDeltaMs * safeSpeed;
  const isFirstScan = prevState.scanCount === 0;

  const nextElapsedSimMs = (prevState.elapsedSimMs ?? 0) + effectiveDeltaMs;
  const nextRtcEpochMs = (prevState.rtcEpochMs ?? Date.now()) + effectiveDeltaMs;

  const inputs: Record<string, boolean> = { ...prevState.inputs };
  const outputs: Record<string, boolean> = { ...prevState.outputs };
  const relays: Record<string, boolean> = {
    ...prevState.relays,
    M1000: true,
    M1001: false,
    M1002: isFirstScan,
    M1003: !isFirstScan,
    M1011: computeClockPulse(
      nextElapsedSimMs,
      effectiveDeltaMs,
      10,
      Boolean(prevState.relays.M1011)
    ),
    M1012: computeClockPulse(
      nextElapsedSimMs,
      effectiveDeltaMs,
      100,
      Boolean(prevState.relays.M1012)
    ),
    M1013: computeClockPulse(
      nextElapsedSimMs,
      effectiveDeltaMs,
      1000,
      Boolean(prevState.relays.M1013)
    ),
    M1014: computeClockPulse(
      nextElapsedSimMs,
      effectiveDeltaMs,
      60000,
      Boolean(prevState.relays.M1014)
    ),
    M1020: Boolean(prevState.relays.M1020),
    M1021: Boolean(prevState.relays.M1021),
    M1022: Boolean(prevState.relays.M1022),
  };

  const timers: Record<string, TimerRuntime> = {};
  for (const [k, v] of Object.entries(prevState.timers)) {
    timers[k] = { ...v };
  }
  const counters: Record<string, CounterRuntime> = {};
  for (const [k, v] of Object.entries(prevState.counters)) {
    counters[k] = { ...v };
  }
  const registers: Record<string, number> = { ...prevState.registers };
  // Sync live SX2 RTC registers (D1313–D1319) every scan
  writeRtcRegistersFromEpoch(registers, nextRtcEpochMs);

  const prevBits = prevState.previousBitStates;
  const prevEdgeStates = prevState.instructionEdgeStates ?? {};
  const nextEdgeStates: Record<string, boolean> = {};

  const energizedCells: Record<string, boolean> = {};
  const energizedWires: Record<string, boolean> = {};
  const conductingCells: Record<string, boolean> = {};
  const touchedBitAddresses = new Set<string>([
    ...ALL_OCTAL_INPUTS,
    ...ALL_OCTAL_OUTPUTS,
    ...SPECIAL_RELAY_ADDRESSES,
    ...Object.keys(relays),
    ...Object.keys(timers),
    ...Object.keys(counters),
  ]);

  // Track counters actively held in RST/ZRST during this scan (for RST priority over CNT)
  const resetActiveCounters = new Set<string>();

  const readBit = (rawAddress: string): boolean => {
    const addr = rawAddress.trim().toUpperCase();
    touchedBitAddresses.add(addr);
    const prefix = addr[0];
    if (prefix === 'X') return Boolean(inputs[addr]);
    if (prefix === 'Y') return Boolean(outputs[addr]);
    if (prefix === 'M') {
      if (addr === 'M1000') return true;
      if (addr === 'M1001') return false;
      if (addr === 'M1002') return isFirstScan;
      if (addr === 'M1003') return !isFirstScan;
      return Boolean(relays[addr]);
    }
    if (prefix === 'T') return Boolean(timers[addr]?.done);
    if (prefix === 'C') return Boolean(counters[addr]?.done);
    return false;
  };

  const writeBit = (rawAddress: string, value: boolean): void => {
    const addr = rawAddress.trim().toUpperCase();
    touchedBitAddresses.add(addr);
    const prefix = addr[0];
    if (prefix === 'Y') {
      outputs[addr] = value;
    } else if (prefix === 'M' && !SPECIAL_RELAY_ADDRESSES.has(addr)) {
      relays[addr] = value;
    }
  };

  const readWord = (rawOperand: string): number => {
    const op = rawOperand.trim().toUpperCase();
    const prefix = op[0];
    if (prefix === 'K') {
      const parsed = Number.parseInt(op.slice(1), 10);
      return Number.isNaN(parsed) ? 0 : clampSigned16(parsed);
    }
    if (prefix === 'D') return registers[op] ?? 0;
    if (prefix === 'T') return timers[op]?.currentValue ?? 0;
    if (prefix === 'C') return counters[op]?.currentValue ?? 0;
    return 0;
  };

  const evalContact = (contactType: ContactKind, address: string): boolean => {
    const norm = address.trim().toUpperCase();
    const cur = readBit(norm);
    const prev = Boolean(prevBits[norm]);
    switch (contactType) {
      case 'NO':
        return cur;
      case 'NC':
        return !cur;
      case 'RISING':
        return cur && !prev;
      case 'FALLING':
        return !cur && prev;
    }
  };

  const resetSingleDevice = (addr: string) => {
    const norm = addr.trim().toUpperCase();
    touchedBitAddresses.add(norm);
    const prefix = norm[0];
    if (prefix === 'Y') {
      outputs[norm] = false;
    } else if (prefix === 'M' && !SPECIAL_RELAY_ADDRESSES.has(norm)) {
      relays[norm] = false;
    } else if (prefix === 'T') {
      const prevT = timers[norm];
      timers[norm] = {
        currentValue: 0,
        presetValue: prevT?.presetValue ?? 0,
        accumulatedMs: 0,
        coilEnergized: false,
        done: false,
      };
    } else if (prefix === 'C') {
      resetActiveCounters.add(norm);
      const prevC = counters[norm];
      counters[norm] = {
        currentValue: 0,
        presetValue: prevC?.presetValue ?? 0,
        previousInput: prevC?.previousInput ?? false,
        done: false,
      };
    } else if (prefix === 'D') {
      registers[norm] = 0;
    }
  };

  // Evaluate each rung top-to-bottom until END
  for (let rungIndex = 0; rungIndex < program.rungs.length; rungIndex += 1) {
    const rung = program.rungs[rungIndex];
    if (rung.isEnd) {
      break;
    }

    const rowCount = rung.rows.length;
    const logicCols = LADDER_COIL_COLUMN;

    const boundaryPower: boolean[][] = Array.from({ length: rowCount }, () =>
      Array.from({ length: logicCols + 1 }, (_, b) => b === 0)
    );

    const cellConducts: boolean[][] = Array.from({ length: rowCount }, (_, r) =>
      Array.from({ length: logicCols }, (_, c) => {
        const el = rung.rows[r]?.[c]?.element;
        if (!el) return false;
        if (el.kind === 'HLINE') return true;
        if (el.kind === 'CONTACT') {
          return evalContact(el.contactType, el.address);
        }
        if (el.kind === 'COMPARE') {
          return compareValues(
            el.operator,
            readWord(el.operandA),
            readWord(el.operandB)
          );
        }
        return false;
      })
    );

    // Fixed-point electrical propagation across horizontal logic cells and vertical branchDown drops
    let changed = true;
    let safety = 0;
    const maxIterations = Math.max(16, rowCount * (logicCols + 2) * 2);

    while (changed && safety < maxIterations) {
      changed = false;
      safety += 1;

      for (let r = 0; r < rowCount; r += 1) {
        for (let c = 0; c < logicCols; c += 1) {
          if (boundaryPower[r][c] && cellConducts[r][c] && !boundaryPower[r][c + 1]) {
            boundaryPower[r][c + 1] = true;
            changed = true;
          }
        }
      }

      for (let r = 0; r < rowCount - 1; r += 1) {
        for (let c = 0; c < logicCols; c += 1) {
          if (rung.rows[r]?.[c]?.branchDown) {
            const b = c + 1;
            const upper = boundaryPower[r][b];
            const lower = boundaryPower[r + 1][b];
            if (upper !== lower) {
              boundaryPower[r][b] = true;
              boundaryPower[r + 1][b] = true;
              changed = true;
            }
          }
        }
      }
    }

    // Record visual power flow for cells & wires in this rung
    for (let r = 0; r < rowCount; r += 1) {
      for (let c = 0; c < logicCols; c += 1) {
        const cell = rung.rows[r]?.[c];
        if (!cell) continue;
        const leftActive = boundaryPower[r][c];
        const rightActive = boundaryPower[r][c + 1];

        if (leftActive && cell.element.kind !== 'EMPTY') {
          energizedWires[leftWireKey(rungIndex, r, c)] = true;
        }
        if (
          (cell.element.kind === 'CONTACT' || cell.element.kind === 'COMPARE') &&
          cellConducts[r][c]
        ) {
          conductingCells[cellKey(rungIndex, r, c)] = true;
        }
        if (leftActive && cellConducts[r][c]) {
          energizedCells[cellKey(rungIndex, r, c)] = true;
        }
        if (cell.branchDown && rightActive) {
          energizedWires[branchWireKey(rungIndex, r, c)] = true;
        }
      }
    }

    // Execute outputs on column LADDER_COIL_COLUMN
    for (let r = 0; r < rowCount; r += 1) {
      const outCell = rung.rows[r]?.[LADDER_COIL_COLUMN];
      if (!outCell) continue;
      const el = outCell.element;
      if (el.kind === 'EMPTY' || el.kind === 'HLINE' || el.kind === 'END') continue;

      const cKey = cellKey(rungIndex, r, LADDER_COIL_COLUMN);
      const rungPower = boundaryPower[r][LADDER_COIL_COLUMN];
      const prevRungPower = Boolean(prevEdgeStates[cKey]);
      const isRisingRungPower = rungPower && !prevRungPower;
      nextEdgeStates[cKey] = rungPower;

      if (rungPower) {
        energizedWires[leftWireKey(rungIndex, r, LADDER_COIL_COLUMN)] = true;
        energizedCells[cKey] = true;
      }

      if (el.kind === 'COIL') {
        const addr = el.address.trim().toUpperCase();
        if (el.coilType === 'OUT') {
          writeBit(addr, rungPower);
        } else if (el.coilType === 'SET') {
          if (rungPower) writeBit(addr, true);
        } else if (el.coilType === 'RST') {
          if (rungPower) resetSingleDevice(addr);
        }
      } else if (el.kind === 'TMR') {
        const addr = el.address.trim().toUpperCase();
        touchedBitAddresses.add(addr);
        // Dynamic preset support: K constant or D register (e.g. TMR T0 D500)
        const presetVal = Math.max(0, readWord(el.preset));
        const prevT = timers[addr];

        if (!rungPower) {
          timers[addr] = {
            currentValue: 0,
            presetValue: presetVal,
            accumulatedMs: 0,
            coilEnergized: false,
            done: false,
          };
        } else if (presetVal === 0) {
          timers[addr] = {
            currentValue: 0,
            presetValue: 0,
            accumulatedMs: 0,
            coilEnergized: true,
            done: true,
          };
        } else {
          const timeBaseMs = getTimerTimeBaseMs(addr);
          const prevAcc = prevT?.coilEnergized ? prevT.accumulatedMs : 0;
          const maxMs = presetVal * timeBaseMs;
          const nextAcc = Math.min(maxMs, prevAcc + effectiveDeltaMs);
          const nextVal = Math.min(presetVal, Math.floor(nextAcc / timeBaseMs));
          timers[addr] = {
            currentValue: nextVal,
            presetValue: presetVal,
            accumulatedMs: nextAcc,
            coilEnergized: true,
            done: nextVal >= presetVal,
          };
        }
      } else if (el.kind === 'CNT') {
        const addr = el.address.trim().toUpperCase();
        touchedBitAddresses.add(addr);
        // Dynamic preset support: K constant or D register (e.g. CNT C0 D10)
        const presetVal = Math.max(0, readWord(el.preset));
        const prevC = counters[addr] ?? {
          currentValue: 0,
          presetValue: presetVal,
          previousInput: false,
          done: false,
        };

        if (resetActiveCounters.has(addr)) {
          counters[addr] = {
            currentValue: 0,
            presetValue: presetVal,
            previousInput: rungPower,
            done: false,
          };
        } else {
          const risingEdge = rungPower && !prevC.previousInput;
          let nextVal = prevC.currentValue;
          if (risingEdge && nextVal < presetVal) {
            nextVal += 1;
          }
          const done = presetVal === 0 ? true : nextVal >= presetVal;
          counters[addr] = {
            currentValue: nextVal,
            presetValue: presetVal,
            previousInput: rungPower,
            done,
          };
        }
      } else if (el.kind === 'MOV') {
        const dest = el.destination.trim().toUpperCase();
        if (rungPower) {
          registers[dest] = clampSigned16(readWord(el.source));
        }
      } else if (el.kind === 'ALT') {
        // Flip-Flop: toggles target bit (Y/M) cleanly on rising edge of rungPower (works with both LD and LDP)
        if (isRisingRungPower) {
          const target = el.target.trim().toUpperCase();
          writeBit(target, !readBit(target));
        }
      } else if (el.kind === 'ZRST') {
        if (rungPower) {
          const s1 = el.start.trim().toUpperCase();
          const s2 = el.end.trim().toUpperCase();
          const prefix = s1[0];
          if (prefix === s2[0]) {
            const radix = prefix === 'Y' ? 8 : 10;
            const startNum = Number.parseInt(s1.slice(1), radix);
            const endNum = Number.parseInt(s2.slice(1), radix);
            if (!Number.isNaN(startNum) && !Number.isNaN(endNum) && startNum <= endNum) {
              const safeEnd = Math.min(endNum, startNum + 512);
              for (let idx = startNum; idx <= safeEnd; idx += 1) {
                const dev = `${prefix}${idx.toString(radix)}`;
                resetSingleDevice(dev);
              }
            }
          }
        }
      } else if (el.kind === 'CMP') {
        if (rungPower) {
          const v1 = readWord(el.source1);
          const v2 = readWord(el.source2);
          const d0 = el.destination.trim().toUpperCase();
          const d1 = offsetDeviceAddress(d0, 1);
          const d2 = offsetDeviceAddress(d0, 2);
          writeBit(d0, v1 > v2);
          if (d1) writeBit(d1, v1 === v2);
          if (d2) writeBit(d2, v1 < v2);
        }
      } else if (el.kind === 'MATH') {
        if (rungPower) {
          const s1 = readWord(el.source1);
          const s2 = readWord(el.source2);
          const dst = el.destination.trim().toUpperCase();

          if (el.operator === 'ADD') {
            const raw = s1 + s2;
            const wrapped = wrapSigned16(raw);
            registers[dst] = wrapped;
            relays.M1020 = wrapped === 0;
            relays.M1021 = raw < -32768;
            relays.M1022 = raw > 32767;
          } else if (el.operator === 'SUB') {
            const raw = s1 - s2;
            const wrapped = wrapSigned16(raw);
            registers[dst] = wrapped;
            relays.M1020 = wrapped === 0;
            relays.M1021 = raw < -32768;
            relays.M1022 = raw > 32767;
          } else if (el.operator === 'MUL') {
            const prod = s1 * s2;
            const low16 = (prod << 16) >> 16;
            const high16 = ((prod >> 16) << 16) >> 16;
            registers[dst] = low16;
            const dstPlus1 = offsetDeviceAddress(dst, 1);
            if (dstPlus1) {
              registers[dstPlus1] = high16;
            }
            relays.M1020 = prod === 0;
          } else if (el.operator === 'DIV') {
            if (s2 !== 0) {
              const quotient = Math.trunc(s1 / s2);
              const remainder = s1 % s2;
              registers[dst] = clampSigned16(quotient);
              const dstPlus1 = offsetDeviceAddress(dst, 1);
              if (dstPlus1) {
                registers[dstPlus1] = clampSigned16(remainder);
              }
              relays.M1020 = quotient === 0 && remainder === 0;
            }
          }
        }
      } else if (el.kind === 'INCDEC') {
        const shouldExecute =
          el.operator === 'INCP' || el.operator === 'DECP'
            ? isRisingRungPower
            : rungPower;
        if (shouldExecute) {
          const target = el.target.trim().toUpperCase();
          const cur = registers[target] ?? 0;
          const delta = el.operator === 'INC' || el.operator === 'INCP' ? 1 : -1;
          const raw = cur + delta;
          const wrapped = wrapSigned16(raw);
          registers[target] = wrapped;
          relays.M1020 = wrapped === 0;
          relays.M1021 = raw < -32768;
          relays.M1022 = raw > 32767;
        }
      } else if (el.kind === 'TRD') {
        if (rungPower) {
          // Delta DVP API 166 TRD D: D+0=Year, D+1=DayOfWeek, D+2=Month, D+3=Day, D+4=Hour, D+5=Min, D+6=Sec
          const base = el.destination.trim().toUpperCase();
          const rtcValues = [
            registers['D1319'] ?? 0,
            registers['D1318'] ?? 1,
            registers['D1317'] ?? 1,
            registers['D1316'] ?? 1,
            registers['D1315'] ?? 0,
            registers['D1314'] ?? 0,
            registers['D1313'] ?? 0,
          ];
          for (let k = 0; k < rtcValues.length; k += 1) {
            const targetReg = offsetDeviceAddress(base, k);
            if (targetReg) {
              registers[targetReg] = rtcValues[k];
            }
          }
        }
      }
    }
  }

  // Build snapshot of all bit states at the end of this scan for next scan's edge contacts
  const nextPreviousBitStates: Record<string, boolean> = {};
  for (const addr of touchedBitAddresses) {
    nextPreviousBitStates[addr] = readBit(addr);
  }

  return {
    running: prevState.running,
    scanCount: prevState.scanCount + 1,
    scanTimeMs: safeDeltaMs > 0 ? Math.round(safeDeltaMs) : prevState.scanTimeMs,
    elapsedSimMs: nextElapsedSimMs,
    rtcEpochMs: nextRtcEpochMs,
    inputs,
    outputs,
    relays,
    previousBitStates: nextPreviousBitStates,
    instructionEdgeStates: nextEdgeStates,
    timers,
    counters,
    registers,
    energizedCells,
    energizedWires,
    conductingCells,
  };
}

/**
 * Extracts all unique device addresses referenced in a LadderProgram so Device Monitor can prioritize them.
 */
export function collectReferencedDevices(program: LadderProgram): {
  relays: string[];
  timers: string[];
  counters: string[];
  registers: string[];
} {
  const relays = new Set<string>();
  const timers = new Set<string>();
  const counters = new Set<string>();
  const registers = new Set<string>();

  const registerAddr = (raw: string) => {
    const norm = raw.trim().toUpperCase();
    if (norm.startsWith('M') && !SPECIAL_RELAY_ADDRESSES.has(norm)) {
      relays.add(norm);
    } else if (norm.startsWith('T')) {
      timers.add(norm);
    } else if (norm.startsWith('C')) {
      counters.add(norm);
    } else if (norm.startsWith('D')) {
      registers.add(norm);
    }
  };

  for (const rung of program.rungs) {
    if (rung.isEnd) continue;
    for (const row of rung.rows) {
      for (const cell of row) {
        const el = cell.element;
        if (el.kind === 'CONTACT' || el.kind === 'COIL') {
          registerAddr(el.address);
        } else if (el.kind === 'TMR' || el.kind === 'CNT') {
          registerAddr(el.address);
          registerAddr(el.preset);
        } else if (el.kind === 'MOV') {
          registerAddr(el.source);
          registerAddr(el.destination);
        } else if (el.kind === 'COMPARE') {
          registerAddr(el.operandA);
          registerAddr(el.operandB);
        } else if (el.kind === 'ALT') {
          registerAddr(el.target);
        } else if (el.kind === 'ZRST') {
          registerAddr(el.start);
          registerAddr(el.end);
        } else if (el.kind === 'CMP') {
          registerAddr(el.source1);
          registerAddr(el.source2);
          registerAddr(el.destination);
          const d1 = offsetDeviceAddress(el.destination, 1);
          const d2 = offsetDeviceAddress(el.destination, 2);
          if (d1) registerAddr(d1);
          if (d2) registerAddr(d2);
        } else if (el.kind === 'MATH') {
          registerAddr(el.source1);
          registerAddr(el.source2);
          registerAddr(el.destination);
          if (el.operator === 'DIV' || el.operator === 'MUL') {
            const d1 = offsetDeviceAddress(el.destination, 1);
            if (d1) registerAddr(d1);
          }
        } else if (el.kind === 'INCDEC') {
          registerAddr(el.target);
        } else if (el.kind === 'TRD') {
          registerAddr(el.destination);
        }
      }
    }
  }

  const sortNum = (a: string, b: string) =>
    Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10);

  return {
    relays: Array.from(relays).sort(sortNum),
    timers: Array.from(timers).sort(sortNum),
    counters: Array.from(counters).sort(sortNum),
    registers: Array.from(registers).sort(sortNum),
  };
}
