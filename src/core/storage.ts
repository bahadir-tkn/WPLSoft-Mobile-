import type {
  CellElement,
  CoilKind,
  CompareOperator,
  ContactKind,
  IncDecOperator,
  LadderProgram,
  LadderRung,
  MathOperator,
  PlcModelId,
} from '../types/plc';
import { validateAddress, validateZrstRange } from './addressing';
import { deduplicateRungIds } from './gridFactory';
import { LADDER_COIL_COLUMN, LADDER_TOTAL_COLUMNS, PLC_MODELS } from './plcModels';

export const DRAFT_STORAGE_KEY = 'wplsoft_web_dvp_draft_v1';
export const DRAFT_RECOVERY_KEY = 'wplsoft_web_dvp_recovery_v1';
export const SAVED_PROJECTS_KEY = 'wplsoft_web_dvp_projects_v1';
export const CUSTOM_SNIPPETS_KEY = 'wplsoft_web_dvp_snippets_v1';

export const SUPPORTED_SCHEMA_VERSION = '1.0' as const;
export const MAX_PROJECT_JSON_BYTES = 2 * 1024 * 1024; // 2 MB hard cap
export const MAX_PROJECT_RUNGS = 500;
export const MAX_ROWS_PER_RUNG = 32;

const VALID_MODELS = new Set<PlcModelId>(['DVP-SX2', 'DVP-14SS2', 'DVP-12SA2']);
const VALID_CONTACTS = new Set<ContactKind>(['NO', 'NC', 'RISING', 'FALLING']);
const VALID_COILS = new Set<CoilKind>(['OUT', 'SET', 'RST']);
const VALID_COMPARES = new Set<CompareOperator>(['=', '>', '<', '>=', '<=', '<>']);
const VALID_MATHS = new Set<MathOperator>(['ADD', 'SUB', 'MUL', 'DIV']);
const VALID_INCDECS = new Set<IncDecOperator>(['INC', 'INCP', 'DEC', 'DECP']);
const OUTPUT_ELEMENT_KINDS = new Set<CellElement['kind']>([
  'COIL',
  'TMR',
  'CNT',
  'MOV',
  'ALT',
  'ZRST',
  'CMP',
  'MATH',
  'INCDEC',
  'TRD',
]);
const LOGIC_ELEMENT_KINDS = new Set<CellElement['kind']>(['CONTACT', 'COMPARE', 'HLINE']);

export interface StorageWriteResult {
  ok: boolean;
  error?: string;
}

export interface JsonImportResult {
  success: boolean;
  program?: LadderProgram;
  error?: string;
}

export interface SavedProjectEntry {
  id: string;
  projectName: string;
  model: PlcModelId;
  updatedAt: string;
  rungCount: number;
  program: LadderProgram;
}

export interface CustomCircuitSnippet {
  id: string;
  title: string;
  description: string;
  model: PlcModelId;
  createdAt: string;
  program: LadderProgram;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalComment(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function validateCellElement(
  raw: unknown,
  model: PlcModelId,
  locationTag: string
): { valid: true; element: CellElement } | { valid: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: `${locationTag}: Hücre elemanı geçersiz.` };
  }

  const el = raw as Record<string, unknown>;
  const kind = el.kind;

