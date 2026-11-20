import React from 'react';
import {
  BookOpen,
  Cable,
  CheckSquare,
  FileCode2,
  FolderOpen,
  HelpCircle,
  Play,
  Power,
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
  return (
    <header className="shrink-0 bg-[#F7F8FA] border-b border-[#CBD2DC] px-1.5 sm:px-3.5 h-12 flex items-center justify-between gap-1 sm:gap-2.5">
      {/* Zone 1: Brand & PLC Model */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        <div
          className={`w-7 h-7 rounded text-white flex items-center justify-center shrink-0 transition-colors ${
            isOnline ? 'bg-[#00C853]' : 'bg-[#0B4EA2]'
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

        <h1 className="sr-only sm:not-sr-only text-[15px] font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0">
          WPLSoft Web
        </h1>

        <span className="hidden 2xl:inline text-xs text-[#94A3B8]" aria-hidden="true">
          ·
        </span>
        <span className="hidden 2xl:inline text-xs font-mono text-[#475569] truncate max-w-[170px]">
          {projectName}
        </span>

        <div className="flex items-center gap-1 ml-0.5 sm:ml-2 min-w-0">
          <select
            id="plc-model-select"
            aria-label="PLC Modeli"
            value={model}
            disabled={isOnline}
            onChange={(e) => onModelChange(e.target.value as PlcModelId)}
            className="h-8 w-full max-w-[92px] sm:w-auto sm:max-w-none rounded border border-[#B8C2D1] bg-white px-1 sm:px-2 text-[11px] sm:text-xs font-mono font-semibold text-[#0B4EA2] disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B4EA2] cursor-pointer"
          >
            {PLC_MODEL_LIST.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.recommended ? `${spec.label} ★` : spec.label}
              </option>
            ))}
          </select>

          <div className="hidden md:flex items-center gap-1 ml-0.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo || isOnline}
              aria-label="Geri Al (Ctrl+Z)"
              title="Geri Al (Ctrl+Z)"
              className="h-8 w-8 rounded border border-[#C5CDD9] bg-white text-[#334155] hover:bg-[#EDF2F8] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo || isOnline}
              aria-label="İleri Al (Ctrl+Y)"
              title="İleri Al (Ctrl+Y)"
              className="h-8 w-8 rounded border border-[#C5CDD9] bg-white text-[#334155] hover:bg-[#EDF2F8] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center cursor-pointer"
            >
              <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Zone 2: Core WPLSoft Actions (Dosya/IL, Şablonlar, Kablolama, Derle, Simülasyon, IL, Bilgi) */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpenProjectIoModal}
          disabled={isOnline}
          data-testid="open-project-io-btn"
          aria-label="Dosya, PC WPLSoft IL aktarımı ve yeni proje"
          title="Dosya / IL (.il, .txt, .json, Yeni Proje)"
          className="h-8 w-7 sm:w-8 lg:w-auto lg:px-2.5 rounded border border-[#C5CDD9] bg-white text-[#1E293B] hover:bg-[#EDF2F8] disabled:opacity-35 disabled:pointer-events-none text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
          <span className="hidden lg:inline">Dosya / IL</span>
        </button>

        <button
          type="button"
          onClick={onOpenTemplatesModal}
          disabled={isOnline}
          data-testid="open-templates-btn"
          aria-label="Hazır endüstriyel ders şablonlarını aç"
          title="Şablonlar (Start-Stop, Yıldız-Üçgen, Örnek 6.1–8.1)"
          className="h-8 w-7 sm:w-8 lg:w-auto lg:px-2.5 rounded border border-[#C5CDD9] bg-white text-[#1E293B] hover:bg-[#EDF2F8] disabled:opacity-35 disabled:pointer-events-none text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <BookOpen className="w-3.5 h-3.5 text-[#0B4EA2]" aria-hidden="true" />
          <span className="hidden lg:inline">Şablonlar</span>
        </button>

        <button
          type="button"
          onClick={onOpenSearchModal}
          data-testid="open-search-btn"
          aria-label="Ladder içinde ara ve kullanılan adresleri görüntüle"
          title="Ara / Kullanılan Adresler (Ctrl+F)"
          className="h-8 w-7 sm:w-8 xl:w-auto xl:px-2.5 rounded border border-[#C5CDD9] bg-white text-[#1E293B] hover:bg-[#EDF2F8] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Search className="w-3.5 h-3.5 text-[#0B4EA2] shrink-0" aria-hidden="true" />
          <span className="hidden xl:inline">Ara</span>
        </button>

        <button
          type="button"
          onClick={onOpenWiringModal}
          data-testid="open-wiring-btn"
          aria-label="BETİ Delta PLC Eğitim Seti kablolama şemasını aç"
          title="Kablolama (BETİ)"
          className="h-8 w-7 sm:w-8 lg:w-auto lg:px-2.5 rounded border border-[#C5CDD9] bg-white text-[#1E293B] hover:bg-[#EDF2F8] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Cable className="w-3.5 h-3.5 text-[#0B4EA2] shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline xl:hidden">Kablolama</span>
          <span className="hidden xl:inline">Kablolama (BETİ)</span>
        </button>

        <button
          type="button"
          onClick={onCompileCheck}
          aria-label="Programı derle ve denetle"
          title="Derle ve Denetle"
          className={`h-8 w-7 sm:w-auto sm:px-2.5 rounded border text-xs font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            errorCount > 0
              ? 'border-[#DC2626] bg-[#FEF2F2] text-[#B91C1C]'
              : warningCount > 0
                ? 'border-[#D97706] bg-[#FFFBEB] text-[#92400E]'
                : 'border-[#0B4EA2] bg-[#0B4EA2] text-white hover:bg-[#073878]'
          }`}
        >
          <CheckSquare className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Derle</span>
          {(errorCount > 0 || warningCount > 0) && (
            <span className="hidden sm:inline font-mono text-[11px]">
              ({errorCount + warningCount})
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleOnline}
          aria-pressed={isOnline}
          data-testid="toggle-online-btn"
          aria-label={
            isOnline
              ? 'Sanal simülasyondan çık ve düzenleme moduna dön'
              : 'Sanal PLC simülasyonunu başlat (gerçek PLC bağlantısı değildir)'
          }
          title={
            isOnline
              ? 'Sanal simülasyonu kapatıp düzenleme moduna dön'
              : 'Tarayıcı içi Sanal PLC Simülasyonu (gerçek PLC bağlantısı değildir)'
          }
          className={`h-8 px-2 sm:px-2.5 rounded border text-xs font-bold flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isOnline
              ? isRunning
                ? 'border-[#00963F] bg-[#00C853] text-white hover:bg-[#00B248]'
                : 'border-[#DC2626] bg-[#DC2626] text-white hover:bg-[#B91C1C]'
              : 'border-[#00963F] bg-[#E6F9EE] text-[#007A33] hover:bg-[#D1F5DF]'
          }`}
        >
          {isOnline ? (
            <Power className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Play className="w-3.5 h-3.5 shrink-0 fill-current" aria-hidden="true" />
          )}
          <span className="sm:hidden">{isOnline ? 'Çık' : 'Sim'}</span>
          <span className="hidden sm:inline">
            {isOnline ? (isRunning ? 'Simülasyon · RUN' : 'Simülasyon · STOP') : 'Simülasyon'}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleIlPanel}
          aria-pressed={showIlPanel}
          aria-label="Instruction List (IL) panelini aç veya kapat"
          className={`h-8 w-7 sm:w-auto sm:px-2.5 rounded border text-xs font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            showIlPanel
              ? 'border-[#0B4EA2] bg-[#EEF4FC] text-[#0B4EA2]'
              : 'border-[#C5CDD9] bg-white text-[#1E293B] hover:bg-[#EDF2F8]'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">IL</span>
        </button>

        <PWAInstallButton />

        <button
          type="button"
          onClick={onOpenShortcutsModal}
          aria-label="Klavye kısayolları ve komut bilgisi"
          title="Kısayollar ve Komut Bilgisi"
          className="hidden sm:flex h-8 w-8 rounded border border-[#C5CDD9] bg-white text-[#475569] hover:bg-[#EDF2F8] items-center justify-center transition-colors shrink-0 cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};
