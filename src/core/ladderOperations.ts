import type {
  CellElement,
  CursorPosition,
  DevicePrefix,
  LadderCellData,
  LadderProgram,
  LadderRung,
} from '../types/plc';
import { offsetDeviceAddress } from './addressing';
import { createEmptyCell, createEmptyRow, createEmptyRung } from './gridFactory';
import { getStepHeader } from './ast';
import { LADDER_COIL_COLUMN, LADDER_TOTAL_COLUMNS } from './plcModels';
import { parseQuickCommand, type QuickCommandSuccess } from './quickCommand';

export const MAX_HISTORY_DEPTH = 40;

export type HistoryTransitionKind = 'commit' | 'undo' | 'redo';

export interface HistoryTransition {
  kind: HistoryTransitionKind;
  seq: number;
}

export interface EditorHistoryState {
  past: LadderProgram[];
  present: LadderProgram;
  future: LadderProgram[];
  lastTransition: HistoryTransition | null;
}

export function createInitialHistory(initial: LadderProgram): EditorHistoryState {
  return {
    past: [],
    present: initial,
    future: [],
    lastTransition: null,
  };
}

export function commitHistory(
  history: EditorHistoryState,
  updater: (current: LadderProgram) => LadderProgram,
  updatedAt?: string
): EditorHistoryState {
  const next = updater(history.present);
  if (next === history.present) return history;
  const stamped: LadderProgram = {
    ...next,
    updatedAt: updatedAt ?? next.updatedAt ?? history.present.updatedAt,
  };
  const nextSeq = (history.lastTransition?.seq ?? 0) + 1;
  return {
    past: [...history.past.slice(-(MAX_HISTORY_DEPTH - 1)), history.present],
    present: stamped,
    future: [],
    lastTransition: { kind: 'commit', seq: nextSeq },
  };
}

export function commitHistoryFromSnapshot(
  history: EditorHistoryState,
  baseProgram: LadderProgram,
  nextProgram: LadderProgram,
  updatedAt?: string
): EditorHistoryState {
  if (nextProgram === baseProgram) return history;
  const stamped: LadderProgram = {
    ...nextProgram,
    updatedAt: updatedAt ?? nextProgram.updatedAt ?? baseProgram.updatedAt,
  };
  const nextSeq = (history.lastTransition?.seq ?? 0) + 1;
  return {
    past: [...history.past.slice(-(MAX_HISTORY_DEPTH - 1)), baseProgram],
    present: stamped,
    future: [],
    lastTransition: { kind: 'commit', seq: nextSeq },
  };
}

export function undoHistory(history: EditorHistoryState): EditorHistoryState {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const nextSeq = (history.lastTransition?.seq ?? 0) + 1;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future.slice(0, MAX_HISTORY_DEPTH - 1)],
    lastTransition: { kind: 'undo', seq: nextSeq },
  };
}

export function redoHistory(history: EditorHistoryState): EditorHistoryState {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  const nextSeq = (history.lastTransition?.seq ?? 0) + 1;
  return {
    past: [...history.past.slice(-(MAX_HISTORY_DEPTH - 1)), history.present],
    present: next,
    future: history.future.slice(1),
    lastTransition: { kind: 'redo', seq: nextSeq },
  };
}

export function isOutputElement(element: CellElement): boolean {
  return (
    element.kind === 'COIL' ||
    element.kind === 'TMR' ||
    element.kind === 'CNT' ||
    element.kind === 'MOV' ||
    element.kind === 'ALT' ||
    element.kind === 'ZRST' ||
    element.kind === 'CMP' ||
    element.kind === 'MATH' ||
    element.kind === 'SQR' ||
    element.kind === 'FLOAT_MOV' ||
    element.kind === 'FLOAT_MATH' ||
    element.kind === 'FLOAT_UNARY' ||
    element.kind === 'INCDEC' ||
    element.kind === 'TRD' ||
    element.kind === 'TWR' ||
    element.kind === 'TZCP'
  );
}

export function isLogicElement(element: CellElement): boolean {
  return element.kind === 'CONTACT' || element.kind === 'COMPARE' || element.kind === 'EDGE';
}

