import React, { useEffect, useMemo, useState } from 'react';
import { Check, Edit3, ListTree, Search, Tag, X } from 'lucide-react';
import type { DevicePrefix, LadderProgram } from '../../types/plc';
import {
  buildAddressCrossReference,
  searchLadderProgram,
} from '../../core/ladderOperations';

type ModalTab = 'search' | 'crossref';
type PrefixFilter = 'ALL' | Exclude<DevicePrefix, 'K'>;

interface SearchCrossRefModalProps {
  isOpen: boolean;
  program: LadderProgram;
  isLocked: boolean;
  onJumpToCell: (rungIndex: number, rowIndex: number, colIndex: number) => void;
  onUpdateDeviceComment: (address: string, comment: string) => void;
  onClose: () => void;
}

const PREFIX_TABS: { id: PrefixFilter; label: string }[] = [
  { id: 'ALL', label: 'Tümü' },
  { id: 'X', label: 'X' },
  { id: 'Y', label: 'Y' },
  { id: 'M', label: 'M' },
  { id: 'T', label: 'T' },
  { id: 'C', label: 'C' },
  { id: 'D', label: 'D' },
];

export const SearchCrossRefModal: React.FC<SearchCrossRefModalProps> = ({
  isOpen,
  program,
  isLocked,
  onJumpToCell,
  onUpdateDeviceComment,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('search');
  const [query, setQuery] = useState('');
  const [prefixFilter, setPrefixFilter] = useState<PrefixFilter>('ALL');
  const [editingAddr, setEditingAddr] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editingAddr) {
          setEditingAddr(null);
          setCommentDraft('');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, editingAddr, onClose]);

  const searchResults = useMemo(
    () => searchLadderProgram(program, query),
    [program, query]
  );

  const crossRefEntries = useMemo(
    () => buildAddressCrossReference(program),
    [program]
  );

  const visibleCrossRef = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    return crossRefEntries.filter((entry) => {
      if (prefixFilter !== 'ALL' && entry.prefix !== prefixFilter) return false;
      if (!q) return true;
      return (
        entry.address.toLocaleLowerCase('tr-TR').includes(q) ||
        (entry.comment?.toLocaleLowerCase('tr-TR').includes(q) ?? false)
      );
    });
  }, [crossRefEntries, prefixFilter, query]);

  if (!isOpen) return null;

  const handleJump = (rungIndex: number, rowIndex: number, colIndex: number) => {
    onJumpToCell(rungIndex, rowIndex, colIndex);
    onClose();
  };

  const startEditComment = (address: string, current?: string) => {
    if (isLocked) return;
    setEditingAddr(address);
    setCommentDraft(current ?? '');
  };

  const commitComment = () => {
    if (!editingAddr) return;
    onUpdateDeviceComment(editingAddr, commentDraft);
    setEditingAddr(null);
    setCommentDraft('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-crossref-title"
      data-testid="search-crossref-modal"
      className="fixed inset-0 z-50 bg-[#0F172A]/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-2xl bg-white border border-[#BFC7D5] rounded-t-xl sm:rounded shadow-xl flex flex-col max-h-[88dvh] overflow-hidden">
        {/* Header */}
        <div className="bg-[#0B4EA2] text-white px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
            <h2 id="search-crossref-title" className="text-sm font-semibold truncate">
              Ladder Arama &amp; Kullanılan Adresler (Cross-Reference)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Arama penceresini kapat"
            className="p-1 rounded hover:bg-white/15 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Arama ve Adres Sekmeleri"
          className="shrink-0 bg-[#E6E9EF] border-b border-[#CBD2DC] px-3 pt-2 flex items-center gap-1"
        >
          <button
            type="button"
            role="tab"
            data-testid="search-tab-find"
            aria-selected={activeTab === 'search'}
            onClick={() => setActiveTab('search')}
            className={`px-3 py-2 text-xs font-semibold rounded-t border-t border-x flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'search'
                ? 'bg-white border-[#CBD2DC] text-[#0B4EA2] -mb-px'
                : 'bg-transparent border-transparent text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Ladder İçinde Ara</span>
          </button>

          <button
            type="button"
            role="tab"
            data-testid="search-tab-crossref"
            aria-selected={activeTab === 'crossref'}
            onClick={() => setActiveTab('crossref')}
            className={`px-3 py-2 text-xs font-semibold rounded-t border-t border-x flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'crossref'
                ? 'bg-white border-[#CBD2DC] text-[#0B4EA2] -mb-px'
                : 'bg-transparent border-transparent text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Kullanılan Adresler ({crossRefEntries.length})</span>
          </button>
        </div>

        {/* Shared Search Input */}
        <div className="p-3 bg-[#F8FAFC] border-b border-[#DDE3EC] space-y-2 shrink-0">
          <div className="relative">
            <Search
              className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              data-testid="ladder-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder={
                activeTab === 'search'
                  ? 'Adres, komut veya açıklama yazın (Örn: X0, Y0, TMR, Motor)...'
                  : 'Adres veya etiket filtrele (Örn: X0, M0, T0, Start)...'
              }
              className="w-full h-9 pl-9 pr-8 rounded border border-[#B8C2D1] bg-white font-mono text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/25 focus:border-[#0B4EA2]"
            />
            {query && (
              <button
                type="button"
                aria-label="Aramayı temizle"
                onClick={() => setQuery('')}
                className="w-7 h-7 absolute right-1 top-1/2 -translate-y-1/2 rounded flex items-center justify-center text-[#64748B] hover:bg-[#E2E8F0] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {activeTab === 'crossref' && (
            <div className="flex items-center gap-1 flex-wrap">
              {PREFIX_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPrefixFilter(tab.id)}
                  className={`h-7 px-2.5 rounded font-mono text-[11px] font-bold cursor-pointer ${
                    prefixFilter === tab.id
                      ? 'bg-[#0B4EA2] text-white'
                      : 'bg-white border border-[#CBD2DC] text-[#334155] hover:bg-[#EEF4FC]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto wpl-scrollbar p-3 space-y-2 text-xs">
          {activeTab === 'search' ? (
            !query.trim() ? (
              <div className="py-8 text-center text-[#64748B] space-y-1">
                <p className="font-semibold text-[#334155]">
                  Ladder diyagramında hızlı arama yapın
                </p>
                <p className="text-[11px]">
                  Örnek aramalar: <code className="font-mono bg-[#F1F5F9] px-1 rounded">X0</code>,{' '}
                  <code className="font-mono bg-[#F1F5F9] px-1 rounded">Y0</code>,{' '}
                  <code className="font-mono bg-[#F1F5F9] px-1 rounded">TMR</code>,{' '}
                  <code className="font-mono bg-[#F1F5F9] px-1 rounded">Motor</code>
                </p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="py-8 text-center text-[#64748B]">
                &ldquo;{query}&rdquo; için eşleşen hücre veya açıklama bulunamadı.
              </div>
            ) : (
              <div className="space-y-1.5" data-testid="ladder-search-results">
                <div className="text-[11px] text-[#64748B] font-medium">
                  {searchResults.length} sonuç bulundu (gitmek için dokunun)
                </div>
                {searchResults.map((match, idx) => (
                  <button
                    key={`${match.rungIndex}-${match.rowIndex}-${match.colIndex}-${idx}`}
                    type="button"
                    data-testid={`search-match-${idx}`}
                    onClick={() =>
                      handleJump(match.rungIndex, match.rowIndex, match.colIndex)
                    }
                    className="w-full text-left px-3 py-2 rounded border border-[#CBD2DC] bg-white hover:bg-[#EEF4FC] hover:border-[#0B4EA2] flex items-center justify-between gap-2 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-[#0F172A] truncate">
                        {match.summary}
                      </div>
                      <div className="text-[10px] text-[#64748B]">
                        {match.matchType === 'rung_comment'
                          ? 'Segment Başlığı'
                          : match.matchType === 'device_comment'
                            ? 'Aygıt Etiketi Eşleşmesi'
                            : 'Ladder Elemanı'}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] font-semibold text-[#0B4EA2] bg-[#EEF4FC] border border-[#BBD2F3] rounded px-2 py-0.5 shrink-0">
                      Ağ {String(match.rungIndex).padStart(3, '0')} · S{match.rowIndex}:C{match.colIndex}
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : visibleCrossRef.length === 0 ? (
            <div className="py-8 text-center text-[#64748B]">
              Bu filtrede kullanılan aygıt adresi bulunamadı.
            </div>
          ) : (
            <div className="space-y-2" data-testid="crossref-list">
              {visibleCrossRef.map((entry) => {
                const isEditing = editingAddr === entry.address;
                return (
                  <div
                    key={entry.address}
                    data-testid={`crossref-item-${entry.address}`}
                    className="rounded border border-[#CBD2DC] bg-[#FAFBFD] p-2.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-bold text-white bg-[#0B4EA2] px-2 py-0.5 rounded">
                          {entry.address}
                        </span>
                        {isEditing ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              commitComment();
                            }}
                            className="flex items-center gap-1"
                          >
                            <input
                              type="text"
                              value={commentDraft}
                              maxLength={24}
                              autoFocus
                              onChange={(e) => setCommentDraft(e.target.value)}
                              placeholder="Aygıt etiketi (Örn: Start)"
                              className="h-7 px-2 rounded border border-[#0B4EA2] bg-white text-xs text-[#0F172A] focus:outline-none"
                            />
                            <button
                              type="submit"
                              aria-label="Etiketi kaydet"
                              className="h-7 px-2 rounded bg-[#0B4EA2] text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3 h-3" aria-hidden="true" />
                              <span>Kaydet</span>
                            </button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-[#334155] truncate">
                              {entry.comment || (
                                <span className="text-[#94A3B8] italic">Etiket yok</span>
                              )}
                            </span>
                            {!isLocked && (
                              <button
                                type="button"
                                onClick={() => startEditComment(entry.address, entry.comment)}
                                title={`${entry.address} etiketini düzenle`}
                                className="h-6 px-1.5 rounded border border-[#CBD2DC] bg-white hover:bg-[#EEF4FC] text-[#475569] hover:text-[#0B4EA2] flex items-center gap-1 text-[10px] cursor-pointer"
                              >
                                <Tag className="w-3 h-3" aria-hidden="true" />
                                <Edit3 className="w-2.5 h-2.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-[#E0F2FE] text-[#0369A1] font-semibold">
                          Okuma: {entry.readCount}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[#DCFCE7] text-[#166534] font-semibold">
                          Yazma: {entry.writeCount}
                        </span>
                      </div>
                    </div>

                    {entry.locations.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {entry.locations.map((loc, idx) => (
                          <button
                            key={`${loc.rungIndex}-${loc.rowIndex}-${loc.colIndex}-${idx}`}
                            type="button"
                            onClick={() =>
                              handleJump(loc.rungIndex, loc.rowIndex, loc.colIndex)
                            }
                            className={`h-6 px-2 rounded border font-mono text-[10px] font-semibold cursor-pointer transition-colors ${
                              loc.role === 'write'
                                ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#166534] hover:bg-[#DCFCE7]'
                                : 'border-[#CBD2DC] bg-white text-[#334155] hover:border-[#0B4EA2] hover:text-[#0B4EA2]'
                            }`}
                          >
                            Ağ {String(loc.rungIndex).padStart(3, '0')} · {loc.opcodeLabel}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#F4F6F9] border-t border-[#CBD2DC] flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-[#64748B]">
            Toplam {crossRefEntries.length} benzersiz aygıt adresi
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
