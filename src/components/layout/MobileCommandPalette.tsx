import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Grid2X2, Search, X } from 'lucide-react';
import type { CellElement, FunctionToolId, PlcModelId } from '../../types/plc';
import { PLC_MODELS } from '../../core/plcModels';
import type { RecentCommandEntry } from '../../hooks/useLadderEditor';

type CommandCategoryId =
  | 'contacts'
  | 'coils'
  | 'timers'
  | 'counters'
  | 'compare'
  | 'data'
  | 'math'
  | 'wires';

interface MobileCommandItem {
  id: string;
  category: CommandCategoryId;
  opcode: string;
  label: string;
  hint: string;
  element?: CellElement;
  toolId?: FunctionToolId;
  requiresRtc?: boolean;
}

const CATEGORIES: { id: CommandCategoryId; label: string }[] = [
  { id: 'contacts', label: 'Kontaklar' },
  { id: 'coils', label: 'Bobinler' },
  { id: 'timers', label: 'Zamanlayıcılar' },
  { id: 'counters', label: 'Sayaçlar' },
  { id: 'compare', label: 'Karşılaştırmalar' },
  { id: 'data', label: 'Veri İşlemleri' },
  { id: 'math', label: 'Matematik' },
  { id: 'wires', label: 'Bağlantılar' },
];

