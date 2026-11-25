/**
 * Bağımsız IL yorumlayıcısı (yalnızca testler için).
 *
 * Gerçek Delta DVP PLC'nin komut listesini nasıl çalıştırdığını adım adım taklit eder:
 * komutlar yukarıdan aşağıya tek tek yürütülür, kontaklar okunduğu anda değerlendirilir,
 * LDP/LDF/ANDP/ANDF/ORP/ORF ve NP/PN kendi komutlarına ait kenar belleği kullanır.
 *
 * Merdiven simülatörü (scanner.ts) ızgara üzerinde güç akışıyla çalışır; bu dosya onunla
 * aynı sonuçları verip vermediğini karşılaştırmak için vardır. Uygulama kodunda kullanılmaz.
 */
import { getTimerTimeBaseMs } from './scanner';
import { offsetDeviceAddress } from './addressing';

export interface RefInstruction {
  opcode: string;
  operands: string[];
}

export interface RefTimer {
  accumulatedMs: number;
  currentValue: number;
  energized: boolean;
  done: boolean;
}

export interface RefCounter {
  currentValue: number;
  previousInput: boolean;
  done: boolean;
}

export interface RefState {
  scanCount: number;
  bits: Record<string, boolean>;
  timers: Record<string, RefTimer>;
  counters: Record<string, RefCounter>;
  registers: Record<string, number>;
  /** Komut sırasına göre kenar belleği (LDP/ANDP/ORP…, NP/PN, ALTP/INCP/DECP) */
  edgeMemory: Record<number, boolean>;
}

export function createRefState(): RefState {
  return { scanCount: 0, bits: {}, timers: {}, counters: {}, registers: {}, edgeMemory: {} };
}

export function parseRefIl(il: string): RefInstruction[] {
  return il
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l && !l.startsWith(';'))
    .map((l) => {
      const [opcode, ...operands] = l.split(/\s+/);
      return { opcode: opcode.toUpperCase(), operands };
    });
}

const wrap16 = (v: number) => ((((v + 32768) % 65536) + 65536) % 65536) - 32768;
const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, v));

export class UnsupportedInstructionError extends Error {}

/**
 * Bir tarama çevrimi yürütür.
 * @param special Her taramada dışarıdan verilen özel röle/registre değerleri (M1013 saat darbesi, D1313… RTC).
 */
