import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Cable,
  CheckSquare,
  Edit3,
  FileCode2,
  FolderOpen,
  HelpCircle,
  MoreHorizontal,
  Play,
  Redo2,
  Search,
  Undo2,
} from 'lucide-react';
import type { PlcModelId } from '../../types/plc';
import { PLC_MODEL_LIST } from '../../core/plcModels';
import { PWAInstallButton } from '../pwa/PWAInstallButton';

interface WplHeaderProps {
  projectName: string;
  model: PlcModelId;
  canUndo: boolean;
  canRedo: boolean;
  showIlPanel: boolean;
  isOnline: boolean;
  isRunning: boolean;
  errorCount: number;
  warningCount: number;
  compactHeight?: boolean;
  onModelChange: (model: PlcModelId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCompileCheck: () => void;
  onToggleOnline: () => void;
  onToggleIlPanel: () => void;
  onOpenTemplatesModal: () => void;
  onOpenWiringModal: () => void;
  onOpenProjectIoModal: () => void;
  onOpenSearchModal: () => void;
  onOpenShortcutsModal: () => void;
}

export const WplHeader: React.FC<WplHeaderProps> = ({
  projectName,
  model,
  canUndo,
  canRedo,
  showIlPanel,
  isOnline,
  isRunning,
  errorCount,
  warningCount,
  compactHeight = false,
  onModelChange,
  onUndo,
  onRedo,
  onCompileCheck,
  onToggleOnline,
  onToggleIlPanel,
  onOpenTemplatesModal,
  onOpenWiringModal,
  onOpenProjectIoModal,
  onOpenSearchModal,
  onOpenShortcutsModal,
}) => {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleOutside = (e: PointerEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('pointerdown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [moreMenuOpen]);

  const hasDiagnostics = errorCount > 0 || warningCount > 0;
  const controlHeight = compactHeight ? 'h-7' : 'h-7 sm:h-8';
  const iconSquare = compactHeight ? 'h-7 w-7' : 'h-7 w-7 sm:h-8 sm:w-8';

  return (
    <header
      className={`shrink-0 bg-[#F7F8FA] border-b border-[#CBD2DC] px-2 sm:px-3.5 ${
        compactHeight ? 'h-10' : 'h-11'
      } flex items-center justify-between gap-1 sm:gap-2.5`}
    >
      {/* Zone 1: Brand, PLC Model & Undo/Redo (Edit mode only) */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        <div
          className={`${compactHeight ? 'w-6 h-6' : 'w-6 h-6 sm:w-7 sm:h-7'} rounded text-white flex items-center justify-center shrink-0 transition-colors ${
            isOnline ? (isRunning ? 'bg-[#00C853]' : 'bg-[#DC2626]') : 'bg-[#0B4EA2]'
          }`}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <path d="M3 5v14M21 5v14M3 12h5M16 12h5M8 8v8M16 8v8" strokeLinecap="square" />
          </svg>
        </div>

        <h1 className="sr-only sm:not-sr-only text-sm font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0">
          WPLSoft Web
        </h1>

        <span className="hidden 2xl:inline text-xs text-[#94A3B8]" aria-hidden="true">
          ·
        </span>
        <span className="hidden 2xl:inline text-xs font-mono text-[#475569] truncate max-w-[170px]">
          {projectName}
        </span>

        <div className="flex items-center gap-1 sm:ml-1.5 min-w-0">
          {isOnline ? (
            <span className="font-mono text-xs font-semibold text-[#0B4EA2] whitespace-nowrap px-1">
              {model}
            </span>
          ) : (
            <>
              <select
                id="plc-model-select"
                aria-label="PLC Modeli"
                value={model}
                onChange={(e) => onModelChange(e.target.value as PlcModelId)}
                className={`${controlHeight} w-[74px] sm:w-auto min-w-0 rounded border border-[#B8C2D1] bg-white px-1 sm:px-2 text-[11px] sm:text-xs font-mono font-semibold text-[#0B4EA2] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B4EA2] cursor-pointer`}
              >
                {PLC_MODEL_LIST.map((spec) => (
                  <option key={spec.id} value={spec.id}>
                    {spec.recommended ? `${spec.label} ★` : spec.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-0.5 ml-0.5">
                <button
                  type="button"
                  data-testid="undo-btn"
                  onClick={onUndo}
                  disabled={!canUndo}
                  aria-label="Geri Al (Ctrl+Z)"
                  title="Geri Al (Ctrl+Z)"
                  className={`${iconSquare} rounded border border-[#CBD2DC] bg-white text-[#334155] hover:bg-[#EDF2F8] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center cursor-pointer`}
                >
                  <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-testid="redo-btn"
                  onClick={onRedo}
                  disabled={!canRedo}
                  aria-label="İleri Al (Ctrl+Y)"
                  title="İleri Al (Ctrl+Y)"
                  className={`${iconSquare} rounded border border-[#CBD2DC] bg-white text-[#334155] hover:bg-[#EDF2F8] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center cursor-pointer`}
                >
                  <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Zone 2: Focused Contextual Actions (Zero Disabled Ghost Buttons in Sim Mode) */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {!isOnline && (
          <>
            <button
              type="button"
              onClick={onOpenProjectIoModal}
              data-testid="open-project-io-btn"
              aria-label="Dosya, PC WPLSoft IL aktarımı ve yeni proje"
              title="Dosya / IL (.il, .txt, .json, Projeler)"
              className={`hidden sm:flex ${controlHeight} px-2 lg:px-2.5 rounded border border-[#CBD2DC] bg-white text-[#1E293B] hover:bg-[#EDF2F8] text-xs font-medium items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
              <span className="hidden md:inline">Dosya / IL</span>
            </button>

            <button
              type="button"
              onClick={onOpenTemplatesModal}
              data-testid="open-templates-btn"
              aria-label="Hazır endüstriyel ders şablonlarını aç"
              title="Hazır Şablonlar ve Özel Devreler"
              className={`hidden sm:flex ${controlHeight} px-2 lg:px-2.5 rounded border border-[#CBD2DC] bg-white text-[#1E293B] hover:bg-[#EDF2F8] text-xs font-medium items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
            >
              <BookOpen className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
              <span className="hidden md:inline">Şablonlar</span>
            </button>

            {hasDiagnostics && (
              <button
                type="button"
                onClick={onCompileCheck}
                aria-label="Derleme hata ve uyarılarını incele"
                className={`hidden sm:flex ${controlHeight} px-2 rounded border text-xs font-semibold items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                  errorCount > 0
                    ? 'border-[#DC2626] bg-[#FEF2F2] text-[#B91C1C]'
                    : 'border-[#D97706] bg-[#FFFBEB] text-[#92400E]'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="font-mono text-[11px]">
                  {errorCount > 0 ? `${errorCount} Hata` : `${warningCount} Uyarı`}
                </span>
              </button>
            )}
          </>
        )}

        {/* Secondary Utilities: Inline on Desktop (lg+), Clean Overflow Menu on Phone & Landscape */}
        <button
          type="button"
          onClick={onOpenSearchModal}
          data-testid="open-search-btn"
          aria-label="Ladder içinde ara ve kullanılan adresleri görüntüle"
          title="Ara / Kullanılan Adresler (Ctrl+F)"
          className={`hidden lg:flex ${controlHeight} xl:px-2.5 lg:w-8 xl:w-auto rounded border border-[#CBD2DC] bg-white text-[#1E293B] hover:bg-[#EDF2F8] text-xs font-medium items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
        >
          <Search className="w-3.5 h-3.5 text-[#0B4EA2] shrink-0" aria-hidden="true" />
          <span className="hidden xl:inline">Ara</span>
        </button>

        <button
          type="button"
          onClick={onOpenWiringModal}
          data-testid="open-wiring-btn"
          aria-label="BETİ Delta PLC Eğitim Seti kablolama şemasını aç"
          title="Kablolama Şeması (BETİ)"
          className={`hidden lg:flex ${controlHeight} px-2.5 rounded border border-[#CBD2DC] bg-white text-[#1E293B] hover:bg-[#EDF2F8] text-xs font-medium items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
        >
          <Cable className="w-3.5 h-3.5 text-[#0B4EA2] shrink-0" aria-hidden="true" />
          <span>Kablolama</span>
        </button>

        {/* Overflow Menu for Secondary Tools on Mobile / Tablet / Phone Landscape */}
        <div ref={moreMenuRef} className="relative lg:hidden">
          <button
            type="button"
            data-testid="header-more-btn"
            aria-expanded={moreMenuOpen}
            aria-haspopup="menu"
            aria-label="Diğer araçlar"
            title="Diğer araçlar (Ara, Kablolama, Kısayollar)"
            onClick={() => setMoreMenuOpen((v) => !v)}
            className={`${iconSquare} rounded border border-[#CBD2DC] bg-white text-[#334155] hover:bg-[#EDF2F8] flex items-center justify-center cursor-pointer`}
          >
            <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
          </button>

          {moreMenuOpen && (
            <div
              role="menu"
              data-testid="header-more-menu"
              className="absolute right-0 mt-1 w-48 bg-white border border-[#CBD2DC] rounded-md shadow-lg py-1 z-50 text-xs"
            >
              {!isOnline && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onOpenProjectIoModal();
                    }}
                    className="sm:hidden w-full px-3 py-2 text-left text-[#0F172A] hover:bg-[#F1F5F9] flex items-center gap-2 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
                    <span>Dosya / IL Aktar</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onOpenTemplatesModal();
                    }}
                    className="sm:hidden w-full px-3 py-2 text-left text-[#0F172A] hover:bg-[#F1F5F9] flex items-center gap-2 cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
                    <span>Hazır Şablonlar</span>
                  </button>
                  <div className="sm:hidden my-1 border-t border-[#E2E8F0]" />
                </>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreMenuOpen(false);
                  onOpenSearchModal();
                }}
                className="w-full px-3 py-2 text-left text-[#0F172A] hover:bg-[#F1F5F9] flex items-center gap-2 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
                <span>Ara &amp; Adresler</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreMenuOpen(false);
                  onOpenWiringModal();
                }}
                className="w-full px-3 py-2 text-left text-[#0F172A] hover:bg-[#F1F5F9] flex items-center gap-2 cursor-pointer"
              >
                <Cable className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
                <span>Kablolama (BETİ)</span>
              </button>
              {!isOnline && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onCompileCheck();
                  }}
                  className="w-full px-3 py-2 text-left text-[#0F172A] hover:bg-[#F1F5F9] flex items-center gap-2 cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
                  <span>Derleme Denetimi</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreMenuOpen(false);
                  onOpenShortcutsModal();
                }}
                className="w-full px-3 py-2 text-left text-[#0F172A] hover:bg-[#F1F5F9] flex items-center gap-2 cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5 text-[#475569]" aria-hidden="true" />
                <span>Kısayollar &amp; Bilgi</span>
              </button>
            </div>
          )}
        </div>

        {/* IL Toggle (with compact diagnostic indicator on <sm so narrow headers never overlap) */}
        <button
          type="button"
          onClick={onToggleIlPanel}
          aria-pressed={showIlPanel}
          data-testid="toggle-il-btn"
          aria-label={
            hasDiagnostics
              ? `Instruction List (IL) panelini aç (${
                  errorCount > 0 ? `${errorCount} hata` : `${warningCount} uyarı`
                })`
              : 'Instruction List (IL) panelini aç veya kapat'
          }
          className={`relative ${controlHeight} px-2 sm:px-2.5 rounded border text-xs font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            showIlPanel
              ? 'border-[#0B4EA2] bg-[#EEF4FC] text-[#0B4EA2]'
              : hasDiagnostics && !isOnline
                ? errorCount > 0
                  ? 'border-[#DC2626] bg-[#FEF2F2] text-[#B91C1C] sm:border-[#CBD2DC] sm:bg-white sm:text-[#1E293B]'
                  : 'border-[#D97706] bg-[#FFFBEB] text-[#92400E] sm:border-[#CBD2DC] sm:bg-white sm:text-[#1E293B]'
                : 'border-[#CBD2DC] bg-white text-[#1E293B] hover:bg-[#EDF2F8]'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>IL</span>
          {hasDiagnostics && !isOnline && (
            <span
              aria-hidden="true"
              className={`sm:hidden absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-0.5 rounded-full font-mono text-[9px] font-bold text-white leading-none shadow-xs ${
                errorCount > 0 ? 'bg-[#DC2626]' : 'bg-[#D97706]'
              }`}
            >
              {errorCount > 0 ? errorCount : warningCount}
            </span>
          )}
        </button>

        {/* Primary Action CTA: Start Simulation OR Return to Edit Mode */}
        <button
          type="button"
          onClick={onToggleOnline}
          aria-pressed={isOnline}
          data-testid="toggle-online-btn"
          aria-label={
            isOnline
              ? 'Simülasyondan çık ve düzenleme moduna dön'
              : 'Sanal PLC simülasyonunu başlat'
          }
          className={`${controlHeight} px-2.5 sm:px-3 rounded border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isOnline
              ? 'border-[#0B4EA2] bg-[#0B4EA2] text-white hover:bg-[#073878]'
              : 'border-[#00963F] bg-[#00A846] text-white hover:bg-[#008C3A]'
          }`}
        >
          {isOnline ? (
            <Edit3 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Play className="w-3.5 h-3.5 shrink-0 fill-current" aria-hidden="true" />
          )}
          <span className="sm:hidden">{isOnline ? 'Düzenle' : 'Simüle'}</span>
          <span className="hidden sm:inline">
            {isOnline ? 'Düzenlemeye Dön' : 'Simülasyon'}
          </span>
        </button>

        <PWAInstallButton compactHeight={compactHeight} />

        <button
          type="button"
          onClick={onOpenShortcutsModal}
          aria-label="Klavye kısayolları ve komut bilgisi"
          title="Kısayollar ve Komut Bilgisi"
          className={`hidden lg:flex ${iconSquare} rounded border border-[#CBD2DC] bg-white text-[#475569] hover:bg-[#EDF2F8] items-center justify-center transition-colors shrink-0 cursor-pointer`}
        >
          <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};
