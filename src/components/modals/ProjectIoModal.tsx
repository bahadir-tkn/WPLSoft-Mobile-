import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Copy,
  Download,
  FileCode2,
  FileJson,
  FilePlus2,
  FolderArchive,
  FolderOpen,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type { CompileResult, LadderProgram } from '../../types/plc';
import { MAX_IL_INPUT_BYTES, parseIlToLadder, type IlParseError } from '../../core/ilParser';
import { copyTextToClipboard } from '../../core/clipboard';
import {
  buildCommentedIlText,
  buildDeviceCommentListText,
  listDeviceComments,
} from '../../core/commentExport';
import {
  clearDraftStorage,
  deleteProjectFromLibrary,
  duplicateProjectInLibrary,
  listSavedProjects,
  loadRecoveryDraftFromStorage,
  MAX_PROJECT_JSON_BYTES,
  parseProgramJson,
  saveProjectToLibrary,
  serializeProgramJson,
  type SavedProjectEntry,
} from '../../core/storage';

type IoTab = 'projects' | 'export_il' | 'import_il' | 'json_backup';

interface ProjectIoModalProps {
  isOpen: boolean;
  program: LadderProgram;
  compileResult: CompileResult;
  /** false dönerse program yüklenemedi demektir; pencere açık kalır. */
  onImportProgram: (nextProgram: LadderProgram, message: string) => boolean;
  onRenameProject: (name: string) => void;
  onResetGrid: () => void;
  onNotify: (message: string) => void;
  onClose: () => void;
}

function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revocation so mobile Safari / Chrome complete reading the blob stream
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function sanitizeFileSlug(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'WPLSoft_Program';
}

