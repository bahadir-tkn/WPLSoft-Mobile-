import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CellElement,
  CursorPosition,
  FunctionToolId,
  LadderProgram,
} from './types/plc';
import { FUNCTION_TOOLBAR_ITEMS, PLC_MODELS } from './core/plcModels';
import { useLadderEditor } from './hooks/useLadderEditor';
import { usePlcSimulator } from './hooks/usePlcSimulator';
import { useViewportLayout } from './hooks/useViewportLayout';
import { WplHeader } from './components/layout/WplHeader';
import { FunctionToolbar } from './components/layout/FunctionToolbar';
import { MobileCommandPalette } from './components/layout/MobileCommandPalette';
import { QuickCommandBar } from './components/layout/QuickCommandBar';
import { OnlineSimBar, type ZoomDensity } from './components/layout/OnlineSimBar';
import { LadderGrid } from './components/ladder/LadderGrid';
import { IlCodeDrawer } from './components/panels/IlCodeDrawer';
import { StatusBar } from './components/layout/StatusBar';
import type { OnlineTargetDescriptor } from './components/modals/OnlineControlModal';
import { OfflineIndicator } from './components/pwa/OfflineIndicator';
import { ToastBanner } from './components/layout/ToastBanner';

const CellEditModal = lazy(() =>
  import('./components/ladder/CellEditModal').then((m) => ({
    default: m.CellEditModal,
  }))
);
const DeviceMonitor = lazy(() =>
  import('./components/panels/DeviceMonitor').then((m) => ({
    default: m.DeviceMonitor,
  }))
);
const ShortcutsModal = lazy(() =>
  import('./components/modals/ShortcutsModal').then((m) => ({
    default: m.ShortcutsModal,
  }))
);
const TemplatesModal = lazy(() =>
  import('./components/modals/TemplatesModal').then((m) => ({
    default: m.TemplatesModal,
  }))
);
const ProjectIoModal = lazy(() =>
  import('./components/modals/ProjectIoModal').then((m) => ({
    default: m.ProjectIoModal,
  }))
);
const SearchCrossRefModal = lazy(() =>
  import('./components/modals/SearchCrossRefModal').then((m) => ({
    default: m.SearchCrossRefModal,
  }))
);
const OnlineControlModal = lazy(() =>
  import('./components/modals/OnlineControlModal').then((m) => ({
    default: m.OnlineControlModal,
  }))
);
const WiringDiagramModal = lazy(() =>
  import('./components/panels/WiringDiagramModal').then((m) => ({
    default: m.WiringDiagramModal,
  }))
);

const VALID_FUNCTION_KEYS = new Set<string>([
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]);

function isEditableWordDevice(raw: string): boolean {
  const norm = raw.trim().toUpperCase();
  return norm.startsWith('D') || norm.startsWith('T') || norm.startsWith('C');
}