export function extractPrimaryAddress(element: CellElement): string | null {
  switch (element.kind) {
    case 'CONTACT':
    case 'COIL':
    case 'TMR':
    case 'CNT':
      return element.address.toUpperCase();
    case 'MOV':
    case 'CMP':
    case 'MATH':
    case 'SQR':
    case 'FLOAT_MOV':
    case 'FLOAT_MATH':
    case 'FLOAT_UNARY':
    case 'TRD':
    case 'TZCP':
      return element.destination.toUpperCase();
    case 'TWR':
      return element.source.toUpperCase();
    case 'ALT':
    case 'INCDEC':
      return element.target.toUpperCase();
    case 'ZRST':
      return element.start.toUpperCase();
    case 'COMPARE':
      return element.operandA.toUpperCase();
    case 'STL':
      return element.address.toUpperCase();
    default:
      return null;
  }
}

export function cloneRung(rung: LadderRung): LadderRung {
  return {
    ...rung,
    rows: rung.rows.map((row) =>
      row.map((cell) => ({
        branchDown: cell.branchDown,
        element: { ...cell.element },
      }))
    ),
  };
}

/**
 * Places a validated CellElement at (rungIndex, rowIndex, colIndex), automatically bridging
 * empty logic columns with HLINE when placing an output element in column 8.
 */
export function placeElementOnProgram(
  program: LadderProgram,
  pos: CursorPosition,
  element: CellElement,
  deviceComment?: string
): LadderProgram {
  const targetRung = program.rungs[pos.rungIndex];
  if (!targetRung || targetRung.isEnd) return program;

  const targetCol = isOutputElement(element) ? LADDER_COIL_COLUMN : pos.colIndex;
  const rungs = program.rungs.map((rung, rIdx) => {
    if (rIdx !== pos.rungIndex) return rung;
    const cloned = cloneRung(rung);
    while (cloned.rows.length <= pos.rowIndex) {
      cloned.rows.push(createEmptyRow(LADDER_TOTAL_COLUMNS));
    }
    cloned.rows[pos.rowIndex][targetCol] = {
      ...cloned.rows[pos.rowIndex][targetCol],
      element,
    };

    if (isOutputElement(element)) {
      let lastLogicCol = -1;
      for (let c = 0; c < LADDER_COIL_COLUMN; c += 1) {
        if (cloned.rows[pos.rowIndex][c].element.kind !== 'EMPTY') {
          lastLogicCol = c;
        }
      }
      if (lastLogicCol >= 0) {
        for (let c = lastLogicCol + 1; c < LADDER_COIL_COLUMN; c += 1) {
          if (cloned.rows[pos.rowIndex][c].element.kind === 'EMPTY') {
            cloned.rows[pos.rowIndex][c].element = { kind: 'HLINE' };
          }
        }
      }
    }
    return cloned;
  });

  const nextComments = { ...program.deviceComments };
  const primaryAddr = extractPrimaryAddress(element);
  if (primaryAddr && deviceComment !== undefined) {
    const trimmed = deviceComment.trim();
    if (trimmed) nextComments[primaryAddr] = trimmed;
    else delete nextComments[primaryAddr];
  }

  return {
    ...program,
    rungs,
    deviceComments: nextComments,
  };
}

export function deleteCellOnProgram(
  program: LadderProgram,
  pos: CursorPosition
): LadderProgram {
  const targetRung = program.rungs[pos.rungIndex];
  if (!targetRung || targetRung.isEnd) return program;

  const rungs = program.rungs.map((rung, rIdx) => {
    if (rIdx !== pos.rungIndex) return rung;
    const cloned = cloneRung(rung);
    if (!cloned.rows[pos.rowIndex]) return cloned;
    cloned.rows[pos.rowIndex][pos.colIndex] = {
      ...cloned.rows[pos.rowIndex][pos.colIndex],
      element: { kind: 'EMPTY' },
    };
    while (
      cloned.rows.length > 1 &&
      cloned.rows[cloned.rows.length - 1].every(
        (c) => c.element.kind === 'EMPTY' && !c.branchDown
      )
    ) {
      const removedRowIdx = cloned.rows.length - 1;
      cloned.rows.pop();
      cloned.rows[removedRowIdx - 1].forEach((c) => {
        c.branchDown = false;
      });
    }
    return cloned;
  });

  return { ...program, rungs };
}

