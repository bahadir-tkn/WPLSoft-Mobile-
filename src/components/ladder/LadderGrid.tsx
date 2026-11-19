import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  GitBranch,
  Lock,
  MessageSquarePlus,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  CellElement,
  CompileResult,
  CursorPosition,
  FunctionToolDefinition,
  LadderCellData,
  LadderProgram,
  SimState,
} from '../../types/plc';
import { LADDER_COIL_COLUMN } from '../../core/plcModels';
import { offsetDeviceAddress } from '../../core/addressing';
import { branchWireKey, cellKey, leftWireKey } from '../../core/scanner';
import { LadderCell } from './LadderCell';

interface LadderGridProps {
  program: LadderProgram;
  compileResult: CompileResult;
  cursor: CursorPosition;
  selectedCell: LadderCellData | null;
  activeToolDef: FunctionToolDefinition;
  isOnline: boolean;
  simState: SimState | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSelectCell: (pos: CursorPosition) => void;
  onActivateCell: (pos: CursorPosition) => void;
  onOnlineCellClick: (pos: CursorPosition) => void;
  onEditSelectedCell: () => void;
  onToggleBranchAtCursor: () => void;
  onInsertRungAfter: (rungIndex: number) => void;
  onDeleteRung: (rungIndex: number) => void;
  onSetRungComment: (rungIndex: number, comment: string) => void;
}

function getElementComment(
  el: CellElement,
  deviceComments: Record<string, string>
): string | undefined {
  switch (el.kind) {
    case 'CONTACT':
    case 'COIL':
    case 'TMR':
    case 'CNT':
      return deviceComments[el.address] ?? el.comment;
    case 'MOV':
    case 'CMP':
    case 'MATH':
    case 'TRD':
      return deviceComments[el.destination] ?? el.comment;
    case 'ALT':
    case 'INCDEC':
      return deviceComments[el.target] ?? el.comment;
    case 'ZRST':
      return deviceComments[el.start] ?? el.comment;
    case 'COMPARE':
      return deviceComments[el.operandA] ?? el.comment;
    default:
      return undefined;
  }
}

