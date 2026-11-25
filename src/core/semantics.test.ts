/**
 * Simülatör doğruluk testi: merdiven simülatörünün (scanner.ts) sonucu, aynı programın
 * komut listesini gerçek PLC gibi satır satır çalıştıran bağımsız yorumlayıcının
 * (plcReference.ts) sonucuyla her taramada karşılaştırılır.
 *
 * Kapsam: tüm hazır şablonlar ve deneyler, ders kitabı örnekleri ve rastgele üretilmiş programlar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LadderProgram, SimState } from '../types/plc';
import { parseIlToLadder } from './ilParser';
import { compileLadderToIl } from './ilCompiler';
import { createInitialSimState, executeScanCycle } from './scanner';
import { createRefState, parseRefIl, runRefScan, type RefState } from './plcReference';
import { INDUSTRIAL_TEMPLATES } from './templates';
import { BOOK } from './fixtures/bookExamples';

const SPECIAL_RELAYS = ['M1011', 'M1012', 'M1013', 'M1014'];
const IGNORED_REGISTERS = /^D13(1[3-9])$/;
const IGNORED_BITS = /^M10(0[0-3]|1[1-7])$/;

function snapshotSim(s: SimState): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries({ ...s.outputs, ...s.relays })) {
    if (v && !IGNORED_BITS.test(k)) out[k] = true;
  }
  for (const [k, t] of Object.entries(s.timers)) {
    if (t.done) out[`${k}.done`] = true;
    if (t.currentValue) out[`${k}.cur`] = t.currentValue;
  }
  for (const [k, c] of Object.entries(s.counters)) {
    if (c.done) out[`${k}.done`] = true;
    if (c.currentValue) out[`${k}.cur`] = c.currentValue;
  }
  for (const [k, v] of Object.entries(s.registers)) {
    if (v && !IGNORED_REGISTERS.test(k)) out[k] = v;
  }
  return out;
}

function snapshotRef(s: RefState): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(s.bits)) {
    if (v && k[0] !== 'X' && !IGNORED_BITS.test(k)) out[k] = true;
  }
  for (const [k, t] of Object.entries(s.timers)) {
    if (t.done) out[`${k}.done`] = true;
    if (t.currentValue) out[`${k}.cur`] = t.currentValue;
  }
  for (const [k, c] of Object.entries(s.counters)) {
    if (c.done) out[`${k}.done`] = true;
    if (c.currentValue) out[`${k}.cur`] = c.currentValue;
  }
  for (const [k, v] of Object.entries(s.registers)) {
    if (v && !IGNORED_REGISTERS.test(k)) out[k] = v;
  }
  return out;
}

function diff(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).map((k) => `${k}: sim=${a[k] ?? '-'} plc=${b[k] ?? '-'}`);
}

/** Basit, tekrarlanabilir rastgele sayı üreteci */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

interface CompareOptions {
  scans: number;
  deltaMs: number;
  inputs: string[];
  seed: number;
  /** Girişlerin her taramada değişme olasılığı */
  toggleChance?: number;
  analog?: Record<string, number>;
}

/** Programı hem simülatörde hem bağımsız yorumlayıcıda çalıştırır, ilk farkı döndürür. */
function compareRun(program: LadderProgram, il: string, opts: CompareOptions): string | null {
  const ref = parseRefIl(il);
  const rand = rng(opts.seed);
  let sim = createInitialSimState();
  let plc = createRefState();
  const inputs: Record<string, boolean> = {};
  for (let scan = 0; scan < opts.scans; scan += 1) {
    for (const x of opts.inputs) {
      if (rand() < (opts.toggleChance ?? 0.08)) inputs[x] = !inputs[x];
    }
    const regs = { ...(opts.analog ?? {}) };
    sim = executeScanCycle(
      program,
      { ...sim, inputs: { ...inputs }, registers: { ...sim.registers, ...regs } },
      opts.deltaMs
    );
    const special: Record<string, boolean> = {};
    for (const k of SPECIAL_RELAYS) special[k] = Boolean(sim.relays[k]);
    const rtc: Record<string, number> = { ...regs };
    for (const [k, v] of Object.entries(sim.registers)) if (IGNORED_REGISTERS.test(k)) rtc[k] = v;
    plc = runRefScan(ref, plc, inputs, opts.deltaMs, { relays: special, registers: rtc });
    const d = diff(snapshotSim(sim), snapshotRef(plc));
    if (d.length) {
      const on = Object.entries(inputs).filter(([, v]) => v).map(([k]) => k).join(',') || '-';
      return `tarama ${scan + 1} (girişler: ${on}): ${d.join(' | ')}`;
    }
  }
  return null;
}