export function toggleBranchDownOnProgram(
  program: LadderProgram,
  pos: CursorPosition
): LadderProgram {
  const targetRung = program.rungs[pos.rungIndex];
  if (!targetRung || targetRung.isEnd || pos.colIndex >= LADDER_COIL_COLUMN) {
    return program;
  }

  const rungs = program.rungs.map((rung, rIdx) => {
    if (rIdx !== pos.rungIndex) return rung;
    const cloned = cloneRung(rung);
    const currentVal = cloned.rows[pos.rowIndex]?.[pos.colIndex]?.branchDown ?? false;
    const nextVal = !currentVal;

    if (nextVal && pos.rowIndex + 1 >= cloned.rows.length) {
      cloned.rows.push(createEmptyRow(LADDER_TOTAL_COLUMNS));
    }
    cloned.rows[pos.rowIndex][pos.colIndex] = {
      ...cloned.rows[pos.rowIndex][pos.colIndex],
      branchDown: nextVal,
    };
    return cloned;
  });

  return { ...program, rungs };
}

export function insertRungOnProgram(
  program: LadderProgram,
  afterRungIndex: number
): { program: LadderProgram; newRungIndex: number } {
  const endIndex = program.rungs.findIndex((r) => r.isEnd);
  const insertAt =
    endIndex === -1
      ? program.rungs.length
      : Math.min(afterRungIndex + 1, endIndex);
  const nextRungs = [...program.rungs];
  nextRungs.splice(insertAt, 0, createEmptyRung());
  return {
    program: { ...program, rungs: nextRungs },
    newRungIndex: insertAt,
  };
}

export function deleteRungOnProgram(
  program: LadderProgram,
  rungIndex: number
): { program: LadderProgram; nextRungIndex: number } {
  const target = program.rungs[rungIndex];
  if (!target || target.isEnd) {
    return { program, nextRungIndex: rungIndex };
  }

  const editableCount = program.rungs.filter((r) => !r.isEnd).length;
  if (editableCount <= 1) {
    const nextRungs = program.rungs.map((r, idx) =>
      idx === rungIndex ? createEmptyRung() : r
    );
    return { program: { ...program, rungs: nextRungs }, nextRungIndex: rungIndex };
  }

  const nextRungs = program.rungs.filter((_, idx) => idx !== rungIndex);
  const nextIdx = Math.max(0, Math.min(rungIndex, nextRungs.length - 2));
  return { program: { ...program, rungs: nextRungs }, nextRungIndex: nextIdx };
}

export function setRungCommentOnProgram(
  program: LadderProgram,
  rungIndex: number,
  comment: string
): LadderProgram {
  const target = program.rungs[rungIndex];
  if (!target || target.isEnd) return program;
  const trimmed = comment.trim();
  const nextRungs = program.rungs.map((r, idx) =>
    idx === rungIndex ? { ...r, comment: trimmed || undefined } : r
  );
  return { ...program, rungs: nextRungs };
}

export function setDeviceCommentOnProgram(
  program: LadderProgram,
  address: string,
  comment: string
): LadderProgram {
  const key = address.trim().toUpperCase();
  if (!key) return program;
  const trimmed = comment.trim();
  const nextComments = { ...program.deviceComments };
  if (trimmed) nextComments[key] = trimmed;
  else delete nextComments[key];
  return { ...program, deviceComments: nextComments };
}

export interface QuickCommandApplyResult {
  ok: true;
  program: LadderProgram;
  nextCursor: CursorPosition;
  parsed: QuickCommandSuccess;
}

export interface QuickCommandApplyError {
  ok: false;
  error: string;
}

function hasContinuousPathToColumn(
  rung: LadderRung,
  rowIndex: number,
  targetCol: number
): boolean {
  if (targetCol === 0) return true;
  const row = rung.rows[rowIndex];
  if (!row) return false;

  // Check if the left edge of targetCol is fed either by a continuous horizontal chain
  // from col 0 on this row, or by a vertical branchDown descending into (rowIndex, targetCol)
  let col = targetCol - 1;
  while (col >= 0) {
    // Vertical branch feeding into left boundary of (col + 1) from rowIndex - 1
    if (rowIndex > 0 && rung.rows[rowIndex - 1]?.[col]?.branchDown) {
      return hasContinuousPathToColumn(rung, rowIndex - 1, col + 1);
    }
    const cell = row[col];
    if (!cell) return false;
    if (
      cell.element.kind !== 'CONTACT' &&
      cell.element.kind !== 'COMPARE' &&
      cell.element.kind !== 'HLINE'
    ) {
      return false;
    }
    col -= 1;
  }
  return true;
}