export const ProjectIoModal: React.FC<ProjectIoModalProps> = ({
  isOpen,
  program,
  compileResult,
  onImportProgram,
  onRenameProject,
  onResetGrid,
  onNotify,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<IoTab>('export_il');
  const [copiedIl, setCopiedIl] = useState(false);
  // 'pure': WPLSoft komut ekranına yapıştırmak için saf IL; 'commented': açıklamalı IL
  const [exportMode, setExportMode] = useState<'pure' | 'commented'>('pure');
  const [confirmingReset, setConfirmingReset] = useState(false);

  // IL Import states
  const [ilDraft, setIlDraft] = useState('');
  const [ilErrors, setIlErrors] = useState<IlParseError[]>([]);
  const [ilWarnings, setIlWarnings] = useState<string[]>([]);
  const ilFileInputRef = useRef<HTMLInputElement | null>(null);

  // Multi-Project Library & Recovery states
  const [savedProjects, setSavedProjects] = useState<SavedProjectEntry[]>([]);
  const [recoveryDraft, setRecoveryDraft] = useState<LadderProgram | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // JSON Backup states
  const [projectNameInput, setProjectNameInput] = useState(program.projectName);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('export_il');
      setIlErrors([]);
      setIlWarnings([]);
      setJsonError(null);
      setLibraryError(null);
      setConfirmingReset(false);
      setSavedProjects(listSavedProjects());
      setRecoveryDraft(loadRecoveryDraftFromStorage());
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setProjectNameInput(program.projectName);
    }
  }, [isOpen, program.projectName]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const refreshLibrary = () => {
    setSavedProjects(listSavedProjects());
    setRecoveryDraft(loadRecoveryDraftFromStorage());
  };

  const handleSaveToLibrary = () => {
    setLibraryError(null);
    const cleanedName = projectNameInput.trim() || program.projectName;
    if (cleanedName !== program.projectName) {
      onRenameProject(cleanedName);
    }
    const { result, entry } = saveProjectToLibrary({
      ...program,
      projectName: cleanedName,
    });
    if (!result.ok || !entry) {
      setLibraryError(result.error ?? 'Proje kaydedilemedi.');
      return;
    }
    refreshLibrary();
    onNotify(`"${entry.projectName}" projesi yerel proje kütüphanesine kaydedildi.`);
  };

  const handleOpenSavedProject = (entry: SavedProjectEntry) => {
    const imported = onImportProgram(
      entry.program,
      `"${entry.projectName}" projesi kütüphaneden açıldı (${entry.model}).`
    );
    if (imported) onClose();
  };

  const handleDuplicateSavedProject = (entry: SavedProjectEntry) => {
    setLibraryError(null);
    const { result, entry: copy } = duplicateProjectInLibrary(entry.id);
    if (!result.ok || !copy) {
      setLibraryError(result.error ?? 'Proje kopyalanamadı.');
      return;
    }
    refreshLibrary();
    onNotify(`"${copy.projectName}" kopyası oluşturuldu.`);
  };

  const handleDeleteSavedProject = (entry: SavedProjectEntry) => {
    setLibraryError(null);
    const res = deleteProjectFromLibrary(entry.id);
    if (!res.ok) {
      setLibraryError(res.error ?? 'Proje silinemedi.');
      return;
    }
    refreshLibrary();
    onNotify(`"${entry.projectName}" proje kütüphanesinden silindi.`);
  };

  const handleRestoreRecoveryDraft = () => {
    if (!recoveryDraft) return;
    const imported = onImportProgram(
      recoveryDraft,
      `Önceki otomatik yedek ("${recoveryDraft.projectName}") geri yüklendi.`
    );
    if (imported) onClose();
  };

  const fileSlug = sanitizeFileSlug(program.projectName);

  const commentedIlText = buildCommentedIlText(program, compileResult);
  const deviceCommentList = listDeviceComments(program);
  const exportText = exportMode === 'pure' ? compileResult.rawIlText : commentedIlText;

  const handleCopyPureIl = async () => {
    const ok = await copyTextToClipboard(exportText);
    if (ok) {
      setCopiedIl(true);
      onNotify(
        exportMode === 'pure'
          ? 'IL kodu panoya kopyalandı. WPLSoft komut ekranına Ctrl+V ile yapıştırabilirsiniz.'
          : 'Açıklamalı IL kodu panoya kopyalandı.'
      );
      window.setTimeout(() => setCopiedIl(false), 1800);
    } else {
      onNotify('Panoya erişilemedi; metni seçerek manuel kopyalayabilirsiniz.');
    }
  };

  const handleDownloadIl = (ext: 'il' | 'txt') => {
    const name = exportMode === 'pure' ? `${fileSlug}.${ext}` : `${fileSlug}_aciklamali.${ext}`;
    let body = `${exportText}\n`;
    if (exportMode === 'commented' && deviceCommentList.length > 0) {
      // END'den sonraki satırlar içe aktarmada yok sayılır; açıklama listesi bilgi amaçlıdır.
      body += `\n// --- Aygıt Açıklamaları ---\n${deviceCommentList
        .map((e) => `// ${e.address.padEnd(6)} ${e.comment}`)
        .join('\n')}\n`;
    }
    triggerFileDownload(name, body, 'text/plain;charset=utf-8');
    onNotify(`${name} dosyası indirildi.`);
  };

  const handleCopyCommentList = async () => {
    const ok = await copyTextToClipboard(buildDeviceCommentListText(program));
    onNotify(
      ok
        ? 'Aygıt açıklama listesi kopyalandı (Adres <Tab> Açıklama).'
        : 'Panoya erişilemedi; listeyi seçerek manuel kopyalayabilirsiniz.'
    );
  };

  const handleLoadIlFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IL_INPUT_BYTES) {
      setIlErrors([
        {
          lineNumber: 1,
          rawLine: '',
          message: `Seçilen IL/TXT dosyası izin verilen maksimum boyutu (${Math.round(
            MAX_IL_INPUT_BYTES / 1024
          )} KB) aşıyor.`,
        },
      ]);
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      setIlDraft(text);
      setIlErrors([]);
      setIlWarnings([]);
    } catch {
      setIlErrors([
        { lineNumber: 0, rawLine: '', message: 'Seçilen IL/TXT dosyası okunamadı.' },
      ]);
    } finally {
      e.target.value = '';
    }
  };

  const handleConvertIlToLadder = () => {
    if (!ilDraft.trim()) {
      setIlErrors([
        {
          lineNumber: 1,
          rawLine: '',
          message: 'Lütfen dönüştürülecek Delta IL komutlarını yapıştırın veya dosya seçin.',
        },
      ]);
      return;
    }

    const result = parseIlToLadder(
      ilDraft,
      program.model,
      program.projectName,
      program.deviceComments
    );
    setIlErrors(result.errors);
    setIlWarnings(result.warnings);

    if (result.success && result.program) {
      const imported = onImportProgram(
        result.program,
        `IL kodu başarıyla Ladder diyagramına dönüştürüldü (${result.parsedRungCount} Ağ).`
      );
      if (imported) onClose();
    }
  };

  const handleDownloadJson = () => {
    const cleanedName = projectNameInput.trim() || program.projectName;
    if (cleanedName !== program.projectName) {
      onRenameProject(cleanedName);
    }
    const payload = serializeProgramJson({
      ...program,
      projectName: cleanedName,
    });
    triggerFileDownload(
      `${sanitizeFileSlug(cleanedName)}.json`,
      payload,
      'application/json;charset=utf-8'
    );
    onNotify(`${sanitizeFileSlug(cleanedName)}.json proje yedeği indirildi.`);
  };

  const handleLoadJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setJsonError(null);
    if (file.size > MAX_PROJECT_JSON_BYTES) {
      setJsonError(
        `Seçilen JSON dosyası izin verilen maksimum boyutu (${Math.round(
          MAX_PROJECT_JSON_BYTES / (1024 * 1024)
        )} MB) aşıyor.`
      );
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseProgramJson(text);
      if (!parsed.success || !parsed.program) {
        setJsonError(parsed.error ?? 'Geçersiz JSON proje dosyası.');
        return;
      }
      const imported = onImportProgram(
        parsed.program,
        `"${parsed.program.projectName}" projesi (.json) başarıyla yüklendi.`
      );
      if (imported) onClose();
    } catch {
      setJsonError('Dosya okunurken hata oluştu.');
    } finally {
      e.target.value = '';
    }
  };

  const handleClearAutoDraft = () => {
    clearDraftStorage();
    onNotify('Tarayıcıdaki yerel otomatik taslak kaydı temizlendi.');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-io-modal-title"
      data-testid="project-io-modal"
      className="fixed inset-0 z-50 bg-[#0F172A]/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-2xl bg-white border border-[#BFC7D5] sm:rounded shadow-xl flex flex-col max-h-[90dvh] overflow-hidden">
        {/* Header */}
        <div className="bg-[#0B4EA2] text-white px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 id="project-io-modal-title" className="text-sm font-semibold truncate">
              Dosya, WPLSoft Aktarımı ve Projeler
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Proje aktarım penceresini kapat"
            className="p-1 rounded hover:bg-white/15 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Aktarım Seçenekleri"
          className="shrink-0 bg-[#E6E9EF] border-b border-[#CBD2DC] px-3 pt-2 flex items-center gap-1 overflow-x-auto wpl-no-scrollbar"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'export_il'}
            data-testid="io-tab-export-il"
            onClick={() => setActiveTab('export_il')}
            className={`px-3 py-2 text-xs font-semibold rounded-t border-t border-x transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'export_il'
                ? 'bg-white border-[#CBD2DC] text-[#0B4EA2] -mb-px'
                : 'bg-transparent border-transparent text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Dışa Aktar</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'import_il'}
            data-testid="io-tab-import-il"
            onClick={() => setActiveTab('import_il')}
            className={`px-3 py-2 text-xs font-semibold rounded-t border-t border-x transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'import_il'
                ? 'bg-white border-[#CBD2DC] text-[#0B4EA2] -mb-px'
                : 'bg-transparent border-transparent text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>İçe Aktar</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'json_backup'}
            data-testid="io-tab-json"
            onClick={() => setActiveTab('json_backup')}
            className={`px-3 py-2 text-xs font-semibold rounded-t border-t border-x transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'json_backup'
                ? 'bg-white border-[#CBD2DC] text-[#0B4EA2] -mb-px'
                : 'bg-transparent border-transparent text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <FileJson className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Yedek (.json)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'projects'}
            data-testid="io-tab-projects"
            onClick={() => setActiveTab('projects')}
            className={`px-3 py-2 text-xs font-semibold rounded-t border-t border-x transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'projects'
                ? 'bg-white border-[#CBD2DC] text-[#0B4EA2] -mb-px'
                : 'bg-transparent border-transparent text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <FolderArchive className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Projelerim ({savedProjects.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 p-4 overflow-y-auto wpl-scrollbar touch-pan-y space-y-3 text-xs">
          {activeTab === 'projects' && (
            <div className="space-y-3.5">
              {/* Save current workspace into local multi-project library */}
              <div className="bg-[#F8FAFC] border border-[#CBD2DC] rounded p-3 space-y-2">
                <label
                  htmlFor="library-project-name"
                  className="block font-semibold text-[#0F172A]"
                >
                  Aktif Projeyi Kütüphaneye Kaydet
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    id="library-project-name"
                    type="text"
                    maxLength={40}
                    data-testid="library-project-name-input"
                    value={projectNameInput}
                    onChange={(e) => setProjectNameInput(e.target.value)}
                    placeholder="Örn. Laboratuvar_Deney_4"
                    className="flex-1 min-w-[180px] h-9 px-3 rounded border border-[#B8C2D1] bg-white font-mono text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30"
                  />
                  <button
                    type="button"
                    data-testid="save-project-library-btn"
                    onClick={handleSaveToLibrary}
                    className="h-9 px-3.5 rounded bg-[#0B4EA2] hover:bg-[#073878] text-white font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Projeyi Kaydet</span>
                  </button>
                </div>
              </div>

              {libraryError && (
                <div className="bg-[#FEF2F2] border border-[#FECACA] rounded p-2.5 flex items-center gap-2 text-[#B91C1C]">
                  <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{libraryError}</span>
                </div>
              )}

              {/* Saved Projects List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-[#0F172A]">
                    Kayıtlı Projeler ({savedProjects.length})
                  </h3>
                  <span className="text-[11px] text-[#64748B]">
                    Tarayıcı yerel deposunda saklanır
                  </span>
                </div>

                {savedProjects.length === 0 ? (
                  <div className="border border-dashed border-[#CBD2DC] rounded p-4 text-center text-[#64748B] bg-[#FAFBFD]">
                    Henüz kütüphaneye kaydedilmiş proje yok. Yukarıdan aktif projenizi kaydederek birden fazla projeyi kolayca yönetebilirsiniz.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedProjects.map((entry) => (
                      <div
                        key={entry.id}
                        data-testid={`saved-project-${entry.id}`}
                        className="border border-[#CBD2DC] rounded p-2.5 bg-white flex items-center justify-between gap-2 flex-wrap"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-bold text-[#0F172A] truncate">
                              {entry.projectName}
                            </span>
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#EEF4FC] text-[#0B4EA2] border border-[#BBD2F3]">
                              {entry.model}
                            </span>
                            <span className="font-mono text-[10px] text-[#64748B]">
                              {entry.rungCount} Ağ
                            </span>
                          </div>
                          <div className="text-[10px] text-[#64748B] mt-0.5">
                            Son güncelleme:{' '}
                            {new Date(entry.updatedAt).toLocaleString('tr-TR')}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenSavedProject(entry)}
                            className="h-8 px-2.5 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-[#0B4EA2] font-semibold cursor-pointer"
                          >
                            Aç
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateSavedProject(entry)}
                            title="Projenin kopyasını oluştur"
                            className="h-8 px-2 rounded border border-[#CBD2DC] bg-white hover:bg-[#F1F5F9] text-[#334155] flex items-center gap-1 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Kopyala</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedProject(entry)}
                            aria-label={`${entry.projectName} projesini sil`}
                            className="h-8 w-8 rounded border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Rolling Auto-Backup Recovery */}
              {recoveryDraft && (
                <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded p-3 flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1 text-[#92400E]">
                    <div className="font-bold">Önceki Otomatik Yedek Mevcut</div>
                    <div className="text-[11px]">
                      <span className="font-mono font-semibold">{recoveryDraft.projectName}</span> ·{' '}
                      {recoveryDraft.model} ({recoveryDraft.rungs.filter((r) => !r.isEnd).length} Ağ)
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="recover-backup-btn"
                    onClick={handleRestoreRecoveryDraft}
                    className="h-8 px-3 rounded border border-[#D97706] bg-white hover:bg-[#FEF3C7] text-[#92400E] font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Yedeği Kurtar</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {activeTab === 'export_il' && (
            <div className="space-y-3">
              <div
                role="radiogroup"
                aria-label="Dışa aktarım biçimi"
                className="grid grid-cols-2 gap-1 p-1 rounded border border-[#CBD2DC] bg-[#F4F6F9]"
              >
                {(
                  [
                    { id: 'pure', title: 'WPLSoft için (saf)', sub: 'Komut ekranına Ctrl+V' },
                    { id: 'commented', title: 'Açıklamalı', sub: 'Etiket ve ağ başlıkları ile' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={exportMode === opt.id}
                    data-testid={`export-mode-${opt.id}`}
                    onClick={() => setExportMode(opt.id)}
                    className={`rounded px-2.5 py-1.5 text-left cursor-pointer transition-colors ${
                      exportMode === opt.id
                        ? 'bg-white border border-[#0B4EA2] text-[#0B4EA2] shadow-sm'
                        : 'border border-transparent text-[#475569] hover:bg-white/60'
                    }`}
                  >
                    <span className="block text-xs font-bold">{opt.title}</span>
                    <span className="block text-[11px] opacity-80">{opt.sub}</span>
                  </button>
                ))}
              </div>

              <p className="text-[#475569] leading-relaxed">
                {exportMode === 'pure'
                  ? "Adım numarası ve açıklama içermez; masaüstü WPLSoft'un komut (Instruction) ekranına doğrudan yapıştırılır."
                  : "Ağ başlıkları ve aygıt açıklamaları // ile eklenir. Bu dosyayı bu uygulamaya geri yüklediğinizde açıklamalar korunur."}
              </p>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-[#0F172A]">
                    IL Kodu ({compileResult.stepCount} Step)
                  </span>
                  <span className="font-mono text-[11px] text-[#64748B]">
                    {program.model}
                  </span>
                </div>
                <textarea
                  readOnly
                  aria-label="IL dışa aktarım metni"
                  data-testid="export-il-textarea"
                  value={exportText}
                  rows={10}
                  wrap="off"
                  className="w-full rounded border border-[#B8C2D1] bg-[#F8FAFC] p-3 font-mono text-xs text-[#0F172A] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyPureIl}
                  data-testid="copy-pure-il-btn"
                  className="h-9 px-3.5 rounded bg-[#0B4EA2] hover:bg-[#073878] text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedIl ? (
                    <>
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Panoya Kopyalandı</span>
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Panoya Kopyala</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadIl('il')}
                  data-testid="download-il-btn"
                  className="h-9 px-3.5 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-[#0B4EA2] font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>.il Olarak İndir</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadIl('txt')}
                  data-testid="download-txt-btn"
                  className="h-9 px-3.5 rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-[#1E293B] font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>.txt Olarak İndir</span>
                </button>
              </div>

              <div className="border border-[#DDE3EC] rounded" data-testid="device-comment-list">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#DDE3EC] bg-[#F8FAFC]">
                  <span className="font-semibold text-[#0F172A]">
                    Aygıt Açıklamaları ({deviceCommentList.length})
                  </span>
                  {deviceCommentList.length > 0 && (
                    <button
                      type="button"
                      onClick={handleCopyCommentList}
                      data-testid="copy-comment-list-btn"
                      className="h-7 px-2.5 rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-[#1E293B] text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <ClipboardCopy className="w-3 h-3" aria-hidden="true" />
                      <span>Listeyi Kopyala</span>
                    </button>
                  )}
                </div>
                {deviceCommentList.length === 0 ? (
                  <p className="px-3 py-2.5 text-[#64748B]">
                    Henüz açıklama yok. Bir elemanı düzenlerken &quot;Aygıt Açıklaması&quot; alanına yazabilirsiniz.
                  </p>
                ) : (
                  <>
                    <ul className="max-h-40 overflow-y-auto wpl-scrollbar divide-y divide-[#EEF1F5]">
                      {deviceCommentList.map((e) => (
                        <li key={e.address} className="flex gap-3 px-3 py-1.5">
                          <span className="font-mono font-bold text-[#0B4EA2] w-14 shrink-0">{e.address}</span>
                          <span className="text-[#1E293B] truncate">{e.comment}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="px-3 py-2 border-t border-[#DDE3EC] text-[11px] text-[#64748B] leading-relaxed">
                      Saf (WPLSoft için) kodda açıklama bulunmaz. Açıklamaları WPLSoft&apos;ta da görmek için bu
                      listeyi WPLSoft&apos;un aygıt açıklaması (Device Comment) bölümüne girebilirsiniz.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'import_il' && (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <p className="text-[#475569] leading-relaxed flex-1">
                  WPLSoft&apos;tan kopyaladığınız komut listesini (IL) buraya yapıştırın; otomatik olarak Ladder diyagramına çevrilir. Başındaki adım numaraları (<code className="font-mono bg-[#F1F5F9] px-1 rounded">0000</code>) sorun değildir. Satır sonundaki <code className="font-mono bg-[#F1F5F9] px-1 rounded">// açıklama</code> metinleri aygıt açıklaması olarak alınır.
                </p>
                <div className="shrink-0">
                  <input
                    ref={ilFileInputRef}
                    type="file"
                    accept=".il,.txt"
                    onChange={handleLoadIlFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => ilFileInputRef.current?.click()}
                    className="h-8 px-2.5 rounded border border-[#B8C2D1] bg-white hover:bg-[#EDF4FC] text-[#0B4EA2] font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>.il / .txt Dosya Seç</span>
                  </button>
                </div>
              </div>

              <textarea
                aria-label="İçe aktarılacak Delta IL kodu"
                data-testid="import-il-textarea"
                value={ilDraft}
                onChange={(e) => {
                  setIlDraft(e.target.value);
                  if (ilErrors.length > 0) setIlErrors([]);
                }}
                rows={9}
                placeholder={`Örnek (adım numaralı veya saf biçim):\n0000 LD X0\n0001 OR Y0\n0002 ANI X1 // Stop butonu\n0003 OUT Y0\n0004 END`}
                className="w-full rounded border border-[#B8C2D1] bg-white p-3 font-mono text-xs text-[#0F172A] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30 focus:border-[#0B4EA2]"
              />

              {ilErrors.length > 0 && (
                <div
                  data-testid="import-il-errors"
                  className="bg-[#FEF2F2] border border-[#FECACA] rounded p-3 space-y-1.5 text-[#B91C1C]"
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>IL Ayrıştırma Hatası ({ilErrors.length})</span>
                  </div>
                  <ul className="space-y-1 font-mono text-[11px]">
                    {ilErrors.map((err, idx) => (
                      <li key={idx}>
                        Satır {err.lineNumber}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {ilWarnings.length > 0 && ilErrors.length === 0 && (
                <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded p-2.5 space-y-1 text-[#92400E]">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Uyarılar</span>
                  </div>
                  <ul className="space-y-0.5 text-[11px]">
                    {ilWarnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleConvertIlToLadder}
                  data-testid="convert-il-btn"
                  className="h-9 px-4 rounded bg-[#0B4EA2] hover:bg-[#073878] text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Ladder&apos;a Dönüştür ve Yükle</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'json_backup' && (
            <div className="space-y-4">
              {/* Project Name */}
              <div className="bg-[#F8FAFC] border border-[#CBD2DC] rounded p-3 space-y-2">
                <label
                  htmlFor="project-name-input"
                  className="block font-semibold text-[#0F172A]"
                >
                  Proje Adı
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="project-name-input"
                    type="text"
                    maxLength={40}
                    value={projectNameInput}
                    onChange={(e) => setProjectNameInput(e.target.value)}
                    className="flex-1 h-9 px-3 rounded border border-[#B8C2D1] bg-white font-mono text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = projectNameInput.trim();
                      if (next) {
                        onRenameProject(next);
                        onNotify(`Proje adı "${next}" olarak güncellendi.`);
                      }
                    }}
                    className="h-9 px-3 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-[#0B4EA2] font-semibold cursor-pointer"
                  >
                    Adı Kaydet
                  </button>
                </div>
              </div>

              {/* Save / Load JSON Backup */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="border border-[#CBD2DC] rounded p-3 space-y-2 bg-white">
                  <h3 className="font-bold text-[#0F172A]">Proje Yedeği Al (.json)</h3>
                  <p className="text-[#475569] leading-relaxed">
                    Tüm Ladder ağlarını, paralel kolları, PLC modelini ve aygıt açıklamalarını eksiksiz yedekleyin.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    data-testid="download-json-btn"
                    className="h-9 w-full rounded bg-[#0B4EA2] hover:bg-[#073878] text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>.json Yedek İndir</span>
                  </button>
                </div>

                <div className="border border-[#CBD2DC] rounded p-3 space-y-2 bg-white">
                  <h3 className="font-bold text-[#0F172A]">Yedekten Yükle (.json)</h3>
                  <p className="text-[#475569] leading-relaxed">
                    Daha önce kaydettiğiniz bir WPLSoft Web <code className="font-mono">.json</code> dosyasını geri yükleyin.
                  </p>
                  <input
                    ref={jsonFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleLoadJsonFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => jsonFileInputRef.current?.click()}
                    data-testid="upload-json-btn"
                    className="h-9 w-full rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-[#0B4EA2] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>.json Dosyası Yükle</span>
                  </button>
                </div>
              </div>

              {jsonError && (
                <div className="bg-[#FEF2F2] border border-[#FECACA] rounded p-2.5 flex items-center gap-2 text-[#B91C1C]">
                  <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{jsonError}</span>
                </div>
              )}

              {/* Automatic Draft Info */}
              <div className="bg-[#F4F6F9] border border-[#CBD2DC] rounded p-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[#334155]">
                  <strong className="text-[#0F172A]">Otomatik kayıt:</strong>{' '}
                  Yaptığınız her değişiklik bu tarayıcıda saklanır; sayfayı kapatıp açtığınızda kaldığınız yerden devam edersiniz.
                </div>
                <button
                  type="button"
                  onClick={handleClearAutoDraft}
                  className="h-8 px-2.5 rounded border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] font-medium flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Taslağı Temizle</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer with Confirmed New Project / Clear Grid */}
        <div className="px-4 py-2.5 bg-[#F4F6F9] border-t border-[#CBD2DC] flex items-center justify-between gap-2 flex-wrap">
          {confirmingReset ? (
            <div
              data-testid="confirm-new-project-bar"
              className="flex items-center gap-2 flex-wrap text-xs"
            >
              <span className="font-semibold text-[#B91C1C]">
                Tüm ağlar temizlensin mi?
              </span>
              <button
                type="button"
                data-testid="confirm-new-project-yes"
                onClick={() => {
                  onResetGrid();
                  setConfirmingReset(false);
                  onClose();
                }}
                className="h-8 px-3 rounded bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold cursor-pointer"
              >
                Evet, Temizle
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="h-8 px-2.5 rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-[#334155] font-medium cursor-pointer"
              >
                Vazgeç
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="new-project-reset-btn"
              onClick={() => setConfirmingReset(true)}
              className="h-9 px-3 rounded border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-xs font-semibold text-[#B91C1C] flex items-center gap-1.5 cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Yeni Proje / Temizle</span>
            </button>
          )}

          <button
            type="button"
            data-testid="close-project-io-btn"
            onClick={onClose}
            className="h-9 px-4 rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-xs font-medium text-[#334155] cursor-pointer ml-auto"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
