import type {
  CellElement,
  CompareOperator,
  ContactKind,
  IncDecOperator,
  LadderCellData,
  LadderProgram,
  LadderRung,
  MathOperator,
  PlcModelId,
} from '../types/plc';
import { validateAddress, validateZrstRange } from './addressing';
import { createBlankProgram, createEmptyCell, createEmptyRow, createEndRung } from './gridFactory';
import { LADDER_COIL_COLUMN, LADDER_TOTAL_COLUMNS, PLC_MODELS } from './plcModels';

export interface IlParseError {
  lineNumber: number;
  rawLine: string;
  message: string;
}

export interface IlParseResult {
  success: boolean;
  program?: LadderProgram;
  errors: IlParseError[];
  warnings: string[];
  parsedRungCount: number;
}

type LogicNode =
  | { type: 'ATOM'; element: CellElement }
  | { type: 'SERIES'; children: LogicNode[] }
  | { type: 'PARALLEL'; children: LogicNode[] };

interface MeasuredNode {
  node: LogicNode;
  width: number;
  height: number;
}

interface MpsBranchDraft {
  extraStack: LogicNode[];
  outputs: CellElement[];
}

interface ActiveMpsState {
  prefix: LogicNode;
  branches: MpsBranchDraft[];
  sawMpp: boolean;
}

const COMPARE_OPS: CompareOperator[] = ['>=', '<=', '<>', '=', '>', '<'];
const MATH_OPS = new Set<MathOperator>(['ADD', 'SUB', 'MUL', 'DIV']);
const INCDEC_OPS = new Set<IncDecOperator>(['INC', 'INCP', 'DEC', 'DECP']);

function parseContactOpcode(
  opcode: string
): { mode: 'LD' | 'AND' | 'OR'; contactType: ContactKind } | null {
  switch (opcode) {
    case 'LD':
      return { mode: 'LD', contactType: 'NO' };
    case 'LDI':
      return { mode: 'LD', contactType: 'NC' };
    case 'LDP':
      return { mode: 'LD', contactType: 'RISING' };
    case 'LDF':
      return { mode: 'LD', contactType: 'FALLING' };
    case 'AND':
      return { mode: 'AND', contactType: 'NO' };
    case 'ANI':
      return { mode: 'AND', contactType: 'NC' };
    case 'ANDP':
      return { mode: 'AND', contactType: 'RISING' };
    case 'ANDF':
      return { mode: 'AND', contactType: 'FALLING' };
    case 'OR':
      return { mode: 'OR', contactType: 'NO' };
    case 'ORI':
      return { mode: 'OR', contactType: 'NC' };
    case 'ORP':
      return { mode: 'OR', contactType: 'RISING' };
    case 'ORF':
      return { mode: 'OR', contactType: 'FALLING' };
    default:
      return null;
  }
}

function parseCompareOpcode(
  opcode: string
): { mode: 'LD' | 'AND' | 'OR'; operator: CompareOperator } | null {
  for (const mode of ['LD', 'AND', 'OR'] as const) {
    if (!opcode.startsWith(mode)) continue;
    const suffix = opcode.slice(mode.length);
    if (COMPARE_OPS.includes(suffix as CompareOperator)) {
      return { mode, operator: suffix as CompareOperator };
    }
  }
  return null;
}

function makeSeries(left: LogicNode, right: LogicNode): LogicNode {
  const children: LogicNode[] = [];
  if (left.type === 'SERIES') children.push(...left.children);
  else children.push(left);
  if (right.type === 'SERIES') children.push(...right.children);
  else children.push(right);
  return { type: 'SERIES', children };
}

function makeParallel(left: LogicNode, right: LogicNode): LogicNode {
  const children: LogicNode[] = [];
  if (left.type === 'PARALLEL') children.push(...left.children);
  else children.push(left);
  if (right.type === 'PARALLEL') children.push(...right.children);
  else children.push(right);
  return { type: 'PARALLEL', children };
}

function measureNode(node: LogicNode): MeasuredNode {
  if (node.type === 'ATOM') {
    return { node, width: 1, height: 1 };
  }
  if (node.type === 'SERIES') {
    const measured = node.children.map(measureNode);
    const width = measured.reduce((sum, m) => sum + m.width, 0);
    const height = Math.max(1, ...measured.map((m) => m.height));
    return { node, width, height };
  }
  // PARALLEL
  const measured = node.children.map(measureNode);
  const width = Math.max(1, ...measured.map((m) => m.width));
  const height = measured.reduce((sum, m) => sum + m.height, 0);
  return { node, width, height };
}

