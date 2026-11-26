/**
 * WPLSoft proje dosyası (.dvp) üretimi.
 *
 * Üretilen dosyalar WPLSoft 2.52'de açılıp yeniden kaydedilerek doğrulandı (Deney 5, Deney 6,
 * trafik lambası ve tüm komut türlerini içeren deneme programı): program, sağlama toplamı ve
 * aygıt açıklamaları WPLSoft'un kaydettiğiyle birebir aynı.
 *
 * Biçim, WPLSoft 2.52 ile DVP-SX2 için kaydedilmiş örnek dosyaların karşılaştırılmasıyla
 * çözülmüştür (resmî belge yoktur):
 *
 *   0x0000  Başlık (0x100 bayt). 0x56: program sağlama toplamı (u16, LE),
 *           0x5E: program şifreleme anahtarı (1 bayt).
 *   0x0100  Program alanı (SX2: 15872 adım × 2 bayt). Her adım 16 bitlik bir kelimedir;
 *           baytlar anahtarla XOR'lanır, boş adımlar 0xFFFF'tir.
 *   0x7D00  Sabit bölüm ("Initial Value" vb.), ardından Ladder çizim önbelleği. Önbellek
 *           boş bırakıldığında WPLSoft diyagramı programdan kendisi oluşturur.
 *   ...     Metin bölümleri: aygıt açıklamaları ("X0$&Start"), çıkış açıklamaları, sembol tablosu.
 *
 * Kodlaması örneklerle doğrulanmamış komutlar (TRD, TWR, TZCP, DMOVR, DSUBR, ...) için dosya
 * üretilmez; kullanıcıya hangi komutların desteklenmediği bildirilir.
 */
import type { CompileResult, LadderProgram, PlcModelId } from '../types/plc';
import { listDeviceComments } from './commentExport';

export interface DvpBuildResult {
  ok: boolean;
  bytes?: Uint8Array;
  errors: string[];
}

export const DVP_SUPPORTED_MODELS: readonly PlcModelId[] = ['DVP-SX2'];

const SX2_PROGRAM_STEPS = 15872;
const HEADER_SIZE = 0x100;
/** Örnek dosyalardaki anahtar/alan çifti (0x5E–0x61) birlikte kullanılır. */
const KEY = 0xb3;
const KEY_FIELD = [0xdb, 0x48, 0x00];

type Seg = [number, number] | string;

function writeSegs(out: number[], segs: Seg[]): void {
  for (const s of segs) {
    if (typeof s === 'string') {
      for (let i = 0; i < s.length; i += 2) out.push(Number.parseInt(s.slice(i, i + 2), 16));
    } else {
      for (let i = 0; i < s[1]; i += 1) out.push(s[0]);
    }
  }
}

const HEADER_SEGS: Seg[] = [
  '570101',
  [0, 10],
  '1f00',
  [0x20, 19],
  '00',
  [0x20, 19],
  '00',
  [0x20, 19],
  '0400d8008813010100011000',
];

const PRELAYOUT_SEGS: Seg[] = [
  '000102030405060700000001020304050607000000000400000102031000',
  [0xff, 16],
  '1800',
  [0xff, 24],
  '3c54797065426567696e3e0a46756e6374696f6e3d496e697469616c2056616c75650a3c54797065456e643e0a3c44617461426567696e3e0a3c44617461456e643e0a01',
  [0, 257],
];

/** Boş Ladder önbelleği (uzunluk 0) ve sabit bölümler. */
const TAIL_SEGS: Seg[] = [
  '00000000',
  [0, 133],
  '01',
  [0xff, 512],
  'e803',
  [0xff, 2000],
  [0, 261],
  '040000',
  [0xff, 65536],
  [0, 132],
  '10',
  [0, 131],
];

const TEXT_AFTER_COMMENTS =
  '<DataEnd>\n<TypeBegin>\nFunction=Output Comment\n<TypeEnd>\n<DataBegin>\n<DataEnd>\n' +
  '<TypeBegin>\nFunction=Symbol Table\n<TypeEnd>\n<DataBegin>\n<DataEnd>\n' +
  '<TypeBegin>\nFunction=Device Comment Range\n<TypeEnd>\n<DataBegin>\nGroup=9\n' +
  '0=0\nS=0\nE=255\n1=0\nS=0\nE=255\n2=0\nS=0\nE=999\n3=0\nS=2000\nE=4095\n4=0\nS=0\nE=1023\n' +
  '5=0\nS=0\nE=255\n6=0\nS=0\nE=255\n7=0\nS=0\nE=999\n8=0\nS=2000\nE=9999\n<DataEnd>\n' +
  '<SegCmt>\n</SegCmt>\n<PrjectEnd>\n';