const COMMAND_ITEMS: MobileCommandItem[] = [
  // Kontaklar
  {
    id: 'm-no',
    category: 'contacts',
    opcode: 'LD / AND',
    label: 'Normal Açık (NO)',
    hint: '-| |- X0',
    element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' },
  },
  {
    id: 'm-nc',
    category: 'contacts',
    opcode: 'LDI / ANI',
    label: 'Normal Kapalı (NC)',
    hint: '-|/|- X1',
    element: { kind: 'CONTACT', contactType: 'NC', address: 'X1' },
  },
  {
    id: 'm-rising',
    category: 'contacts',
    opcode: 'LDP / ANDP',
    label: 'Yükselen Kenar',
    hint: '-|↑|- X0',
    element: { kind: 'CONTACT', contactType: 'RISING', address: 'X0' },
  },
  {
    id: 'm-falling',
    category: 'contacts',
    opcode: 'LDF / ANDF',
    label: 'Düşen Kenar',
    hint: '-|↓|- X0',
    element: { kind: 'CONTACT', contactType: 'FALLING', address: 'X0' },
  },

  // Bobinler
  {
    id: 'm-out',
    category: 'coils',
    opcode: 'OUT',
    label: 'Çıkış Bobini',
    hint: '-( )- Y0',
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
  },
  {
    id: 'm-set',
    category: 'coils',
    opcode: 'SET',
    label: 'Kalıcı Set',
    hint: '-(SET)- M0',
    element: { kind: 'COIL', coilType: 'SET', address: 'M0' },
  },
  {
    id: 'm-rst',
    category: 'coils',
    opcode: 'RST',
    label: 'Sıfırla (Reset)',
    hint: '-(RST)- M0',
    element: { kind: 'COIL', coilType: 'RST', address: 'M0' },
  },
  {
    id: 'm-alt',
    category: 'coils',
    opcode: 'ALT',
    label: 'Flip-Flop Tersle',
    hint: 'ALT Y0',
    element: { kind: 'ALT', target: 'Y0' },
  },
  {
    id: 'm-zrst',
    category: 'coils',
    opcode: 'ZRST',
    label: 'Bölge Sıfırlama',
    hint: 'ZRST Y0 Y5',
    element: { kind: 'ZRST', start: 'Y0', end: 'Y5' },
  },

  // Zamanlayıcılar
  {
    id: 'm-tmr-100',
    category: 'timers',
    opcode: 'TMR (100ms)',
    label: 'Zamanlayıcı T0',
    hint: 'TMR T0 K50 (5sn)',
    element: { kind: 'TMR', address: 'T0', preset: 'K50' },
  },
  {
    id: 'm-tmr-10',
    category: 'timers',
    opcode: 'TMR (10ms)',
    label: 'Hızlı Zamanlayıcı T200',
    hint: 'TMR T200 K100 (1sn)',
    element: { kind: 'TMR', address: 'T200', preset: 'K100' },
  },
  {
    id: 'm-rst-tmr',
    category: 'timers',
    opcode: 'RST T',
    label: 'Zamanlayıcı Sıfırla',
    hint: 'RST T0',
    element: { kind: 'COIL', coilType: 'RST', address: 'T0' },
  },

  // Sayaçlar
  {
    id: 'm-cnt',
    category: 'counters',
    opcode: 'CNT',
    label: 'Sayıcı C0',
    hint: 'CNT C0 K5',
    element: { kind: 'CNT', address: 'C0', preset: 'K5' },
  },
  {
    id: 'm-cnt-reg',
    category: 'counters',
    opcode: 'CNT (Dinamik)',
    label: 'D Hedefli Sayıcı',
    hint: 'CNT C0 D10',
    element: { kind: 'CNT', address: 'C0', preset: 'D10' },
  },
  {
    id: 'm-rst-cnt',
    category: 'counters',
    opcode: 'RST C',
    label: 'Sayıcı Sıfırla',
    hint: 'RST C0',
    element: { kind: 'COIL', coilType: 'RST', address: 'C0' },
  },

  // Karşılaştırmalar
  {
    id: 'm-cmp-eq',
    category: 'compare',
    opcode: 'LD=',
    label: 'Eşitse (=)',
    hint: 'D0 = K10',
    element: { kind: 'COMPARE', operator: '=', operandA: 'D0', operandB: 'K10' },
  },
  {
    id: 'm-cmp-gt',
    category: 'compare',
    opcode: 'LD>',
    label: 'Büyükse (>)',
    hint: 'D0 > K10',
    element: { kind: 'COMPARE', operator: '>', operandA: 'D0', operandB: 'K10' },
  },
  {
    id: 'm-cmp-lt',
    category: 'compare',
    opcode: 'LD<',
    label: 'Küçükse (<)',
    hint: 'T0 < K300',
    element: { kind: 'COMPARE', operator: '<', operandA: 'T0', operandB: 'K300' },
  },
  {
    id: 'm-cmp-ge',
    category: 'compare',
    opcode: 'LD>=',
    label: 'Büyük Eşit (>=)',
    hint: 'T0 >= K300',
    element: { kind: 'COMPARE', operator: '>=', operandA: 'T0', operandB: 'K300' },
  },
  {
    id: 'm-cmp-le',
    category: 'compare',
    opcode: 'LD<=',
    label: 'Küçük Eşit (<=)',
    hint: 'D0 <= K100',
    element: { kind: 'COMPARE', operator: '<=', operandA: 'D0', operandB: 'K100' },
  },
  {
    id: 'm-cmp-block',
    category: 'compare',
    opcode: 'CMP',
    label: '3-Bit Karşılaştırma',
    hint: 'CMP D0 K50 M0',
    element: { kind: 'CMP', source1: 'D0', source2: 'K50', destination: 'M0' },
  },

  // Veri İşlemleri
  {
    id: 'm-mov',
    category: 'data',
    opcode: 'MOV',
    label: 'Veri Taşıma',
    hint: 'MOV K100 D0',
    element: { kind: 'MOV', source: 'K100', destination: 'D0' },
  },
  {
    id: 'm-dmovr',
    category: 'data',
    opcode: 'DMOVR',
    label: '32-Bit Float Taşı',
    hint: 'DMOVR F10.0 D10',
    element: { kind: 'FLOAT_MOV', source: 'F10.000', destination: 'D10' },
  },
  {
    id: 'm-trd',
    category: 'data',
    opcode: 'TRD',
    label: 'RTC Saat Oku',
    hint: 'TRD D20 (SX2)',
    element: { kind: 'TRD', destination: 'D20' },
    requiresRtc: true,
  },
  {
    id: 'm-twr',
    category: 'data',
    opcode: 'TWR',
    label: 'RTC Saat Yaz',
    hint: 'TWR D20 (SX2)',
    element: { kind: 'TWR', source: 'D20', pulsed: false },
    requiresRtc: true,
  },
  {
    id: 'm-tzcp',
    category: 'data',
    opcode: 'TZCP',
    label: 'Zaman Aralığı Karş.',
    hint: 'TZCP D10 D20 D0 M0',
    element: { kind: 'TZCP', start1: 'D10', start2: 'D20', current: 'D0', destination: 'M0' },
  },

  // Matematik
  {
    id: 'm-add',
    category: 'math',
    opcode: 'ADD',
    label: 'Toplama (+)',
    hint: 'ADD D0 K10 D2',
    element: { kind: 'MATH', operator: 'ADD', source1: 'D0', source2: 'K10', destination: 'D2' },
  },
  {
    id: 'm-sub',
    category: 'math',
    opcode: 'SUB',
    label: 'Çıkarma (−)',
    hint: 'SUB D0 K5 D2',
    element: { kind: 'MATH', operator: 'SUB', source1: 'D0', source2: 'K5', destination: 'D2' },
  },
  {
    id: 'm-mul',
    category: 'math',
    opcode: 'MUL',
    label: 'Çarpma (×)',
    hint: 'MUL D0 K2 D2',
    element: { kind: 'MATH', operator: 'MUL', source1: 'D0', source2: 'K2', destination: 'D2' },
  },
  {
    id: 'm-div',
    category: 'math',
    opcode: 'DIV',
    label: 'Bölme (÷)',
    hint: 'DIV D0 K5 D2',
    element: { kind: 'MATH', operator: 'DIV', source1: 'D0', source2: 'K5', destination: 'D2' },
  },
  {
    id: 'm-sqr',
    category: 'math',
    opcode: 'SQR',
    label: 'Karekök (Tam Sayı)',
    hint: 'SQR D0 D2',
    element: { kind: 'SQR', source: 'D0', destination: 'D2' },
  },
  {
    id: 'm-dmulr',
    category: 'math',
    opcode: 'DMULR',
    label: 'Float Çarpma (32b)',
    hint: 'DMULR D10 D20 D30',
    element: { kind: 'FLOAT_MATH', operator: 'DMULR', source1: 'D10', source2: 'D20', destination: 'D30' },
  },
  {
    id: 'm-desqr',
    category: 'math',
    opcode: 'DESQR',
    label: 'Float Karekök (32b)',
    hint: 'DESQR D30 D40',
    element: { kind: 'FLOAT_UNARY', operator: 'DESQR', source: 'D30', destination: 'D40' },
  },
  {
    id: 'm-incp',
    category: 'math',
    opcode: 'INCP',
    label: '1 Artır (Pals)',
    hint: 'INCP D0',
    element: { kind: 'INCDEC', operator: 'INCP', target: 'D0' },
  },
  {
    id: 'm-decp',
    category: 'math',
    opcode: 'DECP',
    label: '1 Azalt (Pals)',
    hint: 'DECP D0',
    element: { kind: 'INCDEC', operator: 'DECP', target: 'D0' },
  },

  // Bağlantılar
  {
    id: 'm-hline',
    category: 'wires',
    opcode: 'F9 · HLINE',
    label: 'Yatay Bağlantı',
    hint: 'Hücreye yatay tel',
    toolId: 'F9',
  },
  {
    id: 'm-branch',
    category: 'wires',
    opcode: 'F10 · OR',
    label: 'Paralel Kol',
    hint: 'Aşağı dikey bağlantı',
    toolId: 'F10',
  },
  {
    id: 'm-new-rung',
    category: 'wires',
    opcode: 'F11 · RUNG',
    label: 'Yeni Ağ Ekle',
    hint: 'Alt satıra ağ ekle',
    toolId: 'F11',
  },
  {
    id: 'm-delete',
    category: 'wires',
    opcode: 'F12 · SİL',
    label: 'Hücreyi Temizle',
    hint: 'Seçili elemanı sil',
    toolId: 'F12',
  },
];

