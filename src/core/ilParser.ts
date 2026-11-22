import type {
  CellElement,
  CompareOperator,
  ContactKind,
  FloatMathOperator,
  FloatUnaryOperator,
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

export const MAX_IL_INPUT_BYTES = 512 * 1024; // 512 KB hard cap
export const MAX_IL_LINES = 5000;

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

interface MpsFrame {
  prefix: LogicNode;
  branchStack: LogicNode[];
  branchHasOutput: boolean;
  sawMpp: boolean;
}

interface MpsLeafBranch {
  factors: LogicNode[];
  output: CellElement;
}

const COMPARE_OPS: CompareOperator[] = ['>=', '<=', '<>', '=', '>', '<'];
const MATH_OPS = new Set<MathOperator>(['ADD', 'SUB', 'MUL', 'DIV']);
const FLOAT_MATH_OPS = new Set<FloatMathOperator>(['DADDR', 'DSUBR', 'DMULR', 'DDIVR']);
const FLOAT_UNARY_OPS = new Set<FloatUnaryOperator>(['DESQR', 'FLT']);
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

function flattenSeriesNodes(node: LogicNode): LogicNode[] {
  if (node.type === 'SERIES') {
    const out: LogicNode[] = [];
    for (const child of node.children) {
      out.push(...flattenSeriesNodes(child));
    }
    return out;
  }
  return [node];
}

function logicNodeSignature(node: LogicNode): string {
  if (node.type === 'ATOM') {
    const el = node.element;
    switch (el.kind) {
      case 'CONTACT':
        return `C:${el.contactType}:${el.address}`;
      case 'COMPARE':
        return `K:${el.operator}:${el.operandA}:${el.operandB}`;
      default:
        return el.kind;
    }
  }
  if (node.type === 'SERIES') {
    return `S(${node.children.map(logicNodeSignature).join('&')})`;
  }
  return `P(${node.children.map(logicNodeSignature).join('|')})`;
}

type MpsLayoutNode =
  | { kind: 'LEAF'; output: CellElement; width: 0; height: 1 }
  | {
      kind: 'BRANCH';
      sharedNodes: LogicNode[];
      segWidth: number;
      sharedHeight: number;
      children: MpsLayoutNode[];
      width: number;
      height: number;
    };

function buildMpsLayoutTree(
  leaves: MpsLeafBranch[],
  offset: number
): MpsLayoutNode {
  if (leaves.length === 1 && leaves[0].factors.length === offset) {
    return { kind: 'LEAF', output: leaves[0].output, width: 0, height: 1 };
  }

  let commonEnd = leaves[0].factors.length;
  for (let i = 1; i < leaves.length; i += 1) {
    let k = offset;
    const maxLen = Math.min(commonEnd, leaves[i].factors.length);
    while (
      k < maxLen &&
      logicNodeSignature(leaves[0].factors[k]) === logicNodeSignature(leaves[i].factors[k])
    ) {
      k += 1;
    }
    commonEnd = Math.min(commonEnd, k);
  }

  const sharedNodes = leaves[0].factors.slice(offset, commonEnd);
  let segWidth = 0;
  let sharedHeight = 1;
  for (const n of sharedNodes) {
    const m = measureNode(n);
    segWidth += m.width;
    sharedHeight = Math.max(sharedHeight, m.height);
  }

  const children: MpsLayoutNode[] = [];
  let idx = 0;
  while (idx < leaves.length) {
    if (leaves[idx].factors.length === commonEnd) {
      children.push({ kind: 'LEAF', output: leaves[idx].output, width: 0, height: 1 });
      idx += 1;
      continue;
    }
    const sig = logicNodeSignature(leaves[idx].factors[commonEnd]);
    let endIdx = idx + 1;
    while (
      endIdx < leaves.length &&
      leaves[endIdx].factors.length > commonEnd &&
      logicNodeSignature(leaves[endIdx].factors[commonEnd]) === sig
    ) {
      endIdx += 1;
    }
    children.push(buildMpsLayoutTree(leaves.slice(idx, endIdx), commonEnd));
    idx = endIdx;
  }

  const childrenTotalHeight = children.reduce((sum, ch) => sum + ch.height, 0);
  const maxChildWidth = children.reduce((max, ch) => Math.max(max, ch.width), 0);

  return {
    kind: 'BRANCH',
    sharedNodes,
    segWidth,
    sharedHeight,
    children,
    width: segWidth + maxChildWidth,
    height: Math.max(sharedHeight, childrenTotalHeight, 1),
  };
}

function renderMpsLayoutTree(
  rows: LadderCellData[][],
  node: MpsLayoutNode,
  startRow: number,
  startCol: number
): void {
  if (node.kind === 'LEAF') {
    for (let c = startCol; c < LADDER_COIL_COLUMN; c += 1) {
      if (rows[startRow][c].element.kind === 'EMPTY') {
        rows[startRow][c] = { ...rows[startRow][c], element: { kind: 'HLINE' } };
      }
    }
    rows[startRow][LADDER_COIL_COLUMN] = {
      ...rows[startRow][LADDER_COIL_COLUMN],
      element: node.output,
    };
    return;
  }

  let colCursor = startCol;
  for (const sn of node.sharedNodes) {
    const m = measureNode(sn);
    renderNodeIntoGrid(rows, sn, startRow, colCursor, m.width);
    colCursor += m.width;
  }

  const nextCol = startCol + node.segWidth;
  const splitCol = nextCol - 1;
  let rowCursor = startRow;
  let splitDownToRow = startRow;

  for (let ci = 0; ci < node.children.length; ci += 1) {
    const child = node.children[ci];
    if (child.kind === 'LEAF') {
      if (ci > 0 && node.children[ci - 1].kind === 'LEAF') {
        rows[rowCursor - 1][LADDER_COIL_COLUMN - 1] = {
          ...rows[rowCursor - 1][LADDER_COIL_COLUMN - 1],
          branchDown: true,
        };
        rows[rowCursor][LADDER_COIL_COLUMN] = {
          ...rows[rowCursor][LADDER_COIL_COLUMN],
          element: child.output,
        };
      } else {
        renderMpsLayoutTree(rows, child, rowCursor, nextCol);
        splitDownToRow = rowCursor;
      }
    } else {
      renderMpsLayoutTree(rows, child, rowCursor, nextCol);
      splitDownToRow = rowCursor;
    }
    rowCursor += child.height;
  }

  if (splitCol >= 0) {
    for (let r = startRow; r < splitDownToRow; r += 1) {
      rows[r][splitCol] = { ...rows[r][splitCol], branchDown: true };
    }
  }
}

function buildMpsRungFromLeafBranches(
  rungIndex: number,
  leaves: MpsLeafBranch[]
): { rung?: LadderRung; error?: string } {
  if (leaves.length === 0) {
    return {
      error: `Ağ ${String(rungIndex).padStart(3, '0')} MPS/MRD/MPP bloğunda çıkış bulunamadı.`,
    };
  }

  const tree = buildMpsLayoutTree(leaves, 0);
  if (tree.width > LADDER_COIL_COLUMN) {
    return {
      error: `Ağ ${String(rungIndex).padStart(3, '0')} MPS dal genişliği (${tree.width}) maksimum 8 sütunu aşıyor.`,
    };
  }

  const rows: LadderCellData[][] = Array.from({ length: tree.height }, () =>
    createEmptyRow(LADDER_TOTAL_COLUMNS)
  );

  renderMpsLayoutTree(rows, tree, 0, 0);

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
  if (typeof rawIlText !== 'string') {
    return {
      success: false,
      errors: [{ lineNumber: 1, rawLine: '', message: 'IL giriş metni geçersiz.' }],
      warnings: [],
      parsedRungCount: 0,
    };
  }
  const utf8Bytes = new TextEncoder().encode(rawIlText).length;
  if (utf8Bytes > MAX_IL_INPUT_BYTES) {
    return {
      success: false,
      errors: [
        {
          lineNumber: 1,
          rawLine: '',
          message: `IL kodu izin verilen maksimum boyutu (${Math.round(
            MAX_IL_INPUT_BYTES / 1024
          )} KB) aşıyor.`,
        },
      ],
      warnings: [],
      parsedRungCount: 0,
    };
  }
  const lines = rawIlText.split(/\r?\n/);
  if (lines.length > MAX_IL_LINES) {
    return {
      success: false,
      errors: [
        {
          lineNumber: 1,
          rawLine: '',
          message: `IL kodu izin verilen maksimum satır sayısını (${lines.length} > ${MAX_IL_LINES}) aşıyor.`,
        },
      ],
      warnings: [],
      parsedRungCount: 0,
    };
  }
  const errors: IlParseError[] = [];
  const warnings: string[] = [];

  const rungs: LadderRung[] = [];
  const stack: LogicNode[] = [];
  let pendingOutputs: CellElement[] = [];
  const mpsStack: MpsFrame[] = [];
  let leafBranches: MpsLeafBranch[] = [];
  let inOutputPhase = false;
  let sawEnd = false;
  let pendingRungComment: string | undefined;

  const combineTopFrameLogic = (): LogicNode => {
    const top = mpsStack[mpsStack.length - 1];
    if (top.branchStack.length === 0) return top.prefix;
    const extra =
      top.branchStack.length === 1
        ? top.branchStack[0]
        : top.branchStack.reduce((acc, cur) => makeSeries(acc, cur));
    return makeSeries(top.prefix, extra);
  };

  const attachPendingComment = (rung: LadderRung): LadderRung => {
    if (!pendingRungComment) return rung;
    const comment = pendingRungComment;
    pendingRungComment = undefined;
    return { ...rung, comment };
  };

  const flushRung = (lineNumber: number, rawLine: string) => {
    if (mpsStack.length > 0) {
      if (mpsStack.some((frame) => !frame.sawMpp)) {
        warnings.push(
          `Satır ${lineNumber}: MPS bloğu MPP ile kapatılmadan sonlandı; otomatik kapatıldı.`
        );
      }
      const built = buildMpsRungFromLeafBranches(rungs.length, leafBranches);
      if (built.error) {
        errors.push({ lineNumber, rawLine, message: built.error });
      } else if (built.rung) {
        rungs.push(attachPendingComment(built.rung));
      }
      mpsStack.length = 0;
      leafBranches = [];
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
    if (mpsStack.length > 0) {
      const logic = combineTopFrameLogic();
      leafBranches.push({
        factors: flattenSeriesNodes(logic),
        output: el,
      });
      for (const frame of mpsStack) {
        frame.branchHasOutput = true;
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
    if (mpsStack.length > 0) {
      const allSawMppWithOutputs =
        inOutputPhase &&
        mpsStack.every((frame) => frame.sawMpp && frame.branchHasOutput);
      if (mode === 'LD' && allSawMppWithOutputs) {
        flushRung(lineNumber, rawLine);
        stack.push(atom);
        return;
      }

      const topFrame = mpsStack[mpsStack.length - 1];
      if (mode === 'LD') {
        topFrame.branchStack.push(atom);
        return;
      }
      if (mode === 'AND') {
        if (topFrame.branchStack.length === 0) {
          topFrame.branchStack.push(atom);
        } else {
          const prev = topFrame.branchStack.pop()!;
          topFrame.branchStack.push(makeSeries(prev, atom));
        }
        return;
      }
      // OR inside branch
      if (topFrame.branchStack.length === 0) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu MPS dalında önce bir kontak/LD gerektirir.`,
        });
        return;
      }
      const prev = topFrame.branchStack.pop()!;
      topFrame.branchStack.push(makeParallel(prev, atom));
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
          if (mpsStack.length > 0 || inOutputPhase || pendingOutputs.length > 0) {
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
      if (mpsStack.length > 0 || inOutputPhase || pendingOutputs.length > 0 || stack.length > 0) {
        flushRung(lineNumber, rawLine);
      }
      sawEnd = true;
      break;
    }

    if (opcode === 'NOP') continue;

    // Multi-output stack instructions: MPS / MRD / MPP (supports nested MPS blocks)
    if (opcode === 'MPS') {
      if (mpsStack.length > 0) {
        mpsStack.push({
          prefix: combineTopFrameLogic(),
          branchStack: [],
          branchHasOutput: false,
          sawMpp: false,
        });
        inOutputPhase = false;
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
      mpsStack.push({
        prefix: stack.pop()!,
        branchStack: [],
        branchHasOutput: false,
        sawMpp: false,
      });
      inOutputPhase = false;
      continue;
    }

    if (opcode === 'MRD' || opcode === 'MPP') {
      if (mpsStack.length === 0) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu yalnızca MPS komutundan sonra kullanılabilir.`,
        });
        continue;
      }
      while (
        mpsStack.length > 1 &&
        mpsStack[mpsStack.length - 1].sawMpp &&
        mpsStack[mpsStack.length - 1].branchHasOutput
      ) {
        mpsStack.pop();
        mpsStack[mpsStack.length - 1].branchHasOutput = true;
      }
      const topFrame = mpsStack[mpsStack.length - 1];
      if (topFrame.sawMpp) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu MPP sonrasında tekrar kullanılamaz.`,
        });
        continue;
      }
      topFrame.branchStack = [];
      topFrame.branchHasOutput = false;
      if (opcode === 'MPP') {
        topFrame.sawMpp = true;
      }
      inOutputPhase = false;
      continue;
    }

    // Block combinators: ORB / ANB
    if (opcode === 'ORB' || opcode === 'ANB') {
      const targetStack =
        mpsStack.length > 0 ? mpsStack[mpsStack.length - 1].branchStack : stack;
      if (mpsStack.length === 0 && inOutputPhase) {
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

    // Integer Square Root: SQR S D
    if (opcode === 'SQR') {
      const srcToken = tokens[1];
      const dstToken = tokens[2];
      if (!srcToken || !dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'SQR komutu için kaynak ve hedef gerekir (örn. SQR K16 D0).',
        });
        continue;
      }
      const src = validateAddress(srcToken, 'word_source', model);
      const dst = validateAddress(dstToken, 'word_dest', model);
      if (!src.valid || !src.parsed) {
        errors.push({ lineNumber, rawLine, message: src.error ?? `Geçersiz SQR S: ${srcToken}` });
        continue;
      }
      if (!dst.valid || !dst.parsed) {
        errors.push({ lineNumber, rawLine, message: dst.error ?? `Geçersiz SQR D: ${dstToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'SQR',
        source: src.parsed.normalized,
        destination: dst.parsed.normalized,
      });
      continue;
    }

    // 32-Bit Floating Point Move: DMOVR S D
    if (opcode === 'DMOVR') {
      const srcToken = tokens[1];
      const dstToken = tokens[2];
      if (!srcToken || !dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'DMOVR komutu için kaynak ve hedef gerekir (örn. DMOVR F10.000 D10).',
        });
        continue;
      }
      const src = validateAddress(srcToken, 'float_source', model);
      const dst = validateAddress(dstToken, 'word_dest', model);
      if (!src.valid || !src.parsed) {
        errors.push({ lineNumber, rawLine, message: src.error ?? `Geçersiz DMOVR S: ${srcToken}` });
        continue;
      }
      if (!dst.valid || !dst.parsed) {
        errors.push({ lineNumber, rawLine, message: dst.error ?? `Geçersiz DMOVR D: ${dstToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'FLOAT_MOV',
        source: src.parsed.normalized,
        destination: dst.parsed.normalized,
      });
      continue;
    }

    // 32-Bit Floating Point Arithmetic: DADDR / DSUBR / DMULR / DDIVR S1 S2 D
    if (FLOAT_MATH_OPS.has(opcode as FloatMathOperator)) {
      const s1Token = tokens[1];
      const s2Token = tokens[2];
      const dstToken = tokens[3];
      if (!s1Token || !s2Token || !dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu için 3 operand gerekir (örn. ${opcode} D10 D20 D30).`,
        });
        continue;
      }
      const s1 = validateAddress(s1Token, 'float_source', model);
      const s2 = validateAddress(s2Token, 'float_source', model);
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
        kind: 'FLOAT_MATH',
        operator: opcode as FloatMathOperator,
        source1: s1.parsed.normalized,
        source2: s2.parsed.normalized,
        destination: dst.parsed.normalized,
      });
      continue;
    }

    // 32-Bit Float Unary: DESQR S D, FLT S D
    if (FLOAT_UNARY_OPS.has(opcode as FloatUnaryOperator)) {
      const srcToken = tokens[1];
      const dstToken = tokens[2];
      if (!srcToken || !dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${opcode} komutu için kaynak ve hedef gerekir (örn. ${opcode} D30 D40).`,
        });
        continue;
      }
      const op = opcode as FloatUnaryOperator;
      const src = validateAddress(srcToken, op === 'FLT' ? 'word_source' : 'float_source', model);
      const dst = validateAddress(dstToken, 'word_dest', model);
      if (!src.valid || !src.parsed) {
        errors.push({ lineNumber, rawLine, message: src.error ?? `Geçersiz ${opcode} S: ${srcToken}` });
        continue;
      }
      if (!dst.valid || !dst.parsed) {
        errors.push({ lineNumber, rawLine, message: dst.error ?? `Geçersiz ${opcode} D: ${dstToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'FLOAT_UNARY',
        operator: op,
        source: src.parsed.normalized,
        destination: dst.parsed.normalized,
      });
      continue;
    }

    // RTC Write: TWR / TWRP S (also accepts textbook TRW / TRWP typo aliases)
    if (opcode === 'TWR' || opcode === 'TWRP' || opcode === 'TRW' || opcode === 'TRWP') {
      const canonicalOp = opcode === 'TWRP' || opcode === 'TRWP' ? 'TWRP' : 'TWR';
      if (opcode === 'TRW' || opcode === 'TRWP') {
        warnings.push(
          `Satır ${lineNumber}: "${opcode}" yazımı Delta kitap kısaltması olarak "${canonicalOp}" (API 167) komutuna dönüştürüldü.`
        );
      }
      if (!PLC_MODELS[model].hasRtc) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${canonicalOp} komutu ${PLC_MODELS[model].label} modelinde desteklenmez (dahili RTC yalnızca DVP-SX2 modelinde mevcuttur).`,
        });
        continue;
      }
      const srcToken = tokens[1];
      if (!srcToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: `${canonicalOp} komutu için kaynak başlangıç registerı gerekir (örn. ${canonicalOp} D10).`,
        });
        continue;
      }
      const src = validateAddress(srcToken, 'word_dest', model);
      if (!src.valid || !src.parsed) {
        errors.push({ lineNumber, rawLine, message: src.error ?? `Geçersiz ${canonicalOp} kaynağı: ${srcToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'TWR',
        pulsed: canonicalOp === 'TWRP' || undefined,
        source: src.parsed.normalized,
      });
      continue;
    }

    // RTC Time Zone Compare: TZCP S1 S2 S D
    if (opcode === 'TZCP') {
      const s1Token = tokens[1];
      const s2Token = tokens[2];
      const curToken = tokens[3];
      const dstToken = tokens[4];
      if (!s1Token || !s2Token || !curToken || !dstToken) {
        errors.push({
          lineNumber,
          rawLine,
          message: 'TZCP komutu için 4 operand gerekir (örn. TZCP D0 D10 D20 M0).',
        });
        continue;
      }
      const s1 = validateAddress(s1Token, 'word_dest', model);
      const s2 = validateAddress(s2Token, 'word_dest', model);
      const cur = validateAddress(curToken, 'word_dest', model);
      const dst = validateAddress(dstToken, 'bit_coil', model);
      if (!s1.valid || !s1.parsed) {
        errors.push({ lineNumber, rawLine, message: s1.error ?? `Geçersiz TZCP S1: ${s1Token}` });
        continue;
      }
      if (!s2.valid || !s2.parsed) {
        errors.push({ lineNumber, rawLine, message: s2.error ?? `Geçersiz TZCP S2: ${s2Token}` });
        continue;
      }
      if (!cur.valid || !cur.parsed) {
        errors.push({ lineNumber, rawLine, message: cur.error ?? `Geçersiz TZCP S: ${curToken}` });
        continue;
      }
      if (!dst.valid || !dst.parsed) {
        errors.push({ lineNumber, rawLine, message: dst.error ?? `Geçersiz TZCP Hedef: ${dstToken}` });
        continue;
      }
      pushOutputElement({
        kind: 'TZCP',
        start1: s1.parsed.normalized,
        start2: s2.parsed.normalized,
        current: cur.parsed.normalized,
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
  if (mpsStack.length > 0 || inOutputPhase || pendingOutputs.length > 0 || stack.length > 0) {
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