/**
 * Pure Quick-Command executor (LD X0, OR Y0, ANI X1, OUT Y0, TMR T0 K50...).
 * Enforces strict parallel OR/ORI/ORP/ORF/OR-compare rules:
 * - Never silently converts OR into LD on an empty rung or invalid column.
 * - Preserves LD X0 -> OR Y0 -> ANI X1 -> OUT Y0 and multi-column parallel branches.
 * - Never overwrites occupied cells when creating parallel branches.
 */
export function applyQuickCommandOnProgram(
  program: LadderProgram,
  cursor: CursorPosition,
  rawInput: string
): QuickCommandApplyResult | QuickCommandApplyError {
  const parsed = parseQuickCommand(rawInput, program.model);
  if (!parsed.valid) {
    return { ok: false, error: parsed.error };
  }

  let targetRungIdx = cursor.rungIndex;
  let targetRowIdx = cursor.rowIndex;
  let targetColIdx =
    parsed.targetScope === 'output'
      ? LADDER_COIL_COLUMN
      : Math.min(cursor.colIndex, LADDER_COIL_COLUMN - 1);

  const existingRung = program.rungs[targetRungIdx];
  if (!existingRung || existingRung.isEnd) {
    const editableIdx = program.rungs.findIndex((r) => !r.isEnd);
    targetRungIdx = editableIdx >= 0 ? editableIdx : 0;
    targetRowIdx = 0;
    targetColIdx = parsed.targetScope === 'output' ? LADDER_COIL_COLUMN : 0;
  }

  const baseRung = program.rungs[targetRungIdx];
  if (!baseRung || baseRung.isEnd) {
    return { ok: false, error: 'Düzenlenebilir Ladder ağı bulunamadı.' };
  }

  // STL Sn / RET: kendi başlık ağına yazılır; ardından adım gövdesi için boş bir ağa geçilir.
  if (parsed.element.kind === 'STL' || parsed.element.kind === 'RET') {
    const rungs = program.rungs.map((r) => cloneRung(r));
    const isBlank = (r: LadderRung) =>
      !r.isEnd && r.rows.every((row) => row.every((c) => c.element.kind === 'EMPTY' && !c.branchDown));
    let headerIdx = targetRungIdx;
    if (!isBlank(rungs[headerIdx])) {
      headerIdx += 1;
      rungs.splice(headerIdx, 0, createEmptyRung(LADDER_TOTAL_COLUMNS));
    }
    const headerRow = createEmptyRow(LADDER_TOTAL_COLUMNS);
    headerRow[0] = { branchDown: false, element: parsed.element };
    rungs[headerIdx] = { ...rungs[headerIdx], rows: [headerRow] };
    if (!rungs[headerIdx + 1] || !isBlank(rungs[headerIdx + 1])) {
      rungs.splice(headerIdx + 1, 0, createEmptyRung(LADDER_TOTAL_COLUMNS));
    }
    return {
      ok: true,
      program: { ...program, rungs },
      nextCursor: { rungIndex: headerIdx + 1, rowIndex: 0, colIndex: 0 },
      parsed,
    };
  }

  if (getStepHeader(baseRung)) {
    return {
      ok: false,
      error: 'Bu ağ bir adım başlığıdır (STL/RET). Komutları alttaki ağa yazın.',
    };
  }

  // Strict validation BEFORE mutating rungs when placing a parallel OR command
  if (parsed.isParallelOr && parsed.targetScope === 'logic') {
    const opcodeLabel = parsed.summary.split(' ')[0] ?? 'OR';
    const hasAnyLogicInRung = baseRung.rows.some((r) =>
      r.slice(0, LADDER_COIL_COLUMN).some((c) => isLogicElement(c.element))
    );
    if (!hasAnyLogicInRung) {
      return {
        ok: false,
        error: `${opcodeLabel} komutu boş bir ağda kullanılamaz. Önce bir LD / LDI / LDP / LDF kontağı ekleyin (Örn: LD X0).`,
      };
    }

    const row = baseRung.rows[targetRowIdx];
    if (!row) {
      return {
        ok: false,
        error: `${opcodeLabel} komutu için geçerli bir üst satır bulunamadı.`,
      };
    }

    let anchorCol = targetColIdx;
    const curCell = row[anchorCol];
    // If cursor auto-advanced to an empty cell immediately right of a logic contact, anchor under anchorCol - 1
    if (
      curCell &&
      curCell.element.kind === 'EMPTY' &&
      anchorCol > 0 &&
      isLogicElement(row[anchorCol - 1].element)
    ) {
      anchorCol -= 1;
    }

    const anchorCell = row[anchorCol];
    if (!anchorCell || !isLogicElement(anchorCell.element)) {
      return {
        ok: false,
        error: `${opcodeLabel} komutu için geçerli bir üst kontak bulunamadı (Sütun ${targetColIdx}). İmleci paralel bağlanacak kontağın üzerine veya hemen sağına getirin.`,
      };
    }

    // Ensure there is an unbroken LD/AND path from the left rail to anchorCol
    if (!hasContinuousPathToColumn(baseRung, targetRowIdx, anchorCol)) {
      return {
        ok: false,
        error: `${opcodeLabel} komutu Sütun ${anchorCol} konumunda kullanılamaz; sol güç hattından (LD) kesintisiz bir kontak zinciri bulunmalıdır.`,
      };
    }

    const cloned = cloneRung(baseRung);

    // Find the first empty row below targetRowIdx at anchorCol (never overwriting occupied cells)
    let destRow = targetRowIdx + 1;
    while (
      destRow < cloned.rows.length &&
      cloned.rows[destRow][anchorCol].element.kind !== 'EMPTY'
    ) {
      destRow += 1;
    }

    // For anchorCol > 0, guard against accidentally short-circuiting an unrelated series branch on anchorCol - 1
    if (anchorCol > 0) {
      for (let r = targetRowIdx + 1; r <= destRow; r += 1) {
        const leftNeighbor = cloned.rows[r]?.[anchorCol - 1];
        const upperLeftBranch = cloned.rows[r - 1]?.[anchorCol - 1]?.branchDown ?? false;
        if (
          leftNeighbor &&
          leftNeighbor.element.kind !== 'EMPTY' &&
          !upperLeftBranch
        ) {
          return {
            ok: false,
            error: `${opcodeLabel} komutu Sütun ${anchorCol} konumunda mevcut alt dal ile çakışıyor. Paralel dalı ayrı bir kolda veya uygun sütunda oluşturun.`,
          };
        }
      }
    }

    while (cloned.rows.length <= destRow) {
      cloned.rows.push(createEmptyRow(LADDER_TOTAL_COLUMNS));
    }

    // Connect vertical rails cleanly down to destRow
    for (let r = targetRowIdx; r < destRow; r += 1) {
      cloned.rows[r][anchorCol] = {
        ...cloned.rows[r][anchorCol],
        branchDown: true,
      };
      if (anchorCol > 0) {
        cloned.rows[r][anchorCol - 1] = {
          ...cloned.rows[r][anchorCol - 1],
          branchDown: true,
        };
      }
    }

    cloned.rows[destRow][anchorCol] = {
      ...cloned.rows[destRow][anchorCol],
      element: parsed.element,
    };

    const updatedRungs = program.rungs.map((r, idx) =>
      idx === targetRungIdx ? cloned : r
    );

    const nextCursor: CursorPosition = {
      rungIndex: targetRungIdx,
      rowIndex: targetRowIdx,
      colIndex: Math.min(anchorCol + 1, LADDER_COIL_COLUMN - 1),
    };

    return {
      ok: true,
      program: {
        ...program,
        rungs: updatedRungs,
      },
      nextCursor,
      parsed,
    };
  }

  // Prevent accidentally overwriting an already occupied cell at the rightmost logic column
  const existingRow = baseRung.rows[targetRowIdx];
  if (
    parsed.targetScope === 'logic' &&
    targetColIdx === LADDER_COIL_COLUMN - 1 &&
    existingRow &&
    existingRow[targetColIdx] &&
    existingRow[targetColIdx].element.kind !== 'EMPTY' &&
    existingRow[targetColIdx].element.kind !== 'HLINE'
  ) {
    return {
      ok: false,
      error: `Sütun ${targetColIdx} zaten dolu. Mevcut elemanı değiştirmek için hücreye dokunarak düzenleyin veya yeni ağ ekleyin.`,
    };
  }

  let nextCursor: CursorPosition = {
    rungIndex: targetRungIdx,
    rowIndex: targetRowIdx,
    colIndex: targetColIdx,
  };

  let createdNextRung = false;

  const updatedRungs = program.rungs.map((rung, rIdx) => {
    if (rIdx !== targetRungIdx) return rung;
    const cloned = cloneRung(rung);
    while (cloned.rows.length <= targetRowIdx) {
      cloned.rows.push(createEmptyRow(LADDER_TOTAL_COLUMNS));
    }

    // Standard placement (LD / LDI / LDP / LDF / AND / ANI / ANDP / ANDF / Compare / Outputs)
    cloned.rows[targetRowIdx][targetColIdx] = {
      ...cloned.rows[targetRowIdx][targetColIdx],
      element: parsed.element,
    };

    if (parsed.targetScope === 'output') {
      let lastLogicCol = -1;
      for (let c = 0; c < LADDER_COIL_COLUMN; c += 1) {
        if (cloned.rows[targetRowIdx][c].element.kind !== 'EMPTY') {
          lastLogicCol = c;
        }
      }
      if (lastLogicCol >= 0) {
        for (let c = lastLogicCol + 1; c < LADDER_COIL_COLUMN; c += 1) {
          if (cloned.rows[targetRowIdx][c].element.kind === 'EMPTY') {
            cloned.rows[targetRowIdx][c].element = { kind: 'HLINE' };
          }
        }
      }

      const nextRungCandidate = program.rungs[targetRungIdx + 1];
      if (nextRungCandidate && !nextRungCandidate.isEnd) {
        nextCursor = {
          rungIndex: targetRungIdx + 1,
          rowIndex: 0,
          colIndex: 0,
        };
      } else {
        createdNextRung = true;
        nextCursor = {
          rungIndex: targetRungIdx + 1,
          rowIndex: 0,
          colIndex: 0,
        };
      }
    } else {
      nextCursor = {
        rungIndex: targetRungIdx,
        rowIndex: targetRowIdx,
        colIndex: Math.min(targetColIdx + 1, LADDER_COIL_COLUMN - 1),
      };
    }

    return cloned;
  });

  if (createdNextRung) {
    const endIdx = updatedRungs.findIndex((r) => r.isEnd);
    const insertAt = endIdx === -1 ? updatedRungs.length : endIdx;
    updatedRungs.splice(insertAt, 0, createEmptyRung());
    nextCursor = { rungIndex: insertAt, rowIndex: 0, colIndex: 0 };
  }

  return {
    ok: true,
    program: {
      ...program,
      rungs: updatedRungs,
    },
    nextCursor,
    parsed,
  };
}