function renderNodeIntoGrid(
  rows: LadderCellData[][],
  node: LogicNode,
  startRow: number,
  startCol: number,
  allocatedWidth: number
): void {
  if (node.type === 'ATOM') {
    rows[startRow][startCol] = {
      ...rows[startRow][startCol],
      element: node.element,
    };
    for (let c = startCol + 1; c < startCol + allocatedWidth; c += 1) {
      if (rows[startRow][c].element.kind === 'EMPTY') {
        rows[startRow][c] = { ...rows[startRow][c], element: { kind: 'HLINE' } };
      }
    }
    return;
  }

  if (node.type === 'SERIES') {
    const measured = node.children.map(measureNode);
    let colCursor = startCol;
    for (let i = 0; i < measured.length; i += 1) {
      const m = measured[i];
      const isLast = i === measured.length - 1;
      const childAlloc = isLast
        ? startCol + allocatedWidth - colCursor
        : m.width;
      renderNodeIntoGrid(rows, m.node, startRow, colCursor, childAlloc);
      colCursor += childAlloc;
    }
    return;
  }

  // PARALLEL
  const measured = node.children.map(measureNode);
  const branchStartRows: number[] = [];
  let rowCursor = startRow;

  for (const m of measured) {
    branchStartRows.push(rowCursor);
    renderNodeIntoGrid(rows, m.node, rowCursor, startCol, allocatedWidth);
    rowCursor += m.height;
  }

  const lastBranchRow = branchStartRows[branchStartRows.length - 1];
  const rightCol = startCol + allocatedWidth - 1;

  // Connect right outputs of all parallel branches vertically
  for (let r = startRow; r < lastBranchRow; r += 1) {
    rows[r][rightCol] = { ...rows[r][rightCol], branchDown: true };
  }

  // If parallel block is mid-rung (startCol > 0), connect left inputs via preceding column branchDown
  if (startCol > 0) {
    for (let r = startRow; r < lastBranchRow; r += 1) {
      rows[r][startCol - 1] = { ...rows[r][startCol - 1], branchDown: true };
    }
  }
}

function buildRungFromAst(
  rungIndex: number,
  logic: LogicNode | null,
  outputs: CellElement[]
): { rung?: LadderRung; error?: string } {
  const measured = logic ? measureNode(logic) : { width: 0, height: 1 };
  if (measured.width > LADDER_COIL_COLUMN) {
    return {
      error: `Ağ ${String(rungIndex).padStart(3, '0')} içindeki seri eleman genişliği (${measured.width}) maksimum 8 sütunu aşıyor.`,
    };
  }

  const totalRows = Math.max(measured.height, outputs.length, 1);
  const rows: LadderCellData[][] = Array.from({ length: totalRows }, () =>
    createEmptyRow(LADDER_TOTAL_COLUMNS)
  );

  if (logic) {
    renderNodeIntoGrid(rows, logic, 0, 0, measured.width);
  }

  // Bridge row 0 from logic width to coil column with HLINE
  for (let c = measured.width; c < LADDER_COIL_COLUMN; c += 1) {
    if (rows[0][c].element.kind === 'EMPTY') {
      rows[0][c] = { ...rows[0][c], element: { kind: 'HLINE' } };
    }
  }

  // Place outputs in coil column (col 8)
  for (let i = 0; i < outputs.length; i += 1) {
    rows[i][LADDER_COIL_COLUMN] = {
      ...rows[i][LADDER_COIL_COLUMN],
      element: outputs[i],
    };
    if (i > 0) {
      rows[i - 1][LADDER_COIL_COLUMN - 1] = {
        ...rows[i - 1][LADDER_COIL_COLUMN - 1],
        branchDown: true,
      };
    }
  }

  const cleanRows = rows.map((row) =>
    row.map((cell) => ({
      branchDown: cell.branchDown,
      element: cell.element ? { ...cell.element } : createEmptyCell().element,
    }))
  );

  return {
    rung: {
      id: `rung-il-${rungIndex}-${Date.now().toString(36)}`,
      rows: cleanRows,
    },
  };
}