// ---------------------------------------------------------------------------
// Komut kodlaması
// ---------------------------------------------------------------------------

class EncodeError extends Error {}

function parseDevice(op: string): { prefix: string; num: number } {
  const m = /^([XYMSTCDK])(-?\d+)$/.exec(op.trim().toUpperCase());
  if (!m) throw new EncodeError(`"${op}" operandı .dvp için desteklenmiyor`);
  const prefix = m[1];
  const num = prefix === 'X' || prefix === 'Y' ? Number.parseInt(m[2], 8) : Number.parseInt(m[2], 10);
  return { prefix, num };
}

/** Temel komutlarda kullanılan 12 bitlik aygıt kodu. */
function bitDeviceCode(op: string): number {
  const { prefix, num } = parseDevice(op);
  switch (prefix) {
    case 'X':
      if (num > 255) break;
      return 0x400 | num;
    case 'Y':
      if (num > 255) break;
      return 0x500 | num;
    case 'M':
      if (num > 2047) break;
      return ((0x8 + (num >> 8)) << 8) | (num & 0xff);
    case 'S':
      if (num > 1023) break;
      return ((num >> 8) << 8) | (num & 0xff);
    case 'T':
      if (num > 255) break;
      return 0x600 | num;
    case 'C':
      if (num > 255) break;
      return 0xe00 | num;
  }
  throw new EncodeError(`${op} adresi .dvp için desteklenmiyor`);
}

/** Uygulama komutlarında bit aygıtı (X/Y/M/S) operandı: 2 kelime. */
function bitOperand(op: string): number[] {
  const { prefix } = parseDevice(op);
  if (!'XYMS'.includes(prefix)) throw new EncodeError(`${op} burada .dvp için desteklenmiyor`);
  const code = bitDeviceCode(op);
  return [0x8400 | (code & 0xff), 0x8000 | (code >> 8)];
}

function k16(value: number): number[] {
  if (!Number.isInteger(value) || value < -32768 || value > 32767) {
    throw new EncodeError(`K${value} sabiti 16 bit aralığının dışında`);
  }
  const v = value & 0xffff;
  return [0x8000 | (v & 0xff), 0x8000 | (v >> 8)];
}

function dRegister(num: number): number[] {
  if (num < 0 || num > 9999) throw new EncodeError(`D${num} adresi desteklenmiyor`);
  const v = num * 2;
  return [0x8600 | (v & 0xff), 0x8600 | (v >> 8)];
}

/** 16 bitlik kelime operandı: K sabiti veya D. */
function wordOperand(op: string): number[] {
  const { prefix, num } = parseDevice(op);
  if (prefix === 'K') return k16(num);
  if (prefix === 'D') return dRegister(num);
  // T/C şimdiki değeri: RST T0 / RST C0 ile aynı kelime aygıtı biçimi.
  if ((prefix === 'T' || prefix === 'C') && num <= 255) return resetOperand(op);
  throw new EncodeError(`${op} operandı .dvp için desteklenmiyor (yalnızca K, D, T, C)`);
}

/** RST / ZRST hedefi: X/Y/M/S, T, C veya D. */
function resetOperand(op: string): number[] {
  const { prefix, num } = parseDevice(op);
  if ('XYMS'.includes(prefix)) return bitOperand(op);
  if (prefix === 'T' && num <= 255) return [0x8600 | num, 0x8206];
  if (prefix === 'C' && num <= 255) return [0x8600 | num, 0x840e];
  if (prefix === 'D') return dRegister(num);
  throw new EncodeError(`${op} sıfırlama hedefi .dvp için desteklenmiyor`);
}