interface MobileCommandPaletteProps {
  visible: boolean;
  compactHeight?: boolean;
  activeTool: FunctionToolId;
  model: PlcModelId;
  recentCommands: RecentCommandEntry[];
  isSelectedEditable: boolean;
  showQuickCmd: boolean;
  zoomDensity: 'compact' | 'normal' | 'large';
  onSelectTool: (toolId: FunctionToolId) => void;
  onPlaceElement: (
    element: CellElement,
    meta: { id: string; label: string; opcode: string }
  ) => void;
  onEditSelectedCell: () => void;
  onToggleQuickCmd: () => void;
  onCycleZoom: () => void;
}

export const MobileCommandPalette: React.FC<MobileCommandPaletteProps> = ({
  visible,
  compactHeight = false,
  activeTool,
  model,
  recentCommands,
  isSelectedEditable,
  showQuickCmd,
  zoomDensity,
  onSelectTool,
  onPlaceElement,
  onEditSelectedCell,
  onToggleQuickCmd,
  onCycleZoom,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CommandCategoryId>('contacts');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const modelSpec = PLC_MODELS[model];

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    if (q) {
      return COMMAND_ITEMS.filter(
        (item) =>
          item.opcode.toLocaleLowerCase('tr-TR').includes(q) ||
          item.label.toLocaleLowerCase('tr-TR').includes(q) ||
          item.hint.toLocaleLowerCase('tr-TR').includes(q)
      );
    }
    return COMMAND_ITEMS.filter((item) => item.category === activeCategory);
  }, [activeCategory, searchQuery]);

  if (!visible) return null;

  const handlePickItem = (item: MobileCommandItem) => {
    if (item.requiresRtc && !modelSpec.hasRtc) return;
    if (item.toolId) {
      onSelectTool(item.toolId);
    } else if (item.element) {
      onPlaceElement(item.element, {
        id: item.id,
        label: item.label,
        opcode: item.opcode,
      });
    }
    setIsOpen(false);
  };

  const handlePickRecent = (entry: RecentCommandEntry) => {
    if (entry.toolId) {
      onSelectTool(entry.toolId);
    } else if (entry.element) {
      onPlaceElement(entry.element, {
        id: entry.id,
        label: entry.label,
        opcode: entry.opcode,
      });
    }
    setIsOpen(false);
  };

  const btnH = compactHeight ? 'h-7' : 'h-8';
  const zoomLabel =
    zoomDensity === 'compact' ? '75%' : zoomDensity === 'large' ? '125%' : '100%';

  return (
    <div className="relative shrink-0 bg-[#EEF2F7] border-b border-[#CBD2DC] z-20">
      {/* Single-Row Unified Touch Bar (Portrait & Phone Landscape) */}
      <div
        className={`px-2 ${
          compactHeight ? 'py-1' : 'py-1.5'
        } flex items-center justify-between gap-1.5`}
      >
        <button
          type="button"
          data-testid="mobile-command-menu-toggle"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((v) => !v)}
          className={`${btnH} px-2 rounded border text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer transition-colors ${
            isOpen
              ? 'bg-[#0B4EA2] border-[#0B4EA2] text-white'
              : 'bg-white border-[#0B4EA2] text-[#0B4EA2]'
          }`}
        >
          <Grid2X2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Komutlar</span>
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>

        {/* Scrollable Quick Strip */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto wpl-no-scrollbar min-w-0">
          {isSelectedEditable && (
            <button
              type="button"
              data-testid="compact-edit-cell-btn"
              onClick={onEditSelectedCell}
              className={`${btnH} px-2 rounded border border-[#0B4EA2] bg-[#EEF4FC] text-[#0B4EA2] text-[11px] font-bold shrink-0 cursor-pointer whitespace-nowrap`}
            >
              Düzenle
            </button>
          )}
          {(
            [
              { toolId: 'F1', text: 'NO' },
              { toolId: 'F2', text: 'NC' },
              { toolId: 'F7', text: 'OUT' },
              { toolId: 'F6', text: 'TMR' },
              { toolId: 'F9', text: 'Hat' },
              { toolId: 'F10', text: 'Paralel' },
              { toolId: 'F11', text: '+Satır' },
              { toolId: 'F12', text: 'Sil' },
            ] as const
          ).map((btn) => {
            const isActive = activeTool === btn.toolId;
            return (
              <button
                key={btn.toolId}
                type="button"
                aria-pressed={isActive}
                onClick={() => onSelectTool(btn.toolId)}
                className={`${btnH} px-2 rounded border font-mono text-[11px] font-bold shrink-0 cursor-pointer whitespace-nowrap transition-colors ${
                  btn.toolId === 'F12'
                    ? isActive
                      ? 'border-[#DC2626] bg-[#DC2626] text-white'
                      : 'border-[#FECACA] bg-white text-[#B91C1C]'
                    : isActive
                      ? 'border-[#0B4EA2] bg-[#0B4EA2] text-white'
                      : 'border-[#CBD2DC] bg-white text-[#0F172A]'
                }`}
              >
                {btn.text}
              </button>
            );
          })}
        </div>

        {/* Right Compact Utilities: Quick Command Toggle + Zoom Cycle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            data-testid="toggle-quick-cmd-btn"
            aria-pressed={showQuickCmd}
            aria-label="Hızlı komut satırını aç veya kapat"
            title="Hızlı Komut Satırı (LD X0, OUT Y0...)"
            onClick={onToggleQuickCmd}
            className={`${btnH} px-2 rounded border font-mono text-[11px] font-bold shrink-0 cursor-pointer transition-colors ${
              showQuickCmd
                ? 'border-[#0B4EA2] bg-[#0B4EA2] text-white'
                : 'border-[#CBD2DC] bg-white text-[#334155]'
            }`}
          >
            &gt;_
          </button>

          <button
            type="button"
            data-testid="compact-zoom-btn"
            aria-label={`Izgara yakınlaştırma: ${zoomLabel}`}
            title="Yakınlaştırma oranını değiştir (75% / 100% / 125%)"
            onClick={onCycleZoom}
            className={`${btnH} px-2 rounded border border-[#CBD2DC] bg-white font-mono text-[11px] font-bold text-[#0B4EA2] shrink-0 cursor-pointer`}
          >
            {zoomLabel}
          </button>
        </div>
      </div>

      {/* Overlay Categorized Command Drawer (never crushes Ladder diagram height) */}
      {isOpen && (
        <div
          data-testid="mobile-command-drawer"
          className="absolute left-0 right-0 top-full z-30 border-b border-[#BFC7D5] bg-white px-2.5 py-2.5 space-y-2.5 max-h-[65dvh] overflow-y-auto wpl-scrollbar shadow-xl"
        >
          {/* Search Input */}
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-[#64748B] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              data-testid="mobile-command-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Komut ara (Örn: TMR, MOV, ALT, ADD, CMP)..."
              className="w-full h-9 pl-8 pr-8 rounded border border-[#B8C2D1] bg-[#F8FAFC] text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/25 focus:border-[#0B4EA2]"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Aramayı temizle"
                onClick={() => setSearchQuery('')}
                className="w-7 h-7 absolute right-1 top-1/2 -translate-y-1/2 rounded flex items-center justify-center text-[#64748B] hover:bg-[#E2E8F0] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Recent Commands */}
          {recentCommands.length > 0 && !searchQuery && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#64748B]">
                <Clock className="w-3 h-3" aria-hidden="true" />
                <span>Son Kullanılanlar</span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto wpl-no-scrollbar pb-0.5">
                {recentCommands.map((rc) => (
                  <button
                    key={rc.id}
                    type="button"
                    onClick={() => handlePickRecent(rc)}
                    className="h-8 px-2.5 rounded border border-[#BBD2F3] bg-[#EEF4FC] text-[#0B4EA2] font-mono text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {rc.opcode}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category Tabs */}
          {!searchQuery && (
            <div
              role="tablist"
              aria-label="Komut Kategorileri"
              className="flex items-center gap-1 overflow-x-auto wpl-no-scrollbar pb-0.5"
            >
              {CATEGORIES.map((cat) => {
                const active = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    data-testid={`mobile-cat-${cat.id}`}
                    aria-selected={active}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`h-8 px-2.5 rounded text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      active
                        ? 'bg-[#0B4EA2] text-white'
                        : 'bg-[#F1F5F9] text-[#334155] border border-[#CBD2DC]'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Command Cards Grid */}
          {filteredItems.length === 0 ? (
            <p className="text-xs text-[#64748B] text-center py-3">
              &ldquo;{searchQuery}&rdquo; ile eşleşen komut bulunamadı.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {filteredItems.map((item) => {
                const disabled = Boolean(item.requiresRtc && !modelSpec.hasRtc);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    data-testid={`mobile-cmd-${item.id}`}
                    onClick={() => handlePickItem(item)}
                    className={`min-h-[48px] px-2.5 py-1.5 rounded border text-left flex flex-col justify-center transition-colors ${
                      disabled
                        ? 'bg-[#F8FAFC] border-[#E2E8F0] opacity-50 cursor-not-allowed'
                        : 'bg-[#F8FAFC] border-[#CBD2DC] active:bg-[#EEF4FC] active:border-[#0B4EA2] cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-xs font-bold text-[#0B4EA2]">
                        {item.opcode}
                      </span>
                      {disabled && (
                        <span className="text-[9px] font-mono text-[#B91C1C]">SX2</span>
                      )}
                    </div>
                    <span className="text-[11px] font-semibold text-[#0F172A] truncate">
                      {item.label}
                    </span>
                    <span className="text-[10px] font-mono text-[#64748B] truncate">
                      {item.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
