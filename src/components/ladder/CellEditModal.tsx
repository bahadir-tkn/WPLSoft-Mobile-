import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Trash2, X, XCircle } from 'lucide-react';
import type {
  AddressRole,
  CellElement,
  CoilKind,
  CompareOperator,
  ContactKind,
  IncDecOperator,
  MathOperator,
  PlcModelId,
} from '../../types/plc';
import { PLC_MODELS } from '../../core/plcModels';
import { validateAddress, validateZrstRange } from '../../core/addressing';

interface CellEditModalProps {
  element: CellElement;
  isNewPlacement: boolean;
  model: PlcModelId;
  deviceComments: Record<string, string>;
  onSave: (element: CellElement, comment: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}

const COMPARE_OPERATORS: CompareOperator[] = ['=', '>', '<', '>=', '<=', '<>'];

const CONTACT_TYPES: { id: ContactKind; label: string; glyph: string }[] = [
  { id: 'NO', label: 'NO (LD/AND)', glyph: '-| |-' },
  { id: 'NC', label: 'NC (LDI/ANI)', glyph: '-|/|-' },
  { id: 'RISING', label: 'Yükselen (LDP)', glyph: '-|↑|-' },
  { id: 'FALLING', label: 'Düşen (LDF)', glyph: '-|↓|-' },
];

const COIL_TYPES: { id: CoilKind; label: string }[] = [
  { id: 'OUT', label: 'OUT (Bobin)' },
  { id: 'SET', label: 'SET (Mühürle)' },
  { id: 'RST', label: 'RST (Sıfırla)' },
];

type AppCmdKind =
  | 'TMR'
  | 'CNT'
  | 'MOV'
  | 'ALT'
  | 'ZRST'
  | 'CMP'
  | 'ADD'
  | 'SUB'
  | 'MUL'
  | 'DIV'
  | 'INC'
  | 'INCP'
  | 'DEC'
  | 'DECP'
  | 'TRD';

const APP_CMD_GROUPS: {
  label: string;
  items: { id: AppCmdKind; short: string }[];
}[] = [
  {
    label: 'Temel',
    items: [
      { id: 'TMR', short: 'TMR' },
      { id: 'CNT', short: 'CNT' },
      { id: 'MOV', short: 'MOV' },
      { id: 'ALT', short: 'ALT' },
      { id: 'ZRST', short: 'ZRST' },
    ],
  },
  {
    label: 'Aritmetik & Karşılaştırma',
    items: [
      { id: 'CMP', short: 'CMP' },
      { id: 'ADD', short: 'ADD' },
      { id: 'SUB', short: 'SUB' },
      { id: 'MUL', short: 'MUL' },
      { id: 'DIV', short: 'DIV' },
    ],
  },
  {
    label: 'Artır / Azalt & RTC',
    items: [
      { id: 'INC', short: 'INC' },
      { id: 'INCP', short: 'INCP' },
      { id: 'DEC', short: 'DEC' },
      { id: 'DECP', short: 'DECP' },
      { id: 'TRD', short: 'TRD' },
    ],
  },
];

type QuickPickGroup = {
  id: string;
  label: string;
  items: { value: string; sub?: string; highlight?: boolean }[];
};

function buildQuickPickGroups(role: AddressRole, model: PlcModelId): QuickPickGroup[] {
  const spec = PLC_MODELS[model];
  const isSx2 = model === 'DVP-SX2';

  const xGroup: QuickPickGroup = {
    id: 'X',
    label: 'Giriş (X)',
    items: spec.allInputs.map((addr) => ({
      value: addr,
      highlight: spec.onboardInputs.includes(addr),
    })),
  };

  const yGroup: QuickPickGroup = {
    id: 'Y',
    label: 'Çıkış (Y)',
    items: spec.allOutputs.map((addr) => ({
      value: addr,
      highlight: spec.onboardOutputs.includes(addr),
    })),
  };

  const mContactGroup: QuickPickGroup = {
    id: 'M',
    label: 'Röle (M)',
    items: [
      { value: 'M0' },
      { value: 'M1' },
      { value: 'M2' },
      { value: 'M3' },
      { value: 'M4' },
      { value: 'M5' },
      { value: 'M10' },
      { value: 'M1000', sub: 'ON', highlight: true },
      { value: 'M1002', sub: '1.Pals', highlight: true },
      { value: 'M1003', sub: '1.OFF', highlight: true },
      { value: 'M1013', sub: '1sn', highlight: true },
      { value: 'M1020', sub: 'Zero', highlight: true },
    ],
  };

  const mCoilGroup: QuickPickGroup = {
    id: 'M',
    label: 'Röle (M)',
    items: ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M10', 'M11', 'M12', 'M20'].map(
      (v) => ({ value: v })
    ),
  };