const BASIC_OP: Record<string, number> = { LD: 2, LDI: 3, AND: 4, ANI: 5, OR: 6, ORI: 7, OUT: 0xc, SET: 0xd };
const EDGE_OP: Record<string, number> = { LDP: 0x101, LDF: 0x102, ANDP: 0x103, ANDF: 0x104, ORP: 0x105, ORF: 0x106 };
const STACK_OP: Record<string, number> = {
  NP: 0xfff6,
  PN: 0xfff7,
  ANB: 0xfff8,
  ORB: 0xfff9,
  MPS: 0xfffa,
  MRD: 0xfffb,
  MPP: 0xfffc,
  RET: 0x000e,
  END: 0x000f,
};
/** Delta API numaraları; kod = 2 × API + 16 (P sürümü +0x1000). */
const API: Record<string, number> = {
  CMP: 10,
  MOV: 12,
  ADD: 20,
  SUB: 21,
  MUL: 22,
  DIV: 23,
  INC: 24,
  DEC: 25,
  ZRST: 40,
  SQR: 48,
  FLT: 49,
  ALT: 66,
};
const COMPARE_API: Record<string, number> = {
  'LD=': 224, 'LD>': 225, 'LD<': 226, 'LD<>': 228, 'LD<=': 229, 'LD>=': 230,
  'AND=': 232, 'AND>': 233, 'AND<': 234, 'AND<>': 236, 'AND<=': 237, 'AND>=': 238,
  'OR=': 240, 'OR>': 241, 'OR<': 242, 'OR<>': 244, 'OR<=': 245, 'OR>=': 246,
};

const apiCode = (api: number, pulse = false) => 2 * api + 16 + (pulse ? 0x1000 : 0);

/** Tek bir IL komutunu WPLSoft program kelimelerine çevirir. */
export function encodeInstruction(opcode: string, operands: string[]): number[] {
  const op = opcode.toUpperCase();
  if (op in BASIC_OP) {
    return [(BASIC_OP[op] << 12) | bitDeviceCode(operands[0])];
  }
  if (op === 'STL') {
    const { prefix, num } = parseDevice(operands[0]);
    if (prefix !== 'S' || num > 1023) throw new EncodeError(`STL ${operands[0]} desteklenmiyor`);
    return [0xa000 | bitDeviceCode(operands[0])];
  }
  if (op in STACK_OP) return [STACK_OP[op]];
  if (op in EDGE_OP) return [EDGE_OP[op], ...bitOperand(operands[0])];
  if (op in COMPARE_API) {
    return [apiCode(COMPARE_API[op]), ...wordOperand(operands[0]), ...wordOperand(operands[1])];
  }
  switch (op) {
    case 'RST':
      return [0x0007, ...resetOperand(operands[0])];
    case 'TMR': {
      const { prefix, num } = parseDevice(operands[0]);
      if (prefix !== 'T' || num > 255) throw new EncodeError(`TMR ${operands[0]} desteklenmiyor`);
      return [0x0003, 0x8100 | num, ...wordOperand(operands[1])];
    }
    case 'CNT': {
      const { prefix, num } = parseDevice(operands[0]);
      if (prefix !== 'C' || num > 199) throw new EncodeError(`CNT ${operands[0]} desteklenmiyor (C0–C199)`);
      return [0x0005, 0x8300 | num, ...wordOperand(operands[1])];
    }
    case 'MOV':
      return [apiCode(API.MOV), ...wordOperand(operands[0]), ...dOnly(operands[1])];
    case 'CMP':
      return [apiCode(API.CMP), ...wordOperand(operands[0]), ...wordOperand(operands[1]), ...bitOperand(operands[2])];
    case 'ADD':
    case 'SUB':
    case 'MUL':
    case 'DIV':
      return [apiCode(API[op]), ...wordOperand(operands[0]), ...wordOperand(operands[1]), ...dOnly(operands[2])];
    case 'INC':
    case 'DEC':
    case 'INCP':
    case 'DECP':
      return [apiCode(API[op.slice(0, 3)], op.endsWith('P')), ...dOnly(operands[0])];
    case 'SQR':
    case 'FLT':
      return [apiCode(API[op]), ...wordOperand(operands[0]), ...dOnly(operands[1])];
    case 'ALT':
    case 'ALTP':
      return [apiCode(API.ALT, op === 'ALTP'), ...bitOperand(operands[0])];
    case 'ZRST': {
      const a = parseDevice(operands[0]);
      const b = parseDevice(operands[1]);
      if (a.prefix !== b.prefix) throw new EncodeError('ZRST aralığı aynı aygıt türünde olmalı');
      return [apiCode(API.ZRST), ...resetOperand(operands[0]), ...resetOperand(operands[1])];
    }
    case 'DADDR':
      return [0x0177, ...d32(operands[0]), ...d32(operands[1]), ...d32(operands[2])];
  }
  throw new EncodeError(`${op} komutu .dvp için henüz desteklenmiyor`);
}

function dOnly(op: string): number[] {
  const { prefix, num } = parseDevice(op);
  if (prefix !== 'D') throw new EncodeError(`${op} hedefi .dvp için desteklenmiyor (yalnızca D)`);
  return dRegister(num);
}