// ============================================================================
// Search & Used-Address Cross-Reference Analyzer
// ============================================================================

export interface LadderSearchMatch {
  rungIndex: number;
  rowIndex: number;
  colIndex: number;
  summary: string;
  address?: string;
  matchType: 'element' | 'rung_comment' | 'device_comment';
}

export interface AddressUsageLocation {
  rungIndex: number;
  rowIndex: number;
  colIndex: number;
  role: 'read' | 'write';
  opcodeLabel: string;
}

export interface AddressCrossRefEntry {
  address: string;
  prefix: DevicePrefix;
  numericSortKey: number;
  comment?: string;
  totalCount: number;
  readCount: number;
  writeCount: number;
  locations: AddressUsageLocation[];
}

export function describeCellElement(el: CellElement): string {
  switch (el.kind) {
    case 'CONTACT': {
      const tag =
        el.contactType === 'NO'
          ? 'LD'
          : el.contactType === 'NC'
            ? 'LDI'
            : el.contactType === 'RISING'
              ? 'LDP'
              : 'LDF';
      return `${tag} ${el.address}`;
    }
    case 'COMPARE':
      return `${el.operator} ${el.operandA} ${el.operandB}`;
    case 'COIL':
      return `${el.coilType} ${el.address}`;
    case 'TMR':
      return `TMR ${el.address} ${el.preset}`;
    case 'CNT':
      return `CNT ${el.address} ${el.preset}`;
    case 'MOV':
      return `MOV ${el.source} ${el.destination}`;
    case 'ALT':
      return `${el.pulsed ? 'ALTP' : 'ALT'} ${el.target}`;
    case 'ZRST':
      return `ZRST ${el.start} ${el.end}`;
    case 'CMP':
      return `CMP ${el.source1} ${el.source2} ${el.destination}`;
    case 'MATH':
      return `${el.operator} ${el.source1} ${el.source2} ${el.destination}`;
    case 'SQR':
      return `SQR ${el.source} ${el.destination}`;
    case 'FLOAT_MOV':
      return `DMOVR ${el.source} ${el.destination}`;
    case 'FLOAT_MATH':
      return `${el.operator} ${el.source1} ${el.source2} ${el.destination}`;
    case 'FLOAT_UNARY':
      return `${el.operator} ${el.source} ${el.destination}`;
    case 'INCDEC':
      return `${el.operator} ${el.target}`;
    case 'TRD':
      return `TRD ${el.destination}`;
    case 'TWR':
      return `${el.pulsed ? 'TWRP' : 'TWR'} ${el.source}`;
    case 'TZCP':
      return `TZCP ${el.start1} ${el.start2} ${el.current} ${el.destination}`;
    case 'HLINE':
      return 'HLINE';
    case 'EDGE':
      return el.edge;
    case 'STL':
      return `STL ${el.address}`;
    case 'RET':
      return 'RET';
    case 'END':
      return 'END';
    default:
      return '';
  }
}