function parsePresetDisplay(preset: string, simState: SimState): number {
  const norm = preset.trim().toUpperCase();
  if (norm.startsWith('K')) {
    const n = Number.parseInt(norm.slice(1), 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
  }
  if (norm.startsWith('D')) {
    return Math.max(0, simState.registers[norm] ?? 0);
  }
  return 0;
}

function getLiveValueBadge(
  el: CellElement,
  simState: SimState | null
): string | undefined {
  if (!simState) return undefined;
  switch (el.kind) {
    case 'TMR': {
      const addr = el.address.trim().toUpperCase();
      const rt = simState.timers[addr];
      const cur = rt?.currentValue ?? 0;
      const preset = rt?.presetValue ?? parsePresetDisplay(el.preset, simState);
      return `${cur}/${preset}`;
    }
    case 'CNT': {
      const addr = el.address.trim().toUpperCase();
      const rt = simState.counters[addr];
      const cur = rt?.currentValue ?? 0;
      const preset = rt?.presetValue ?? parsePresetDisplay(el.preset, simState);
      return `${cur}/${preset}`;
    }
    case 'MOV': {
      const dest = el.destination.trim().toUpperCase();
      const val = simState.registers[dest] ?? 0;
      return `${dest}=${val}`;
    }
    case 'ALT': {
      const target = el.target.trim().toUpperCase();
      const isOn = target.startsWith('Y')
        ? Boolean(simState.outputs[target])
        : Boolean(simState.relays[target]);
      return `${target}=${isOn ? 'ON' : 'OFF'}`;
    }
    case 'CMP': {
      const d0 = el.destination.trim().toUpperCase();
      const d1 = offsetDeviceAddress(d0, 1);
      const d2 = offsetDeviceAddress(d0, 2);
      const readBit = (a: string | null) => {
        if (!a) return false;
        return a.startsWith('Y') ? Boolean(simState.outputs[a]) : Boolean(simState.relays[a]);
      };
      if (readBit(d0)) return `${d0}(>)=ON`;
      if (readBit(d1)) return `${d1}(=)=ON`;
      if (readBit(d2)) return `${d2}(<)=ON`;
      return `${d0}..OFF`;
    }
    case 'MATH': {
      const dest = el.destination.trim().toUpperCase();
      const val = simState.registers[dest] ?? 0;
      if (el.operator === 'DIV') {
        const remAddr = offsetDeviceAddress(dest, 1);
        const rem = remAddr ? (simState.registers[remAddr] ?? 0) : 0;
        return `${dest}=${val} · r=${rem}`;
      }
      return `${dest}=${val}`;
    }
    case 'INCDEC': {
      const target = el.target.trim().toUpperCase();
      const val = simState.registers[target] ?? 0;
      return `${target}=${val}`;
    }
    case 'TRD': {
      const dest = el.destination.trim().toUpperCase();
      const hrAddr = offsetDeviceAddress(dest, 4);
      const minAddr = offsetDeviceAddress(dest, 5);
      const secAddr = offsetDeviceAddress(dest, 6);
      const hh = String(hrAddr ? (simState.registers[hrAddr] ?? 0) : 0).padStart(2, '0');
      const mm = String(minAddr ? (simState.registers[minAddr] ?? 0) : 0).padStart(2, '0');
      const ss = String(secAddr ? (simState.registers[secAddr] ?? 0) : 0).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }
    case 'COMPARE': {
      const opA = el.operandA.trim().toUpperCase();
      if (opA.startsWith('D')) {
        return `${opA}=${simState.registers[opA] ?? 0}`;
      }
      if (opA.startsWith('T')) {
        return `${opA}=${simState.timers[opA]?.currentValue ?? 0}`;
      }
      if (opA.startsWith('C')) {
        return `${opA}=${simState.counters[opA]?.currentValue ?? 0}`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

export const LadderGrid: React.FC<LadderGridProps> = ({
  program,
  compileResult,
  cursor,
  selectedCell,
  activeToolDef,
  isOnline,
  simState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSelectCell,
  onActivateCell,
  onOnlineCellClick,
  onEditSelectedCell,
  onToggleBranchAtCursor,
  onInsertRungAfter,
  onDeleteRung,
  onSetRungComment,
}) => {
  const [editingSegmentRung, setEditingSegmentRung] = useState<number | null>(null);
  const [segmentDraft, setSegmentDraft] = useState('');
  const [zoomDensity, setZoomDensity] = useState<'compact' | 'normal' | 'large'>('normal');

  const editableRungCount = program.rungs.filter((r) => !r.isEnd).length;
  const isCoilCol = cursor.colIndex === LADDER_COIL_COLUMN;
  const isSelectedEditable =
    !isOnline &&
    selectedCell !== null &&
    selectedCell.element.kind !== 'EMPTY' &&
    selectedCell.element.kind !== 'HLINE' &&
    selectedCell.element.kind !== 'END';

  const leftRailActive = isOnline && Boolean(simState && simState.scanCount > 0);

  // Map each rungIndex to its authentic starting IL Step number (e.g. 0, 5, 12...)
  const rungStartStepMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const inst of compileResult.instructions) {
      if (!map.has(inst.rungIndex)) {
        map.set(inst.rungIndex, inst.stepAddress);
      }
    }
    return map;
  }, [compileResult.instructions]);

  // Map cell coordinates to diagnostic severity for crisp red/amber error highlighting
  const cellDiagnosticMap = useMemo(() => {
    const map = new Map<string, 'error' | 'warning'>();
    for (const diag of compileResult.diagnostics) {
      if (
        diag.rungIndex !== undefined &&
        diag.rowIndex !== undefined &&
        diag.colIndex !== undefined
      ) {
        const key = `${diag.rungIndex}:${diag.rowIndex}:${diag.colIndex}`;
        const existing = map.get(key);
        if (!existing || diag.severity === 'error') {
          map.set(key, diag.severity);
        }
      }
    }
    return map;
  }, [compileResult.diagnostics]);

  const gridMinWidthClass =
    zoomDensity === 'compact'
      ? 'min-w-[710px]'
      : zoomDensity === 'large'
        ? 'min-w-[1120px]'
        : 'min-w-[920px]';

  const startSegmentEdit = (rungIndex: number) => {
    if (isOnline) return;
    const rung = program.rungs[rungIndex];
    if (!rung || rung.isEnd) return;
    setEditingSegmentRung(rungIndex);
    setSegmentDraft(rung.comment ?? '');
  };

  const commitSegmentEdit = () => {
    if (editingSegmentRung === null) return;
    onSetRungComment(editingSegmentRung, segmentDraft);
    setEditingSegmentRung(null);
    setSegmentDraft('');
  };

  const cancelSegmentEdit = () => {
    setEditingSegmentRung(null);
    setSegmentDraft('');
  };

  return (
    <main className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#E9EDF3]">
      {/* Compact Workspace Context Strip */}
      <div
        className={`shrink-0 border-b px-3 sm:px-4 py-1.5 flex items-center justify-between gap-2 flex-wrap ${
          isOnline
            ? 'bg-[#EEFBF3] border-[#A7E6BE]'
            : 'bg-[#F4F6F9] border-[#CBD2DC]'
        }`}
      >
        {isOnline ? (
          <div className="flex items-center gap-2 text-xs text-[#0F172A] min-w-0">
            <Lock className="w-3.5 h-3.5 text-[#008C3A] shrink-0" aria-hidden="true" />
            <span className="font-semibold text-[#007A33] whitespace-nowrap">
              Sanal Simülasyon ({simState?.running ? 'RUN' : 'STOP'})
            </span>
            <span aria-hidden="true" className="text-[#94A3B8]">
              ·
            </span>
            <span className="text-[#334155] truncate">
              Kontaklara dokunarak Set On/Off/Pals, D/T/C bloklarına dokunarak değer değiştirebilirsiniz
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-[#334155] min-w-0">
            <span className="font-mono font-semibold text-[#0B4EA2] whitespace-nowrap">
              {activeToolDef.shortcut}
            </span>
            <span aria-hidden="true" className="text-[#94A3B8]">
              ·
            </span>
            <span className="font-medium text-[#0F172A] truncate">
              {activeToolDef.label}
            </span>
            <span className="hidden xl:inline text-[#94A3B8]" aria-hidden="true">
              ·
            </span>
            <span className="hidden xl:inline font-mono text-[#475569] whitespace-nowrap">
              Step {rungStartStepMap.get(cursor.rungIndex) ?? '—'} · Satır {cursor.rowIndex} ({isCoilCol ? 'Çıkış' : 'Lojik'})
            </span>
          </div>
        )}

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-wrap">
          {!isOnline && (
            <>
              {/* Mobile Undo / Redo (Header shows these on md+) */}
              <div className="flex md:hidden items-center gap-1">
                <button
                  type="button"
                  data-testid="mobile-undo-btn"
                  onClick={onUndo}
                  disabled={!canUndo}
                  aria-label="Geri Al"
                  title="Geri Al"
                  className="h-7 w-7 rounded border border-[#B8C2D1] bg-white text-[#334155] hover:bg-[#EDF2F8] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-testid="mobile-redo-btn"
                  onClick={onRedo}
                  disabled={!canRedo}
                  aria-label="İleri Al"
                  title="İleri Al"
                  className="h-7 w-7 rounded border border-[#B8C2D1] bg-white text-[#334155] hover:bg-[#EDF2F8] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center cursor-pointer"
                >
                  <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              {isSelectedEditable && (
                <button
                  type="button"
                  onClick={onEditSelectedCell}
                  className="h-7 px-2 sm:px-2.5 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-xs font-semibold text-[#0B4EA2] flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Düzenle</span>
                </button>
              )}

              {!isCoilCol && (
                <button
                  type="button"
                  data-testid="context-branch-btn"
                  onClick={onToggleBranchAtCursor}
                  title="Paralel Kol Ekle/Kaldır (F10)"
                  className="h-7 px-2 sm:px-2.5 rounded border border-[#B8C2D1] bg-white hover:bg-[#EDF4FC] hover:border-[#0B4EA2] text-xs font-medium text-[#334155] hover:text-[#0B4EA2] flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Paralel Kol (F10)</span>
                </button>
              )}

              <button
                type="button"
                data-testid="edit-segment-comment-btn"
                onClick={() => startSegmentEdit(cursor.rungIndex)}
                title="Seçili ağın üstüne kırmızı WPLSoft Segment Açıklaması ekle"
                className="h-7 px-2 sm:px-2.5 rounded border border-[#B8C2D1] bg-white hover:bg-[#FEF2F2] hover:border-[#DC2626]/50 text-xs font-medium text-[#334155] hover:text-[#B91C1C] flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MessageSquarePlus className="w-3.5 h-3.5 text-[#DC2626]" aria-hidden="true" />
                <span className="hidden md:inline">Segment Başlığı</span>
              </button>

              <button
                type="button"
                data-testid="context-insert-rung-btn"
                onClick={() => onInsertRungAfter(cursor.rungIndex)}
                title="Yeni Satır Ekle (F11)"
                className="h-7 px-2 sm:px-2.5 rounded border border-[#B8C2D1] bg-white hover:bg-[#EDF4FC] hover:border-[#0B4EA2] text-xs font-medium text-[#0B4EA2] flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Satır Ekle</span>
              </button>

              <button
                type="button"
                data-testid="context-delete-rung-btn"
                onClick={() => onDeleteRung(cursor.rungIndex)}
                disabled={editableRungCount <= 1}
                title={
                  editableRungCount <= 1
                    ? 'En az 1 çalışma satırı bulunmalıdır'
                    : 'Seçili satırı sil'
                }
                className="h-7 px-2 rounded border border-[#B8C2D1] bg-white hover:bg-[#FEF2F2] hover:border-[#DC2626]/50 text-xs font-medium text-[#475569] hover:text-[#DC2626] disabled:opacity-35 disabled:pointer-events-none flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Satır Sil</span>
              </button>
            </>
          )}

          {/* Ladder Zoom Presets (75% / 100% / 125%) */}
          <div
            role="group"
            aria-label="Ladder görünüm yakınlaştırma"
            className="flex items-center bg-[#E2E8F0] p-0.5 rounded border border-[#CBD2DC] shrink-0"
          >
            {(
              [
                { id: 'compact', label: '75%' },
                { id: 'normal', label: '100%' },
                { id: 'large', label: '125%' },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-testid={`zoom-${preset.id}-btn`}
                aria-pressed={zoomDensity === preset.id}
                onClick={() => setZoomDensity(preset.id)}
                className={`h-6 px-1.5 rounded-[3px] font-mono text-[10px] font-bold transition-colors cursor-pointer ${
                  zoomDensity === preset.id
                    ? 'bg-[#0B4EA2] text-white'
                    : 'text-[#334155] hover:bg-white/70'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable Authentic PC WPLSoft Ladder Worksheet Canvas (No C0-C7 headers, No right action column) */}
      <div className="flex-1 overflow-auto touch-pan-x touch-pan-y wpl-scrollbar p-2 sm:p-3">
        <div
          className={`${gridMinWidthClass} max-w-[1620px] mx-auto bg-white border border-[#BFC7D5] shadow-[0_1px_2px_rgba(15,23,42,0.06)]`}
          data-testid="ladder-grid"
        >
          {/* Ladder Rungs */}
          <div role="grid" aria-label="Delta PLC Ladder Diyagram Izgarası">
            {program.rungs.map((rung, rungIndex) => {
              const isEnd = Boolean(rung.isEnd);
              const isRungActive = !isEnd && !isOnline && cursor.rungIndex === rungIndex;
              const startStep = rungStartStepMap.get(rungIndex);
              const isEditingThisSegment = editingSegmentRung === rungIndex;
              const hasSegmentComment = !isEnd && Boolean(rung.comment?.trim());

              return (
                <div key={rung.id} className="flex flex-col">
                  {/* Authentic PC WPLSoft Red Segment Header Banner */}
                  {(hasSegmentComment || isEditingThisSegment) && (
                    <div
                      data-testid={`segment-header-${rungIndex}`}
                      className="flex items-stretch bg-[#FFFBFB] border-b border-[#E2E8F0]"
                    >
                      <div className="w-[54px] shrink-0 border-r border-[#CBD2DC] bg-[#F6F8FA] flex items-center justify-center font-mono text-[10px] font-semibold text-[#DC2626] select-none">
                        SEG
                      </div>
                      <div
                        className={`w-[4px] shrink-0 ${
                          leftRailActive ? 'bg-[#00C853]' : 'bg-[#1E293B]'
                        }`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 px-3 py-1.5 flex items-center justify-between gap-2">
                        {isEditingThisSegment ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              commitSegmentEdit();
                            }}
                            className="flex-1 flex items-center gap-1.5"
                          >
                            <input
                              type="text"
                              data-testid={`segment-input-${rungIndex}`}
                              value={segmentDraft}
                              onChange={(e) => setSegmentDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelSegmentEdit();
                                }
                              }}
                              placeholder="Segment açıklaması (Örn: Start-Stop Mühürleme Devresi)"
                              maxLength={120}
                              autoFocus
                              className="flex-1 h-7 px-2 rounded border border-[#DC2626]/50 bg-white text-xs font-semibold text-[#DC2626] focus:outline-none focus:ring-2 focus:ring-[#DC2626]/25"
                            />
                            <button
                              type="submit"
                              aria-label="Segment açıklamasını kaydet"
                              className="h-7 px-2 rounded bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Kaydet</span>
                            </button>
                            <button
                              type="button"
                              onClick={cancelSegmentEdit}
                              aria-label="Segment düzenlemesini iptal et"
                              className="h-7 w-7 rounded border border-[#CBD2DC] bg-white hover:bg-[#F1F5F9] text-[#475569] flex items-center justify-center cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            disabled={isOnline}
                            onClick={() => startSegmentEdit(rungIndex)}
                            title={isOnline ? undefined : 'Segment başlığını düzenlemek için tıklayın'}
                            className={`text-left text-xs font-bold text-[#DC2626] leading-snug tracking-tight ${
                              isOnline ? 'cursor-default' : 'hover:underline cursor-pointer'
                            }`}
                          >
                            {rung.comment}
                          </button>
                        )}
                      </div>
                      <div className="w-[4px] shrink-0 bg-[#1E293B]" aria-hidden="true" />
                    </div>
                  )}

                  {/* Rung Main Row */}
                  <div
                    role="row"
                    data-testid={isEnd ? 'rung-end' : `rung-${rungIndex}`}
                    className={`flex items-stretch ${
                      isRungActive ? 'bg-[#F8FBFF]' : 'bg-white'
                    }`}
                  >
                    {/* Left IL Step Number Gutter (Authentic WPLSoft Step Addressing) */}
                    <button
                      type="button"
                      disabled={isEnd || isOnline}
                      onClick={() => {
                        if (!isEnd && !isOnline) startSegmentEdit(rungIndex);
                      }}
                      title={
                        isEnd
                          ? 'Program sonu (END)'
                          : isOnline
                            ? `IL Adım ${startStep ?? '—'}`
                            : 'Segment açıklaması eklemek/düzenlemek için tıklayın'
                      }
                      data-testid={isEnd ? 'step-gutter-end' : `step-gutter-${rungIndex}`}
                      className={`w-[54px] shrink-0 border-r border-b border-[#CBD2DC] flex flex-col items-center justify-center font-mono text-xs select-none transition-colors ${
                        isEnd
                          ? 'bg-[#EEF4FC] text-[#0B4EA2] font-bold cursor-default'
                          : isRungActive
                            ? 'bg-[#E6F0FC] text-[#0B4EA2] font-bold cursor-pointer hover:bg-[#DCE9FA]'
                            : isOnline
                              ? 'bg-[#F6F8FA] text-[#475569] cursor-default'
                              : 'bg-[#F6F8FA] text-[#475569] hover:text-[#0B4EA2] hover:bg-[#EDF2F8] cursor-pointer'
                      }`}
                    >
                      <span>
                        {startStep !== undefined ? String(startStep) : isEnd ? 'END' : '·'}
                      </span>
                      {isEnd && (
                        <span className="text-[9px] text-[#0B4EA2] font-bold">END</span>
                      )}
                      {!isEnd && rung.rows.length > 1 && (
                        <span className="text-[9px] text-[#64748B] font-normal">
                          {rung.rows.length} kol
                        </span>
                      )}
                    </button>

                    {/* Left Power Rail */}
                    <div
                      className={`w-[4px] shrink-0 transition-colors ${
                        !isEnd && leftRailActive ? 'bg-[#00C853]' : 'bg-[#1E293B]'
                      }`}
                      aria-hidden="true"
                    />

                    {/* Rung Sub-rows */}
                    <div className="flex-1 flex flex-col">
                      {rung.rows.map((rowCells, rowIndex) => (
                        <div key={rowIndex} className="flex items-stretch">
                          {rowCells.map((cell, colIndex) => {
                            const hasBranchUp =
                              rowIndex > 0 &&
                              Boolean(rung.rows[rowIndex - 1]?.[colIndex]?.branchDown);
                            const cKey = cellKey(rungIndex, rowIndex, colIndex);
                            const lKey = leftWireKey(rungIndex, rowIndex, colIndex);
                            const bKey = branchWireKey(rungIndex, rowIndex, colIndex);
                            const bUpKey =
                              rowIndex > 0
                                ? branchWireKey(rungIndex, rowIndex - 1, colIndex)
                                : '';

                            const cellEnergized =
                              isOnline && Boolean(simState?.energizedCells[cKey]);
                            const cellConducting =
                              isOnline && Boolean(simState?.conductingCells?.[cKey]);
                            const leftEnergized =
                              isOnline && Boolean(simState?.energizedWires[lKey]);
                            const branchEnergized =
                              isOnline && Boolean(simState?.energizedWires[bKey]);
                            const branchUpEnergized =
                              isOnline &&
                              hasBranchUp &&
                              Boolean(simState?.energizedWires[bUpKey]);

                            return (
                              <LadderCell
                                key={colIndex}
                                cell={cell}
                                rungIndex={rungIndex}
                                rowIndex={rowIndex}
                                colIndex={colIndex}
                                isCoilColumn={colIndex === LADDER_COIL_COLUMN}
                                isSelected={
                                  !isEnd &&
                                  !isOnline &&
                                  cursor.rungIndex === rungIndex &&
                                  cursor.rowIndex === rowIndex &&
                                  cursor.colIndex === colIndex
                                }
                                isEndRung={isEnd}
                                isOnline={isOnline}
                                branchUp={hasBranchUp}
                                deviceComment={getElementComment(
                                  cell.element,
                                  program.deviceComments
                                )}
                                liveValueBadge={
                                  isOnline
                                    ? getLiveValueBadge(cell.element, simState)
                                    : undefined
                                }
                                energized={cellEnergized}
                                contactConducting={cellConducting}
                                leftWireEnergized={leftEnergized}
                                branchEnergized={branchEnergized}
                                branchUpEnergized={branchUpEnergized}
                                diagnosticSeverity={
                                  !isEnd
                                    ? cellDiagnosticMap.get(
                                        `${rungIndex}:${rowIndex}:${colIndex}`
                                      )
                                    : undefined
                                }
                                zoomDensity={zoomDensity}
                                onSelect={() =>
                                  onSelectCell({ rungIndex, rowIndex, colIndex })
                                }
                                onActivate={() =>
                                  onActivateCell({ rungIndex, rowIndex, colIndex })
                                }
                                onOnlineClick={() =>
                                  onOnlineCellClick({ rungIndex, rowIndex, colIndex })
                                }
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {/* Right Power Rail */}
                    <div className="w-[4px] shrink-0 bg-[#1E293B]" aria-hidden="true" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
};
