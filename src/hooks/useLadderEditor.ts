import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CellElement,
  CursorPosition,
  FunctionToolId,
  LadderProgram,
  LadderRung,
  PlcModelId,
} from '../types/plc';
import {
  createBlankProgram,
  createEmptyCell,
  createEmptyRow,
  deleteRungAt,
  insertRungAfter,
} from '../core/gridFactory';
import { compileLadderToIl } from '../core/ilCompiler';
import { isLogicElement, isOutputElement } from '../core/ast';
import {
  applyQuickCommandOnProgram,
  commitHistory,
  createInitialHistory,
  redoHistory,
  setDeviceCommentOnProgram,
  undoHistory,
  type EditorHistoryState,
} from '../core/ladderOperations';
import {
  DEFAULT_PLC_MODEL,
  LADDER_COIL_COLUMN,
  PLC_MODELS,
} from '../core/plcModels';
import { loadDraftFromStorage, saveDraftToStorage } from '../core/storage';

export interface EditModalState {
  position: CursorPosition;
  element: CellElement;
  isNewPlacement: boolean;
  /** Snapshot before tentative single-tap placement so Cancel reverts cleanly */
  previousProgram: LadderProgram | null;
}

export interface RecentCommandEntry {
  id: string;
  label: string;
  opcode: string;
  element?: CellElement;
  toolId?: FunctionToolId;
}

const MAX_RECENT_COMMANDS = 6;

function cloneRungs(rungs: LadderRung[]): LadderRung[] {
  return rungs.map((r) => ({
    ...r,
    rows: r.rows.map((row) =>
      row.map((cell) => ({
        branchDown: cell.branchDown,
        element: { ...cell.element },
      }))
    ),
  }));
}

function getPrimaryAddress(el: CellElement): string | null {
  switch (el.kind) {
    case 'CONTACT':
    case 'COIL':
    case 'TMR':
    case 'CNT':
      return el.address;
    case 'MOV':
    case 'CMP':
    case 'MATH':
    case 'TRD':
      return el.destination;
    case 'ALT':
    case 'INCDEC':
      return el.target;
    case 'ZRST':
      return el.start;
    case 'COMPARE':
      return el.operandA;
    default:
      return null;
  }
}

function createDefaultElementForTool(toolId: FunctionToolId): CellElement | null {
  switch (toolId) {
    case 'F1':
      return { kind: 'CONTACT', contactType: 'NO', address: 'X0' };
    case 'F2':
      return { kind: 'CONTACT', contactType: 'NC', address: 'X1' };
    case 'F3':
      return { kind: 'CONTACT', contactType: 'RISING', address: 'X0' };
    case 'F4':
      return { kind: 'CONTACT', contactType: 'FALLING', address: 'X0' };
    case 'F5':
      return { kind: 'COMPARE', operator: '=', operandA: 'D0', operandB: 'K10' };
    case 'F6':
      return { kind: 'TMR', address: 'T0', preset: 'K50' };
    case 'F7':
      return { kind: 'COIL', coilType: 'OUT', address: 'Y0' };
    case 'F8':
      return { kind: 'COIL', coilType: 'SET', address: 'M0' };
    default:
      return null;
  }
}

function pruneEmptyTrailingSubRows(rung: LadderRung): LadderRung {
  const rows = [...rung.rows];
  while (rows.length > 1) {
    const lastIdx = rows.length - 1;
    const lastRow = rows[lastIdx];
    const prevRow = rows[lastIdx - 1];
    const lastHasContent = lastRow.some(
      (c) => c.element.kind !== 'EMPTY' || c.branchDown
    );
    const prevDropsToLast = prevRow.some((c) => c.branchDown);
    if (!lastHasContent && !prevDropsToLast) {
      rows.pop();
    } else {
      break;
    }
  }
  return { ...rung, rows };
}

function autoBridgeRowToOutput(row: LadderRung['rows'][number]): void {
  const outCell = row[LADDER_COIL_COLUMN];
  if (!outCell || !isOutputElement(outCell.element)) return;

  let rightmostLogicCol = -1;
  for (let c = LADDER_COIL_COLUMN - 1; c >= 0; c -= 1) {
    if (isLogicElement(row[c].element)) {
      rightmostLogicCol = c;
      break;
    }
  }
  if (rightmostLogicCol >= 0) {
    for (let c = rightmostLogicCol + 1; c < LADDER_COIL_COLUMN; c += 1) {
      if (row[c].element.kind === 'EMPTY') {
        row[c] = { ...row[c], element: { kind: 'HLINE' } };
      }
    }
  }
}