function collectCellReferences(
  cell: LadderCellData
): { address: string; role: 'read' | 'write'; opcodeLabel: string }[] {
  const el = cell.element;
  const refs: { address: string; role: 'read' | 'write'; opcodeLabel: string }[] = [];

  const addIfDevice = (addr: string | undefined, role: 'read' | 'write', opcodeLabel: string) => {
    if (!addr) return;
    const norm = addr.trim().toUpperCase();
    if (!norm || norm.startsWith('K') || norm.startsWith('F')) return;
    refs.push({ address: norm, role, opcodeLabel });
  };

  switch (el.kind) {
    case 'CONTACT':
      addIfDevice(el.address, 'read', el.contactType);
      break;
    case 'STL':
      addIfDevice(el.address, 'read', 'STL');
      break;
    case 'COMPARE':
      addIfDevice(el.operandA, 'read', `CMP(${el.operator})`);
      addIfDevice(el.operandB, 'read', `CMP(${el.operator})`);
      break;
    case 'COIL':
      addIfDevice(el.address, 'write', el.coilType);
      break;
    case 'TMR':
      addIfDevice(el.address, 'write', 'TMR');
      addIfDevice(el.preset, 'read', 'TMR');
      break;
    case 'CNT':
      addIfDevice(el.address, 'write', 'CNT');
      addIfDevice(el.preset, 'read', 'CNT');
      break;
    case 'MOV':
      addIfDevice(el.source, 'read', 'MOV');
      addIfDevice(el.destination, 'write', 'MOV');
      break;
    case 'ALT':
      addIfDevice(el.target, 'write', el.pulsed ? 'ALTP' : 'ALT');
      break;
    case 'ZRST':
      addIfDevice(el.start, 'write', 'ZRST');
      addIfDevice(el.end, 'write', 'ZRST');
      break;
    case 'CMP': {
      addIfDevice(el.source1, 'read', 'CMP');
      addIfDevice(el.source2, 'read', 'CMP');
      addIfDevice(el.destination, 'write', 'CMP(>)');
      const d1 = offsetDeviceAddress(el.destination, 1);
      const d2 = offsetDeviceAddress(el.destination, 2);
      if (d1) addIfDevice(d1, 'write', 'CMP(=)');
      if (d2) addIfDevice(d2, 'write', 'CMP(<)');
      break;
    }
    case 'MATH':
      addIfDevice(el.source1, 'read', el.operator);
      addIfDevice(el.source2, 'read', el.operator);
      addIfDevice(el.destination, 'write', el.operator);
      break;
    case 'SQR':
      addIfDevice(el.source, 'read', 'SQR');
      addIfDevice(el.destination, 'write', 'SQR');
      break;
    case 'FLOAT_MOV':
      addIfDevice(el.source, 'read', 'DMOVR');
      addIfDevice(el.destination, 'write', 'DMOVR');
      break;
    case 'FLOAT_MATH':
      addIfDevice(el.source1, 'read', el.operator);
      addIfDevice(el.source2, 'read', el.operator);
      addIfDevice(el.destination, 'write', el.operator);
      break;
    case 'FLOAT_UNARY':
      addIfDevice(el.source, 'read', el.operator);
      addIfDevice(el.destination, 'write', el.operator);
      break;
    case 'INCDEC':
      addIfDevice(el.target, 'write', el.operator);
      break;
    case 'TRD':
      addIfDevice(el.destination, 'write', 'TRD');
      break;
    case 'TWR':
      addIfDevice(el.source, 'read', el.pulsed ? 'TWRP' : 'TWR');
      break;
    case 'TZCP': {
      addIfDevice(el.start1, 'read', 'TZCP');
      addIfDevice(el.start2, 'read', 'TZCP');
      addIfDevice(el.current, 'read', 'TZCP');
      addIfDevice(el.destination, 'write', 'TZCP(<)');
      const d1 = offsetDeviceAddress(el.destination, 1);
      const d2 = offsetDeviceAddress(el.destination, 2);
      if (d1) addIfDevice(d1, 'write', 'TZCP(=)');
      if (d2) addIfDevice(d2, 'write', 'TZCP(>)');
      break;
    }
    default:
      break;
  }

  return refs;
}