function buildMpsRungFromAst(
  rungIndex: number,
  mps: ActiveMpsState
): { rung?: LadderRung; error?: string } {
  const measuredPrefix = measureNode(mps.prefix);
  const resolvedBranches = mps.branches
    .filter((b) => b.outputs.length > 0)
    .map((b) => {
      let extra: LogicNode | null = null;
      if (b.extraStack.length === 1) {
        extra = b.extraStack[0];
      } else if (b.extraStack.length > 1) {
        extra = b.extraStack.reduce((acc, cur) => makeSeries(acc, cur));
      }
      const m = extra ? measureNode(extra) : { width: 0, height: 1 };
      return {
        extra,
        width: m.width,
        height: Math.max(m.height, b.outputs.length, 1),
        outputs: b.outputs,
      };
    });

  if (resolvedBranches.length === 0) {
    return {
      error: `Ağ ${String(rungIndex).padStart(3, '0')} MPS/MRD/MPP bloğunda çıkış bulunamadı.`,
    };
  }

  const maxBranchWidth = Math.max(0, ...resolvedBranches.map((b) => b.width));
  if (measuredPrefix.width + maxBranchWidth > LADDER_COIL_COLUMN) {
    return {
      error: `Ağ ${String(rungIndex).padStart(3, '0')} MPS dal genişliği (${measuredPrefix.width + maxBranchWidth}) maksimum 8 sütunu aşıyor.`,
    };
  }

  const anyExtraLogic = resolvedBranches.some((b) => b.extra !== null);
  const branchesTotalHeight = resolvedBranches.reduce((sum, b) => sum + b.height, 0);
  const totalRows = Math.max(measuredPrefix.height, branchesTotalHeight, 1);

  const rows: LadderCellData[][] = Array.from({ length: totalRows }, () =>
    createEmptyRow(LADDER_TOTAL_COLUMNS)
  );

  renderNodeIntoGrid(rows, mps.prefix, 0, 0, measuredPrefix.width);

  if (!anyExtraLogic) {
    // All branches share the exact prefix without per-branch contacts: bridge row 0 to col 7 and split right before col 8
    for (let c = measuredPrefix.width; c < LADDER_COIL_COLUMN; c += 1) {
      if (rows[0][c].element.kind === 'EMPTY') {
        rows[0][c] = { ...rows[0][c], element: { kind: 'HLINE' } };
      }
    }
    let outRow = 0;
    for (const branch of resolvedBranches) {
      for (const outEl of branch.outputs) {
        rows[outRow][LADDER_COIL_COLUMN] = {
          ...rows[outRow][LADDER_COIL_COLUMN],
          element: outEl,
        };
        if (outRow > 0) {
          rows[outRow - 1][LADDER_COIL_COLUMN - 1] = {
            ...rows[outRow - 1][LADDER_COIL_COLUMN - 1],
            branchDown: true,
          };
        }
        outRow += 1;
      }
    }
  } else {
    // At least one branch has per-branch contacts after MPS/MRD/MPP: split vertically at col = measuredPrefix.width - 1
    const splitCol = measuredPrefix.width - 1;
    let rowCursor = 0;
    const branchStartRows: number[] = [];

    for (const branch of resolvedBranches) {
      const startRow = rowCursor;
      branchStartRows.push(startRow);

      if (branch.extra) {
        renderNodeIntoGrid(rows, branch.extra, startRow, measuredPrefix.width, branch.width);
      }
      const bridgeStart = measuredPrefix.width + branch.width;
      for (let c = bridgeStart; c < LADDER_COIL_COLUMN; c += 1) {
        if (rows[startRow][c].element.kind === 'EMPTY') {
          rows[startRow][c] = { ...rows[startRow][c], element: { kind: 'HLINE' } };
        }
      }

      for (let oi = 0; oi < branch.outputs.length; oi += 1) {
        rows[startRow + oi][LADDER_COIL_COLUMN] = {
          ...rows[startRow + oi][LADDER_COIL_COLUMN],
          element: branch.outputs[oi],
        };
        if (oi > 0) {
          rows[startRow + oi - 1][LADDER_COIL_COLUMN - 1] = {
            ...rows[startRow + oi - 1][LADDER_COIL_COLUMN - 1],
            branchDown: true,
          };
        }
      }

      rowCursor += branch.height;
    }

    const lastBranchStart = branchStartRows[branchStartRows.length - 1];
    if (splitCol >= 0) {
      for (let r = 0; r < lastBranchStart; r += 1) {
        rows[r][splitCol] = { ...rows[r][splitCol], branchDown: true };
      }
    }
  }

  const cleanRows = rows.map((row) =>
    row.map((cell) => ({
      branchDown: cell.branchDown,
      element: cell.element ? { ...cell.element } : createEmptyCell().element,
    }))
  );

  return {
    rung: {
      id: `rung-il-mps-${rungIndex}-${Date.now().toString(36)}`,
      rows: cleanRows,
    },
  };
}