function buildOnlineTargetForElement(
  el: CellElement,
  deviceComments: Record<string, string>
): OnlineTargetDescriptor | null {
  const uniqueWordAddrs = (candidates: string[]): string[] => {
    const out: string[] = [];
    for (const raw of candidates) {
      const norm = raw.trim().toUpperCase();
      if (isEditableWordDevice(norm) && !out.includes(norm)) {
        out.push(norm);
      }
    }
    return out;
  };

  switch (el.kind) {
    case 'CONTACT': {
      const addr = el.address.trim().toUpperCase();
      if (addr.startsWith('T') || addr.startsWith('C')) {
        return {
          mode: 'value',
          addresses: [addr],
          comment: deviceComments[addr] ?? el.comment,
        };
      }
      return {
        mode: 'bit',
        address: addr,
        comment: deviceComments[addr] ?? el.comment,
      };
    }

    case 'COIL': {
      const addr = el.address.trim().toUpperCase();
      if (addr.startsWith('T') || addr.startsWith('C') || addr.startsWith('D')) {
        return {
          mode: 'value',
          addresses: [addr],
          comment: deviceComments[addr] ?? el.comment,
        };
      }
      return {
        mode: 'bit',
        address: addr,
        comment: deviceComments[addr] ?? el.comment,
      };
    }

    case 'ALT': {
      const addr = el.target.trim().toUpperCase();
      return {
        mode: 'bit',
        address: addr,
        comment: deviceComments[addr] ?? el.comment,
      };
    }

    case 'TMR':
    case 'CNT': {
      const addrs = uniqueWordAddrs([el.address, el.preset]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[el.address] ?? el.comment }
        : null;
    }

    case 'COMPARE': {
      const addrs = uniqueWordAddrs([el.operandA, el.operandB]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[addrs[0]] ?? el.comment }
        : null;
    }

    case 'MOV': {
      const addrs = uniqueWordAddrs([el.destination, el.source]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[el.destination] ?? el.comment }
        : null;
    }

    case 'CMP': {
      const addrs = uniqueWordAddrs([el.source1, el.source2]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[addrs[0]] ?? el.comment }
        : null;
    }

    case 'MATH': {
      const addrs = uniqueWordAddrs([el.destination, el.source1, el.source2]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[el.destination] ?? el.comment }
        : null;
    }

    case 'INCDEC': {
      const addrs = uniqueWordAddrs([el.target]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[el.target] ?? el.comment }
        : null;
    }

    case 'TRD': {
      const addrs = uniqueWordAddrs([el.destination]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[el.destination] ?? el.comment }
        : null;
    }

    case 'TWR': {
      const addrs = uniqueWordAddrs([el.source]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[el.source] ?? el.comment }
        : null;
    }

    case 'SQR':
    case 'FLOAT_MOV':
    case 'FLOAT_UNARY': {
      const addrs = uniqueWordAddrs([el.destination, el.source]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[el.destination] ?? el.comment }
        : null;
    }

    case 'FLOAT_MATH': {
      const addrs = uniqueWordAddrs([el.destination, el.source1, el.source2]);
      return addrs.length > 0
        ? { mode: 'value', addresses: addrs, comment: deviceComments[el.destination] ?? el.comment }
        : null;
    }

    case 'TZCP': {
      const addrs = uniqueWordAddrs([el.current, el.start1, el.start2]);
      if (addrs.length > 0) {
        return { mode: 'value', addresses: addrs, comment: deviceComments[el.destination] ?? el.comment };
      }
      return {
        mode: 'bit',
        address: el.destination.trim().toUpperCase(),
        comment: deviceComments[el.destination] ?? el.comment,
      };
    }

    case 'ZRST': {
      const addrs = uniqueWordAddrs([el.start, el.end]);
      if (addrs.length > 0) {
        return { mode: 'value', addresses: addrs, comment: el.comment };
      }
      return { mode: 'bit', address: el.start.trim().toUpperCase(), comment: el.comment };
    }

    default:
      return null;
  }
}