const PREFIX_ORDER: Record<DevicePrefix, number> = {
  X: 0,
  Y: 1,
  M: 2,
  S: 3,
  T: 4,
  C: 5,
  D: 6,
  K: 7,
  F: 8,
};

function addressSortNumber(address: string): number {
  const prefix = address[0];
  const rest = address.slice(1);
  if (prefix === 'X' || prefix === 'Y') {
    const val = Number.parseInt(rest, 8);
    return Number.isNaN(val) ? 999999 : val;
  }
  const val = Number.parseInt(rest, 10);
  return Number.isNaN(val) ? 999999 : val;
}

export function buildAddressCrossReference(program: LadderProgram): AddressCrossRefEntry[] {
  const map = new Map<string, AddressCrossRefEntry>();

  program.rungs.forEach((rung, rungIndex) => {
    if (rung.isEnd) return;
    rung.rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const refs = collectCellReferences(cell);
        for (const ref of refs) {
          const prefix = ref.address[0] as DevicePrefix;
          let entry = map.get(ref.address);
          if (!entry) {
            entry = {
              address: ref.address,
              prefix,
              numericSortKey: addressSortNumber(ref.address),
              comment: program.deviceComments[ref.address],
              totalCount: 0,
              readCount: 0,
              writeCount: 0,
              locations: [],
            };
            map.set(ref.address, entry);
          }
          entry.totalCount += 1;
          if (ref.role === 'read') entry.readCount += 1;
          else entry.writeCount += 1;
          entry.locations.push({
            rungIndex,
            rowIndex,
            colIndex,
            role: ref.role,
            opcodeLabel: ref.opcodeLabel,
          });
        }
      });
    });
  });

  // Also include commented devices that aren't currently placed on the grid
  for (const [addr, comment] of Object.entries(program.deviceComments)) {
    const norm = addr.trim().toUpperCase();
    if (!norm || map.has(norm) || !comment.trim()) continue;
    const prefix = norm[0] as DevicePrefix;
    if (!(prefix in PREFIX_ORDER)) continue;
    map.set(norm, {
      address: norm,
      prefix,
      numericSortKey: addressSortNumber(norm),
      comment: comment.trim(),
      totalCount: 0,
      readCount: 0,
      writeCount: 0,
      locations: [],
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    const pDiff = (PREFIX_ORDER[a.prefix] ?? 9) - (PREFIX_ORDER[b.prefix] ?? 9);
    if (pDiff !== 0) return pDiff;
    return a.numericSortKey - b.numericSortKey;
  });
}