  const tGroup: QuickPickGroup = {
    id: 'T',
    label: 'Zamanlayıcı (T)',
    items: ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((v) => ({ value: v })),
  };

  const cGroup: QuickPickGroup = {
    id: 'C',
    label: 'Sayıcı (C)',
    items: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((v) => ({ value: v })),
  };

  const dGroup: QuickPickGroup = {
    id: 'D',
    label: 'Register (D)',
    items: [
      { value: 'D0' },
      { value: 'D1' },
      { value: 'D2' },
      { value: 'D10' },
      { value: 'D20' },
      { value: 'D100' },
      { value: 'D500' },
      ...(isSx2
        ? [
            { value: 'D1110', sub: 'AD0', highlight: true },
            { value: 'D1111', sub: 'AD1', highlight: true },
            { value: 'D1112', sub: 'AD2', highlight: true },
            { value: 'D1313', sub: 'RTC Sn', highlight: true },
            { value: 'D1315', sub: 'RTC Sa', highlight: true },
          ]
        : [{ value: 'D3' }, { value: 'D4' }, { value: 'D5' }]),
    ],
  };

  const dDestGroup: QuickPickGroup = {
    id: 'D',
    label: 'Hedef (D)',
    items: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D10', 'D20', 'D50', 'D100', 'D200', 'D500'].map(
      (v) => ({ value: v })
    ),
  };

  const kPresetGroup: QuickPickGroup = {
    id: 'K',
    label: 'Sabit (K)',
    items: [
      { value: 'K3', sub: '3 / 0.3s' },
      { value: 'K5', sub: '5 / 0.5s' },
      { value: 'K10', sub: '1.0s' },
      { value: 'K20', sub: '2.0s' },
      { value: 'K30', sub: '3.0s' },
      { value: 'K50', sub: '5.0s' },
      { value: 'K100', sub: '10.0s' },
      { value: 'K200', sub: '20.0s' },
    ],
  };

  const kWordGroup: QuickPickGroup = {
    id: 'K',
    label: 'Sabit (K)',
    items: ['K0', 'K1', 'K5', 'K10', 'K50', 'K100', 'K500', 'K1000'].map((v) => ({
      value: v,
    })),
  };

  switch (role) {
    case 'bit_contact':
      return [xGroup, yGroup, mContactGroup, tGroup, cGroup];
    case 'bit_coil':
      return [yGroup, mCoilGroup];
    case 'rst_target':
      return [yGroup, mCoilGroup, tGroup, cGroup, dDestGroup];
    case 'timer':
      return [tGroup];
    case 'counter':
      return [cGroup];
    case 'preset':
      return [kPresetGroup, dDestGroup];
    case 'word_source':
      return [dGroup, kWordGroup, tGroup, cGroup];
    case 'word_dest':
      return [dDestGroup];
    default:
      return [xGroup, yGroup, mCoilGroup];
  }
}

interface QuickPickPanelProps {
  role: AddressRole;
  model: PlcModelId;
  selectedValue: string;
  onPick: (value: string) => void;
}

