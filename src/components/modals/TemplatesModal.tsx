import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, BookmarkPlus, Cpu, Play, Trash2, X } from 'lucide-react';
import type { LadderProgram, PlcModelId } from '../../types/plc';
import { INDUSTRIAL_TEMPLATES, type TemplateCategory } from '../../core/templates';
import { compileLadderToIl } from '../../core/ilCompiler';
import {
  deleteCustomSnippet,
  listCustomSnippets,
  saveCustomSnippet,
  type CustomCircuitSnippet,
} from '../../core/storage';

interface TemplatesModalProps {
  isOpen: boolean;
  model: PlcModelId;
  currentProgram: LadderProgram;
  onLoadTemplate: (program: LadderProgram, startSimulation: boolean) => void;
  onNotify: (message: string) => void;
  onClose: () => void;
}

type FilterTab = 'all' | TemplateCategory | 'custom';

export const TemplatesModal: React.FC<TemplatesModalProps> = ({
  isOpen,
  model,
  currentProgram,
  onLoadTemplate,
  onNotify,
  onClose,
}) => {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [customSnippets, setCustomSnippets] = useState<CustomCircuitSnippet[]>([]);
  const [snippetTitle, setSnippetTitle] = useState('');
  const [snippetDesc, setSnippetDesc] = useState('');
  const [snippetError, setSnippetError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCustomSnippets(listCustomSnippets());
      setSnippetError(null);
    }
  }, [isOpen]);

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

  const counts = useMemo(
    () => ({
      all: INDUSTRIAL_TEMPLATES.length,
      classic: INDUSTRIAL_TEMPLATES.filter((t) => t.category === 'classic').length,
      textbook: INDUSTRIAL_TEMPLATES.filter((t) => t.category === 'textbook').length,
      custom: customSnippets.length,
    }),
    [customSnippets.length]
  );

  const visibleTemplates = useMemo(
    () =>
      filter === 'all'
        ? INDUSTRIAL_TEMPLATES
        : filter === 'custom'
          ? []
          : INDUSTRIAL_TEMPLATES.filter((t) => t.category === filter),
    [filter]
  );

  if (!isOpen) return null;

  const handleSaveCurrentAsSnippet = (e: React.FormEvent) => {
    e.preventDefault();
    setSnippetError(null);
    const { result, snippet } = saveCustomSnippet(
      snippetTitle,
      snippetDesc,
      currentProgram
    );
    if (!result.ok || !snippet) {
      setSnippetError(result.error ?? 'Özel devre kaydedilemedi.');
      return;
    }
    setCustomSnippets(listCustomSnippets());
    setSnippetTitle('');
    setSnippetDesc('');
    onNotify(`"${snippet.title}" özel devre şablonu kaydedildi.`);
  };

  const handleDeleteSnippet = (snippet: CustomCircuitSnippet) => {
    const res = deleteCustomSnippet(snippet.id);
    if (!res.ok) {
      setSnippetError(res.error ?? 'Özel devre silinemedi.');
      return;
    }
    setCustomSnippets(listCustomSnippets());
    onNotify(`"${snippet.title}" özel devre şablonu silindi.`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="templates-modal-title"
      data-testid="templates-modal"
      className="fixed inset-0 z-50 bg-[#0F172A]/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-2xl bg-white border border-[#BFC7D5] sm:rounded shadow-xl flex flex-col max-h-[90dvh] overflow-hidden">
        {/* Header */}
        <div className="bg-[#0B4EA2] text-white px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 id="templates-modal-title" className="text-sm font-semibold truncate">
              Hazır Şablonlar &amp; Özel Devrelerim ({model})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Şablon penceresini kapat"
            className="p-1 rounded hover:bg-white/15 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Category Filter Bar */}
        <div
          role="tablist"
          aria-label="Şablon kategorileri"
          className="px-4 py-2 bg-white border-b border-[#CBD2DC] flex items-center gap-1.5 wpl-scrollbar-x shrink-0"
        >
          {(
            [
              { id: 'all', label: `Tümü (${counts.all})` },
              { id: 'textbook', label: `Ders Kitabı / Laboratuvar (${counts.textbook})` },
              { id: 'classic', label: `Temel Kumanda (${counts.classic})` },
              { id: 'custom', label: `Özel Devrelerim (${counts.custom})` },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`tpl-filter-${tab.id}`}
                onClick={() => setFilter(tab.id)}
                className={`h-8 px-3 rounded text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? 'bg-[#0B4EA2] text-white'
                    : 'bg-[#F1F5F9] text-[#334155] hover:bg-[#E2E8F0]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Template / Custom Snippet List */}
        <div className="flex-1 min-h-0 p-4 overflow-y-auto wpl-scrollbar touch-pan-y space-y-3 bg-[#F4F6F9]">
          {filter === 'custom' ? (
            <div className="space-y-3">
              {/* Save Active Circuit Form */}
              <form
                onSubmit={handleSaveCurrentAsSnippet}
                className="bg-white border border-[#CBD2DC] rounded p-3.5 space-y-2.5 text-xs"
              >
                <div className="flex items-center gap-1.5 font-bold text-[#0F172A]">
                  <BookmarkPlus className="w-4 h-4 text-[#0B4EA2]" aria-hidden="true" />
                  <span>Aktif Ladder Devresini Özel Şablon Olarak Kaydet</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    maxLength={48}
                    data-testid="custom-snippet-title-input"
                    value={snippetTitle}
                    onChange={(e) => {
                      setSnippetTitle(e.target.value);
                      if (snippetError) setSnippetError(null);
                    }}
                    placeholder="Devre başlığı (Örn: Konveyör Acil Stop)"
                    className="h-9 px-3 rounded border border-[#B8C2D1] bg-white text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30"
                  />
                  <input
                    type="text"
                    maxLength={90}
                    data-testid="custom-snippet-desc-input"
                    value={snippetDesc}
                    onChange={(e) => setSnippetDesc(e.target.value)}
                    placeholder="Kısa açıklama (isteğe bağlı)"
                    className="h-9 px-3 rounded border border-[#B8C2D1] bg-white text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30"
                  />
                </div>
                {snippetError && (
                  <p className="text-[11px] font-medium text-[#B91C1C]">{snippetError}</p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#64748B]">
                    Model: <strong className="font-mono text-[#0B4EA2]">{currentProgram.model}</strong> ·{' '}
                    {currentProgram.rungs.filter((r) => !r.isEnd).length} Ağ
                  </span>
                  <button
                    type="submit"
                    data-testid="save-custom-snippet-btn"
                    className="h-8 px-3.5 rounded bg-[#0B4EA2] hover:bg-[#073878] text-white font-semibold cursor-pointer"
                  >
                    Devreyi Kaydet
                  </button>
                </div>
              </form>

              {customSnippets.length === 0 ? (
                <div className="bg-white border border-dashed border-[#CBD2DC] rounded p-5 text-center text-xs text-[#64748B]">
                  Henüz kayıtlı özel devreniz yok. Kendi sık kullandığınız devreleri yukarıdan kaydedip tek dokunuşla tekrar yükleyebilirsiniz.
                </div>
              ) : (
                customSnippets.map((snip) => {
                  const compiled = compileLadderToIl(snip.program);
                  return (
                    <article
                      key={snip.id}
                      data-testid={`custom-snippet-card-${snip.id}`}
                      className="bg-white border border-[#CBD2DC] rounded p-3.5 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="text-sm font-bold text-[#0F172A]">{snip.title}</h3>
                            <span className="font-mono text-[10px] font-bold text-[#0B4EA2] bg-[#EEF4FC] border border-[#BBD2F3] rounded px-1.5 py-0.5">
                              {snip.model}
                            </span>
                            <span className="font-mono text-[10px] text-[#64748B]">
                              {compiled.stepCount} Step
                            </span>
                          </div>
                          <p className="text-xs text-[#475569] mt-0.5">{snip.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteSnippet(snip)}
                          aria-label={`${snip.title} özel devresini sil`}
                          className="h-8 w-8 rounded border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onLoadTemplate(snip.program, false)}
                          className="h-8 px-3 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-xs font-semibold text-[#0B4EA2] cursor-pointer"
                        >
                          Izgaraya Yükle
                        </button>
                        <button
                          type="button"
                          onClick={() => onLoadTemplate(snip.program, true)}
                          className="h-8 px-3 rounded bg-[#00C853] hover:bg-[#00B248] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                          <span>Yükle &amp; Simüle Et</span>
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          ) : (
            <>
              <p className="text-xs text-[#475569]">
                Aşağıdaki endüstriyel Delta DVP ve üniversite laboratuvarı devrelerinden birini seçip ızgaraya yükleyebilir, saf IL kodunu inceleyebilir veya tek tıkla sanal simülasyonda çalıştırabilirsiniz.
              </p>

              {visibleTemplates.map((tpl) => {
                const effectiveModel = tpl.requiredModel ?? model;
                const previewProgram = tpl.buildProgram(effectiveModel);
                const compiled = compileLadderToIl(previewProgram);

                return (
                  <article
                    key={tpl.id}
                    data-testid={`template-card-${tpl.id}`}
                    className="bg-white border border-[#CBD2DC] rounded p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-bold text-[#0F172A]">{tpl.title}</h3>
                          {tpl.requiredModel && (
                            <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#0B4EA2] bg-[#E8F1FC] border border-[#93C5FD] rounded px-1.5 py-0.5">
                              <Cpu className="w-3 h-3" aria-hidden="true" />
                              {tpl.requiredModel}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#0B4EA2] font-medium mt-0.5">{tpl.subtitle}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {tpl.referenceTag && (
                          <span className="font-mono text-[11px] font-semibold text-[#166534] bg-[#ECFDF5] border border-[#BBF7D0] rounded px-2 py-0.5">
                            {tpl.referenceTag}
                          </span>
                        )}
                        <span className="font-mono text-[11px] font-semibold text-[#475569] bg-[#F1F5F9] border border-[#CBD2DC] rounded px-2 py-0.5">
                          {tpl.difficulty} · {compiled.stepCount} Step
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-[#334155] leading-relaxed">
                      {tpl.description}
                    </p>

                    {/* I/O Mapping Summary */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2">
                      {tpl.ioSummary.map((io) => (
                        <div
                          key={io.address}
                          className="flex items-center justify-between gap-2 text-[11px] px-1"
                        >
                          <span className="font-mono font-bold text-[#0B4EA2] shrink-0">
                            {io.address}
                          </span>
                          <span className="text-[#334155] truncate">{io.role}</span>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                      {tpl.requiredModel && tpl.requiredModel !== model ? (
                        <span className="text-[11px] text-[#475569]">
                          Yüklendiğinde PLC modeli otomatik <strong className="font-mono text-[#0B4EA2]">{tpl.requiredModel}</strong> yapılır.
                        </span>
                      ) : (
                        <span />
                      )}
                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          type="button"
                          data-testid={`load-template-${tpl.id}`}
                          onClick={() => onLoadTemplate(tpl.buildProgram(effectiveModel), false)}
                          className="h-9 px-3.5 rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-xs font-semibold text-[#0B4EA2] cursor-pointer transition-colors"
                        >
                          Izgaraya Yükle
                        </button>
                        <button
                          type="button"
                          data-testid={`run-template-${tpl.id}`}
                          onClick={() => onLoadTemplate(tpl.buildProgram(effectiveModel), true)}
                          className="h-9 px-3.5 rounded bg-[#00C853] hover:bg-[#00B248] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                          <span>Yükle &amp; Simüle Et</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-white border-t border-[#CBD2DC] flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#64748B]">
            {INDUSTRIAL_TEMPLATES.length} hazır şablon · {customSnippets.length} özel devre
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-xs font-medium text-[#334155] cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