export function searchLadderProgram(
  program: LadderProgram,
  rawQuery: string
): LadderSearchMatch[] {
  const query = rawQuery.trim().toLocaleLowerCase('tr-TR');
  if (!query) return [];

  const matches: LadderSearchMatch[] = [];

  program.rungs.forEach((rung, rungIndex) => {
    if (rung.isEnd) return;

    if (rung.comment && rung.comment.toLocaleLowerCase('tr-TR').includes(query)) {
      matches.push({
        rungIndex,
        rowIndex: 0,
        colIndex: 0,
        summary: `Ağ Başlığı: ${rung.comment}`,
        matchType: 'rung_comment',
      });
    }

    rung.rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (cell.element.kind === 'EMPTY' || cell.element.kind === 'HLINE') return;
        const summary = describeCellElement(cell.element);
        const primaryAddr = extractPrimaryAddress(cell.element) ?? undefined;
        const devComment = primaryAddr ? program.deviceComments[primaryAddr] : undefined;

        if (summary.toLocaleLowerCase('tr-TR').includes(query)) {
          matches.push({
            rungIndex,
            rowIndex,
            colIndex,
            summary,
            address: primaryAddr,
            matchType: 'element',
          });
        } else if (devComment && devComment.toLocaleLowerCase('tr-TR').includes(query)) {
          matches.push({
            rungIndex,
            rowIndex,
            colIndex,
            summary: `${summary} (${devComment})`,
            address: primaryAddr,
            matchType: 'device_comment',
          });
        }
      });
    });
  });

  return matches;
}