/**
 * Cleans a raw PC WPLSoft / text IL line:
 * - Strips inline comments (// or ;)
 * - Strips optional leading step/line numbers (e.g. "0000 LD X0", "12: OUT Y0", "0\tLD X0")
 */
export function cleanIlLine(raw: string): string {
  const withoutComments = raw.replace(/(\/\/|;).*$/, '').trim();
  if (!withoutComments) return '';
  return withoutComments.replace(/^\d+\s*[:.)-]?\s+/, '').trim();
}

/**
 * Parses Delta WPLSoft Instruction List (IL) text into a complete LadderProgram.
 */
export function parseIlToLadder(
  rawIlText: string,
  model: PlcModelId,
  projectName = 'IL_Ice_Aktarim',
  existingComments: Record<string, string> = {}
): IlParseResult {
  const lines = rawIlText.split(/\r?\n/);
  const errors: IlParseError[] = [];
  const warnings: string[] = [];

  const rungs: LadderRung[] = [];
  const stack: LogicNode[] = [];
  let pendingOutputs: CellElement[] = [];
  let activeMps: ActiveMpsState | null = null;
  let inOutputPhase = false;
  let sawEnd = false;
  let pendingRungComment: string | undefined;

  const getCurrentBranch = (): MpsBranchDraft | null => {
    if (!activeMps || activeMps.branches.length === 0) return null;
    return activeMps.branches[activeMps.branches.length - 1];
  };

  const attachPendingComment = (rung: LadderRung): LadderRung => {
    if (!pendingRungComment) return rung;
    const comment = pendingRungComment;
    pendingRungComment = undefined;
    return { ...rung, comment };
  };

  const flushRung = (lineNumber: number, rawLine: string) => {
    if (activeMps) {
      if (!activeMps.sawMpp) {
        warnings.push(
          `Satır ${lineNumber}: MPS bloğu MPP ile kapatılmadan sonlandı; otomatik kapatıldı.`
        );
      }
      const built = buildMpsRungFromAst(rungs.length, activeMps);
      if (built.error) {
        errors.push({ lineNumber, rawLine, message: built.error });
      } else if (built.rung) {
        rungs.push(attachPendingComment(built.rung));
      }
      activeMps = null;
      pendingOutputs = [];
      inOutputPhase = false;
      stack.length = 0;
      return;
    }

    if (pendingOutputs.length === 0 && stack.length === 0) return;

    if (pendingOutputs.length === 0) {
      errors.push({
        lineNumber,
        rawLine,
        message: 'Çıkış bobini veya uygulama komutu olmadan yeni ağ başlatıldı.',
      });
      stack.length = 0;
      return;
    }

    if (stack.length > 1) {
      warnings.push(
        `Satır ${lineNumber}: Yığında birleştirilmemiş blok vardı; otomatik ANB uygulandı.`
      );
      while (stack.length > 1) {
        const right = stack.pop()!;
        const left = stack.pop()!;
        stack.push(makeSeries(left, right));
      }
    }

    const logic = stack.pop() ?? null;
    const built = buildRungFromAst(rungs.length, logic, pendingOutputs);
    if (built.error) {
      errors.push({ lineNumber, rawLine, message: built.error });
    } else if (built.rung) {
      rungs.push(attachPendingComment(built.rung));
    }

    pendingOutputs = [];
    inOutputPhase = false;
  };

  const pushOutputElement = (el: CellElement) => {
    if (activeMps) {
      const branch = getCurrentBranch();
      if (branch) {
        branch.outputs.push(el);
      }
      inOutputPhase = true;
    } else {
      inOutputPhase = true;
      pendingOutputs.push(el);
    }
  };

  const applyLogicAtom = (
    mode: 'LD' | 'AND' | 'OR',
    atom: LogicNode,
    opcode: string,
    lineNumber: number,
    rawLine: string
  ) => {
    if (activeMps) {
      const branch = getCurrentBranch()!;
      if (mode === 'LD' && activeMps.sawMpp && branch.outputs.length > 0) {
        flushRung(lineNumber, rawLine);
        stack.push(atom);
        return;
      }
      if (mode === 'LD') {
        branch.extraStack.push(atom);
        return;
      }
      if (mode === 'AND') {
        if (branch.extraStack.length === 0) {
          branch.extraStack.push(atom);
        } else {
          const top = branch.extraStack.pop()!;
          branch.extraStack.push(makeSeries(top, atom));
        }
        return;
      }
      // OR inside branch
      if (branch.extraStack.length === 0) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu MPS dalında önce bir kontak/LD gerektirir.`,
        });
        return;
      }
      const top = branch.extraStack.pop()!;
      branch.extraStack.push(makeParallel(top, atom));
      return;
    }

    if (mode === 'LD' && inOutputPhase) {
      flushRung(lineNumber, rawLine);
    } else if (mode !== 'LD' && inOutputPhase) {
      errors.push({
        lineNumber,
        rawLine,
        message: `${opcode} komutu çıkıştan sonra kullanılamaz; yeni ağ LD/LDI ile başlamalıdır.`,
      });
      return;
    }

    if (mode === 'LD') {
      stack.push(atom);
    } else if (mode === 'AND') {
      if (stack.length === 0) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutundan önce LD/LDI bulunmalıdır.`,
        });
        return;
      }
      stack.push(makeSeries(stack.pop()!, atom));
    } else {
      if (stack.length === 0) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutundan önce LD/LDI bulunmalıdır.`,
        });
        return;
      }
      stack.push(makeParallel(stack.pop()!, atom));
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const rawLine = lines[i];
    const trimmedRaw = rawLine.trim();
    const cleaned = cleanIlLine(rawLine);
    if (!cleaned) {
      // Preserve standalone comment lines as Segment Comment for the next rung
      if (trimmedRaw.startsWith('//') || trimmedRaw.startsWith(';')) {
        const commentBody = trimmedRaw.replace(/^(\/\/|;)+\s*/, '').trim();
        if (commentBody) {
          if (activeMps || inOutputPhase || pendingOutputs.length > 0) {
            flushRung(lineNumber, rawLine);
          }
          pendingRungComment = pendingRungComment
            ? `${pendingRungComment} · ${commentBody}`
            : commentBody;
        }
      }
      continue;
    }

    const tokens = cleaned.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const opcode = tokens[0].toUpperCase();

    if (opcode === 'END') {
      if (activeMps || inOutputPhase || pendingOutputs.length > 0 || stack.length > 0) {
        flushRung(lineNumber, rawLine);
      }
      sawEnd = true;
      break;
    }

    if (opcode === 'NOP') continue;

    // Multi-output stack instructions: MPS / MRD / MPP
    if (opcode === 'MPS') {
      if (activeMps) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'İç içe (nested) MPS bloğu desteklenmiyor; önce mevcut MPS bloğunu MPP ile kapatın.',
        });
        continue;
      }
      if (stack.length === 0) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'MPS komutundan önce en az bir LD/LDI kontak bloğu bulunmalıdır.',
        });
        continue;
      }
      while (stack.length > 1) {
        const right = stack.pop()!;
        const left = stack.pop()!;
        stack.push(makeSeries(left, right));
      }
      activeMps = {
        prefix: stack.pop()!,
        branches: [{ extraStack: [], outputs: [] }],
        sawMpp: false,
      };
      inOutputPhase = false;
      continue;
    }

    if (opcode === 'MRD' || opcode === 'MPP') {
      if (!activeMps) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu yalnızca MPS komutundan sonra kullanılabilir.`,
        });
        continue;
      }
      if (activeMps.sawMpp) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu MPP sonrasında tekrar kullanılamaz.`,
        });
        continue;
      }
      activeMps.branches.push({ extraStack: [], outputs: [] });
      if (opcode === 'MPP') {
        activeMps.sawMpp = true;
      }
      inOutputPhase = false;
      continue;
    }

    // Block combinators: ORB / ANB
    if (opcode === 'ORB' || opcode === 'ANB') {
      const targetStack = activeMps ? getCurrentBranch()!.extraStack : stack;
      if (!activeMps && inOutputPhase) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu çıkış bobinlerinden sonra kullanılamaz.`,
        });
        continue;
      }
      if (targetStack.length < 2) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu için yığında en az 2 lojik blok bulunmalıdır.`,
        });
        continue;
      }
      const right = targetStack.pop()!;
      const left = targetStack.pop()!;
      targetStack.push(opcode === 'ORB' ? makeParallel(left, right) : makeSeries(left, right));
      continue;
    }

    // Contact instructions (LD/LDI/LDP/LDF, AND/ANI/ANDP/ANDF, OR/ORI/ORP/ORF)
    const contactSpec = parseContactOpcode(opcode);
    if (contactSpec) {
      const addrToken = tokens[1];
      if (!addrToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu için aygıt adresi eksik (örn. ${opcode} X0).`,
        });
        continue;
      }
      const check = validateAddress(addrToken, 'bit_contact', model);
      if (!check.valid || !check.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: check.error ?? `Geçersiz kontak adresi: ${addrToken}`,
        });
        continue;
      }
      if (check.warning) warnings.push(`Satır ${lineNumber}: ${check.warning}`);

      const atom: LogicNode = {
        type: 'ATOM',
        element: {
          kind: 'CONTACT',
          contactType: contactSpec.contactType,
          address: check.parsed.normalized,
        },
      };
      applyLogicAtom(contactSpec.mode, atom, opcode, lineNumber, rawLine);
      continue;
    }

    // Compare instructions (LD=, AND>, OR<=, etc.)
    const compareSpec = parseCompareOpcode(opcode);
    if (compareSpec) {
      const opAToken = tokens[1];
      const opBToken = tokens[2];
      if (!opAToken || !opBToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} için 2 operand gerekir (örn. ${opcode} D0 K10).`,
        });
        continue;
      }
      const checkA = validateAddress(opAToken, 'word_source', model);
      const checkB = validateAddress(opBToken, 'word_source', model);
      if (!checkA.valid || !checkA.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: checkA.error ?? `Geçersiz 1. operand: ${opAToken}`,
        });
        continue;
      }
      if (!checkB.valid || !checkB.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: checkB.error ?? `Geçersiz 2. operand: ${opBToken}`,
        });
        continue;
      }

      const atom: LogicNode = {
        type: 'ATOM',
        element: {
          kind: 'COMPARE',
          operator: compareSpec.operator,
          operandA: checkA.parsed.normalized,
          operandB: checkB.parsed.normalized,
        },
      };
      applyLogicAtom(compareSpec.mode, atom, opcode, lineNumber, rawLine);
      continue;
    }

    // Output Coils: OUT / SET / RST
    if (opcode === 'OUT' || opcode === 'SET' || opcode === 'RST') {
      const addrToken = tokens[1];
      if (!addrToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu için hedef adres eksik.`,
        });
        continue;
      }
      const role = opcode === 'RST' ? 'rst_target' : 'bit_coil';
      const check = validateAddress(addrToken, role, model);
      if (!check.valid || !check.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: check.error ?? `Geçersiz ${opcode} adresi: ${addrToken}`,
        });
        continue;
      }
      if (check.warning) warnings.push(`Satır ${lineNumber}: ${check.warning}`);

      pushOutputElement({
        kind: 'COIL',
        coilType: opcode,
        address: check.parsed.normalized,
      });
      continue;
    }

    // Application Outputs: TMR / CNT (supports both K constant and D register presets)
    if (opcode === 'TMR' || opcode === 'CNT') {
      const addrToken = tokens[1];
      const presetToken = tokens[2];
      if (!addrToken || !presetToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} için adres ve hedef değer gerekir (örn. ${opcode} ${
            opcode === 'TMR' ? 'T0 K50 veya T0 D500' : 'C0 K5 veya C0 D10'
          }).`,
        });
        continue;
      }
      const addrCheck = validateAddress(
        addrToken,
        opcode === 'TMR' ? 'timer' : 'counter',
        model
      );
      const presetCheck = validateAddress(presetToken, 'preset', model);
      if (!addrCheck.valid || !addrCheck.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: addrCheck.error ?? `Geçersiz ${opcode} adresi: ${addrToken}`,
        });
        continue;
      }
      if (!presetCheck.valid || !presetCheck.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: presetCheck.error ?? `Geçersiz ${opcode} hedef değeri: ${presetToken}`,
        });
        continue;
      }

      pushOutputElement(
        opcode === 'TMR'
          ? {
              kind: 'TMR',
              address: addrCheck.parsed.normalized,
              preset: presetCheck.parsed.normalized,
            }
          : {
              kind: 'CNT',
              address: addrCheck.parsed.normalized,
              preset: presetCheck.parsed.normalized,
            }
      );
      continue;
    }

    // Application Output: MOV
    if (opcode === 'MOV') {
      const srcToken = tokens[1];
      const dstToken = tokens[2];
      if (!srcToken || !dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'MOV komutu için kaynak ve hedef gerekir (örn. MOV K100 D0).',
        });
        continue;
      }
      const srcCheck = validateAddress(srcToken, 'word_source', model);
      const dstCheck = validateAddress(dstToken, 'word_dest', model);
      if (!srcCheck.valid || !srcCheck.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: srcCheck.error ?? `Geçersiz MOV kaynağı: ${srcToken}`,
        });
        continue;
      }
      if (!dstCheck.valid || !dstCheck.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: dstCheck.error ?? `Geçersiz MOV hedefi: ${dstToken}`,
        });
        continue;
      }

      pushOutputElement({
        kind: 'MOV',
        source: srcCheck.parsed.normalized,
        destination: dstCheck.parsed.normalized,
      });
      continue;
    }

    // Application Output: ALT / ALTP (Flip-Flop)
    if (opcode === 'ALT' || opcode === 'ALTP') {
      const targetToken = tokens[1];
      if (!targetToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'ALT komutu için hedef bit adresi gerekir (örn. ALT Y0 veya ALT M0).',
        });
        continue;
      }
      const check = validateAddress(targetToken, 'bit_coil', model);
      if (!check.valid || !check.parsed) {
        errors.push({
          lineNumber,
          rawLine,
          message: check.error ?? `Geçersiz ALT hedefi: ${targetToken}`,
        });
        continue;
      }
      if (check.warning) warnings.push(`Satır ${lineNumber}: ${check.warning}`);
      pushOutputElement({
        kind: 'ALT',
        target: check.parsed.normalized,
      });
      continue;
    }

    // Application Output: ZRST S1 S2
    if (opcode === 'ZRST') {
      const s1Token = tokens[1];
      const s2Token = tokens[2];
      if (!s1Token || !s2Token) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'ZRST komutu için başlangıç ve bitiş adresi gerekir (örn. ZRST Y0 Y5).',
        });
        continue;
      }
      const zRes = validateZrstRange(s1Token, s2Token, model);
      if (!zRes.valid || !zRes.startNorm || !zRes.endNorm) {
        errors.push({
          lineNumber,
          rawLine,
          message: zRes.error ?? 'Geçersiz ZRST aralığı.',
        });
        continue;
      }
      pushOutputElement({
        kind: 'ZRST',
        start: zRes.startNorm,
        end: zRes.endNorm,
      });
      continue;
    }

    // Application Output: CMP S1 S2 D
    if (opcode === 'CMP') {
      const s1Token = tokens[1];
      const s2Token = tokens[2];
      const dstToken = tokens[3];
      if (!s1Token || !s2Token || !dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'CMP komutu için 3 operand gerekir (örn. CMP D0 K50 M0).',
        });
        continue;
      }
      const s1 = validateAddress(s1Token, 'word_source', model);
      const s2 = validateAddress(s2Token, 'word_source', model);
      const dst = validateAddress(dstToken, 'bit_coil', model);
      if (!s1.valid || !s1.parsed) {
        errors.push({ lineNumber, rawLine, message: s1.error ?? `Geçersiz CMP S1: ${s1Token}` });
        continue;
      }
      if (!s2.valid || !s2.parsed) {
        errors.push({ lineNumber, rawLine, message: s2.error ?? `Geçersiz CMP S2: ${s2Token}` });
        continue;
      }
      if (!dst.valid || !dst.parsed) {
        errors.push({ lineNumber, rawLine, message: dst.error ?? `Geçersiz CMP D: ${dstToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'CMP',
        source1: s1.parsed.normalized,
        source2: s2.parsed.normalized,
        destination: dst.parsed.normalized,
      });
      continue;
    }

    // Arithmetic: ADD / SUB / MUL / DIV S1 S2 D
    if (MATH_OPS.has(opcode as MathOperator)) {
      const s1Token = tokens[1];
      const s2Token = tokens[2];
      const dstToken = tokens[3];
      if (!s1Token || !s2Token || !dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu için 3 operand gerekir (örn. ${opcode} D0 K10 D2).`,
        });
        continue;
      }
      const s1 = validateAddress(s1Token, 'word_source', model);
      const s2 = validateAddress(s2Token, 'word_source', model);
      const dst = validateAddress(dstToken, 'word_dest', model);
      if (!s1.valid || !s1.parsed) {
        errors.push({ lineNumber, rawLine, message: s1.error ?? `Geçersiz ${opcode} S1: ${s1Token}` });
        continue;
      }
      if (!s2.valid || !s2.parsed) {
        errors.push({ lineNumber, rawLine, message: s2.error ?? `Geçersiz ${opcode} S2: ${s2Token}` });
        continue;
      }
      if (!dst.valid || !dst.parsed) {
        errors.push({ lineNumber, rawLine, message: dst.error ?? `Geçersiz ${opcode} D: ${dstToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'MATH',
        operator: opcode as MathOperator,
        source1: s1.parsed.normalized,
        source2: s2.parsed.normalized,
        destination: dst.parsed.normalized,
      });
      continue;
    }

    // Increment / Decrement: INC / INCP / DEC / DECP D
    if (INCDEC_OPS.has(opcode as IncDecOperator)) {
      const targetToken = tokens[1];
      if (!targetToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu için hedef D registerı gerekir (örn. ${opcode} D0).`,
        });
        continue;
      }
      const dst = validateAddress(targetToken, 'word_dest', model);
      if (!dst.valid || !dst.parsed) {
        errors.push({ lineNumber, rawLine, message: dst.error ?? `Geçersiz ${opcode} hedefi: ${targetToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'INCDEC',
        operator: opcode as IncDecOperator,
        target: dst.parsed.normalized,
      });
      continue;
    }

    // RTC Read: TRD D
    if (opcode === 'TRD') {
      if (!PLC_MODELS[model].hasRtc) {
        errors.push({
          lineNumber,
          rawLine,
          message: `TRD komutu ${PLC_MODELS[model].label} modelinde desteklenmez (dahili RTC yalnızca DVP-SX2 modelinde mevcuttur).`,
        });
        continue;
      }
      const dstToken = tokens[1];
      if (!dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'TRD komutu için hedef başlangıç registerı gerekir (örn. TRD D0).',
        });
        continue;
      }
      const dst = validateAddress(dstToken, 'word_dest', model);
      if (!dst.valid || !dst.parsed) {
        errors.push({ lineNumber, rawLine, message: dst.error ?? `Geçersiz TRD hedefi: ${dstToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'TRD',
        destination: dst.parsed.normalized,
      });
      continue;
    }

    errors.push({
      lineNumber,
      rawLine,
      message: `Tanınmayan veya desteklenmeyen Delta IL komutu: "${opcode}"`,
    });
  }

  // Flush final pending rung if END was omitted
  if (activeMps || inOutputPhase || pendingOutputs.length > 0 || stack.length > 0) {
    flushRung(lines.length, lines[lines.length - 1] ?? '');
  }

  if (!sawEnd && rungs.length > 0) {
    warnings.push('Giriş metninde END komutu yoktu; program sonuna END otomatik eklendi.');
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
      warnings,
      parsedRungCount: rungs.length,
    };
  }

  if (rungs.length === 0) {
    const blank = createBlankProgram(model, projectName, 4);
    return {
      success: true,
      program: {
        ...blank,
        deviceComments: { ...existingComments },
      },
      errors: [],
      warnings,
      parsedRungCount: 0,
    };
  }

  const finalRungs: LadderRung[] = [...rungs, createEndRung()];
  const now = new Date().toISOString();

  return {
    success: true,
    program: {
      version: '1.0',
      projectName,
      model,
      columns: LADDER_TOTAL_COLUMNS,
      rungs: finalRungs,
      deviceComments: { ...existingComments },
      updatedAt: now,
    },
    errors: [],
    warnings,
    parsedRungCount: rungs.length,
  };
}