const QuickPickPanel: React.FC<QuickPickPanelProps> = ({
  role,
  model,
  selectedValue,
  onPick,
}) => {
  const groups = useMemo(() => buildQuickPickGroups(role, model), [role, model]);
  const [activeGroupId, setActiveGroupId] = useState(groups[0]?.id ?? 'X');

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  if (!activeGroup) return null;

  const normalizedSel = selectedValue.trim().toUpperCase();

  return (
    <div className="bg-[#F8FAFC] border border-[#DDE3EC] rounded p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-[#475569]">
          Hızlı Adres Seçici ({model})
        </span>
        {groups.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveGroupId(g.id)}
                className={`h-7 px-2 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  activeGroup.id === g.id
                    ? 'bg-[#0B4EA2] text-white'
                    : 'bg-white border border-[#CBD2DC] text-[#334155] hover:bg-[#EDF4FC]'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
        {activeGroup.items.map((item) => {
          const isCurrent = normalizedSel === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onPick(item.value)}
              className={`min-h-[38px] px-1.5 py-1 rounded border font-mono text-xs font-semibold flex flex-col items-center justify-center leading-tight transition-colors cursor-pointer ${
                isCurrent
                  ? 'bg-[#0B4EA2] text-white border-[#0B4EA2]'
                  : item.highlight
                    ? 'bg-[#EEF4FC] text-[#0B4EA2] border-[#BBD2F3] hover:bg-[#DCE9FA]'
                    : 'bg-white text-[#1E293B] border-[#CBD2DC] hover:border-[#0B4EA2] hover:text-[#0B4EA2]'
              }`}
            >
              <span>{item.value}</span>
              {item.sub && (
                <span
                  className={`text-[9px] font-sans font-normal ${
                    isCurrent ? 'text-white/85' : 'text-[#64748B]'
                  }`}
                >
                  {item.sub}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

function getInitialFields(
  element: CellElement,
  deviceComments: Record<string, string>,
  isNewPlacement: boolean
) {
  let contactType: ContactKind = 'NO';
  let coilType: CoilKind = 'OUT';
  let appCmdKind: AppCmdKind = 'TMR';
  let compareOp: CompareOperator = '=';
  let primaryInput = 'X0';
  let secondaryInput = 'K50';
  let tertiaryInput = 'D10';
  let commentKey = '';

  if (element.kind === 'CONTACT') {
    contactType = element.contactType;
    primaryInput = element.address;
    commentKey = element.address;
  } else if (element.kind === 'COIL') {
    coilType = element.coilType;
    primaryInput = element.address;
    commentKey = element.address;
  } else if (element.kind === 'TMR') {
    appCmdKind = 'TMR';
    primaryInput = element.address;
    secondaryInput = element.preset;
    commentKey = element.address;
  } else if (element.kind === 'CNT') {
    appCmdKind = 'CNT';
    primaryInput = element.address;
    secondaryInput = element.preset;
    commentKey = element.address;
  } else if (element.kind === 'MOV') {
    appCmdKind = 'MOV';
    primaryInput = element.source;
    secondaryInput = element.destination;
    commentKey = element.destination;
  } else if (element.kind === 'ALT') {
    appCmdKind = 'ALT';
    primaryInput = element.target;
    commentKey = element.target;
  } else if (element.kind === 'ZRST') {
    appCmdKind = 'ZRST';
    primaryInput = element.start;
    secondaryInput = element.end;
    commentKey = element.start;
  } else if (element.kind === 'CMP') {
    appCmdKind = 'CMP';
    primaryInput = element.source1;
    secondaryInput = element.source2;
    tertiaryInput = element.destination;
    commentKey = element.destination;
  } else if (element.kind === 'MATH') {
    appCmdKind = element.operator;
    primaryInput = element.source1;
    secondaryInput = element.source2;
    tertiaryInput = element.destination;
    commentKey = element.destination;
  } else if (element.kind === 'INCDEC') {
    appCmdKind = element.operator;
    primaryInput = element.target;
    commentKey = element.target;
  } else if (element.kind === 'TRD') {
    appCmdKind = 'TRD';
    primaryInput = element.destination;
    commentKey = element.destination;
  } else if (element.kind === 'COMPARE') {
    compareOp = element.operator;
    primaryInput = element.operandA;
    secondaryInput = element.operandB;
    commentKey = element.operandA;
  }

  const initialComment = isNewPlacement
    ? deviceComments[commentKey] ?? ''
    : deviceComments[commentKey] ?? ('comment' in element ? element.comment ?? '' : '');

  return {
    contactType,
    coilType,
    appCmdKind,
    compareOp,
    primaryInput,
    secondaryInput,
    tertiaryInput,
    initialComment,
  };
}

function isMathAppCmd(cmd: AppCmdKind): cmd is MathOperator {
  return cmd === 'ADD' || cmd === 'SUB' || cmd === 'MUL' || cmd === 'DIV';
}

function isIncDecAppCmd(cmd: AppCmdKind): cmd is IncDecOperator {
  return cmd === 'INC' || cmd === 'INCP' || cmd === 'DEC' || cmd === 'DECP';
}

export const CellEditModal: React.FC<CellEditModalProps> = ({
  element,
  isNewPlacement,
  model,
  deviceComments,
  onSave,
  onDelete,
  onCancel,
}) => {
  const initial = useMemo(
    () => getInitialFields(element, deviceComments, isNewPlacement),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [contactType, setContactType] = useState<ContactKind>(initial.contactType);
  const [coilType, setCoilType] = useState<CoilKind>(initial.coilType);
  const [appCmdKind, setAppCmdKind] = useState<AppCmdKind>(initial.appCmdKind);
  const [compareOp, setCompareOp] = useState<CompareOperator>(initial.compareOp);

  const [primaryInput, setPrimaryInput] = useState(initial.primaryInput);
  const [secondaryInput, setSecondaryInput] = useState(initial.secondaryInput);
  const [tertiaryInput, setTertiaryInput] = useState(initial.tertiaryInput);
  const [activeField, setActiveField] = useState<'primary' | 'secondary' | 'tertiary'>(
    'primary'
  );
  const [comment, setComment] = useState(initial.initialComment);
  const [commentTouched, setCommentTouched] = useState(false);

  const spec = PLC_MODELS[model];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const isAppCmd =
    element.kind === 'TMR' ||
    element.kind === 'CNT' ||
    element.kind === 'MOV' ||
    element.kind === 'ALT' ||
    element.kind === 'ZRST' ||
    element.kind === 'CMP' ||
    element.kind === 'MATH' ||
    element.kind === 'INCDEC' ||
    element.kind === 'TRD';
  const isCompare = element.kind === 'COMPARE';
  const isContact = element.kind === 'CONTACT';
  const isCoil = element.kind === 'COIL';

  const syncCommentForAddress = (addr: string) => {
    if (!commentTouched) {
      const normalized = addr.trim().toUpperCase();
      setComment(deviceComments[normalized] ?? '');
    }
  };

  const handlePrimaryChange = (nextVal: string) => {
    const upper = nextVal.toUpperCase();
    setPrimaryInput(upper);
    if (
      !(
        isAppCmd &&
        (appCmdKind === 'MOV' || appCmdKind === 'CMP' || isMathAppCmd(appCmdKind))
      )
    ) {
      syncCommentForAddress(upper);
    }
  };

  const handleSecondaryChange = (nextVal: string) => {
    const upper = nextVal.toUpperCase();
    setSecondaryInput(upper);
    if (isAppCmd && appCmdKind === 'MOV') {
      syncCommentForAddress(upper);
    }
  };

  const handleTertiaryChange = (nextVal: string) => {
    const upper = nextVal.toUpperCase();
    setTertiaryInput(upper);
    if (isAppCmd && (appCmdKind === 'CMP' || isMathAppCmd(appCmdKind))) {
      syncCommentForAddress(upper);
    }
  };

  // Determine validation roles for primary, secondary, and tertiary inputs
  let primaryRole: AddressRole = 'bit_contact';
  let secondaryRole: AddressRole | null = null;
  let tertiaryRole: AddressRole | null = null;
  let primaryLabel = 'Aygıt Adresi';
  let secondaryLabel = '';
  let tertiaryLabel = '';
  let helperHint = '';

  if (isContact) {
    primaryRole = 'bit_contact';
    primaryLabel = 'Kontak Adresi (X, Y, M, T, C)';
  } else if (isCoil) {
    primaryRole = coilType === 'RST' ? 'rst_target' : 'bit_coil';
    primaryLabel =
      coilType === 'RST'
        ? 'Sıfırlanacak Aygıt (Y, M, T, C, D)'
        : 'Bobin Adresi (Y, M)';
  } else if (isCompare) {
    primaryRole = 'word_source';
    secondaryRole = 'word_source';
    primaryLabel = '1. Değer (S1: D / K / T / C)';
    secondaryLabel = '2. Değer (S2: D / K / T / C)';
  } else if (isAppCmd) {
    if (appCmdKind === 'TMR') {
      primaryRole = 'timer';
      secondaryRole = 'preset';
      primaryLabel = `Zamanlayıcı (T0 – T${spec.timerRange.max})`;
      secondaryLabel = 'Süre Hedefi (K50 veya D500)';
    } else if (appCmdKind === 'CNT') {
      primaryRole = 'counter';
      secondaryRole = 'preset';
      primaryLabel = `Sayıcı (C0 – C${spec.counterRange.max})`;
      secondaryLabel = 'Sayma Hedefi (K5 veya D10)';
    } else if (appCmdKind === 'MOV') {
      primaryRole = 'word_source';
      secondaryRole = 'word_dest';
      primaryLabel = 'Kaynak (S: K / D / T / C)';
      secondaryLabel = `Hedef (D0 – D${spec.registerRange.max})`;
    } else if (appCmdKind === 'ALT') {
      primaryRole = 'bit_coil';
      primaryLabel = 'Flip-Flop Hedef Biti (Y / M)';
      helperHint = 'Girişin her yükselen kenarında hedef bitin durumunu tersler.';
    } else if (appCmdKind === 'ZRST') {
      primaryRole = 'rst_target';
      secondaryRole = 'rst_target';
      primaryLabel = 'Başlangıç Aygıtı (S1)';
      secondaryLabel = 'Bitiş Aygıtı (S2)';
      helperHint = 'S1–S2 arasındaki aynı tip tüm aygıtları toplu sıfırlar (örn. Y0..Y5, C0..C1).';
    } else if (appCmdKind === 'CMP') {
      primaryRole = 'word_source';
      secondaryRole = 'word_source';
      tertiaryRole = 'bit_coil';
      primaryLabel = '1. Değer (S1)';
      secondaryLabel = '2. Değer (S2)';
      tertiaryLabel = 'Sonuç Başlangıç Biti (D: Y / M)';
      helperHint = 'S1>S2 → D, S1=S2 → D+1, S1<S2 → D+2 bitlerini aktif eder.';
    } else if (isMathAppCmd(appCmdKind)) {
      primaryRole = 'word_source';
      secondaryRole = 'word_source';
      tertiaryRole = 'word_dest';
      primaryLabel = '1. Terim (S1)';
      secondaryLabel = '2. Terim (S2)';
      tertiaryLabel = 'Sonuç Registerı (D)';
      if (appCmdKind === 'DIV') {
        helperHint = 'DIV: Bölüm D registerına, kalan (mod) D+1 registerına yazılır.';
      } else {
        helperHint = `${appCmdKind}: S1 ve S2 işlenip sonuç D registerına yazılır (M1020–M1022 güncellenir).`;
      }
    } else if (isIncDecAppCmd(appCmdKind)) {
      primaryRole = 'word_dest';
      primaryLabel = `Hedef Register (D0 – D${spec.registerRange.max})`;
      helperHint = appCmdKind.endsWith('P')
        ? `${appCmdKind}: Yalnızca yükselen kenarda hedef registerı 1 ${appCmdKind.startsWith('INC') ? 'artırır' : 'azaltır'}.`
        : `${appCmdKind}: Hat enerjiliyken her taramada hedef registerı 1 ${appCmdKind.startsWith('INC') ? 'artırır' : 'azaltır'}.`;
    } else if (appCmdKind === 'TRD') {
      primaryRole = 'word_dest';
      primaryLabel = 'RTC Hedef Başlangıç (D)';
      helperHint = 'RTC (D1319..D1313) verisini 7 ardışık registera kopyalar (Yıl→D, Saat→D+4, Dk→D+5, Sn→D+6).';
    }
  }

  const primaryValidation = validateAddress(primaryInput, primaryRole, model);
  const secondaryValidation = secondaryRole
    ? validateAddress(secondaryInput, secondaryRole, model)
    : { valid: true };
  const tertiaryValidation = tertiaryRole
    ? validateAddress(tertiaryInput, tertiaryRole, model)
    : { valid: true };

  const zrstValidation =
    isAppCmd && appCmdKind === 'ZRST'
      ? validateZrstRange(primaryInput, secondaryInput, model)
      : { valid: true };

  const rtcSupportError =
    isAppCmd && appCmdKind === 'TRD' && !spec.hasRtc
      ? `TRD komutu yalnızca dahili RTC bulunan DVP-SX2 modelinde desteklenir (seçili model: ${model}).`
      : null;

  const isFormValid =
    !rtcSupportError &&
    primaryValidation.valid &&
    secondaryValidation.valid &&
    tertiaryValidation.valid &&
    zrstValidation.valid;

  const firstError = rtcSupportError
    ? rtcSupportError
    : !primaryValidation.valid
      ? primaryValidation.error
      : !secondaryValidation.valid && 'error' in secondaryValidation
        ? secondaryValidation.error
        : !tertiaryValidation.valid && 'error' in tertiaryValidation
          ? tertiaryValidation.error
          : !zrstValidation.valid && 'error' in zrstValidation
            ? zrstValidation.error
            : null;

  const handleSwitchAppCmd = (nextKind: AppCmdKind) => {
    setAppCmdKind(nextKind);
    setActiveField('primary');
    setCommentTouched(false);
    if (nextKind === 'TMR') {
      setPrimaryInput('T0');
      setSecondaryInput('K50');
      setComment(deviceComments['T0'] ?? '');
    } else if (nextKind === 'CNT') {
      setPrimaryInput('C0');
      setSecondaryInput('K5');
      setComment(deviceComments['C0'] ?? '');
    } else if (nextKind === 'MOV') {
      setPrimaryInput('K100');
      setSecondaryInput('D0');
      setComment(deviceComments['D0'] ?? '');
    } else if (nextKind === 'ALT') {
      setPrimaryInput('Y0');
      setComment(deviceComments['Y0'] ?? '');
    } else if (nextKind === 'ZRST') {
      setPrimaryInput('Y0');
      setSecondaryInput('Y5');
      setComment(deviceComments['Y0'] ?? '');
    } else if (nextKind === 'CMP') {
      setPrimaryInput(model === 'DVP-SX2' ? 'D1110' : 'D0');
      setSecondaryInput('K500');
      setTertiaryInput('M0');
      setComment(deviceComments['M0'] ?? '');
    } else if (isMathAppCmd(nextKind)) {
      setPrimaryInput('D0');
      setSecondaryInput(nextKind === 'DIV' ? 'K5' : 'D2');
      setTertiaryInput('D10');
      setComment(deviceComments['D10'] ?? '');
    } else if (isIncDecAppCmd(nextKind)) {
      setPrimaryInput('D0');
      setComment(deviceComments['D0'] ?? '');
    } else if (nextKind === 'TRD') {
      setPrimaryInput('D20');
      setComment(deviceComments['D20'] ?? '');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !primaryValidation.parsed) return;

    const pNorm = primaryValidation.parsed.normalized;
    const sNorm =
      secondaryRole && 'parsed' in secondaryValidation && secondaryValidation.parsed
        ? secondaryValidation.parsed.normalized
        : secondaryInput.trim().toUpperCase();
    const tNorm =
      tertiaryRole && 'parsed' in tertiaryValidation && tertiaryValidation.parsed
        ? tertiaryValidation.parsed.normalized
        : tertiaryInput.trim().toUpperCase();
    const cleanComment = comment.trim() || undefined;

    if (isContact) {
      onSave(
        { kind: 'CONTACT', contactType, address: pNorm, comment: cleanComment },
        comment
      );
    } else if (isCoil) {
      onSave(
        { kind: 'COIL', coilType, address: pNorm, comment: cleanComment },
        comment
      );
    } else if (isCompare) {
      onSave(
        {
          kind: 'COMPARE',
          operator: compareOp,
          operandA: pNorm,
          operandB: sNorm,
          comment: cleanComment,
        },
        comment
      );
    } else if (isAppCmd) {
      if (appCmdKind === 'TMR') {
        onSave({ kind: 'TMR', address: pNorm, preset: sNorm, comment: cleanComment }, comment);
      } else if (appCmdKind === 'CNT') {
        onSave({ kind: 'CNT', address: pNorm, preset: sNorm, comment: cleanComment }, comment);
      } else if (appCmdKind === 'MOV') {
        onSave(
          { kind: 'MOV', source: pNorm, destination: sNorm, comment: cleanComment },
          comment
        );
      } else if (appCmdKind === 'ALT') {
        onSave({ kind: 'ALT', target: pNorm, comment: cleanComment }, comment);
      } else if (appCmdKind === 'ZRST') {
        onSave({ kind: 'ZRST', start: pNorm, end: sNorm, comment: cleanComment }, comment);
      } else if (appCmdKind === 'CMP') {
        onSave(
          {
            kind: 'CMP',
            source1: pNorm,
            source2: sNorm,
            destination: tNorm,
            comment: cleanComment,
          },
          comment
        );
      } else if (isMathAppCmd(appCmdKind)) {
        onSave(
          {
            kind: 'MATH',
            operator: appCmdKind,
            source1: pNorm,
            source2: sNorm,
            destination: tNorm,
            comment: cleanComment,
          },
          comment
        );
      } else if (isIncDecAppCmd(appCmdKind)) {
        onSave(
          { kind: 'INCDEC', operator: appCmdKind, target: pNorm, comment: cleanComment },
          comment
        );
      } else if (appCmdKind === 'TRD') {
        onSave({ kind: 'TRD', destination: pNorm, comment: cleanComment }, comment);
      }
    }
  };

  const activeQuickRole =
    activeField === 'tertiary' && tertiaryRole
      ? tertiaryRole
      : activeField === 'secondary' && secondaryRole
        ? secondaryRole
        : primaryRole;

  const activeQuickValue =
    activeField === 'tertiary' && tertiaryRole
      ? tertiaryInput
      : activeField === 'secondary' && secondaryRole
        ? secondaryInput
        : primaryInput;

  const handleQuickPick = (val: string) => {
    if (activeField === 'tertiary' && tertiaryRole) {
      handleTertiaryChange(val);
    } else if (activeField === 'secondary' && secondaryRole) {
      handleSecondaryChange(val);
      if (tertiaryRole) {
        setActiveField('tertiary');
      }
    } else {
      handlePrimaryChange(val);
      if (secondaryRole) {
        setActiveField('secondary');
      }
    }
  };

  const modalTitle = isContact
    ? 'Kontak Düzenle'
    : isCoil
      ? 'Çıkış / Mühür Bobini Düzenle'
      : isCompare
        ? 'Karşılaştırma Kontağı Düzenle'
        : `Uygulama Komutu Düzenle (${appCmdKind})`;

  const gridColsClass = tertiaryRole
    ? 'grid grid-cols-1 sm:grid-cols-3 gap-2.5'
    : secondaryRole
      ? 'grid grid-cols-1 sm:grid-cols-2 gap-2.5'
      : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cell-edit-modal-title"
      className="fixed inset-0 z-50 bg-[#0F172A]/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-[#BFC7D5] rounded-t-xl sm:rounded-md shadow-xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3 bg-[#F4F6F9] border-b border-[#CBD2DC] flex items-center justify-between gap-2">
          <h2 id="cell-edit-modal-title" className="text-sm font-bold text-[#0F172A]">
            {modalTitle}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Düzenleme penceresini kapat"
            className="w-8 h-8 rounded flex items-center justify-center text-[#475569] hover:bg-[#E2E8F0] hover:text-[#0F172A] cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto wpl-scrollbar space-y-3.5 text-xs">
          {/* Sub-type switcher */}
          {isContact && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {CONTACT_TYPES.map((ct) => (
                <button
                  key={ct.id}
                  type="button"
                  onClick={() => setContactType(ct.id)}
                  className={`min-h-[42px] px-2 py-1 rounded border text-center transition-colors cursor-pointer ${
                    contactType === ct.id
                      ? 'bg-[#EEF4FC] border-[#0B4EA2] text-[#0B4EA2] font-bold'
                      : 'bg-white border-[#CBD2DC] text-[#334155] hover:bg-[#F8FAFC]'
                  }`}
                >
                  <div className="font-mono text-xs">{ct.glyph}</div>
                  <div className="text-[10px]">{ct.label}</div>
                </button>
              ))}
            </div>
          )}

          {isCoil && (
            <div className="grid grid-cols-3 gap-1.5">
              {COIL_TYPES.map((ct) => (
                <button
                  key={ct.id}
                  type="button"
                  onClick={() => setCoilType(ct.id)}
                  className={`min-h-[40px] px-2 py-1.5 rounded border text-xs font-semibold transition-colors cursor-pointer ${
                    coilType === ct.id
                      ? 'bg-[#EEF4FC] border-[#0B4EA2] text-[#0B4EA2]'
                      : 'bg-white border-[#CBD2DC] text-[#334155] hover:bg-[#F8FAFC]'
                  }`}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          )}

          {isAppCmd && (
            <div className="space-y-2">
              {APP_CMD_GROUPS.map((grp) => (
                <div key={grp.label} className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    {grp.label}
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {grp.items.map((cmd) => {
                      const isDisabled = cmd.id === 'TRD' && !spec.hasRtc;
                      return (
                        <button
                          key={cmd.id}
                          type="button"
                          disabled={isDisabled}
                          data-testid={`app-cmd-${cmd.id}`}
                          title={
                            isDisabled
                              ? `TRD yalnızca dahili RTC bulunan DVP-SX2 modelinde desteklenir (${model} desteklemez)`
                              : cmd.short
                          }
                          onClick={() => handleSwitchAppCmd(cmd.id)}
                          className={`min-h-[34px] px-1.5 py-1 rounded border text-xs font-mono font-bold transition-colors ${
                            isDisabled
                              ? 'bg-[#F1F5F9] border-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                              : appCmdKind === cmd.id
                                ? 'bg-[#0B4EA2] border-[#0B4EA2] text-white cursor-pointer'
                                : 'bg-white border-[#CBD2DC] text-[#334155] hover:bg-[#EDF4FC] hover:border-[#0B4EA2] cursor-pointer'
                          }`}
                        >
                          {cmd.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {isCompare && (
            <div>
              <span className="block text-[11px] font-medium text-[#475569] mb-1">
                Karşılaştırma Operatörü
              </span>
              <div className="grid grid-cols-6 gap-1.5">
                {COMPARE_OPERATORS.map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => setCompareOp(op)}
                    className={`h-9 rounded border font-mono text-xs font-bold transition-colors cursor-pointer ${
                      compareOp === op
                        ? 'bg-[#0B4EA2] text-white border-[#0B4EA2]'
                        : 'bg-white border-[#CBD2DC] text-[#1E293B] hover:border-[#0B4EA2]'
                    }`}
                  >
                    {op}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Address Input Fields */}
          <div className={gridColsClass}>
            <div>
              <label
                htmlFor="cell-primary-input"
                className="block text-[11px] font-medium text-[#475569] mb-1"
              >
                {primaryLabel}
              </label>
              <input
                id="cell-primary-input"
                type="text"
                autoFocus
                value={primaryInput}
                onFocus={() => setActiveField('primary')}
                onChange={(e) => handlePrimaryChange(e.target.value)}
                className={`w-full h-10 px-3 rounded border font-mono text-sm font-semibold text-[#0F172A] focus:outline-none focus:ring-2 ${
                  !primaryValidation.valid
                    ? 'border-[#DC2626] focus:ring-[#DC2626]/30 bg-[#FEF2F2]/40'
                    : activeField === 'primary'
                      ? 'border-[#0B4EA2] focus:ring-[#0B4EA2]/25 bg-white'
                      : 'border-[#B8C2D1] focus:ring-[#0B4EA2]/25 bg-white'
                }`}
              />
            </div>

            {secondaryRole && (
              <div>
                <label
                  htmlFor="cell-secondary-input"
                  className="block text-[11px] font-medium text-[#475569] mb-1"
                >
                  {secondaryLabel}
                </label>
                <input
                  id="cell-secondary-input"
                  type="text"
                  value={secondaryInput}
                  onFocus={() => setActiveField('secondary')}
                  onChange={(e) => handleSecondaryChange(e.target.value)}
                  className={`w-full h-10 px-3 rounded border font-mono text-sm font-semibold text-[#0F172A] focus:outline-none focus:ring-2 ${
                    !secondaryValidation.valid || !zrstValidation.valid
                      ? 'border-[#DC2626] focus:ring-[#DC2626]/30 bg-[#FEF2F2]/40'
                      : activeField === 'secondary'
                        ? 'border-[#0B4EA2] focus:ring-[#0B4EA2]/25 bg-white'
                        : 'border-[#B8C2D1] focus:ring-[#0B4EA2]/25 bg-white'
                  }`}
                />
              </div>
            )}

            {tertiaryRole && (
              <div>
                <label
                  htmlFor="cell-tertiary-input"
                  className="block text-[11px] font-medium text-[#475569] mb-1"
                >
                  {tertiaryLabel}
                </label>
                <input
                  id="cell-tertiary-input"
                  type="text"
                  value={tertiaryInput}
                  onFocus={() => setActiveField('tertiary')}
                  onChange={(e) => handleTertiaryChange(e.target.value)}
                  className={`w-full h-10 px-3 rounded border font-mono text-sm font-semibold text-[#0F172A] focus:outline-none focus:ring-2 ${
                    !tertiaryValidation.valid
                      ? 'border-[#DC2626] focus:ring-[#DC2626]/30 bg-[#FEF2F2]/40'
                      : activeField === 'tertiary'
                        ? 'border-[#0B4EA2] focus:ring-[#0B4EA2]/25 bg-white'
                        : 'border-[#B8C2D1] focus:ring-[#0B4EA2]/25 bg-white'
                  }`}
                />
              </div>
            )}
          </div>

          {helperHint && (
            <p className="text-[11px] text-[#475569] bg-[#F1F5F9] border border-[#DDE3EC] rounded px-2.5 py-1.5">
              {helperHint}
            </p>
          )}

          {/* Live Validation Feedback */}
          {firstError && (
            <div className="flex items-start gap-2 text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded p-2.5">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{firstError}</span>
            </div>
          )}

          {primaryValidation.valid && primaryValidation.warning && (
            <div className="flex items-start gap-2 text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{primaryValidation.warning}</span>
            </div>
          )}

          {/* Quick-Pick Chips */}
          <QuickPickPanel
            role={activeQuickRole}
            model={model}
            selectedValue={activeQuickValue}
            onPick={handleQuickPick}
          />

          {/* Optional Device Comment */}
          <div>
            <label
              htmlFor="cell-comment-input"
              className="block text-[11px] font-medium text-[#475569] mb-1"
            >
              Aygıt Açıklaması / Etiketi (İsteğe Bağlı)
            </label>
            <input
              id="cell-comment-input"
              type="text"
              maxLength={24}
              value={comment}
              onChange={(e) => {
                setCommentTouched(true);
                setComment(e.target.value);
              }}
              placeholder="Örn. Start, Stop, Motor"
              className="w-full h-9 px-3 rounded border border-[#B8C2D1] bg-white text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/25 focus:border-[#0B4EA2]"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 bg-[#F4F6F9] border-t border-[#CBD2DC] flex items-center justify-between gap-2">
          <div>
            {!isNewPlacement && (
              <button
                type="button"
                onClick={onDelete}
                className="h-9 px-3 rounded border border-[#FECACA] bg-white text-[#B91C1C] hover:bg-[#FEF2F2] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sil</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-9 px-3.5 rounded border border-[#C5CDD9] bg-white text-[#334155] hover:bg-[#EDF2F8] text-xs font-medium cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={!isFormValid}
              className="h-9 px-4 rounded bg-[#0B4EA2] text-white hover:bg-[#073878] disabled:opacity-45 disabled:pointer-events-none text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Uygula</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