function d32(op: string): number[] {
  return [...dOnly(op), 0x8000, 0x8000];
}

/** Programın tamamını kelimelere çevirir; desteklenmeyen komutları toplar. */
export function encodeProgramWords(compiled: CompileResult): { words: number[]; errors: string[] } {
  const words: number[] = [];
  const errors: string[] = [];
  for (const inst of compiled.instructions) {
    try {
      words.push(...encodeInstruction(inst.opcode, inst.operands));
    } catch (e) {
      const text = `${inst.opcode} ${inst.operands.join(' ')}`.trim();
      errors.push(`${text}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { words, errors };
}

// ---------------------------------------------------------------------------
// Türkçe (Windows-1254) metin kodlaması
// ---------------------------------------------------------------------------

const CP1254_SPECIAL: Record<string, number> = { Ğ: 0xd0, İ: 0xdd, Ş: 0xde, ğ: 0xf0, ı: 0xfd, ş: 0xfe };

export function encodeCp1254(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const special = CP1254_SPECIAL[ch];
    if (special !== undefined) out.push(special);
    else {
      const code = ch.codePointAt(0) ?? 0x3f;
      // Latin-1 ile ortak aralık (Ç, Ö, Ü, ç, ö, ü, â, î, û ...)
      out.push(code < 0x80 || (code >= 0xa0 && code <= 0xff && code !== 0xd0 && code !== 0xdd && code !== 0xde && code !== 0xf0 && code !== 0xfd && code !== 0xfe) ? code : 0x3f);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dosya
// ---------------------------------------------------------------------------

export interface DvpBuildOptions {
  /** Yalnızca testler için: şifreleme anahtarı ve yanındaki alan. */
  key?: number;
  keyField?: number[];
  /** Yalnızca testler için: kullanıcı açıklamalarından sonra eklenecek ham açıklama satırları. */
  extraCommentLines?: string[];
  /** Yalnızca testler için: hazır program kelimeleri. */
  words?: number[];
}

export function buildDvpFile(
  program: LadderProgram,
  compiled: CompileResult,
  options: DvpBuildOptions = {}
): DvpBuildResult {
  if (!DVP_SUPPORTED_MODELS.includes(program.model)) {
    return {
      ok: false,
      errors: [`.dvp dosyası şimdilik yalnızca DVP-SX2 için üretilebiliyor (seçili model: ${program.model}).`],
    };
  }
  if (compiled.hasErrors) {
    return { ok: false, errors: ['Önce derleme hatalarını giderin.'] };
  }
  const encoded = options.words ? { words: options.words, errors: [] } : encodeProgramWords(compiled);
  const { words, errors } = encoded;
  if (errors.length) return { ok: false, errors };
  const key = options.key ?? KEY;
  const keyField = options.keyField ?? KEY_FIELD;
  if (words.length > SX2_PROGRAM_STEPS) {
    return { ok: false, errors: ['Program DVP-SX2 bellek kapasitesini aşıyor.'] };
  }

  const out: number[] = [];
  writeSegs(out, HEADER_SEGS);
  let checksum = 0;
  for (const w of words) checksum = (checksum + (((w & 0xff) << 8) | (w >> 8))) & 0xffff;
  out.push(checksum & 0xff, checksum >> 8);
  out.push(0x00, 0x00, 0x01, 0x00, 0x00, 0x00, key, ...keyField);
  while (out.length < HEADER_SIZE) out.push(0);

  for (let i = 0; i < SX2_PROGRAM_STEPS; i += 1) {
    const w = i < words.length ? words[i] : 0xffff;
    out.push((w & 0xff) ^ key, (w >> 8) ^ key);
  }
  writeSegs(out, PRELAYOUT_SEGS);
  writeSegs(out, TAIL_SEGS);

  let text = '<TypeBegin>\nFunction=Device Comment\n<TypeEnd>\n<DataBegin>\n';
  for (const { address, comment } of listDeviceComments(program)) {
    const clean = comment.replace(/[\r\n]+/g, ' ').replace(/\$&/g, '$ &').trim();
    if (clean) text += `${address}$&${clean}\n`;
  }
  for (const line of options.extraCommentLines ?? []) text += `${line}\n`;
  text += TEXT_AFTER_COMMENTS;
  out.push(...encodeCp1254(text));

  return { ok: true, bytes: Uint8Array.from(out), errors: [] };
}
