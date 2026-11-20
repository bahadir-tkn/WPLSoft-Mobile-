import type {
  LadderCellData,
  LadderProgram,
  LadderRung,
  PlcModelId,
} from '../types/plc';
import {
  DEFAULT_EMPTY_RUNG_COUNT,
  LADDER_COIL_COLUMN,
  LADDER_TOTAL_COLUMNS,
} from './plcModels';

let rungIdCounter = 1;
const SESSION_RUNG_PREFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function generateUniqueRungId(existingIds?: ReadonlySet<string>): string {
  let candidate = `rung-${SESSION_RUNG_PREFIX}-${rungIdCounter++}`;
  while (existingIds && existingIds.has(candidate)) {
    candidate = `rung-${SESSION_RUNG_PREFIX}-${rungIdCounter++}`;
  }
  return candidate;
}

export function deduplicateRungIds(rungs: LadderRung[]): LadderRung[] {
  const seen = new Set<string>();
  let changed = false;

  const result = rungs.map((rung) => {
    const rawId = typeof rung.id === 'string' ? rung.id.trim() : '';
    const preferredId = rawId || (rung.isEnd ? 'rung-end' : generateUniqueRungId(seen));
    if (!seen.has(preferredId)) {
      seen.add(preferredId);
      if (preferredId === rung.id) {
        return rung;
      }
      changed = true;
      return { ...rung, id: preferredId };
    }
    changed = true;
    const uniqueId = generateUniqueRungId(seen);
    seen.add(uniqueId);
    return { ...rung, id: uniqueId };
  });

  return changed ? result : rungs;
}

export function createEmptyCell(): LadderCellData {
  return {
    element: { kind: 'EMPTY' },
    branchDown: false,
  };
}

export function createEmptyRow(columns = LADDER_TOTAL_COLUMNS): LadderCellData[] {
  return Array.from({ length: columns }, () => createEmptyCell());
}

export function createEmptyRung(
  columns = LADDER_TOTAL_COLUMNS,
  id?: string
): LadderRung {
  const generatedId = id ?? generateUniqueRungId();
  return {
    id: generatedId,
    rows: [createEmptyRow(columns)],
  };
}

export function createEndRung(columns = LADDER_TOTAL_COLUMNS): LadderRung {
  const row = createEmptyRow(columns);
  for (let c = 0; c < LADDER_COIL_COLUMN; c += 1) {
    row[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  row[LADDER_COIL_COLUMN] = {
    element: { kind: 'END' },
    branchDown: false,
  };

  return {
    id: 'rung-end',
    rows: [row],
    isEnd: true,
  };
}

export function createBlankProgram(
  model: PlcModelId = 'DVP-SX2',
  projectName = 'Yeni_Proje_SX2',
  emptyRungCount = DEFAULT_EMPTY_RUNG_COUNT
): LadderProgram {
  const rungs: LadderRung[] = [];
  for (let i = 0; i < emptyRungCount; i += 1) {
    rungs.push(createEmptyRung(LADDER_TOTAL_COLUMNS, `rung-init-${i}`));
  }
  rungs.push(createEndRung(LADDER_TOTAL_COLUMNS));

  return {
    version: '1.0',
    model,
    projectName,
    columns: LADDER_TOTAL_COLUMNS,
    rungs,
    deviceComments: {},
    updatedAt: new Date().toISOString(),
  };
}

export function insertRungAfter(
  program: LadderProgram,
  afterRungIndex: number
): { program: LadderProgram; insertedIndex: number } {
  const endIndex = program.rungs.findIndex((r) => r.isEnd);
  const safeInsertIndex =
    endIndex === -1
      ? Math.min(afterRungIndex + 1, program.rungs.length)
      : Math.min(afterRungIndex + 1, endIndex);

  const nextRungs = [...program.rungs];
  nextRungs.splice(safeInsertIndex, 0, createEmptyRung(program.columns));

  return {
    insertedIndex: safeInsertIndex,
    program: {
      ...program,
      rungs: nextRungs,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function deleteRungAt(
  program: LadderProgram,
  rungIndex: number
): { program: LadderProgram; nextRungIndex: number; deleted: boolean } {
  const target = program.rungs[rungIndex];
  if (!target || target.isEnd) {
    return { program, nextRungIndex: rungIndex, deleted: false };
  }

  const editableCount = program.rungs.filter((r) => !r.isEnd).length;
  if (editableCount <= 1) {
    return { program, nextRungIndex: rungIndex, deleted: false };
  }

  const nextRungs = program.rungs.filter((_, idx) => idx !== rungIndex);
  const maxEditableIndex = nextRungs.filter((r) => !r.isEnd).length - 1;
  const clampedIndex = Math.max(0, Math.min(rungIndex, maxEditableIndex));

  return {
    deleted: true,
    nextRungIndex: clampedIndex,
    program: {
      ...program,
      rungs: nextRungs,
      updatedAt: new Date().toISOString(),
    },
  };
}