export function useLadderEditor(
  onNotify: (message: string) => void,
  isLocked = false
) {
  const [history, setHistory] = useState<EditorHistoryState>(() =>
    createInitialHistory(
      loadDraftFromStorage() ??
        createBlankProgram(DEFAULT_PLC_MODEL, 'Yeni_Proje_SX2')
    )
  );
  const program = history.present;

  const [activeTool, setActiveTool] = useState<FunctionToolId>('F1');
  const [cursor, setCursor] = useState<CursorPosition>({
    rungIndex: 0,
    rowIndex: 0,
    colIndex: 0,
  });
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [recentCommands, setRecentCommands] = useState<RecentCommandEntry[]>([]);
  const lastNotifiedStorageErrRef = useRef<string | null>(null);

  const recordRecentCommand = useCallback((entry: RecentCommandEntry) => {
    setRecentCommands((prev) => {
      const filtered = prev.filter((item) => item.id !== entry.id);
      return [entry, ...filtered].slice(0, MAX_RECENT_COMMANDS);
    });
  }, []);

  // Auto-save confirmed working program draft to localStorage & notify user if storage fails
  useEffect(() => {
    if (editModal !== null) return;
    const res = saveDraftToStorage(program);
    if (!res.ok) {
      const msg = res.error ?? 'Otomatik taslak kaydedilemedi.';
      setStorageError(msg);
      if (lastNotifiedStorageErrRef.current !== msg) {
        lastNotifiedStorageErrRef.current = msg;
        onNotify(msg);
      }
    } else if (storageError !== null) {
      setStorageError(null);
      lastNotifiedStorageErrRef.current = null;
    }
  }, [editModal, onNotify, program, storageError]);

  const compileResult = useMemo(() => compileLadderToIl(program), [program]);

  const editableRungCount = useMemo(
    () => program.rungs.filter((r) => !r.isEnd).length,
    [program.rungs]
  );

  const commitProgram = useCallback((nextProgram: LadderProgram) => {
    setHistory((prev) => commitHistory(prev, () => nextProgram));
  }, []);

  const replacePresentWithoutHistory = useCallback((nextProgram: LadderProgram) => {
    setHistory((prev) => ({
      ...prev,
      present: nextProgram,
    }));
  }, []);

  const undo = useCallback(() => {
    if (isLocked) return;
    let didUndo = false;
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      didUndo = true;
      return undoHistory(prev);
    });
    if (didUndo) {
      onNotify('Son işlem geri alındı.');
    }
  }, [isLocked, onNotify]);

  const redo = useCallback(() => {
    if (isLocked) return;
    let didRedo = false;
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      didRedo = true;
      return redoHistory(prev);
    });
    if (didRedo) {
      onNotify('İşlem yeniden uygulandı.');
    }
  }, [isLocked, onNotify]);

  const setModel = useCallback(
    (nextModel: PlcModelId) => {
      if (isLocked) return;
      const nextSpec = PLC_MODELS[nextModel];
      commitProgram({
        ...program,
        model: nextModel,
        updatedAt: new Date().toISOString(),
      });
      onNotify(
        `PLC modeli ${nextSpec.label} olarak güncellendi (${nextSpec.onboardInputCount} DI / ${nextSpec.onboardOutputCount} DO).`
      );
    },
    [commitProgram, isLocked, onNotify, program]
  );

  const applyElementToProgram = useCallback(
    (
      baseProgram: LadderProgram,
      pos: CursorPosition,
      element: CellElement,
      comment?: string
    ): LadderProgram => {
      const rungs = cloneRungs(baseProgram.rungs);
      const rung = rungs[pos.rungIndex];
      if (!rung || rung.isEnd) return baseProgram;
      const row = rung.rows[pos.rowIndex];
      if (!row || !row[pos.colIndex]) return baseProgram;

      row[pos.colIndex] = {
        ...row[pos.colIndex],
        element,
      };

      if (pos.colIndex === LADDER_COIL_COLUMN && isOutputElement(element)) {
        autoBridgeRowToOutput(row);
        if (pos.rowIndex > 0) {
          const hasOwnLogic = row
            .slice(0, LADDER_COIL_COLUMN)
            .some((c) => isLogicElement(c.element));
          if (!hasOwnLogic) {
            const upperRow = rung.rows[pos.rowIndex - 1];
            if (upperRow && upperRow[LADDER_COIL_COLUMN - 1]) {
              upperRow[LADDER_COIL_COLUMN - 1] = {
                ...upperRow[LADDER_COIL_COLUMN - 1],
                branchDown: true,
              };
            }
          }
        }
      } else if (pos.colIndex < LADDER_COIL_COLUMN && isLogicElement(element)) {
        autoBridgeRowToOutput(row);
      }

      const nextComments = { ...baseProgram.deviceComments };
      const primaryAddr = getPrimaryAddress(element);
      if (primaryAddr && comment !== undefined) {
        const cleaned = comment.trim();
        if (cleaned) nextComments[primaryAddr] = cleaned;
        else delete nextComments[primaryAddr];
      }

      return {
        ...baseProgram,
        rungs,
        deviceComments: nextComments,
        updatedAt: new Date().toISOString(),
      };
    },
    []
  );

  const handleSaveModal = useCallback(
    (updatedElement: CellElement, comment: string) => {
      if (!editModal) return;
      const base = editModal.previousProgram ?? program;
      const nextProgram = applyElementToProgram(
        base,
        editModal.position,
        updatedElement,
        comment
      );

      setHistory((prev) => ({
        past: [...prev.past.slice(-39), base],
        present: nextProgram,
        future: [],
      }));
      setEditModal(null);

      if (
        editModal.isNewPlacement &&
        editModal.position.colIndex < LADDER_COIL_COLUMN - 1
      ) {
        setCursor({
          ...editModal.position,
          colIndex: editModal.position.colIndex + 1,
        });
      }
    },
    [applyElementToProgram, editModal, program]
  );

  const handleCancelModal = useCallback(() => {
    if (editModal?.isNewPlacement && editModal.previousProgram) {
      replacePresentWithoutHistory(editModal.previousProgram);
    }
    setEditModal(null);
  }, [editModal, replacePresentWithoutHistory]);

  const clearCellAt = useCallback(
    (pos: CursorPosition) => {
      const targetRung = program.rungs[pos.rungIndex];
      if (!targetRung || targetRung.isEnd) return;

      const rungs = cloneRungs(program.rungs);
      const rung = rungs[pos.rungIndex];
      if (!rung.rows[pos.rowIndex]?.[pos.colIndex]) return;

      rung.rows[pos.rowIndex][pos.colIndex] = createEmptyCell();
      rungs[pos.rungIndex] = pruneEmptyTrailingSubRows(rung);

      const safeRowIdx = Math.min(pos.rowIndex, rungs[pos.rungIndex].rows.length - 1);
      setCursor({ ...pos, rowIndex: safeRowIdx });

      commitProgram({
        ...program,
        rungs,
        updatedAt: new Date().toISOString(),
      });
      onNotify('Hücre temizlendi.');
    },
    [commitProgram, onNotify, program]
  );

  const handleDeleteFromModal = useCallback(() => {
    if (!editModal) return;
    const base = editModal.previousProgram ?? program;
    const rungs = cloneRungs(base.rungs);
    const rung = rungs[editModal.position.rungIndex];
    if (
      rung &&
      !rung.isEnd &&
      rung.rows[editModal.position.rowIndex]?.[editModal.position.colIndex]
    ) {
      rung.rows[editModal.position.rowIndex][editModal.position.colIndex] =
        createEmptyCell();
      rungs[editModal.position.rungIndex] = pruneEmptyTrailingSubRows(rung);
    }
    setHistory((prev) => ({
      past: [...prev.past.slice(-39), base],
      present: {
        ...base,
        rungs,
        updatedAt: new Date().toISOString(),
      },
      future: [],
    }));
    setEditModal(null);
    onNotify('Eleman silindi.');
  }, [editModal, onNotify, program]);

  const toggleHLineAt = useCallback(
    (pos: CursorPosition) => {
      if (pos.colIndex >= LADDER_COIL_COLUMN) {
        onNotify('Yatay hat (F9) yalnızca lojik sütunlarına (0–7) eklenebilir.');
        return;
      }
      const rungs = cloneRungs(program.rungs);
      const rung = rungs[pos.rungIndex];
      if (!rung || rung.isEnd) return;
      const cell = rung.rows[pos.rowIndex]?.[pos.colIndex];
      if (!cell) return;

      const nextKind = cell.element.kind === 'HLINE' ? 'EMPTY' : 'HLINE';
      cell.element = { kind: nextKind };

      commitProgram({
        ...program,
        rungs,
        updatedAt: new Date().toISOString(),
      });

      if (nextKind === 'HLINE' && pos.colIndex < LADDER_COIL_COLUMN - 1) {
        setCursor({ ...pos, colIndex: pos.colIndex + 1 });
      }
    },
    [commitProgram, onNotify, program]
  );

  const toggleBranchDownAt = useCallback(
    (pos: CursorPosition) => {
      if (pos.colIndex >= LADDER_COIL_COLUMN) {
        onNotify('Paralel kol (F10) lojik sütunlarının (0–7) sağ kenarına eklenir.');
        return;
      }
      const rungs = cloneRungs(program.rungs);
      const rung = rungs[pos.rungIndex];
      if (!rung || rung.isEnd) return;
      const cell = rung.rows[pos.rowIndex]?.[pos.colIndex];
      if (!cell) return;

      const nextBranch = !cell.branchDown;
      cell.branchDown = nextBranch;

      if (nextBranch && pos.rowIndex === rung.rows.length - 1) {
        rung.rows.push(createEmptyRow(program.columns));
      }

      rungs[pos.rungIndex] = pruneEmptyTrailingSubRows(rung);
      commitProgram({
        ...program,
        rungs,
        updatedAt: new Date().toISOString(),
      });

      if (nextBranch) {
        onNotify(
          `Ağ ${String(pos.rungIndex).padStart(3, '0')} Sütun ${pos.colIndex} için paralel kol (OR Branch) eklendi.`
        );
      } else {
        onNotify('Paralel kol bağlantısı kaldırıldı.');
      }
    },
    [commitProgram, onNotify, program]
  );

  const handleInsertRungAfter = useCallback(
    (rungIndex: number) => {
      if (isLocked) return;
      const result = insertRungAfter(program, rungIndex);
      commitProgram(result.program);
      setCursor({
        rungIndex: result.insertedIndex,
        rowIndex: 0,
        colIndex: 0,
      });
      onNotify('Yeni boş Ladder ağı (Network) eklendi.');
    },
    [commitProgram, isLocked, onNotify, program]
  );

  const handleDeleteRung = useCallback(
    (rungIndex: number) => {
      if (isLocked) return;
      const result = deleteRungAt(program, rungIndex);
      if (!result.deleted) {
        onNotify('En az bir düzenlenebilir satır bulunmalıdır.');
        return;
      }
      commitProgram(result.program);
      setCursor({
        rungIndex: result.nextRungIndex,
        rowIndex: 0,
        colIndex: 0,
      });
      onNotify(`Ağ ${String(rungIndex).padStart(3, '0')} silindi.`);
    },
    [commitProgram, isLocked, onNotify, program]
  );

  const handleResetGrid = useCallback(() => {
    if (isLocked) return;
    commitProgram(createBlankProgram(program.model, program.projectName));
    setCursor({ rungIndex: 0, rowIndex: 0, colIndex: 0 });
    setActiveTool('F1');
    setEditModal(null);
    onNotify('Ladder çalışma ızgarası sıfırlandı.');
  }, [commitProgram, isLocked, onNotify, program.model, program.projectName]);

  const loadExternalProgram = useCallback(
    (nextProgram: LadderProgram, message: string) => {
      commitProgram({
        ...nextProgram,
        updatedAt: new Date().toISOString(),
      });
      setCursor({ rungIndex: 0, rowIndex: 0, colIndex: 0 });
      setEditModal(null);
      onNotify(message);
    },
    [commitProgram, onNotify]
  );

  const setProjectName = useCallback(
    (nextName: string) => {
      const cleaned = nextName.trim();
      if (!cleaned) return;
      commitProgram({
        ...program,
        projectName: cleaned,
        updatedAt: new Date().toISOString(),
      });
    },
    [commitProgram, program]
  );

  const setRungComment = useCallback(
    (rungIndex: number, comment: string) => {
      if (isLocked) return;
      const target = program.rungs[rungIndex];
      if (!target || target.isEnd) return;
      const cleaned = comment.trim();
      const rungs = cloneRungs(program.rungs);
      rungs[rungIndex] = {
        ...rungs[rungIndex],
        comment: cleaned || undefined,
      };
      commitProgram({
        ...program,
        rungs,
        updatedAt: new Date().toISOString(),
      });
      onNotify(
        cleaned
          ? 'Segment açıklaması kaydedildi.'
          : 'Segment açıklaması temizlendi.'
      );
    },
    [commitProgram, isLocked, onNotify, program]
  );

  const setDeviceComment = useCallback(
    (address: string, comment: string) => {
      if (isLocked) return;
      const next = setDeviceCommentOnProgram(program, address, comment);
      commitProgram(next);
      const norm = address.trim().toUpperCase();
      onNotify(
        comment.trim()
          ? `${norm} etiketi "${comment.trim()}" olarak güncellendi.`
          : `${norm} aygıt etiketi temizlendi.`
      );
    },
    [commitProgram, isLocked, onNotify, program]
  );

  const applyQuickCommand = useCallback(
    (rawCommand: string): { ok: boolean; error?: string } => {
      if (isLocked) {
        return { ok: false, error: 'Simülasyon modunda komut eklenemez.' };
      }
      const res = applyQuickCommandOnProgram(program, cursor, rawCommand);
      if (!res.ok) {
        return { ok: false, error: res.error };
      }
      commitProgram(res.program);
      setCursor(res.nextCursor);
      recordRecentCommand({
        id: `cmd-${res.parsed.summary}`,
        label: res.parsed.summary,
        opcode: res.parsed.summary.split(' ')[0] ?? 'CMD',
        element: res.parsed.element,
      });
      onNotify(
        res.parsed.isParallelOr
          ? `Paralel kol yerleştirildi: ${res.parsed.summary}`
          : `Komut yerleştirildi: ${res.parsed.summary}`
      );
      return { ok: true };
    },
    [commitProgram, cursor, isLocked, onNotify, program, recordRecentCommand]
  );

  const openEditModalForCell = useCallback(
    (pos: CursorPosition) => {
      if (isLocked) return;
      const rung = program.rungs[pos.rungIndex];
      if (!rung || rung.isEnd) return;
      const cell = rung.rows[pos.rowIndex]?.[pos.colIndex];
      if (!cell) return;
      if (cell.element.kind === 'EMPTY' || cell.element.kind === 'HLINE') return;

      setEditModal({
        position: pos,
        element: { ...cell.element },
        isNewPlacement: false,
        previousProgram: null,
      });
    },
    [isLocked, program.rungs]
  );

  /**
   * Places a preset element from the categorized mobile command palette directly onto the grid
   * and opens CellEditModal for immediate operand customization.
   */
  const placePresetElement = useCallback(
    (element: CellElement, meta?: { id: string; label: string; opcode: string }) => {
      if (isLocked) return;
      const rung = program.rungs[cursor.rungIndex];
      if (!rung || rung.isEnd) return;
      const row = rung.rows[cursor.rowIndex];
      if (!row) return;

      let targetCol = cursor.colIndex;
      if (isOutputElement(element)) {
        targetCol = LADDER_COIL_COLUMN;
      } else if (targetCol >= LADDER_COIL_COLUMN) {
        const firstEmpty = row
          .slice(0, LADDER_COIL_COLUMN)
          .findIndex((c) => c.element.kind === 'EMPTY');
        targetCol = firstEmpty >= 0 ? firstEmpty : 0;
      }

      const targetPos: CursorPosition = {
        rungIndex: cursor.rungIndex,
        rowIndex: cursor.rowIndex,
        colIndex: targetCol,
      };
      setCursor(targetPos);

      if (meta) {
        recordRecentCommand({
          id: meta.id,
          label: meta.label,
          opcode: meta.opcode,
          element,
        });
      }

      const previousSnapshot = program;
      const tentativeProgram = applyElementToProgram(
        program,
        targetPos,
        element
      );
      replacePresentWithoutHistory(tentativeProgram);

      setEditModal({
        position: targetPos,
        element,
        isNewPlacement: true,
        previousProgram: previousSnapshot,
      });
    },
    [
      applyElementToProgram,
      cursor,
      isLocked,
      program,
      recordRecentCommand,
      replacePresentWithoutHistory,
    ]
  );

  const triggerTool = useCallback(
    (toolId: FunctionToolId) => {
      if (isLocked) return;
      if (toolId === 'F11') {
        handleInsertRungAfter(cursor.rungIndex);
        return;
      }
      if (toolId === 'F12') {
        clearCellAt(cursor);
        return;
      }
      if (toolId === 'F9') {
        setActiveTool('F9');
        toggleHLineAt(cursor);
        recordRecentCommand({ id: 'tool-F9', label: 'Yatay Hat', opcode: 'HLINE', toolId: 'F9' });
        return;
      }
      if (toolId === 'F10') {
        setActiveTool('F10');
        toggleBranchDownAt(cursor);
        recordRecentCommand({ id: 'tool-F10', label: 'Paralel Kol', opcode: 'OR', toolId: 'F10' });
        return;
      }

      setActiveTool(toolId);
      const defaultElement = createDefaultElementForTool(toolId);
      if (!defaultElement) return;

      const labelMap: Record<string, { label: string; opcode: string }> = {
        F1: { label: 'Normal Açık (NO)', opcode: 'LD' },
        F2: { label: 'Normal Kapalı (NC)', opcode: 'LDI' },
        F3: { label: 'Yükselen Kenar', opcode: 'LDP' },
        F4: { label: 'Düşen Kenar', opcode: 'LDF' },
        F5: { label: 'Karşılaştırma', opcode: 'LD=' },
        F6: { label: 'Zamanlayıcı', opcode: 'TMR' },
        F7: { label: 'Çıkış Bobini', opcode: 'OUT' },
        F8: { label: 'Set / Reset', opcode: 'SET' },
      };
      const meta = labelMap[toolId];
      placePresetElement(
        defaultElement,
        meta ? { id: `tool-${toolId}`, label: meta.label, opcode: meta.opcode } : undefined
      );
    },
    [
      clearCellAt,
      cursor,
      handleInsertRungAfter,
      isLocked,
      placePresetElement,
      recordRecentCommand,
      toggleBranchDownAt,
      toggleHLineAt,
    ]
  );

  const handleSelectCell = useCallback(
    (pos: CursorPosition) => {
      const rung = program.rungs[pos.rungIndex];
      if (!rung || rung.isEnd) return;
      const cell = rung.rows[pos.rowIndex]?.[pos.colIndex];
      if (!cell) return;

      const isSameCell =
        cursor.rungIndex === pos.rungIndex &&
        cursor.rowIndex === pos.rowIndex &&
        cursor.colIndex === pos.colIndex;

      setCursor(pos);

      if (
        !isLocked &&
        isSameCell &&
        cell.element.kind !== 'EMPTY' &&
        cell.element.kind !== 'HLINE'
      ) {
        openEditModalForCell(pos);
      }
    },
    [cursor, isLocked, openEditModalForCell, program.rungs]
  );

  const handleActivateCell = useCallback(
    (pos: CursorPosition) => {
      setCursor(pos);
      if (isLocked) return;
      const rung = program.rungs[pos.rungIndex];
      const cell = rung?.rows[pos.rowIndex]?.[pos.colIndex];
      if (!cell) return;
      if (cell.element.kind !== 'EMPTY' && cell.element.kind !== 'HLINE') {
        openEditModalForCell(pos);
      } else {
        const isCoil = pos.colIndex === LADDER_COIL_COLUMN;
        const toolToRun: FunctionToolId = isCoil
          ? activeTool === 'F6' || activeTool === 'F7' || activeTool === 'F8'
            ? activeTool
            : 'F7'
          : activeTool === 'F1' ||
              activeTool === 'F2' ||
              activeTool === 'F3' ||
              activeTool === 'F4' ||
              activeTool === 'F5'
            ? activeTool
            : 'F1';
        triggerTool(toolToRun);
      }
    },
    [activeTool, isLocked, openEditModalForCell, program.rungs, triggerTool]
  );

  const moveCursor = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right' | 'home' | 'end') => {
      setCursor((prev) => {
        if (direction === 'left') {
          return { ...prev, colIndex: Math.max(0, prev.colIndex - 1) };
        }
        if (direction === 'right') {
          return {
            ...prev,
            colIndex: Math.min(program.columns - 1, prev.colIndex + 1),
          };
        }
        if (direction === 'home') {
          return { ...prev, colIndex: 0 };
        }
        if (direction === 'end') {
          return { ...prev, colIndex: program.columns - 1 };
        }
        if (direction === 'down') {
          const curRung = program.rungs[prev.rungIndex];
          if (curRung && prev.rowIndex < curRung.rows.length - 1) {
            return { ...prev, rowIndex: prev.rowIndex + 1 };
          }
          const nextRungIdx = Math.min(editableRungCount - 1, prev.rungIndex + 1);
          return { ...prev, rungIndex: nextRungIdx, rowIndex: 0 };
        }
        if (prev.rowIndex > 0) {
          return { ...prev, rowIndex: prev.rowIndex - 1 };
        }
        const prevRungIdx = Math.max(0, prev.rungIndex - 1);
        const prevRung = program.rungs[prevRungIdx];
        const lastRow = prevRung ? prevRung.rows.length - 1 : 0;
        return { ...prev, rungIndex: prevRungIdx, rowIndex: lastRow };
      });
    },
    [editableRungCount, program.columns, program.rungs]
  );

  const jumpToRung = useCallback(
    (rungIndex: number) => {
      const clamped = Math.max(0, Math.min(rungIndex, editableRungCount - 1));
      setCursor({ rungIndex: clamped, rowIndex: 0, colIndex: 0 });
    },
    [editableRungCount]
  );

  const jumpToCell = useCallback(
    (rungIndex: number, rowIndex = 0, colIndex = 0) => {
      const clampedRung = Math.max(0, Math.min(rungIndex, editableRungCount - 1));
      const targetRung = program.rungs[clampedRung];
      const maxRow = targetRung ? Math.max(0, targetRung.rows.length - 1) : 0;
      const clampedRow = Math.max(0, Math.min(rowIndex, maxRow));
      const clampedCol = Math.max(0, Math.min(colIndex, program.columns - 1));
      setCursor({
        rungIndex: clampedRung,
        rowIndex: clampedRow,
        colIndex: clampedCol,
      });

      // Scroll target cell smoothly into view on mobile/desktop
      if (typeof document !== 'undefined') {
        window.requestAnimationFrame(() => {
          const el = document.querySelector(
            `[data-testid="cell-${clampedRung}-${clampedRow}-${clampedCol}"]`
          );
          if (el && 'scrollIntoView' in el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          }
        });
      }
    },
    [editableRungCount, program.columns, program.rungs]
  );

  useEffect(() => {
    const handleUndoRedoKeys = (e: KeyboardEvent) => {
      if (isLocked || editModal) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        clearCellAt(cursor);
      } else if (e.key === 'Enter') {
        const rung = program.rungs[cursor.rungIndex];
        const cell = rung?.rows[cursor.rowIndex]?.[cursor.colIndex];
        if (cell && cell.element.kind !== 'EMPTY' && cell.element.kind !== 'HLINE') {
          e.preventDefault();
          openEditModalForCell(cursor);
        }
      }
    };

    window.addEventListener('keydown', handleUndoRedoKeys);
    return () => window.removeEventListener('keydown', handleUndoRedoKeys);
  }, [clearCellAt, cursor, editModal, isLocked, openEditModalForCell, program.rungs, redo, undo]);

  const selectedCell =
    program.rungs[cursor.rungIndex]?.rows[cursor.rowIndex]?.[cursor.colIndex] ?? null;

  return {
    program,
    compileResult,
    cursor,
    selectedCell,
    activeTool,
    editableRungCount,
    editModal,
    storageError,
    recentCommands,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    setModel,
    triggerTool,
    placePresetElement,
    handleSelectCell,
    handleActivateCell,
    openEditModalForCell,
    handleSaveModal,
    handleCancelModal,
    handleDeleteFromModal,
    handleInsertRungAfter,
    handleDeleteRung,
    handleResetGrid,
    loadExternalProgram,
    setProjectName,
    setRungComment,
    setDeviceComment,
    applyQuickCommand,
    moveCursor,
    jumpToRung,
    jumpToCell,
  };
}
