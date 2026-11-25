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
  deduplicateRungIds,
  deleteRungAt,
  insertRungAfter,
} from '../core/gridFactory';
import { compileLadderToIl } from '../core/ilCompiler';
import { getStepHeader, isLogicElement, isOutputElement } from '../core/ast';
import {
  applyQuickCommandOnProgram,
  commitHistory,
  commitHistoryFromSnapshot,
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
import {
  MAX_PROJECT_RUNGS,
  MAX_ROWS_PER_RUNG,
  loadDraftFromStorage,
  parseProgramJson,
  saveDraftToStorage,
  serializeProgramJson,
} from '../core/storage';

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
    case 'SQR':
    case 'FLOAT_MOV':
    case 'FLOAT_MATH':
    case 'FLOAT_UNARY':
    case 'TRD':
    case 'TZCP':
      return el.destination;
    case 'TWR':
      return el.source;
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

function rungHasContent(rung: LadderRung): boolean {
  return rung.rows.some((row) => row.some((c) => c.element.kind !== 'EMPTY' || c.branchDown));
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

  const latestProgramRef = useRef(program);
  const editModalOpenRef = useRef(editModal !== null);
  latestProgramRef.current = program;
  editModalOpenRef.current = editModal !== null;

  const flushDraftSave = useCallback(
    (targetProgram: LadderProgram) => {
      const res = saveDraftToStorage(targetProgram);
      if (!res.ok) {
        const msg = res.error ?? 'Otomatik taslak kaydedilemedi.';
        setStorageError(msg);
        if (lastNotifiedStorageErrRef.current !== msg) {
          lastNotifiedStorageErrRef.current = msg;
          onNotify(msg);
        }
      } else if (lastNotifiedStorageErrRef.current !== null) {
        setStorageError(null);
        lastNotifiedStorageErrRef.current = null;
      }
    },
    [onNotify]
  );

  // Debounced auto-save (300ms) avoids blocking mobile UI thread on rapid edits
  useEffect(() => {
    if (editModal !== null) return;
    const tid = window.setTimeout(() => {
      flushDraftSave(program);
    }, 300);
    return () => window.clearTimeout(tid);
  }, [editModal, flushDraftSave, program]);

  // Synchronous flush on iOS Safari pagehide / mobile app switch so unsaved drafts are never lost
  useEffect(() => {
    const flushNow = () => {
      if (!editModalOpenRef.current) {
        saveDraftToStorage(latestProgramRef.current);
      }
    };
    const handleVisibility = () => {
      if (document.hidden) flushNow();
    };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const compileResult = useMemo(() => compileLadderToIl(program), [program]);

  const editableRungCount = useMemo(
    () => program.rungs.filter((r) => !r.isEnd).length,
    [program.rungs]
  );

  const lastNotifiedTransitionSeqRef = useRef<number>(0);

  // Notify strictly after real Undo / Redo state transitions (zero side effects inside state updaters)
  useEffect(() => {
    const tr = history.lastTransition;
    if (!tr || tr.seq === lastNotifiedTransitionSeqRef.current) return;
    lastNotifiedTransitionSeqRef.current = tr.seq;
    if (tr.kind === 'undo') {
      onNotify('Son işlem geri alındı.');
    } else if (tr.kind === 'redo') {
      onNotify('İşlem yeniden uygulandı.');
    }
  }, [history.lastTransition, onNotify]);

  const commitProgramUpdate = useCallback(
    (updater: (current: LadderProgram) => LadderProgram) => {
      const timestamp = new Date().toISOString();
      setHistory((prev) => commitHistory(prev, updater, timestamp));
    },
    []
  );

  const commitProgram = useCallback(
    (nextProgram: LadderProgram) => {
      const timestamp = new Date().toISOString();
      setHistory((prev) => commitHistory(prev, () => nextProgram, timestamp));
    },
    []
  );

  const replacePresentWithoutHistory = useCallback((nextProgram: LadderProgram) => {
    setHistory((prev) => ({
      ...prev,
      present: nextProgram,
    }));
  }, []);

  const undo = useCallback(() => {
    if (isLocked) return;
    setHistory((prev) => undoHistory(prev));
  }, [isLocked]);

  const redo = useCallback(() => {
    if (isLocked) return;
    setHistory((prev) => redoHistory(prev));
  }, [isLocked]);

  const setModel = useCallback(
    (nextModel: PlcModelId) => {
      if (isLocked || program.model === nextModel) return;
      const nextSpec = PLC_MODELS[nextModel];
      // Seçilen modelde olmayan adresler (ör. SX2'ye özel D1110) projeyi geçersiz kılar ve
      // otomatik kaydın yeniden açılışta reddedilmesine yol açar. Bu yüzden geçişi engelle.
      const compatibility = parseProgramJson(serializeProgramJson({ ...program, model: nextModel }));
      if (!compatibility.success) {
        onNotify(
          `${nextSpec.label} modeline geçilemedi: ${compatibility.error ?? 'projede bu modelde olmayan adresler var.'} Önce bu adresi değiştirin.`
        );
        return;
      }
      commitProgramUpdate((current) =>
        current.model === nextModel ? current : { ...current, model: nextModel }
      );
      onNotify(
        `PLC modeli ${nextSpec.label} olarak güncellendi (${nextSpec.onboardInputCount} DI / ${nextSpec.onboardOutputCount} DO).`
      );
    },
    [commitProgramUpdate, isLocked, onNotify, program]
  );

  const applyElementToProgram = useCallback(
    (
      baseProgram: LadderProgram,
      pos: CursorPosition,
      element: CellElement,
      comment?: string,
      updatedAt?: string
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

      if (element.kind === 'STL' || element.kind === 'RET') {
        // Adım başlığı ağın tek elemanıdır: satırın geri kalanı ve dallar temizlenir.
        const headerRow = createEmptyRow(baseProgram.columns);
        headerRow[0] = { branchDown: false, element };
        rung.rows = [headerRow];
      } else if (pos.colIndex === LADDER_COIL_COLUMN && isOutputElement(element)) {
        autoBridgeRowToOutput(row);
        if (pos.rowIndex > 0) {
          const hasOwnLogic = row
            .slice(0, LADDER_COIL_COLUMN)
            .some((c) => isLogicElement(c.element));
          if (!hasOwnLogic) {
            const upperRow = rung.rows[pos.rowIndex - 1];
            // Kullanıcının bu satıra indirdiği bir paralel kol varsa çıkış o kola bağlanır:
            // kolun indiği noktadan çıkış sütununa kadar yatay hat çekilir (yeni kol açılmaz).
            let entryBoundary = -1;
            for (let c = 0; c < LADDER_COIL_COLUMN - 1; c += 1) {
              if (upperRow?.[c]?.branchDown) {
                entryBoundary = c + 1;
                break;
              }
            }
            if (entryBoundary > 0) {
              for (let c = entryBoundary; c < LADDER_COIL_COLUMN; c += 1) {
                if (row[c].element.kind === 'EMPTY') {
                  row[c] = { ...row[c], element: { kind: 'HLINE' } };
                }
              }
            } else if (upperRow && upperRow[LADDER_COIL_COLUMN - 1]) {
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
        updatedAt: updatedAt ?? baseProgram.updatedAt,
      };
    },
    []
  );

  const handleSaveModal = useCallback(
    (updatedElement: CellElement, comment: string | undefined) => {
      if (!editModal) return;
      const base = editModal.previousProgram ?? program;
      const timestamp = new Date().toISOString();
      const nextProgram = applyElementToProgram(
        base,
        editModal.position,
        updatedElement,
        comment,
        timestamp
      );

      setHistory((prev) =>
        commitHistoryFromSnapshot(prev, base, nextProgram, timestamp)
      );
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
      if (isLocked) return;
      const previewRung = program.rungs[pos.rungIndex];
      if (!previewRung || previewRung.isEnd) return;
      const previewCell = previewRung.rows[pos.rowIndex]?.[pos.colIndex];
      if (!previewCell) return;

      const previewCloned = cloneRungs([previewRung])[0];
      previewCloned.rows[pos.rowIndex][pos.colIndex] = createEmptyCell();
      const prunedPreview = pruneEmptyTrailingSubRows(previewCloned);
      const nextRowIdx = Math.min(pos.rowIndex, prunedPreview.rows.length - 1);

      commitProgramUpdate((current) => {
        const targetRung = current.rungs[pos.rungIndex];
        if (!targetRung || targetRung.isEnd) return current;
        if (!targetRung.rows[pos.rowIndex]?.[pos.colIndex]) return current;

        const rungs = cloneRungs(current.rungs);
        const rung = rungs[pos.rungIndex];
        rung.rows[pos.rowIndex][pos.colIndex] = createEmptyCell();
        rungs[pos.rungIndex] = pruneEmptyTrailingSubRows(rung);
        return { ...current, rungs };
      });

      setCursor({ ...pos, rowIndex: nextRowIdx });
      onNotify('Hücre temizlendi.');
    },
    [commitProgramUpdate, isLocked, onNotify, program.rungs]
  );

  const handleDeleteFromModal = useCallback(() => {
    if (!editModal) return;
    if (editModal.isNewPlacement && editModal.previousProgram) {
      replacePresentWithoutHistory(editModal.previousProgram);
      setEditModal(null);
      onNotify('Eleman silindi.');
      return;
    }

    const base = editModal.previousProgram ?? program;
    const timestamp = new Date().toISOString();
    const targetCell =
      base.rungs[editModal.position.rungIndex]?.rows[editModal.position.rowIndex]?.[
        editModal.position.colIndex
      ];
    if (!targetCell || targetCell.element.kind === 'EMPTY') {
      setEditModal(null);
      return;
    }

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
    const nextProgram: LadderProgram = {
      ...base,
      rungs,
      updatedAt: timestamp,
    };
    setHistory((prev) =>
      commitHistoryFromSnapshot(prev, base, nextProgram, timestamp)
    );
    setEditModal(null);
    onNotify('Eleman silindi.');
  }, [editModal, onNotify, program, replacePresentWithoutHistory]);

  const toggleHLineAt = useCallback(
    (pos: CursorPosition) => {
      if (isLocked) return;
      if (pos.colIndex >= LADDER_COIL_COLUMN) {
        onNotify('Yatay hat (F9) yalnızca lojik sütunlarına (0–7) eklenebilir.');
        return;
      }
      const targetRung = program.rungs[pos.rungIndex];
      const currentCell = targetRung?.rows[pos.rowIndex]?.[pos.colIndex];
      if (!targetRung || targetRung.isEnd || !currentCell) return;
      if (getStepHeader(targetRung)) {
        onNotify('Bu ağ bir adım başlığıdır (STL/RET); yatay hat eklenemez.');
        return;
      }

      const willAddHLine = currentCell.element.kind !== 'HLINE';
      commitProgramUpdate((current) => {
        const rungs = cloneRungs(current.rungs);
        const rung = rungs[pos.rungIndex];
        if (!rung || rung.isEnd) return current;
        const cell = rung.rows[pos.rowIndex]?.[pos.colIndex];
        if (!cell) return current;
        const nextKind = cell.element.kind === 'HLINE' ? 'EMPTY' : 'HLINE';
        cell.element = { kind: nextKind };
        return { ...current, rungs };
      });

      if (willAddHLine && pos.colIndex < LADDER_COIL_COLUMN - 1) {
        setCursor({ ...pos, colIndex: pos.colIndex + 1 });
      }
    },
    [commitProgramUpdate, isLocked, onNotify, program.rungs]
  );

  const toggleBranchDownAt = useCallback(
    (pos: CursorPosition) => {
      if (isLocked) return;
      // Gerçek WPLSoft'taki gibi: dikey paralel kol, seçili hücrenin SOL kenarından aşağı iner.
      // Veri modelinde dikey çizgi bir hücrenin sağ kenarında tutulduğu için
      // seçili sütunun solundaki (colIndex - 1) hücreye yazılır.
      if (pos.colIndex <= 0) {
        onNotify(
          'İlk sütunun solu sol güç hattıdır; satırlar oraya zaten bağlıdır. Paralel kol için 1. sütun veya sağını seçin.'
        );
        return;
      }
      const anchorCol = Math.min(pos.colIndex, LADDER_COIL_COLUMN) - 1;
      const targetRung = program.rungs[pos.rungIndex];
      const currentCell = targetRung?.rows[pos.rowIndex]?.[anchorCol];
      if (!targetRung || targetRung.isEnd || !currentCell) return;
      if (getStepHeader(targetRung)) {
        onNotify('Bu ağ bir adım başlığıdır (STL/RET); paralel kol eklenemez.');
        return;
      }

      const willAddBranch = !currentCell.branchDown;
      const isLastRow = pos.rowIndex === targetRung.rows.length - 1;
      const belowRung = program.rungs[pos.rungIndex + 1];
      // WPLSoft'ta satırlar serbesttir: alttaki satıra önce kontak konup sonra dikey çizgi
      // çekilebilir. Bu durumda alttaki (dolu) ağ, bu ağın devamı olarak birleştirilir.
      const willMergeBelow =
        willAddBranch &&
        isLastRow &&
        Boolean(belowRung) &&
        !belowRung.isEnd &&
        !getStepHeader(belowRung) &&
        rungHasContent(belowRung);
      const nextRowCount = willMergeBelow
        ? targetRung.rows.length + belowRung.rows.length
        : targetRung.rows.length + (willAddBranch && isLastRow ? 1 : 0);
      if (willAddBranch && nextRowCount > MAX_ROWS_PER_RUNG) {
        onNotify(`Bir ağda en fazla ${MAX_ROWS_PER_RUNG} satır olabilir. Devreyi yeni bir ağa bölün.`);
        return;
      }

      commitProgramUpdate((current) => {
        const rungs = cloneRungs(current.rungs);
        const rung = rungs[pos.rungIndex];
        if (!rung || rung.isEnd) return current;
        const cell = rung.rows[pos.rowIndex]?.[anchorCol];
        if (!cell) return current;

        const nextBranch = !cell.branchDown;
        cell.branchDown = nextBranch;

        if (nextBranch && pos.rowIndex === rung.rows.length - 1) {
          const below = rungs[pos.rungIndex + 1];
          if (willMergeBelow && below && !below.isEnd) {
            rung.rows.push(...below.rows);
            if (!rung.comment && below.comment) rung.comment = below.comment;
            rungs.splice(pos.rungIndex + 1, 1);
          } else {
            rung.rows.push(createEmptyRow(current.columns));
          }
        }

        rungs[pos.rungIndex] = pruneEmptyTrailingSubRows(rung);
        return { ...current, rungs };
      });

      if (willMergeBelow) {
        onNotify(
          `Paralel kol eklendi; alttaki satır Ağ ${String(pos.rungIndex).padStart(3, '0')} ile birleştirildi.`
        );
      } else if (willAddBranch) {
        onNotify(
          `Ağ ${String(pos.rungIndex).padStart(3, '0')} Sütun ${pos.colIndex} hücresinin solundan paralel kol eklendi.`
        );
      } else {
        onNotify('Paralel kol bağlantısı kaldırıldı.');
      }
    },
    [commitProgramUpdate, isLocked, onNotify, program.rungs]
  );

  const handleInsertRungAfter = useCallback(
    (rungIndex: number) => {
      if (isLocked) return;
      if (program.rungs.length >= MAX_PROJECT_RUNGS) {
        onNotify(`Bir projede en fazla ${MAX_PROJECT_RUNGS - 1} ağ olabilir.`);
        return;
      }
      const endIdx = program.rungs.findIndex((r) => r.isEnd);
      const predictedIndex =
        endIdx === -1
          ? Math.min(rungIndex + 1, program.rungs.length)
          : Math.min(rungIndex + 1, endIdx);
      commitProgramUpdate((current) => insertRungAfter(current, rungIndex).program);
      setCursor({
        rungIndex: predictedIndex,
        rowIndex: 0,
        colIndex: 0,
      });
      onNotify('Yeni boş Ladder ağı (Network) eklendi.');
    },
    [commitProgramUpdate, isLocked, onNotify, program.rungs]
  );

  const handleDeleteRung = useCallback(
    (rungIndex: number) => {
      if (isLocked) return;
      const preview = deleteRungAt(program, rungIndex);
      if (!preview.deleted) {
        onNotify('En az bir düzenlenebilir satır bulunmalıdır.');
        return;
      }
      commitProgramUpdate((current) => {
        const res = deleteRungAt(current, rungIndex);
        return res.deleted ? res.program : current;
      });
      setCursor({
        rungIndex: preview.nextRungIndex,
        rowIndex: 0,
        colIndex: 0,
      });
      onNotify(`Ağ ${String(rungIndex).padStart(3, '0')} silindi.`);
    },
    [commitProgramUpdate, isLocked, onNotify, program]
  );

  const handleResetGrid = useCallback(() => {
    if (isLocked) return;
    commitProgramUpdate((current) =>
      createBlankProgram(current.model, current.projectName)
    );
    setCursor({ rungIndex: 0, rowIndex: 0, colIndex: 0 });
    setActiveTool('F1');
    setEditModal(null);
    onNotify('Ladder çalışma ızgarası sıfırlandı.');
  }, [commitProgramUpdate, isLocked, onNotify]);

  const loadExternalProgram = useCallback(
    (nextProgram: LadderProgram, message: string): boolean => {
      const candidate: LadderProgram = {
        ...nextProgram,
        rungs: deduplicateRungIds(nextProgram.rungs),
        updatedAt: new Date().toISOString(),
      };
      // Kaydedilemeyecek (yeniden açılışta reddedilecek) bir program asla yüklenmez.
      const check = parseProgramJson(serializeProgramJson(candidate));
      if (!check.success || !check.program) {
        onNotify(`Program yüklenemedi: ${check.error ?? 'geçersiz program yapısı.'}`);
        return false;
      }
      commitProgram(check.program);
      setCursor({ rungIndex: 0, rowIndex: 0, colIndex: 0 });
      setEditModal(null);
      onNotify(message);
      return true;
    },
    [commitProgram, onNotify]
  );

  const setProjectName = useCallback(
    (nextName: string) => {
      const cleaned = nextName.trim();
      if (!cleaned) return;
      commitProgramUpdate((current) =>
        current.projectName === cleaned ? current : { ...current, projectName: cleaned }
      );
    },
    [commitProgramUpdate]
  );

  const setRungComment = useCallback(
    (rungIndex: number, comment: string) => {
      if (isLocked) return;
      const cleaned = comment.trim();
      commitProgramUpdate((current) => {
        const target = current.rungs[rungIndex];
        if (!target || target.isEnd) return current;
        const rungs = cloneRungs(current.rungs);
        rungs[rungIndex] = {
          ...rungs[rungIndex],
          comment: cleaned || undefined,
        };
        return { ...current, rungs };
      });
      onNotify(
        cleaned
          ? 'Segment açıklaması kaydedildi.'
          : 'Segment açıklaması temizlendi.'
      );
    },
    [commitProgramUpdate, isLocked, onNotify]
  );

  const setDeviceComment = useCallback(
    (address: string, comment: string) => {
      if (isLocked) return;
      commitProgramUpdate((current) =>
        setDeviceCommentOnProgram(current, address, comment)
      );
      const norm = address.trim().toUpperCase();
      onNotify(
        comment.trim()
          ? `${norm} etiketi "${comment.trim()}" olarak güncellendi.`
          : `${norm} aygıt etiketi temizlendi.`
      );
    },
    [commitProgramUpdate, isLocked, onNotify]
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
      if (res.program.rungs.some((r) => r.rows.length > MAX_ROWS_PER_RUNG)) {
        return {
          ok: false,
          error: `Bir ağda en fazla ${MAX_ROWS_PER_RUNG} satır olabilir. Devreyi yeni bir ağa bölün.`,
        };
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
      if (getStepHeader(rung) && element.kind !== 'STL' && element.kind !== 'RET') {
        onNotify('Bu ağ bir adım başlığıdır (STL/RET). Adımın komutları için altına yeni bir ağ ekleyin (F11).');
        return;
      }

      let targetCol = cursor.colIndex;
      if (element.kind === 'STL' || element.kind === 'RET') {
        const isEmptyRung = rung.rows.every((r) =>
          r.every((c) => (c.element.kind === 'EMPTY' && !c.branchDown) || c.element.kind === 'STL' || c.element.kind === 'RET')
        );
        if (!isEmptyRung) {
          onNotify('STL ve RET yalnızca boş bir ağa yerleştirilebilir. Önce F11 ile yeni bir ağ ekleyin.');
          return;
        }
        targetCol = 0;
        setCursor({ rungIndex: cursor.rungIndex, rowIndex: 0, colIndex: 0 });
      }
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