  switch (kind) {
    case 'EMPTY':
      return { valid: true, element: { kind: 'EMPTY' } };
    case 'HLINE':
      return { valid: true, element: { kind: 'HLINE' } };
    case 'END':
      return { valid: true, element: { kind: 'END' } };

    case 'CONTACT': {
      if (typeof el.contactType !== 'string' || !VALID_CONTACTS.has(el.contactType as ContactKind)) {
        return { valid: false, error: `${locationTag}: Geçersiz kontak tipi ("${String(el.contactType)}").` };
      }
      if (!isNonEmptyString(el.address)) {
        return { valid: false, error: `${locationTag}: Kontak adresi eksik.` };
      }
      const check = validateAddress(el.address, 'bit_contact', model);
      if (!check.valid || !check.parsed) {
        return { valid: false, error: `${locationTag}: ${check.error ?? 'Geçersiz kontak adresi.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'CONTACT',
          contactType: el.contactType as ContactKind,
          address: check.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'COMPARE': {
      if (typeof el.operator !== 'string' || !VALID_COMPARES.has(el.operator as CompareOperator)) {
        return { valid: false, error: `${locationTag}: Geçersiz karşılaştırma operatörü.` };
      }
      if (!isNonEmptyString(el.operandA) || !isNonEmptyString(el.operandB)) {
        return { valid: false, error: `${locationTag}: Karşılaştırma operandları eksik.` };
      }
      const a = validateAddress(el.operandA, 'word_source', model);
      const b = validateAddress(el.operandB, 'word_source', model);
      if (!a.valid || !a.parsed) {
        return { valid: false, error: `${locationTag} S1: ${a.error ?? 'Geçersiz adres.'}` };
      }
      if (!b.valid || !b.parsed) {
        return { valid: false, error: `${locationTag} S2: ${b.error ?? 'Geçersiz adres.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'COMPARE',
          operator: el.operator as CompareOperator,
          operandA: a.parsed.normalized,
          operandB: b.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'COIL': {
      if (typeof el.coilType !== 'string' || !VALID_COILS.has(el.coilType as CoilKind)) {
        return { valid: false, error: `${locationTag}: Geçersiz bobin tipi ("${String(el.coilType)}").` };
      }
      if (!isNonEmptyString(el.address)) {
        return { valid: false, error: `${locationTag}: Bobin adresi eksik.` };
      }
      const role = el.coilType === 'RST' ? 'rst_target' : 'bit_coil';
      const check = validateAddress(el.address, role, model);
      if (!check.valid || !check.parsed) {
        return { valid: false, error: `${locationTag}: ${check.error ?? 'Geçersiz bobin adresi.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'COIL',
          coilType: el.coilType as CoilKind,
          address: check.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'TMR':
    case 'CNT': {
      if (!isNonEmptyString(el.address) || !isNonEmptyString(el.preset)) {
        return { valid: false, error: `${locationTag}: ${kind} adres veya hedef değeri eksik.` };
      }
      const devCheck = validateAddress(el.address, kind === 'TMR' ? 'timer' : 'counter', model);
      const presetCheck = validateAddress(el.preset, 'preset', model);
      if (!devCheck.valid || !devCheck.parsed) {
        return { valid: false, error: `${locationTag}: ${devCheck.error ?? 'Geçersiz aygıt adresi.'}` };
      }
      if (!presetCheck.valid || !presetCheck.parsed) {
        return { valid: false, error: `${locationTag}: ${presetCheck.error ?? 'Geçersiz hedef değer.'}` };
      }
      return {
        valid: true,
        element: {
          kind,
          address: devCheck.parsed.normalized,
          preset: presetCheck.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'MOV': {
      if (!isNonEmptyString(el.source) || !isNonEmptyString(el.destination)) {
        return { valid: false, error: `${locationTag}: MOV kaynak veya hedef adresi eksik.` };
      }
      const src = validateAddress(el.source, 'word_source', model);
      const dst = validateAddress(el.destination, 'word_dest', model);
      if (!src.valid || !src.parsed) {
        return { valid: false, error: `${locationTag} MOV Kaynak: ${src.error ?? 'Geçersiz.'}` };
      }
      if (!dst.valid || !dst.parsed) {
        return { valid: false, error: `${locationTag} MOV Hedef: ${dst.error ?? 'Geçersiz.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'MOV',
          source: src.parsed.normalized,
          destination: dst.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'ALT': {
      if (!isNonEmptyString(el.target)) {
        return { valid: false, error: `${locationTag}: ALT hedef adresi eksik.` };
      }
      const tgt = validateAddress(el.target, 'bit_coil', model);
      if (!tgt.valid || !tgt.parsed) {
        return { valid: false, error: `${locationTag} ALT: ${tgt.error ?? 'Geçersiz.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'ALT',
          target: tgt.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'ZRST': {
      if (!isNonEmptyString(el.start) || !isNonEmptyString(el.end)) {
        return { valid: false, error: `${locationTag}: ZRST başlangıç/bitiş adresi eksik.` };
      }
      const zRes = validateZrstRange(el.start, el.end, model);
      if (!zRes.valid || !zRes.startNorm || !zRes.endNorm) {
        return { valid: false, error: `${locationTag}: ${zRes.error ?? 'Geçersiz ZRST aralığı.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'ZRST',
          start: zRes.startNorm,
          end: zRes.endNorm,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'CMP': {
      if (!isNonEmptyString(el.source1) || !isNonEmptyString(el.source2) || !isNonEmptyString(el.destination)) {
        return { valid: false, error: `${locationTag}: CMP parametreleri eksik.` };
      }
      const s1 = validateAddress(el.source1, 'word_source', model);
      const s2 = validateAddress(el.source2, 'word_source', model);
      const dst = validateAddress(el.destination, 'bit_coil', model);
      if (!s1.valid || !s1.parsed) {
        return { valid: false, error: `${locationTag} CMP S1: ${s1.error ?? 'Geçersiz.'}` };
      }
      if (!s2.valid || !s2.parsed) {
        return { valid: false, error: `${locationTag} CMP S2: ${s2.error ?? 'Geçersiz.'}` };
      }
      if (!dst.valid || !dst.parsed) {
        return { valid: false, error: `${locationTag} CMP Hedef: ${dst.error ?? 'Geçersiz.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'CMP',
          source1: s1.parsed.normalized,
          source2: s2.parsed.normalized,
          destination: dst.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'MATH': {
      if (typeof el.operator !== 'string' || !VALID_MATHS.has(el.operator as MathOperator)) {
        return { valid: false, error: `${locationTag}: Geçersiz matematik operatörü.` };
      }
      if (!isNonEmptyString(el.source1) || !isNonEmptyString(el.source2) || !isNonEmptyString(el.destination)) {
        return { valid: false, error: `${locationTag}: ${el.operator} parametreleri eksik.` };
      }
      const s1 = validateAddress(el.source1, 'word_source', model);
      const s2 = validateAddress(el.source2, 'word_source', model);
      const dst = validateAddress(el.destination, 'word_dest', model);
      if (!s1.valid || !s1.parsed) {
        return { valid: false, error: `${locationTag} ${el.operator} S1: ${s1.error ?? 'Geçersiz.'}` };
      }
      if (!s2.valid || !s2.parsed) {
        return { valid: false, error: `${locationTag} ${el.operator} S2: ${s2.error ?? 'Geçersiz.'}` };
      }
      if (!dst.valid || !dst.parsed) {
        return { valid: false, error: `${locationTag} ${el.operator} Hedef: ${dst.error ?? 'Geçersiz.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'MATH',
          operator: el.operator as MathOperator,
          source1: s1.parsed.normalized,
          source2: s2.parsed.normalized,
          destination: dst.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'INCDEC': {
      if (typeof el.operator !== 'string' || !VALID_INCDECS.has(el.operator as IncDecOperator)) {
        return { valid: false, error: `${locationTag}: Geçersiz INC/DEC operatörü.` };
      }
      if (!isNonEmptyString(el.target)) {
        return { valid: false, error: `${locationTag}: ${el.operator} hedef adresi eksik.` };
      }
      const dst = validateAddress(el.target, 'word_dest', model);
      if (!dst.valid || !dst.parsed) {
        return { valid: false, error: `${locationTag} ${el.operator}: ${dst.error ?? 'Geçersiz.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'INCDEC',
          operator: el.operator as IncDecOperator,
          target: dst.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    case 'TRD': {
      if (!PLC_MODELS[model].hasRtc) {
        return {
          valid: false,
          error: `${locationTag}: TRD komutu ${PLC_MODELS[model].label} modelinde desteklenmez (dahili RTC gerekir).`,
        };
      }
      if (!isNonEmptyString(el.destination)) {
        return { valid: false, error: `${locationTag}: TRD hedef registerı eksik.` };
      }
      const dst = validateAddress(el.destination, 'word_dest', model);
      if (!dst.valid || !dst.parsed) {
        return { valid: false, error: `${locationTag} TRD: ${dst.error ?? 'Geçersiz.'}` };
      }
      return {
        valid: true,
        element: {
          kind: 'TRD',
          destination: dst.parsed.normalized,
          comment: optionalComment(el.comment),
        },
      };
    }

    default:
      return {
        valid: false,
        error: `${locationTag}: Tanınmayan hücre türü ("${String(kind)}").`,
      };
  }
}

export function serializeProgramJson(program: LadderProgram): string {
  return JSON.stringify(program, null, 2);
}

export function parseProgramJson(rawJson: string): JsonImportResult {
  if (typeof rawJson !== 'string') {
    return { success: false, error: 'JSON içeriği boş.' };
  }
  if (rawJson.length > MAX_PROJECT_JSON_BYTES) {
    return {
      success: false,
      error: `Proje JSON dosyası izin verilen maksimum boyutu (${Math.round(
        MAX_PROJECT_JSON_BYTES / (1024 * 1024)
      )} MB) aşıyor.`,
    };
  }
  if (!rawJson.trim()) {
    return { success: false, error: 'JSON içeriği boş.' };
  }

  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { success: false, error: 'Geçersiz JSON proje biçimi (nesne bekleniyor).' };
    }

    const obj = parsed as Record<string, unknown>;

    // 1. Exact schema version check
    if (obj.version !== SUPPORTED_SCHEMA_VERSION) {
      return {
        success: false,
        error: `Desteklenmeyen proje şema sürümü: "${String(obj.version)}". Tam olarak "${SUPPORTED_SCHEMA_VERSION}" sürümü bekleniyor.`,
      };
    }

    // 2. Strict PLC model validation
    if (typeof obj.model !== 'string' || !VALID_MODELS.has(obj.model as PlcModelId)) {
      return {
        success: false,
        error: `Geçersiz veya eksik PLC modeli: "${String(obj.model)}". Geçerli modeller: DVP-SX2, DVP-14SS2, DVP-12SA2.`,
      };
    }
    const model = obj.model as PlcModelId;

    // 3. Column count check (optional for minimal legacy files, but must match 9 when present)
    if (obj.columns !== undefined && obj.columns !== LADDER_TOTAL_COLUMNS) {
      return {
        success: false,
        error: `Geçersiz sütun sayısı (columns: ${String(obj.columns)}). Beklenen sütun sayısı: ${LADDER_TOTAL_COLUMNS}.`,
      };
    }

    // 4. Rungs array presence & safety limits
    if (!Array.isArray(obj.rungs) || obj.rungs.length === 0) {
      return {
        success: false,
        error: 'Proje dosyasında geçerli Ladder satırı (rungs) bulunamadı.',
      };
    }
    if (obj.rungs.length > MAX_PROJECT_RUNGS) {
      return {
        success: false,
        error: `Proje dosyasında izin verilenden fazla ağ bulunuyor (${obj.rungs.length} > ${MAX_PROJECT_RUNGS}).`,
      };
    }

    const normalizedRungs: LadderRung[] = [];
    let endCount = 0;
    let endRungIndex = -1;

    for (let i = 0; i < obj.rungs.length; i += 1) {
      const rawRung = obj.rungs[i];
      if (!rawRung || typeof rawRung !== 'object' || Array.isArray(rawRung)) {
        return {
          success: false,
          error: `Ağ ${i} geçerli bir nesne değil.`,
        };
      }
      const r = rawRung as Record<string, unknown>;

      // Strict boolean check for isEnd (undefined permitted for backward compatibility on non-END rungs)
      if (r.isEnd !== undefined && typeof r.isEnd !== 'boolean') {
        return {
          success: false,
          error: `Ağ ${i}: "isEnd" alanı boolean (true/false) olmalıdır (bulunan: ${typeof r.isEnd}).`,
        };
      }
      const isEnd = r.isEnd === true;
      if (isEnd) {
        endCount += 1;
        endRungIndex = i;
        if (endCount > 1) {
          return {
            success: false,
            error: `Proje dosyasında birden fazla END ağı bulunamaz (Ağ ${i}).`,
          };
        }
        if (i !== obj.rungs.length - 1) {
          return {
            success: false,
            error: `END ağı yalnızca programın en son satırında bulunabilir (Ağ ${i} konumunda bulundu).`,
          };
        }
      }

      if (r.comment !== undefined && typeof r.comment !== 'string') {
        return {
          success: false,
          error: `Ağ ${i}: "comment" alanı metin (string) olmalıdır.`,
        };
      }

      if (!Array.isArray(r.rows) || r.rows.length === 0) {
        return {
          success: false,
          error: `Ağ ${i}: "rows" alanı en az 1 satır içeren bir dizi olmalıdır.`,
        };
      }
      if (r.rows.length > MAX_ROWS_PER_RUNG) {
        return {
          success: false,
          error: `Ağ ${i}: Satır sayısı sınırı aşıldı (${r.rows.length} > ${MAX_ROWS_PER_RUNG}).`,
        };
      }

      const normalizedRows = [];
      for (let rowIdx = 0; rowIdx < r.rows.length; rowIdx += 1) {
        const row = r.rows[rowIdx];
        if (!Array.isArray(row)) {
          return {
            success: false,
            error: `Ağ ${i} Satır ${rowIdx + 1}: Geçerli bir hücre dizisi değil.`,
          };
        }
        if (row.length !== LADDER_TOTAL_COLUMNS) {
          return {
            success: false,
            error: `Ağ ${i} Satır ${rowIdx + 1}: Hücre sayısı ${row.length}, beklenen tam sütun sayısı ${LADDER_TOTAL_COLUMNS} olmalıdır.`,
          };
        }

        const normalizedRow = [];
        for (let colIdx = 0; colIdx < LADDER_TOTAL_COLUMNS; colIdx += 1) {
          const rawCell = row[colIdx];
          if (!rawCell || typeof rawCell !== 'object' || Array.isArray(rawCell)) {
            return {
              success: false,
              error: `Ağ ${i} (Satır ${rowIdx + 1}, Sütun ${colIdx + 1}): Hücre nesnesi bozuk veya eksik.`,
            };
          }
          const cell = rawCell as Record<string, unknown>;
          if (typeof cell.branchDown !== 'boolean') {
            return {
              success: false,
              error: `Ağ ${i} (Satır ${rowIdx + 1}, Sütun ${colIdx + 1}): "branchDown" alanı boolean (true/false) olmalıdır (bulunan: ${typeof cell.branchDown}).`,
            };
          }

          const validated = validateCellElement(
            cell.element,
            model,
            `Ağ ${i} (Satır ${rowIdx + 1}, Sütun ${colIdx + 1})`
          );
          if (!validated.valid) {
            return { success: false, error: validated.error };
          }

          const el = validated.element;
          // Enforce column/rung structural integrity
          if (!isEnd && el.kind === 'END') {
            return {
              success: false,
              error: `Ağ ${i} (Satır ${rowIdx + 1}, Sütun ${colIdx + 1}): END elemanı yalnızca isEnd: true olan son ağda bulunabilir.`,
            };
          }
          if (colIdx < LADDER_COIL_COLUMN && OUTPUT_ELEMENT_KINDS.has(el.kind)) {
            return {
              success: false,
              error: `Ağ ${i} (Satır ${rowIdx + 1}, Sütun ${colIdx + 1}): Çıkış/uygulama komutu (${el.kind}) yalnızca son sütunda (Sütun ${LADDER_COIL_COLUMN}) bulunabilir.`,
            };
          }
          if (colIdx === LADDER_COIL_COLUMN && LOGIC_ELEMENT_KINDS.has(el.kind)) {
            return {
              success: false,
              error: `Ağ ${i} (Satır ${rowIdx + 1}, Sütun ${colIdx + 1}): Lojik eleman (${el.kind}) çıkış sütununda bulunamaz.`,
            };
          }

          normalizedRow.push({
            branchDown: cell.branchDown,
            element: el,
          });
        }
        normalizedRows.push(normalizedRow);
      }

      if (isEnd) {
        const hasEndMarker = normalizedRows.some(
          (nr) => nr[LADDER_COIL_COLUMN]?.element.kind === 'END'
        );
        if (!hasEndMarker) {
          return {
            success: false,
            error: `Ağ ${i}: END ağının çıkış sütununda END elemanı eksik.`,
          };
        }
      }

      normalizedRungs.push({
        id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `rung-json-${i}`,
        comment: typeof r.comment === 'string' && r.comment.trim() ? r.comment.trim() : undefined,
        isEnd: isEnd || undefined,
        rows: normalizedRows,
      });
    }

    if (endCount === 0 || endRungIndex !== obj.rungs.length - 1) {
      return {
        success: false,
        error: 'Proje dosyasında son satırda tek bir geçerli END ağı bulunmalıdır.',
      };
    }

    const deviceComments: Record<string, string> = {};
    if (obj.deviceComments !== undefined) {
      if (
        !obj.deviceComments ||
        typeof obj.deviceComments !== 'object' ||
        Array.isArray(obj.deviceComments)
      ) {
        return {
          success: false,
          error: '"deviceComments" alanı anahtar-değer nesnesi olmalıdır.',
        };
      }
      for (const [k, v] of Object.entries(obj.deviceComments as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          return {
            success: false,
            error: `deviceComments["${k}"] değeri metin (string) olmalıdır.`,
          };
        }
        if (v.trim()) {
          deviceComments[k.trim().toUpperCase()] = v.trim();
        }
      }
    }

    if (obj.projectName !== undefined && typeof obj.projectName !== 'string') {
      return {
        success: false,
        error: '"projectName" alanı metin (string) olmalıdır.',
      };
    }
    const projectName =
      typeof obj.projectName === 'string' && obj.projectName.trim()
        ? obj.projectName.trim()
        : 'Yuklenen_Proje_DVP';

    return {
      success: true,
      program: {
        version: SUPPORTED_SCHEMA_VERSION,
        projectName,
        model,
        columns: LADDER_TOTAL_COLUMNS,
        rungs: deduplicateRungIds(normalizedRungs),
        deviceComments,
        updatedAt:
          typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
      },
    };
  } catch {
    return {
      success: false,
      error: 'JSON dosyası ayrıştırılamadı. Dosyanın geçerli bir WPLSoft Web yedeği olduğundan emin olun.',
    };
  }
}

function hasAnyProgramContent(program: LadderProgram): boolean {
  return program.rungs.some(
    (rung) =>
      !rung.isEnd &&
      rung.rows.some((row) => row.some((cell) => cell.element.kind !== 'EMPTY'))
  );
}

export function saveDraftToStorage(program: LadderProgram): StorageWriteResult {
  if (typeof window === 'undefined') return { ok: true };
  try {
    const serialized = serializeProgramJson(program);
    const previousRaw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (previousRaw && previousRaw !== serialized) {
      const prevParsed = parseProgramJson(previousRaw);
      if (prevParsed.success && prevParsed.program && hasAnyProgramContent(prevParsed.program)) {
        try {
          window.localStorage.setItem(DRAFT_RECOVERY_KEY, previousRaw);
        } catch {
          // Recovery backup is best-effort if quota is tight
        }
      }
    }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, serialized);
    return { ok: true };
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.code === 22);
    return {
      ok: false,
      error: isQuota
        ? 'Tarayıcı depolama alanı doldu; otomatik taslak kaydedilemedi. Projenizi JSON olarak dışa aktarın.'
        : 'Yerel depolamaya erişilemiyor (gizli sekme veya izin kısıtlaması). Değişiklikleri JSON olarak yedekleyin.',
    };
  }
}

export function loadDraftFromStorage(): LadderProgram | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const res = parseProgramJson(raw);
    return res.success && res.program ? res.program : null;
  } catch {
    return null;
  }
}

export function loadRecoveryDraftFromStorage(): LadderProgram | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_RECOVERY_KEY);
    if (!raw) return null;
    const res = parseProgramJson(raw);
    return res.success && res.program ? res.program : null;
  } catch {
    return null;
  }
}

export function clearDraftStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage access errors
  }
}

// ============================================================================
// Multi-Project Workspace Library (LocalStorage)
// ============================================================================

export function listSavedProjects(): SavedProjectEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_PROJECTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validEntries: SavedProjectEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Partial<SavedProjectEntry>;
      if (typeof candidate.id !== 'string' || !candidate.program) continue;
      const check = parseProgramJson(JSON.stringify(candidate.program));
      if (!check.success || !check.program) continue;
      validEntries.push({
        id: candidate.id,
        projectName: check.program.projectName,
        model: check.program.model,
        updatedAt: check.program.updatedAt,
        rungCount: check.program.rungs.filter((r) => !r.isEnd).length,
        program: check.program,
      });
    }
    return validEntries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function writeSavedProjects(entries: SavedProjectEntry[]): StorageWriteResult {
  if (typeof window === 'undefined') return { ok: true };
  try {
    window.localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(entries));
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Proje kütüphanesi kaydedilemedi (yerel depolama alanı dolu veya kapalı).',
    };
  }
}

export function saveProjectToLibrary(
  program: LadderProgram,
  existingId?: string
): { result: StorageWriteResult; entry?: SavedProjectEntry } {
  const entries = listSavedProjects();
  const id = existingId ?? `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const snapshot: LadderProgram = {
    ...program,
    updatedAt: now,
  };
  const entry: SavedProjectEntry = {
    id,
    projectName: snapshot.projectName,
    model: snapshot.model,
    updatedAt: now,
    rungCount: snapshot.rungs.filter((r) => !r.isEnd).length,
    program: snapshot,
  };

  const next = entries.filter((item) => item.id !== id);
  next.unshift(entry);
  const result = writeSavedProjects(next);
  return result.ok ? { result, entry } : { result };
}

export function duplicateProjectInLibrary(
  projectId: string
): { result: StorageWriteResult; entry?: SavedProjectEntry } {
  const entries = listSavedProjects();
  const source = entries.find((item) => item.id === projectId);
  if (!source) {
    return { result: { ok: false, error: 'Kopyalanacak proje bulunamadı.' } };
  }
  const clonedProgram: LadderProgram = {
    ...source.program,
    projectName: `${source.projectName}_Kopya`,
    updatedAt: new Date().toISOString(),
  };
  return saveProjectToLibrary(clonedProgram);
}

export function deleteProjectFromLibrary(projectId: string): StorageWriteResult {
  const entries = listSavedProjects().filter((item) => item.id !== projectId);
  return writeSavedProjects(entries);
}

// ============================================================================
// User-Defined Custom Reusable Circuit Snippets (LocalStorage)
// ============================================================================

export function listCustomSnippets(): CustomCircuitSnippet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_SNIPPETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: CustomCircuitSnippet[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const cand = item as Partial<CustomCircuitSnippet>;
      if (typeof cand.id !== 'string' || typeof cand.title !== 'string' || !cand.program) continue;
      const check = parseProgramJson(JSON.stringify(cand.program));
      if (!check.success || !check.program) continue;
      valid.push({
        id: cand.id,
        title: cand.title.trim() || check.program.projectName,
        description: typeof cand.description === 'string' ? cand.description.trim() : '',
        model: check.program.model,
        createdAt: typeof cand.createdAt === 'string' ? cand.createdAt : new Date().toISOString(),
        program: check.program,
      });
    }
    return valid.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function saveCustomSnippet(
  title: string,
  description: string,
  program: LadderProgram
): { result: StorageWriteResult; snippet?: CustomCircuitSnippet } {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { result: { ok: false, error: 'Özel devre başlığı boş bırakılamaz.' } };
  }
  const snippets = listCustomSnippets();
  const snippet: CustomCircuitSnippet = {
    id: `snip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: trimmedTitle,
    description: description.trim() || 'Kullanıcı tarafından kaydedilen özel Ladder devresi.',
    model: program.model,
    createdAt: new Date().toISOString(),
    program: {
      ...program,
      projectName: trimmedTitle.replace(/\s+/g, '_'),
      updatedAt: new Date().toISOString(),
    },
  };
  const next = [snippet, ...snippets];
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CUSTOM_SNIPPETS_KEY, JSON.stringify(next));
    }
    return { result: { ok: true }, snippet };
  } catch {
    return {
      result: {
        ok: false,
        error: 'Özel devre kaydedilemedi (yerel depolama alanı dolu veya erişilemiyor).',
      },
    };
  }
}

export function deleteCustomSnippet(snippetId: string): StorageWriteResult {
  const next = listCustomSnippets().filter((s) => s.id !== snippetId);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CUSTOM_SNIPPETS_KEY, JSON.stringify(next));
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Özel devre silinemedi.' };
  }
}