function inputsOf(il: string): string[] {
  return [...new Set(il.match(/\bX[0-7]+\b/g) ?? [])];
}

test('Simulator matches real PLC instruction-by-instruction execution for every template', () => {
  const failures: string[] = [];
  for (const tpl of INDUSTRIAL_TEMPLATES) {
    const model = tpl.requiredModel ?? 'DVP-SX2';
    const program = tpl.buildProgram(model);
    const il = compileLadderToIl(program).rawIlText;
    for (const seed of [1, 2, 3]) {
      const res = compareRun(program, il, {
        scans: 3000,
        deltaMs: 50,
        inputs: inputsOf(il),
        seed,
        toggleChance: 0.01,
        analog: { D1110: 50 + seed * 30 },
      });
      if (res) {
        failures.push(`${tpl.id} (seed ${seed}): ${res}`);
        break;
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('Simulator matches real PLC execution for every textbook example (except STL steps)', () => {
  const failures: string[] = [];
  for (const [name, il] of Object.entries(BOOK)) {
    if (/\bSTL\b/.test(il) || /\b(TWR|TWRP|TRD|TZCP|DMOVR|DMULR|DESQR|DADDR|DSUBR|DDIVR|FLT|SQR)\b/.test(il)) continue;
    const parsed = parseIlToLadder(il, 'DVP-SX2');
    assert.equal(parsed.success, true, `${name}: ${JSON.stringify(parsed.errors)}`);
    const compiledIl = compileLadderToIl(parsed.program!).rawIlText;
    for (const seed of [11, 12]) {
      // Kitaptaki yazımla ve uygulamanın ürettiği yazımla ayrı ayrı karşılaştır.
      for (const source of [il, compiledIl]) {
        const res = compareRun(parsed.program!, source, {
          scans: 2000,
          deltaMs: 50,
          inputs: inputsOf(il),
          seed,
          toggleChance: 0.02,
          analog: { D1110: 300 },
        });
        if (res) failures.push(`${name} (seed ${seed}${source === il ? ', kitap IL' : ''}): ${res}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

// ---------------------------------------------------------------------------
// Rastgele program üreteci
// ---------------------------------------------------------------------------

function generateProgram(seed: number): string {
  const r = rng(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
  const bits = ['X0', 'X1', 'X2', 'X3', 'Y0', 'Y1', 'Y2', 'M0', 'M1', 'M2', 'T0', 'T1', 'C0', 'C1'];
  const usedTimers = new Set<string>();
  const usedCounters = new Set<string>();

  const contactSuffix = () => {
    const x = r();
    return x < 0.6 ? '' : x < 0.8 ? 'I' : x < 0.9 ? 'P' : 'F';
  };
  const leaf = (kind: 'LD' | 'AND' | 'OR') => {
    const sfx = contactSuffix();
    const op = kind === 'AND' && sfx === 'I' ? 'ANI' : `${kind}${sfx}`;
    return [`${op} ${pick(bits)}`];
  };
  // Bir blok: yığına tek bir değer bırakır.
  const block = (depth: number, mode: 'series' | 'parallel'): string[] => {
    const n = 2 + Math.floor(r() * 2);
    const lines: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const nest = depth > 0 && r() < 0.3;
      if (i === 0) {
        lines.push(...(nest ? block(depth - 1, mode === 'series' ? 'parallel' : 'series') : leaf('LD')));
      } else if (nest) {
        lines.push(...block(depth - 1, mode === 'series' ? 'parallel' : 'series'));
        lines.push(mode === 'series' ? 'ANB' : 'ORB');
      } else {
        lines.push(...leaf(mode === 'series' ? 'AND' : 'OR'));
      }
    }
    return lines;
  };
  const output = (): string[] => {
    const x = r();
    if (x < 0.1) {
      const t = pick(['T0', 'T1']);
      if (!usedTimers.has(t)) {
        usedTimers.add(t);
        return [`TMR ${t} K${1 + Math.floor(r() * 6)}`];
      }
    }
    if (x < 0.2) {
      const c = pick(['C0', 'C1']);
      if (!usedCounters.has(c)) {
        usedCounters.add(c);
        return [`CNT ${c} K${2 + Math.floor(r() * 3)}`];
      }
    }
    if (x < 0.25) return [`RST ${pick(['T0', 'T1', 'C0', 'C1', 'D0'])}`];
    if (x < 0.3) return ['INC D0'];
    if (x < 0.33) return [`MOV K${Math.floor(r() * 9)} D1`];
    if (x < 0.36) return ['ZRST M0 M2'];
    if (x < 0.4) return [`ALT ${pick(['M0', 'M1', 'Y2'])}`];
    const coil = pick(['OUT', 'OUT', 'SET', 'RST']);
    return [`${coil} ${pick(['Y0', 'Y1', 'Y2', 'M0', 'M1', 'M2'])}`];
  };

  const lines: string[] = [];
  const rungs = 2 + Math.floor(r() * 4);
  for (let k = 0; k < rungs; k += 1) {
    lines.push(...block(Number(process.env.SEM_DEPTH ?? 1), r() < 0.5 ? 'series' : 'parallel'));
    if (r() < 0.1) lines.push(pick(['NP', 'PN']));
    const form = r();
    if (form < 0.45) {
      lines.push(...output());
    } else if (form < 0.75) {
      // MPS / MRD / MPP çoklu çıkış
      const branches = 2 + Math.floor(r() * 2);
      for (let b = 0; b < branches; b += 1) {
        lines.push(b === 0 ? 'MPS' : b === branches - 1 ? 'MPP' : 'MRD');
        if (r() < 0.6) lines.push(...leaf('AND'));
        if (b === branches - 1 && r() < 0.25) {
          // İç içe MPS (dal içinde yeniden dallanma)
          lines.push('MPS', ...leaf('AND'), ...output(), 'MPP', ...output());
        } else {
          lines.push(...output());
        }
      }
    } else {
      // WPLSoft "çıkıştan sonra AND" yazımı
      lines.push(...output());
      lines.push(...leaf('AND'));
      lines.push(...output());
    }
  }
  lines.push('END');
  return lines.join('\n');
}

test('Simulator matches real PLC execution for random programs (parallel, MPS, AND-after-output, edges, TMR, CNT)', () => {
  const failures: string[] = [];
  let compared = 0;
  const rejected: string[] = [];
  const count = Number(process.env.SEM_COUNT ?? 300);
  const offset = Number(process.env.SEM_OFFSET ?? 0);
  for (let seed = 1 + offset; seed <= count + offset; seed += 1) {
    const il = generateProgram(seed * 7919);
    const parsed = parseIlToLadder(il, 'DVP-SX2');
    if (!parsed.success) {
      rejected.push(`#${seed}: ${parsed.errors[0]?.message}`);
      continue;
    }
    const compiled = compileLadderToIl(parsed.program!);
    if (compiled.hasErrors) {
      rejected.push(`#${seed} derleme: ${compiled.diagnostics.find((d) => d.severity === 'error')?.message}`);
      continue;
    }
    compared += 1;
    for (const source of [il, compiled.rawIlText]) {
      const res = compareRun(parsed.program!, source, {
        scans: 400,
        deltaMs: 50,
        inputs: ['X0', 'X1', 'X2', 'X3'],
        seed,
        toggleChance: 0.15,
      });
      if (res) {
        failures.push(`#${seed}${source === il ? '' : ' (derlenmiş IL)'}: ${res}\n${il}`);
        break;
      }
    }
    if (failures.length >= 5) break;
  }
  if (process.env.SEM_VERBOSE) console.log(failures.join("\n\n"));
  if (process.env.SEM_VERBOSE) console.log(`compared=${compared} rejected=${rejected.length}\n${rejected.slice(0, 20).join('\n')}`);
  assert.ok(compared >= count * 0.75, `too many rejected: ${rejected.length}\n${rejected.slice(0, 10).join('\n')}`);
  assert.deepEqual(failures, []);
});
