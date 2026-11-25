import type {
  CellElement,
  CompareOperator,
  ContactKind,
  FloatMathOperator,
  FloatUnaryOperator,
  IncDecOperator,
  MathOperator,
  PlcModelId,
} from '../types/plc';
import { validateAddress, validateZrstRange } from './addressing';
import { PLC_MODELS } from './plcModels';

export interface QuickCommandSuccess {
  valid: true;
  element: CellElement;
  targetScope: 'logic' | 'output';
  /** True if entered as OR / ORI / ORP / ORF / OR= etc., indicating parallel branch intent */
  isParallelOr: boolean;
  summary: string;
}

export interface QuickCommandError {
  valid: false;
  error: string;
}

export type QuickCommandParseResult = QuickCommandSuccess | QuickCommandError;

const COMPARE_OPS: CompareOperator[] = ['>=', '<=', '<>', '=', '>', '<'];
const MATH_OPS = new Set<MathOperator>(['ADD', 'SUB', 'MUL', 'DIV']);
const FLOAT_MATH_OPS = new Set<FloatMathOperator>(['DADDR', 'DSUBR', 'DMULR', 'DDIVR']);
const FLOAT_UNARY_OPS = new Set<FloatUnaryOperator>(['DESQR', 'FLT']);
const INCDEC_OPS = new Set<IncDecOperator>(['INC', 'INCP', 'DEC', 'DECP']);

function parseContactCommand(
  opcode: string
): { contactType: ContactKind; isParallelOr: boolean } | null {
  switch (opcode) {
    case 'LD':
    case 'AND':
      return { contactType: 'NO', isParallelOr: false };
    case 'LDI':
    case 'ANI':
      return { contactType: 'NC', isParallelOr: false };
    case 'LDP':
    case 'ANDP':
      return { contactType: 'RISING', isParallelOr: false };
    case 'LDF':
    case 'ANDF':
      return { contactType: 'FALLING', isParallelOr: false };
    case 'OR':
      return { contactType: 'NO', isParallelOr: true };
    case 'ORI':
      return { contactType: 'NC', isParallelOr: true };
    case 'ORP':
      return { contactType: 'RISING', isParallelOr: true };
    case 'ORF':
      return { contactType: 'FALLING', isParallelOr: true };
    default:
      return null;
  }
}

function parseCompareCommand(
  opcode: string
): { operator: CompareOperator; isParallelOr: boolean } | null {
  for (const op of COMPARE_OPS) {
    if (opcode === op) {
      return { operator: op, isParallelOr: false };
    }
  }
  for (const mode of ['LD', 'AND', 'OR'] as const) {
    if (!opcode.startsWith(mode)) continue;
    const suffix = opcode.slice(mode.length);
    if (COMPARE_OPS.includes(suffix as CompareOperator)) {
      return {
        operator: suffix as CompareOperator,
        isParallelOr: mode === 'OR',
      };
    }
  }
  return null;
}

function validateArg(
  raw: string,
  role: Parameters<typeof validateAddress>[1],
  model: PlcModelId
): { ok: true; value: string } | { ok: false; error: string } {
  const res = validateAddress(raw, role, model);
  if (!res.valid || !res.parsed) {
    return { ok: false, error: res.error ?? `Geçersiz adres: ${raw}` };
  }
  return { ok: true, value: res.parsed.normalized };
}

/**
 * Parses a single-line WPLSoft quick entry command (e.g. "LD X0", "ANI X1", "OUT Y0", "TMR T0 K50", "MOV K10 D0")
 * into a validated Ladder CellElement ready for instant placement at the active cursor.
 */