export function runRefScan(
  program: RefInstruction[],
  prev: RefState,
  inputs: Record<string, boolean>,
  deltaMs: number,
  special: { relays?: Record<string, boolean>; registers?: Record<string, number> } = {}
): RefState {
  const s: RefState = {
    scanCount: prev.scanCount + 1,
    bits: { ...prev.bits },
    timers: Object.fromEntries(Object.entries(prev.timers).map(([k, v]) => [k, { ...v }])),
    counters: Object.fromEntries(Object.entries(prev.counters).map(([k, v]) => [k, { ...v }])),
    registers: { ...prev.registers, ...(special.registers ?? {}) },
    edgeMemory: { ...prev.edgeMemory },
  };
  const firstScan = prev.scanCount === 0;
  for (const [k, v] of Object.entries(inputs)) s.bits[k] = v;
  for (const [k, v] of Object.entries(special.relays ?? {})) s.bits[k] = v;
  s.bits.M1000 = true;
  s.bits.M1001 = false;
  s.bits.M1002 = firstScan;
  s.bits.M1003 = !firstScan;
  const resetCounters = new Set<string>();

  const readBit = (a: string): boolean => {
    const addr = a.toUpperCase();
    if (addr[0] === 'T') return Boolean(s.timers[addr]?.done);
    if (addr[0] === 'C') return Boolean(s.counters[addr]?.done);
    return Boolean(s.bits[addr]);
  };
  const writeBit = (a: string, v: boolean) => {
    const addr = a.toUpperCase();
    if (addr[0] === 'X') return;
    if (addr[0] === 'M' && Number(addr.slice(1)) >= 1000 && !/^M10(2[0-2]|6[78])$/.test(addr)) return;
    s.bits[addr] = v;
  };
  const readWord = (op: string): number => {
    const o = op.toUpperCase();
    if (o[0] === 'K') return clamp16(Number.parseInt(o.slice(1), 10) || 0);
    if (o[0] === 'D') return s.registers[o] ?? 0;
    if (o[0] === 'T') return s.timers[o]?.currentValue ?? 0;
    if (o[0] === 'C') return s.counters[o]?.currentValue ?? 0;
    throw new UnsupportedInstructionError(`word ${op}`);
  };
  const resetDevice = (a: string) => {
    const addr = a.toUpperCase();
    if (addr[0] === 'T') s.timers[addr] = { accumulatedMs: 0, currentValue: 0, energized: false, done: false };
    else if (addr[0] === 'C') {
      resetCounters.add(addr);
      const prevIn = s.counters[addr]?.previousInput ?? false;
      s.counters[addr] = { currentValue: 0, previousInput: prevIn, done: false };
    } else if (addr[0] === 'D') s.registers[addr] = 0;
    else writeBit(addr, false);
  };
  const cmp = (op: string, a: number, b: number) => {
    switch (op) {
      case '=': return a === b;
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '<>': return a !== b;
    }
    throw new UnsupportedInstructionError(op);
  };

  let acc = false;
  const blockStack: boolean[] = [];
  const mpsStack: boolean[] = [];

  const contactValue = (idx: number, kind: string, addr: string): boolean => {
    const cur = readBit(addr);
    if (kind === '' ) return cur;
    if (kind === 'I') return !cur;
    const mem = Boolean(s.edgeMemory[idx]);
    s.edgeMemory[idx] = cur;
    if (kind === 'P') return cur && !mem;
    return !cur && mem; // F
  };
  const pulseOf = (idx: number, power: boolean) => {
    const mem = Boolean(s.edgeMemory[idx]);
    s.edgeMemory[idx] = power;
    return power && !mem;
  };

  for (let i = 0; i < program.length; i += 1) {
    const { opcode: op, operands: o } = program[i];
    if (op === 'END') break;
    let m: RegExpMatchArray | null;
    if ((m = op.match(/^(LD|AND|OR)(=|>=|<=|<>|>|<)$/))) {
      const v = cmp(m[2], readWord(o[0]), readWord(o[1]));
      if (m[1] === 'LD') { blockStack.push(acc); acc = v; }
      else if (m[1] === 'AND') acc = acc && v;
      else acc = acc || v;
      continue;
    }
    if ((m = op.match(/^(LD|AND|AN|OR)(I|P|F)?$/)) && op !== 'AN') {
      const base = m[1] === 'AN' ? 'AND' : m[1];
      const kind = m[1] === 'AN' ? 'I' : (m[2] ?? '');
      const v = contactValue(i, kind, o[0]);
      if (base === 'LD') { blockStack.push(acc); acc = v; }
      else if (base === 'AND') acc = acc && v;
      else acc = acc || v;
      continue;
    }
    switch (op) {
      case 'ANB': acc = (blockStack.pop() ?? false) && acc; break;
      case 'ORB': acc = (blockStack.pop() ?? false) || acc; break;
      case 'MPS': mpsStack.push(acc); break;
      case 'MRD': acc = mpsStack[mpsStack.length - 1] ?? false; break;
      case 'MPP': acc = mpsStack.pop() ?? false; break;
      case 'NP': { const mem = Boolean(s.edgeMemory[i]); s.edgeMemory[i] = acc; acc = acc && !mem; break; }
      case 'PN': { const mem = Boolean(s.edgeMemory[i]); s.edgeMemory[i] = acc; acc = !acc && mem; break; }
      case 'OUT': writeBit(o[0], acc); break;
      case 'SET': if (acc) writeBit(o[0], true); break;
      case 'RST': if (acc) resetDevice(o[0]); break;
      case 'ZRST': {
        if (!acc) break;
        const p = o[0][0].toUpperCase();
        const radix = p === 'Y' || p === 'X' ? 8 : 10;
        const a = Number.parseInt(o[0].slice(1), radix);
        const b = Number.parseInt(o[1].slice(1), radix);
        for (let n = a; n <= b; n += 1) resetDevice(`${p}${n.toString(radix)}`);
        break;
      }
      case 'TMR': {
        const addr = o[0].toUpperCase();
        const preset = Math.max(0, readWord(o[1]));
        const t = s.timers[addr] ?? { accumulatedMs: 0, currentValue: 0, energized: false, done: false };
        if (!acc) s.timers[addr] = { accumulatedMs: 0, currentValue: 0, energized: false, done: false };
        else if (preset === 0) s.timers[addr] = { accumulatedMs: 0, currentValue: 0, energized: true, done: true };
        else {
          const base = getTimerTimeBaseMs(addr);
          const accMs = Math.min(preset * base, (t.energized ? t.accumulatedMs : 0) + deltaMs);
          const cur = Math.min(preset, Math.floor(accMs / base));
          s.timers[addr] = { accumulatedMs: accMs, currentValue: cur, energized: true, done: cur >= preset };
        }
        break;
      }
      case 'CNT': {
        const addr = o[0].toUpperCase();
        const preset = Math.max(0, readWord(o[1]));
        const c = s.counters[addr] ?? { currentValue: 0, previousInput: false, done: false };
        if (resetCounters.has(addr)) {
          s.counters[addr] = { currentValue: 0, previousInput: acc, done: false };
        } else {
          let cur = c.currentValue;
          if (acc && !c.previousInput && cur < preset) cur += 1;
          s.counters[addr] = { currentValue: cur, previousInput: acc, done: preset === 0 || cur >= preset };
        }
        break;
      }
      case 'MOV': if (acc) s.registers[o[1].toUpperCase()] = clamp16(readWord(o[0])); break;
      case 'ALT': if (acc) writeBit(o[0], !readBit(o[0])); break;
      case 'ALTP': if (pulseOf(i, acc)) writeBit(o[0], !readBit(o[0])); break;
      case 'INC': case 'DEC': case 'INCP': case 'DECP': {
        const run = op.endsWith('P') ? pulseOf(i, acc) : acc;
        if (!run) break;
        const dst = o[0].toUpperCase();
        const raw = (s.registers[dst] ?? 0) + (op.startsWith('INC') ? 1 : -1);
        s.registers[dst] = wrap16(raw);
        s.bits.M1020 = s.registers[dst] === 0;
        s.bits.M1021 = raw < -32768;
        s.bits.M1022 = raw > 32767;
        break;
      }
      case 'ADD': case 'SUB': {
        if (!acc) break;
        const raw = op === 'ADD' ? readWord(o[0]) + readWord(o[1]) : readWord(o[0]) - readWord(o[1]);
        const dst = o[2].toUpperCase();
        s.registers[dst] = wrap16(raw);
        s.bits.M1020 = s.registers[dst] === 0;
        s.bits.M1021 = raw < -32768;
        s.bits.M1022 = raw > 32767;
        break;
      }
      case 'MUL': {
        if (!acc) break;
        const prod = readWord(o[0]) * readWord(o[1]);
        const dst = o[2].toUpperCase();
        s.registers[dst] = (prod << 16) >> 16;
        const d1 = offsetDeviceAddress(dst, 1);
        if (d1) s.registers[d1] = ((prod >> 16) << 16) >> 16;
        s.bits.M1020 = prod === 0;
        break;
      }
      case 'DIV': {
        if (!acc) break;
        const a = readWord(o[0]);
        const b = readWord(o[1]);
        if (b === 0) { s.bits.M1067 = true; s.bits.M1068 = true; break; }
        const dst = o[2].toUpperCase();
        const q = Math.trunc(a / b);
        const r = a % b;
        s.registers[dst] = clamp16(q);
        const d1 = offsetDeviceAddress(dst, 1);
        if (d1) s.registers[d1] = clamp16(r);
        s.bits.M1020 = q === 0 && r === 0;
        break;
      }
      case 'CMP': {
        if (!acc) break;
        const a = readWord(o[0]);
        const b = readWord(o[1]);
        const d0 = o[2].toUpperCase();
        writeBit(d0, a > b);
        const d1 = offsetDeviceAddress(d0, 1);
        const d2 = offsetDeviceAddress(d0, 2);
        if (d1) writeBit(d1, a === b);
        if (d2) writeBit(d2, a < b);
        break;
      }
      default:
        throw new UnsupportedInstructionError(op);
    }
  }
  return s;
}