export default function App() {
  const viewport = useViewportLayout();
  const [isOnlineMode, setIsOnlineMode] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);
  const [isWiringModalOpen, setIsWiringModalOpen] = useState(false);
  const [isProjectIoModalOpen, setIsProjectIoModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [onlineControlTarget, setOnlineControlTarget] =
    useState<OnlineTargetDescriptor | null>(null);
  const [showIlPanel, setShowIlPanel] = useState(() => viewport.isDesktopWide);
  const [zoomDensity, setZoomDensity] = useState<ZoomDensity>(() =>
    viewport.isCompactTouch ? 'compact' : 'normal'
  );
  const [showQuickCmd, setShowQuickCmd] = useState<boolean>(() => viewport.isDesktopWide);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const prevCompactRef = useRef<boolean>(viewport.isCompactTouch);
  const prevLandscapeRef = useRef<boolean>(viewport.isPhoneLandscape);

  // Smoothly adapt layout defaults when rotating phone or resizing across desktop/compact breakpoints
  useEffect(() => {
    const enteredCompact = viewport.isCompactTouch && !prevCompactRef.current;
    const leftCompact = !viewport.isCompactTouch && prevCompactRef.current;
    const enteredLandscape = viewport.isPhoneLandscape && !prevLandscapeRef.current;

    if (enteredLandscape || enteredCompact) {
      setShowIlPanel(false);
      setShowQuickCmd(false);
      setZoomDensity('compact');
    } else if (leftCompact && viewport.isDesktopWide) {
      setZoomDensity('normal');
      setShowQuickCmd(true);
    }

    prevCompactRef.current = viewport.isCompactTouch;
    prevLandscapeRef.current = viewport.isPhoneLandscape;
  }, [viewport.isCompactTouch, viewport.isDesktopWide, viewport.isPhoneLandscape]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const editor = useLadderEditor(showToast, isOnlineMode);
  const simulator = usePlcSimulator(
    editor.program,
    isOnlineMode,
    setIsOnlineMode,
    showToast
  );
  const modelSpec = PLC_MODELS[editor.program.model];

  const activeToolDef = useMemo(
    () =>
      FUNCTION_TOOLBAR_ITEMS.find((item) => item.id === editor.activeTool) ??
      FUNCTION_TOOLBAR_ITEMS[0],
    [editor.activeTool]
  );

  const errorCount = useMemo(
    () =>
      editor.compileResult.diagnostics.filter((d) => d.severity === 'error').length,
    [editor.compileResult.diagnostics]
  );

  const warningCount = useMemo(
    () =>
      editor.compileResult.diagnostics.filter((d) => d.severity === 'warning').length,
    [editor.compileResult.diagnostics]
  );

  const handleCompileCheck = useCallback(() => {
    if (viewport.isPhoneLandscape && simulator.isOnline) {
      simulator.setIsMonitorOpen(false);
    }
    setShowIlPanel(true);
    if (errorCount > 0) {
      showToast(
        `Derleme tamamlandı: ${errorCount} hata, ${warningCount} uyarı bulundu. Detaylar IL panelinde.`
      );
    } else if (warningCount > 0) {
      showToast(
        `Derleme tamamlandı (${editor.compileResult.stepCount} Step): ${warningCount} uyarı (örn. Çift Bobin) var.`
      );
    } else {
      showToast(
        `Derleme başarılı: ${editor.compileResult.stepCount} Step, 0 hata, 0 uyarı.`
      );
    }
  }, [
    editor.compileResult.stepCount,
    errorCount,
    showToast,
    simulator,
    viewport.isPhoneLandscape,
    warningCount,
  ]);

  const handleToggleIlPanel = useCallback(() => {
    setShowIlPanel((prev) => {
      const next = !prev;
      if (next && viewport.isPhoneLandscape && simulator.isOnline) {
        simulator.setIsMonitorOpen(false);
      }
      return next;
    });
  }, [simulator, viewport.isPhoneLandscape]);

  const handleToggleMonitor = useCallback(() => {
    simulator.setIsMonitorOpen((prev) => {
      const next = !prev;
      if (next && viewport.isPhoneLandscape) {
        setShowIlPanel(false);
      }
      return next;
    });
  }, [simulator, viewport.isPhoneLandscape]);

  const handleToggleOnline = useCallback(() => {
    if (simulator.isOnline) {
      setOnlineControlTarget(null);
      simulator.exitOnline();
      return;
    }
    if (editor.editModal) {
      editor.handleCancelModal();
    }
    if (!viewport.isDesktopWide) {
      setShowIlPanel(false);
    }
    simulator.enterOnline(errorCount > 0);
  }, [editor, errorCount, simulator, viewport.isDesktopWide]);

  const handleLoadTemplate = useCallback(
    (templateProgram: LadderProgram, startSimulation: boolean) => {
      editor.loadExternalProgram(
        templateProgram,
        `"${templateProgram.projectName}" şablonu yüklendi.`
      );
      setIsTemplatesModalOpen(false);
      if (startSimulation) {
        if (!viewport.isDesktopWide) {
          setShowIlPanel(false);
        }
        simulator.enterOnline(false, templateProgram);
      }
    },
    [editor, simulator, viewport.isDesktopWide]
  );

  const cycleZoomDensity = useCallback(() => {
    setZoomDensity((prev) =>
      prev === 'compact' ? 'normal' : prev === 'normal' ? 'large' : 'compact'
    );
  }, []);

  const isSelectedEditable =
    !simulator.isOnline &&
    editor.selectedCell !== null &&
    editor.selectedCell.element.kind !== 'EMPTY' &&
    editor.selectedCell.element.kind !== 'HLINE' &&
    editor.selectedCell.element.kind !== 'END';

  const handleOnlineCellClick = useCallback(
    (pos: CursorPosition) => {
      if (!simulator.isOnline) return;
      const rung = editor.program.rungs[pos.rungIndex];
      const cell = rung?.rows[pos.rowIndex]?.[pos.colIndex];
      if (!cell) return;
      const descriptor = buildOnlineTargetForElement(
        cell.element,
        editor.program.deviceComments
      );
      if (descriptor) {
        setOnlineControlTarget(descriptor);
      }
    },
    [editor.program.deviceComments, editor.program.rungs, simulator.isOnline]
  );

  const anyModalOpen =
    isShortcutsModalOpen ||
    isTemplatesModalOpen ||
    isWiringModalOpen ||
    isProjectIoModalOpen ||
    isSearchModalOpen ||
    Boolean(onlineControlTarget) ||
    Boolean(editor.editModal);

  // Global keyboard shortcuts (F1–F12 disabled during Simulation mode + Ctrl+F Search + Arrow navigation)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (anyModalOpen) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchModalOpen(true);
        return;
      }

      const target = e.target as HTMLElement | null;
      const isFormInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');
      if (isFormInput) return;

      if (VALID_FUNCTION_KEYS.has(e.key)) {
        if (isOnlineMode) return;
        e.preventDefault();
        editor.triggerTool(e.key as FunctionToolId);
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        editor.moveCursor('right');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        editor.moveCursor('left');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        editor.moveCursor('down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        editor.moveCursor('up');
      } else if (e.key === 'Home') {
        e.preventDefault();
        editor.moveCursor('home');
      } else if (e.key === 'End') {
        e.preventDefault();
        editor.moveCursor('end');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [anyModalOpen, editor, isOnlineMode]);

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden bg-[#ECEEF2] wpl-safe-shell">
      <WplHeader
        projectName={editor.program.projectName}
        model={editor.program.model}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        showIlPanel={showIlPanel}
        isOnline={simulator.isOnline}
        isRunning={simulator.simState.running}
        errorCount={errorCount}
        warningCount={warningCount}
        compactHeight={viewport.isPhoneLandscape}
        onModelChange={editor.setModel}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onCompileCheck={handleCompileCheck}
        onToggleOnline={handleToggleOnline}
        onToggleIlPanel={handleToggleIlPanel}
        onOpenTemplatesModal={() => setIsTemplatesModalOpen(true)}
        onOpenWiringModal={() => setIsWiringModalOpen(true)}
        onOpenProjectIoModal={() => setIsProjectIoModalOpen(true)}
        onOpenSearchModal={() => setIsSearchModalOpen(true)}
        onOpenShortcutsModal={() => setIsShortcutsModalOpen(true)}
      />

      {simulator.isOnline ? (
        <OnlineSimBar
          running={simulator.simState.running}
          scanCount={simulator.simState.scanCount}
          scanTimeMs={simulator.simState.scanTimeMs}
          speedMultiplier={simulator.speedMultiplier}
          zoomDensity={zoomDensity}
          isMonitorOpen={simulator.isMonitorOpen}
          compactHeight={viewport.isPhoneLandscape}
          sideDockMonitor={viewport.isPhoneLandscape}
          onChangeSpeed={simulator.setSpeedMultiplier}
          onChangeZoom={setZoomDensity}
          onToggleMonitor={handleToggleMonitor}
          onRun={() => simulator.setRunning(true)}
          onStop={() => simulator.setRunning(false)}
          onSingleStep={simulator.singleStep}
          onResetMemory={simulator.resetMemory}
        />
      ) : (
        <>
          <FunctionToolbar
            activeTool={editor.activeTool}
            onSelectTool={editor.triggerTool}
            hidden={viewport.isCompactTouch}
          />
          <MobileCommandPalette
            visible={viewport.isCompactTouch}
            compactHeight={viewport.isPhoneLandscape}
            activeTool={editor.activeTool}
            model={editor.program.model}
            recentCommands={editor.recentCommands}
            isSelectedEditable={isSelectedEditable}
            showQuickCmd={showQuickCmd}
            zoomDensity={zoomDensity}
            onSelectTool={editor.triggerTool}
            onPlaceElement={editor.placePresetElement}
            onEditSelectedCell={() => editor.openEditModalForCell(editor.cursor)}
            onToggleQuickCmd={() => setShowQuickCmd((v) => !v)}
            onCycleZoom={cycleZoomDensity}
          />
          {showQuickCmd && (
            <QuickCommandBar
              compact={viewport.isCompactTouch}
              onExecuteCommand={editor.applyQuickCommand}
              onClose={() => setShowQuickCmd(false)}
            />
          )}
        </>
      )}

      {/* Split Workspace: Ladder Grid + Side-Docked IL or Phone-Landscape Device Monitor */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <div
          className={`flex-1 flex min-h-0 min-w-0 ${
            showIlPanel && !viewport.isDesktopWide && !viewport.isPhoneLandscape
              ? 'hidden'
              : 'flex'
          }`}
        >
          <LadderGrid
            program={editor.program}
            compileResult={editor.compileResult}
            cursor={editor.cursor}
            selectedCell={editor.selectedCell}
            isOnline={simulator.isOnline}
            simState={simulator.isOnline ? simulator.simState : null}
            zoomDensity={zoomDensity}
            compactMode={viewport.isCompactTouch}
            showQuickCmd={showQuickCmd}
            onChangeZoom={setZoomDensity}
            onToggleQuickCmd={() => setShowQuickCmd((v) => !v)}
            onSelectCell={editor.handleSelectCell}
            onActivateCell={editor.handleActivateCell}
            onOnlineCellClick={handleOnlineCellClick}
            onEditSelectedCell={() => editor.openEditModalForCell(editor.cursor)}
            onDeleteRung={editor.handleDeleteRung}
            onSetRungComment={editor.setRungComment}
          />
        </div>

        {showIlPanel && (
          <div
            className={
              viewport.isPhoneLandscape
                ? 'w-[266px] sm:w-[292px] shrink-0 h-full'
                : 'w-full lg:w-[300px] xl:w-[320px] shrink-0 h-full'
            }
          >
            <IlCodeDrawer
              compileResult={editor.compileResult}
              activeRungIndex={editor.cursor.rungIndex}
              isOnline={simulator.isOnline}
              onSelectRung={(rungIdx) => {
                editor.jumpToRung(rungIdx);
                if (!viewport.isDesktopWide && !viewport.isPhoneLandscape) {
                  setShowIlPanel(false);
                }
              }}
              onSelectDiagnosticCell={(rungIdx, rowIdx, colIdx) => {
                editor.jumpToCell(rungIdx, rowIdx, colIdx);
                if (!viewport.isDesktopWide && !viewport.isPhoneLandscape) {
                  setShowIlPanel(false);
                }
              }}
              onOpenProjectIo={() => setIsProjectIoModalOpen(true)}
              onClose={() => setShowIlPanel(false)}
              onNotify={showToast}
            />
          </div>
        )}

        {/* Phone Landscape: Dock Device Monitor on the RIGHT so Ladder Diagram keeps full height */}
        {simulator.isOnline && viewport.isPhoneLandscape && (
          <Suspense fallback={null}>
            <DeviceMonitor
              program={editor.program}
              modelSpec={modelSpec}
              simState={simulator.simState}
              inputModes={simulator.inputModes}
              isOpen={simulator.isMonitorOpen}
              dockMode="right"
              onToggleOpen={handleToggleMonitor}
              onSetInputBit={simulator.setInputBit}
              onToggleInputBit={simulator.toggleInputBit}
              onSetInputMode={simulator.setInputMode}
              onToggleRelayBit={simulator.toggleRelayBit}
              onSetRegisterValue={simulator.setRegisterValue}
              onSyncRtcNow={simulator.syncRtcNow}
              onShiftRtcSeconds={simulator.shiftRtcSeconds}
            />
          </Suspense>
        )}
      </div>

      {/* Portrait & Desktop: Bottom Collapsible Device Monitor Drawer */}
      {simulator.isOnline && !viewport.isPhoneLandscape && (
        <Suspense fallback={null}>
          <DeviceMonitor
            program={editor.program}
            modelSpec={modelSpec}
            simState={simulator.simState}
            inputModes={simulator.inputModes}
            isOpen={simulator.isMonitorOpen}
            dockMode="bottom"
            onToggleOpen={handleToggleMonitor}
            onSetInputBit={simulator.setInputBit}
            onToggleInputBit={simulator.toggleInputBit}
            onSetInputMode={simulator.setInputMode}
            onToggleRelayBit={simulator.toggleRelayBit}
            onSetRegisterValue={simulator.setRegisterValue}
            onSyncRtcNow={simulator.syncRtcNow}
            onShiftRtcSeconds={simulator.shiftRtcSeconds}
          />
        </Suspense>
      )}

      <StatusBar
        modelSpec={modelSpec}
        cursor={editor.cursor}
        activeToolDef={activeToolDef}
        editableRungCount={editor.editableRungCount}
        stepCount={editor.compileResult.stepCount}
        errorCount={errorCount}
        warningCount={warningCount}
        isOnline={simulator.isOnline}
        isRunning={simulator.simState.running}
        scanCount={simulator.simState.scanCount}
        scanTimeMs={simulator.simState.scanTimeMs}
        storageError={editor.storageError}
        hidden={viewport.isPhoneLandscape}
        showCursorInfo={viewport.isCompactTouch}
      />

      <Suspense fallback={null}>
        {!simulator.isOnline && editor.editModal && (
          <CellEditModal
            key={`${editor.editModal.position.rungIndex}-${editor.editModal.position.rowIndex}-${editor.editModal.position.colIndex}-${editor.editModal.element.kind}`}
            element={editor.editModal.element}
            isNewPlacement={editor.editModal.isNewPlacement}
            model={editor.program.model}
            deviceComments={editor.program.deviceComments}
            onSave={editor.handleSaveModal}
            onDelete={editor.handleDeleteFromModal}
            onCancel={editor.handleCancelModal}
          />
        )}

        {simulator.isOnline && onlineControlTarget && (
          <OnlineControlModal
            target={onlineControlTarget}
            simState={simulator.simState}
            onSetInputBit={simulator.setInputBit}
            onSetRelayBit={simulator.setRelayBit}
            onPulseBit={simulator.pulseBit}
            onSetRegisterValue={simulator.setRegisterValue}
            onSetTimerValue={simulator.setTimerValue}
            onSetCounterValue={simulator.setCounterValue}
            onNotify={showToast}
            onClose={() => setOnlineControlTarget(null)}
          />
        )}

        {isTemplatesModalOpen && (
          <TemplatesModal
            isOpen={isTemplatesModalOpen}
            model={editor.program.model}
            currentProgram={editor.program}
            onLoadTemplate={handleLoadTemplate}
            onNotify={showToast}
            onClose={() => setIsTemplatesModalOpen(false)}
          />
        )}

        {isWiringModalOpen && (
          <WiringDiagramModal
            isOpen={isWiringModalOpen}
            program={editor.program}
            onClose={() => setIsWiringModalOpen(false)}
          />
        )}

        {isProjectIoModalOpen && (
          <ProjectIoModal
            isOpen={isProjectIoModalOpen}
            program={editor.program}
            compileResult={editor.compileResult}
            onImportProgram={editor.loadExternalProgram}
            onRenameProject={editor.setProjectName}
            onResetGrid={editor.handleResetGrid}
            onNotify={showToast}
            onClose={() => setIsProjectIoModalOpen(false)}
          />
        )}

        {isSearchModalOpen && (
          <SearchCrossRefModal
            isOpen={isSearchModalOpen}
            program={editor.program}
            isLocked={simulator.isOnline}
            onJumpToCell={(rungIdx, rowIdx, colIdx) => {
              editor.jumpToCell(rungIdx, rowIdx, colIdx);
              if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                setShowIlPanel(false);
              }
            }}
            onUpdateDeviceComment={editor.setDeviceComment}
            onClose={() => setIsSearchModalOpen(false)}
          />
        )}

        {isShortcutsModalOpen && (
          <ShortcutsModal
            isOpen={isShortcutsModalOpen}
            onClose={() => setIsShortcutsModalOpen(false)}
          />
        )}
      </Suspense>

      <OfflineIndicator />
      <ToastBanner message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}