export function parseQuickCommand(
  rawInput: string,
  model: PlcModelId
): QuickCommandParseResult {
  const cleaned = rawInput.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!cleaned) {
    return {
      valid: false,
      error: 'Komut girin (Örn: LD X0, ANI X1, OUT Y0, TMR T0 K50).',
    };
  }

  const tokens = cleaned.toUpperCase().split(' ');
  const opcode = tokens[0];
  const args = tokens.slice(1);

  // 0. NP / PN (sonuç kenarı) ve adım komutları STL Sn / RET
  if (opcode === 'NP' || opcode === 'PN') {
    if (args.length !== 0) {
      return { valid: false, error: `${opcode} komutu adres almaz (yalnızca ${opcode}).` };
    }
    return {
      valid: true,
      element: { kind: 'EDGE', edge: opcode },
      targetScope: 'logic',
      isParallelOr: false,
      summary: opcode,
    };
  }
  if (opcode === 'RET') {
    return {
      valid: true,
      element: { kind: 'RET' },
      targetScope: 'logic',
      isParallelOr: false,
      summary: 'RET',
    };
  }
  if (opcode === 'STL') {
    if (args.length !== 1) {
      return { valid: false, error: 'STL komutu bir adım rölesi gerektirir (Örn: STL S10).' };
    }
    const addr = validateArg(args[0], 'bit_contact', model);
    if (!addr.ok || !/^S\d+$/.test(addr.value)) {
      return { valid: false, error: 'STL adresi bir adım rölesi olmalıdır (Örn: STL S10).' };
    }
    return {
      valid: true,
      element: { kind: 'STL', address: addr.value },
      targetScope: 'logic',
      isParallelOr: false,
      summary: `STL ${addr.value}`,
    };
  }

  // 1. Contacts: LD / LDI / LDP / LDF / AND / ANI / ANDP / ANDF / OR / ORI / ORP / ORF
  const contactInfo = parseContactCommand(opcode);
  if (contactInfo) {
    if (args.length !== 1) {
      return { valid: false, error: `${opcode} komutu 1 bit adresi gerektirir (Örn: ${opcode} X0).` };
    }
    const addr = validateArg(args[0], 'bit_contact', model);
    if (!addr.ok) {
      return { valid: false, error: addr.error };
    }
    return {
      valid: true,
      element: {
        kind: 'CONTACT',
        contactType: contactInfo.contactType,
        address: addr.value,
      },
      targetScope: 'logic',
      isParallelOr: contactInfo.isParallelOr,
      summary: `${opcode} ${addr.value}`,
    };
  }

  // 2. Compare contacts: LD=, LD>, LD<, LD>=, LD<=, LD<>, AND=, OR=, or bare "= D0 K10"
  const compareInfo = parseCompareCommand(opcode);
  if (compareInfo) {
    if (args.length !== 2) {
      return {
        valid: false,
        error: `${opcode} komutu 2 kaynak değer gerektirir (Örn: LD>= T0 K300).`,
      };
    }
    const aRes = validateArg(args[0], 'word_source', model);
    if (!aRes.ok) {
      return { valid: false, error: `1. değer hatalı: ${aRes.error}` };
    }
    const bRes = validateArg(args[1], 'word_source', model);
    if (!bRes.ok) {
      return { valid: false, error: `2. değer hatalı: ${bRes.error}` };
    }
    return {
      valid: true,
      element: {
        kind: 'COMPARE',
        operator: compareInfo.operator,
        operandA: aRes.value,
        operandB: bRes.value,
      },
      targetScope: 'logic',
      isParallelOr: compareInfo.isParallelOr,
      summary: `${opcode} ${aRes.value} ${bRes.value}`,
    };
  }

  // 3. Coils: OUT / SET / RST
  if (opcode === 'OUT' || opcode === 'SET' || opcode === 'RST') {
    if (args.length !== 1) {
      return { valid: false, error: `${opcode} komutu 1 hedef adres gerektirir (Örn: ${opcode} Y0).` };
    }
    const role = opcode === 'RST' ? 'rst_target' : 'bit_coil';
    const addr = validateArg(args[0], role, model);
    if (!addr.ok) {
      return { valid: false, error: addr.error };
    }
    return {
      valid: true,
      element: {
        kind: 'COIL',
        coilType: opcode,
        address: addr.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `${opcode} ${addr.value}`,
    };
  }

  // 4. Timer & Counter: TMR T0 K50, CNT C0 D10
  if (opcode === 'TMR' || opcode === 'CNT') {
    if (args.length !== 2) {
      return {
        valid: false,
        error: `${opcode} komutu aygıt ve hedef değer gerektirir (Örn: ${
          opcode === 'TMR' ? 'TMR T0 K50' : 'CNT C0 K5'
        }).`,
      };
    }
    const devRes = validateArg(args[0], opcode === 'TMR' ? 'timer' : 'counter', model);
    if (!devRes.ok) {
      return { valid: false, error: devRes.error };
    }
    const presetRes = validateArg(args[1], 'preset', model);
    if (!presetRes.ok) {
      return { valid: false, error: presetRes.error };
    }
    return {
      valid: true,
      element: {
        kind: opcode,
        address: devRes.value,
        preset: presetRes.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `${opcode} ${devRes.value} ${presetRes.value}`,
    };
  }

  // 5. MOV S D
  if (opcode === 'MOV') {
    if (args.length !== 2) {
      return { valid: false, error: 'MOV komutu kaynak ve hedef gerektirir (Örn: MOV K10 D0).' };
    }
    const srcRes = validateArg(args[0], 'word_source', model);
    if (!srcRes.ok) {
      return { valid: false, error: `MOV kaynak hatalı: ${srcRes.error}` };
    }
    const dstRes = validateArg(args[1], 'word_dest', model);
    if (!dstRes.ok) {
      return { valid: false, error: `MOV hedef hatalı: ${dstRes.error}` };
    }
    return {
      valid: true,
      element: {
        kind: 'MOV',
        source: srcRes.value,
        destination: dstRes.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `MOV ${srcRes.value} ${dstRes.value}`,
    };
  }

  // 6. ALT D
  if (opcode === 'ALT') {
    if (args.length !== 1) {
      return { valid: false, error: 'ALT komutu 1 hedef bit gerektirir (Örn: ALT M0).' };
    }
    const tgtRes = validateArg(args[0], 'bit_coil', model);
    if (!tgtRes.ok) {
      return { valid: false, error: tgtRes.error };
    }
    return {
      valid: true,
      element: { kind: 'ALT', target: tgtRes.value },
      targetScope: 'output',
      isParallelOr: false,
      summary: `ALT ${tgtRes.value}`,
    };
  }

  // 7. ZRST S1 S2
  if (opcode === 'ZRST') {
    if (args.length !== 2) {
      return { valid: false, error: 'ZRST komutu başlangıç ve bitiş adresi gerektirir (Örn: ZRST Y0 Y5).' };
    }
    const zRes = validateZrstRange(args[0], args[1], model);
    if (!zRes.valid || !zRes.startNorm || !zRes.endNorm) {
      return { valid: false, error: zRes.error ?? 'Geçersiz ZRST aralığı.' };
    }
    return {
      valid: true,
      element: {
        kind: 'ZRST',
        start: zRes.startNorm,
        end: zRes.endNorm,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `ZRST ${zRes.startNorm} ${zRes.endNorm}`,
    };
  }

  // 8. CMP S1 S2 D
  if (opcode === 'CMP') {
    if (args.length !== 3) {
      return { valid: false, error: 'CMP komutu 3 parametre gerektirir (Örn: CMP D0 K50 M0).' };
    }
    const s1 = validateArg(args[0], 'word_source', model);
    if (!s1.ok) return { valid: false, error: `CMP S1 hatalı: ${s1.error}` };
    const s2 = validateArg(args[1], 'word_source', model);
    if (!s2.ok) return { valid: false, error: `CMP S2 hatalı: ${s2.error}` };
    const dst = validateArg(args[2], 'bit_coil', model);
    if (!dst.ok) return { valid: false, error: `CMP hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: {
        kind: 'CMP',
        source1: s1.value,
        source2: s2.value,
        destination: dst.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `CMP ${s1.value} ${s2.value} ${dst.value}`,
    };
  }

  // 9. ADD / SUB / MUL / DIV
  if (MATH_OPS.has(opcode as MathOperator)) {
    if (args.length !== 3) {
      return { valid: false, error: `${opcode} komutu 3 parametre gerektirir (Örn: ${opcode} D0 K10 D1).` };
    }
    const s1 = validateArg(args[0], 'word_source', model);
    if (!s1.ok) return { valid: false, error: `${opcode} S1 hatalı: ${s1.error}` };
    const s2 = validateArg(args[1], 'word_source', model);
    if (!s2.ok) return { valid: false, error: `${opcode} S2 hatalı: ${s2.error}` };
    const dst = validateArg(args[2], 'word_dest', model);
    if (!dst.ok) return { valid: false, error: `${opcode} hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: {
        kind: 'MATH',
        operator: opcode as MathOperator,
        source1: s1.value,
        source2: s2.value,
        destination: dst.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `${opcode} ${s1.value} ${s2.value} ${dst.value}`,
    };
  }

  // 10. INC / INCP / DEC / DECP
  if (INCDEC_OPS.has(opcode as IncDecOperator)) {
    if (args.length !== 1) {
      return { valid: false, error: `${opcode} komutu 1 register gerektirir (Örn: ${opcode} D1).` };
    }
    const dst = validateArg(args[0], 'word_dest', model);
    if (!dst.ok) return { valid: false, error: `${opcode} hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: {
        kind: 'INCDEC',
        operator: opcode as IncDecOperator,
        target: dst.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `${opcode} ${dst.value}`,
    };
  }

  // 11. TRD D
  if (opcode === 'TRD') {
    if (!PLC_MODELS[model].hasRtc) {
      return {
        valid: false,
        error: `${PLC_MODELS[model].label} modelinde dahili gerçek zaman saati (RTC) olmadığı için TRD komutu desteklenmez (DVP-SX2 seçin).`,
      };
    }
    if (args.length !== 1) {
      return { valid: false, error: 'TRD komutu 1 başlangıç registerı gerektirir (Örn: TRD D200).' };
    }
    const dst = validateArg(args[0], 'word_dest', model);
    if (!dst.ok) return { valid: false, error: `TRD hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: { kind: 'TRD', destination: dst.value },
      targetScope: 'output',
      isParallelOr: false,
      summary: `TRD ${dst.value}`,
    };
  }

  // 12. SQR S D
  if (opcode === 'SQR') {
    if (args.length !== 2) {
      return { valid: false, error: 'SQR komutu kaynak ve hedef gerektirir (Örn: SQR K16 D0).' };
    }
    const src = validateArg(args[0], 'word_source', model);
    if (!src.ok) return { valid: false, error: `SQR S hatalı: ${src.error}` };
    const dst = validateArg(args[1], 'word_dest', model);
    if (!dst.ok) return { valid: false, error: `SQR hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: { kind: 'SQR', source: src.value, destination: dst.value },
      targetScope: 'output',
      isParallelOr: false,
      summary: `SQR ${src.value} ${dst.value}`,
    };
  }

  // 13. DMOVR S D
  if (opcode === 'DMOVR') {
    if (args.length !== 2) {
      return { valid: false, error: 'DMOVR komutu 2 parametre gerektirir (Örn: DMOVR F10.000 D10).' };
    }
    const src = validateArg(args[0], 'float_source', model);
    if (!src.ok) return { valid: false, error: `DMOVR S hatalı: ${src.error}` };
    const dst = validateArg(args[1], 'word_dest', model);
    if (!dst.ok) return { valid: false, error: `DMOVR hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: { kind: 'FLOAT_MOV', source: src.value, destination: dst.value },
      targetScope: 'output',
      isParallelOr: false,
      summary: `DMOVR ${src.value} ${dst.value}`,
    };
  }

  // 14. DADDR / DSUBR / DMULR / DDIVR S1 S2 D
  if (FLOAT_MATH_OPS.has(opcode as FloatMathOperator)) {
    if (args.length !== 3) {
      return { valid: false, error: `${opcode} komutu 3 parametre gerektirir (Örn: ${opcode} D10 D20 D30).` };
    }
    const s1 = validateArg(args[0], 'float_source', model);
    if (!s1.ok) return { valid: false, error: `${opcode} S1 hatalı: ${s1.error}` };
    const s2 = validateArg(args[1], 'float_source', model);
    if (!s2.ok) return { valid: false, error: `${opcode} S2 hatalı: ${s2.error}` };
    const dst = validateArg(args[2], 'word_dest', model);
    if (!dst.ok) return { valid: false, error: `${opcode} hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: {
        kind: 'FLOAT_MATH',
        operator: opcode as FloatMathOperator,
        source1: s1.value,
        source2: s2.value,
        destination: dst.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `${opcode} ${s1.value} ${s2.value} ${dst.value}`,
    };
  }

  // 15. DESQR / FLT S D
  if (FLOAT_UNARY_OPS.has(opcode as FloatUnaryOperator)) {
    if (args.length !== 2) {
      return { valid: false, error: `${opcode} komutu 2 parametre gerektirir (Örn: ${opcode} D30 D40).` };
    }
    const op = opcode as FloatUnaryOperator;
    const src = validateArg(args[0], op === 'FLT' ? 'word_source' : 'float_source', model);
    if (!src.ok) return { valid: false, error: `${opcode} S hatalı: ${src.error}` };
    const dst = validateArg(args[1], 'word_dest', model);
    if (!dst.ok) return { valid: false, error: `${opcode} hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: { kind: 'FLOAT_UNARY', operator: op, source: src.value, destination: dst.value },
      targetScope: 'output',
      isParallelOr: false,
      summary: `${opcode} ${src.value} ${dst.value}`,
    };
  }

  // 16. TWR / TWRP S (and TRW / TRWP alias)
  if (opcode === 'TWR' || opcode === 'TWRP' || opcode === 'TRW' || opcode === 'TRWP') {
    const canonicalOp = opcode === 'TWRP' || opcode === 'TRWP' ? 'TWRP' : 'TWR';
    if (!PLC_MODELS[model].hasRtc) {
      return {
        valid: false,
        error: `${PLC_MODELS[model].label} modelinde dahili RTC olmadığı için ${canonicalOp} desteklenmez (DVP-SX2 seçin).`,
      };
    }
    if (args.length !== 1) {
      return { valid: false, error: `${canonicalOp} komutu 1 başlangıç registerı gerektirir (Örn: ${canonicalOp} D10).` };
    }
    const src = validateArg(args[0], 'word_dest', model);
    if (!src.ok) return { valid: false, error: `${canonicalOp} kaynak hatalı: ${src.error}` };
    return {
      valid: true,
      element: {
        kind: 'TWR',
        pulsed: canonicalOp === 'TWRP' || undefined,
        source: src.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `${canonicalOp} ${src.value}`,
    };
  }

  // 17. TZCP S1 S2 S D
  if (opcode === 'TZCP') {
    if (args.length !== 4) {
      return { valid: false, error: 'TZCP komutu 4 parametre gerektirir (Örn: TZCP D0 D10 D20 M0).' };
    }
    const s1 = validateArg(args[0], 'word_dest', model);
    if (!s1.ok) return { valid: false, error: `TZCP S1 hatalı: ${s1.error}` };
    const s2 = validateArg(args[1], 'word_dest', model);
    if (!s2.ok) return { valid: false, error: `TZCP S2 hatalı: ${s2.error}` };
    const cur = validateArg(args[2], 'word_dest', model);
    if (!cur.ok) return { valid: false, error: `TZCP S hatalı: ${cur.error}` };
    const dst = validateArg(args[3], 'bit_coil', model);
    if (!dst.ok) return { valid: false, error: `TZCP hedef hatalı: ${dst.error}` };
    return {
      valid: true,
      element: {
        kind: 'TZCP',
        start1: s1.value,
        start2: s2.value,
        current: cur.value,
        destination: dst.value,
      },
      targetScope: 'output',
      isParallelOr: false,
      summary: `TZCP ${s1.value} ${s2.value} ${cur.value} ${dst.value}`,
    };
  }

  return {
    valid: false,
    error: `Bilinmeyen komut "${opcode}". Örnekler: LD X0, ANI X1, OUT Y0, TMR T0 K50, MOV K10 D0, DMOVR F10.0 D10.`,
  };
}
