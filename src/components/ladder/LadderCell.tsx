import React from 'react';
import type { LadderCellData } from '../../types/plc';

interface LadderCellProps {
  cell: LadderCellData;
  rungIndex: number;
  rowIndex: number;
  colIndex: number;
  isCoilColumn: boolean;
  isSelected: boolean;
  isEndRung?: boolean;
  isOnline?: boolean;
  branchUp?: boolean;
  deviceComment?: string;
  liveValueBadge?: string;
  energized?: boolean;
  /** True when the contact/compare element itself is closed/conducting (e.g. NC contact when bit=0) */
  contactConducting?: boolean;
  leftWireEnergized?: boolean;
  branchEnergized?: boolean;
  branchUpEnergized?: boolean;
  diagnosticSeverity?: 'error' | 'warning';
  zoomDensity?: 'compact' | 'normal' | 'large';
  onSelect: () => void;
  onActivate?: () => void;
  onOnlineClick?: () => void;
}

export const LadderCell: React.FC<LadderCellProps> = ({
  cell,
  rungIndex,
  rowIndex,
  colIndex,
  isCoilColumn,
  isSelected,
  isEndRung = false,
  isOnline = false,
  branchUp = false,
  deviceComment,
  liveValueBadge,
  energized = false,
  contactConducting = false,
  leftWireEnergized = false,
  branchEnergized = false,
  branchUpEnergized = false,
  diagnosticSeverity,
  zoomDensity = 'normal',
  onSelect,
  onActivate,
  onOnlineClick,
}) => {
  const { element, branchDown } = cell;
  const activeLeft = isOnline && (leftWireEnergized || energized);
  const activeRight = isOnline && energized;
  const activeRightWire = isOnline && (energized || (branchDown && branchEnergized));
  const isContactHighlighted =
    isOnline &&
    (element.kind === 'CONTACT' || element.kind === 'COMPARE') &&
    (energized || contactConducting);

  const leftWireColor = activeLeft ? '#00C853' : '#1E293B';
  const rightWireColor = activeRightWire ? '#00C853' : '#1E293B';
  const symbolColor = activeRight || isContactHighlighted ? '#00C853' : '#0B4EA2';
  const branchDownColor = isOnline && branchEnergized ? '#00C853' : '#1E293B';
  const branchUpColor = isOnline && branchUpEnergized ? '#00C853' : '#1E293B';

  const describeElement = (): string => {
    switch (element.kind) {
      case 'EMPTY':
        return 'Boş';
      case 'HLINE':
        return 'Yatay Hat';
      case 'CONTACT':
        return `${element.contactType} ${element.address}`;
      case 'COMPARE':
        return `${element.operandA} ${element.operator} ${element.operandB}`;
      case 'COIL':
        return `${element.coilType} ${element.address}`;
      case 'TMR':
        return `TMR ${element.address} ${element.preset}`;
      case 'CNT':
        return `CNT ${element.address} ${element.preset}`;
      case 'MOV':
        return `MOV ${element.source} ${element.destination}`;
      case 'ALT':
        return `ALT ${element.target}`;
      case 'ZRST':
        return `ZRST ${element.start} ${element.end}`;
      case 'CMP':
        return `CMP ${element.source1} ${element.source2} ${element.destination}`;
      case 'MATH':
        return `${element.operator} ${element.source1} ${element.source2} ${element.destination}`;
      case 'INCDEC':
        return `${element.operator} ${element.target}`;
      case 'TRD':
        return `TRD ${element.destination}`;
      case 'END':
        return 'END';
    }
  };

  const cellRoleLabel = isEndRung
    ? isCoilColumn
      ? 'Program sonu END komutu'
      : `END satırı bağlantı hücresi sütun ${colIndex}`
    : isCoilColumn
      ? `Ağ ${String(rungIndex).padStart(3, '0')} Satır ${rowIndex} Çıkış Sütunu (${describeElement()})`
      : `Ağ ${String(rungIndex).padStart(3, '0')} Satır ${rowIndex} Sütun ${colIndex} (${describeElement()})`;

  const widthClass = isCoilColumn
    ? zoomDensity === 'compact'
      ? 'min-w-[126px] w-[128px] shrink-0'
      : zoomDensity === 'large'
        ? 'min-w-[180px] w-[184px] shrink-0'
        : 'min-w-[152px] w-[156px] shrink-0'
    : zoomDensity === 'compact'
      ? 'min-w-[70px] xl:min-w-[76px] flex-1'
      : zoomDensity === 'large'
        ? 'min-w-[112px] xl:min-w-[118px] flex-1'
        : 'min-w-[90px] xl:min-w-[96px] flex-1';

  const heightClass =
    zoomDensity === 'compact'
      ? 'h-[62px]'
      : zoomDensity === 'large'
        ? 'h-[84px]'
        : 'h-[72px]';

  const renderElementGraphic = () => {
    switch (element.kind) {
      case 'EMPTY':
        return <div className="w-full h-full" />;

      case 'HLINE':
        return (
          <svg
            viewBox="0 0 120 72"
            className="w-full h-full"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              x1="0"
              y1="38"
              x2="120"
              y2="38"
              stroke={rightWireColor}
              strokeWidth={activeRight ? 3.2 : 2}
            />
          </svg>
        );

      case 'CONTACT': {
        const isNC = element.contactType === 'NC';
        const isRising = element.contactType === 'RISING';
        const isFalling = element.contactType === 'FALLING';
        return (
          <div className="relative w-full h-full">
            <span
              className="absolute top-1 left-0 right-0 text-center text-[11px] font-mono font-bold leading-none px-1 whitespace-nowrap"
              style={{ color: symbolColor }}
            >
              {element.address}
            </span>
            <svg viewBox="0 0 120 72" className="w-full h-full" aria-hidden="true">
              <line
                x1="0"
                y1="38"
                x2="44"
                y2="38"
                stroke={leftWireColor}
                strokeWidth={activeLeft ? 3.2 : 2}
              />
              {(activeRight || isContactHighlighted) && (
                <rect
                  x="44"
                  y="22"
                  width="32"
                  height="32"
                  rx="2"
                  fill="rgba(0, 200, 83, 0.22)"
                />
              )}
              <line x1="44" y1="22" x2="44" y2="54" stroke={symbolColor} strokeWidth="2.6" />
              <line x1="76" y1="22" x2="76" y2="54" stroke={symbolColor} strokeWidth="2.6" />
              {isNC && (
                <line x1="71" y1="24" x2="49" y2="52" stroke={symbolColor} strokeWidth="2.2" />
              )}
              {isRising && (
                <path
                  d="M60 49V27M53 34l7-7 7 7"
                  fill="none"
                  stroke={symbolColor}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {isFalling && (
                <path
                  d="M60 27v22M53 42l7 7 7-7"
                  fill="none"
                  stroke={symbolColor}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <line
                x1="76"
                y1="38"
                x2="120"
                y2="38"
                stroke={rightWireColor}
                strokeWidth={activeRightWire ? 3.2 : 2}
              />
            </svg>
          </div>
        );
      }

      case 'COMPARE':
        return (
          <div className="relative w-full h-full">
            <span
              className="absolute top-1 left-0 right-0 text-center text-[11px] font-mono font-bold leading-none px-1 whitespace-nowrap"
              style={{ color: symbolColor }}
            >
              {element.operandA} {element.operator} {element.operandB}
            </span>
            <svg viewBox="0 0 120 72" className="w-full h-full" aria-hidden="true">
              <line
                x1="0"
                y1="38"
                x2="16"
                y2="38"
                stroke={leftWireColor}
                strokeWidth={activeLeft ? 3.2 : 2}
              />
              <rect
                x="16"
                y="21"
                width="88"
                height="30"
                rx="2"
                fill={activeRight || isContactHighlighted ? 'rgba(0, 200, 83, 0.18)' : '#F8FAFC'}
                stroke={symbolColor}
                strokeWidth="2"
              />
              <text
                x="60"
                y="40"
                textAnchor="middle"
                fill={symbolColor}
                fontSize="12"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                LD{element.operator}
              </text>
              <line
                x1="104"
                y1="38"
                x2="120"
                y2="38"
                stroke={rightWireColor}
                strokeWidth={activeRight ? 3.2 : 2}
              />
            </svg>
          </div>
        );

      case 'COIL':
        return (
          <div className="relative w-full h-full">
            <span
              className="absolute top-1 left-0 right-0 text-center text-[11px] font-mono font-bold leading-none px-1 whitespace-nowrap"
              style={{ color: symbolColor }}
            >
              {element.address}
            </span>
            <svg viewBox="0 0 144 72" className="w-full h-full" aria-hidden="true">
              <line
                x1="0"
                y1="38"
                x2="40"
                y2="38"
                stroke={leftWireColor}
                strokeWidth={activeLeft ? 3.2 : 2}
              />
              {activeRight && (
                <ellipse
                  cx="72"
                  cy="38"
                  rx="27"
                  ry="16"
                  fill="rgba(0, 200, 83, 0.18)"
                />
              )}
              <path
                d="M49 22C37 29 37 47 49 54"
                fill="none"
                stroke={symbolColor}
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d="M95 22C107 29 107 47 95 54"
                fill="none"
                stroke={symbolColor}
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              {element.coilType !== 'OUT' && (
                <text
                  x="72"
                  y="42"
                  textAnchor="middle"
                  fill={symbolColor}
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {element.coilType}
                </text>
              )}
              <line
                x1="104"
                y1="38"
                x2="144"
                y2="38"
                stroke={rightWireColor}
                strokeWidth={activeRight ? 3.2 : 2}
              />
            </svg>
          </div>
        );

      case 'TMR':
      case 'CNT':
        return (
          <div className="relative w-full h-full">
            <span
              className="absolute top-1 left-0 right-0 text-center text-[11px] font-mono font-bold leading-none px-1 whitespace-nowrap"
              style={{ color: symbolColor }}
            >
              {element.kind} {element.address} {element.preset}
            </span>
            <svg viewBox="0 0 144 72" className="w-full h-full" aria-hidden="true">
              <line
                x1="0"
                y1="38"
                x2="12"
                y2="38"
                stroke={leftWireColor}
                strokeWidth={activeLeft ? 3.2 : 2}
              />
              <rect
                x="12"
                y="20"
                width="120"
                height="30"
                rx="2"
                fill={activeRight ? 'rgba(0, 200, 83, 0.16)' : '#F8FAFC'}
                stroke={symbolColor}
                strokeWidth="2"
              />
              <text
                x="72"
                y="39"
                textAnchor="middle"
                fill={symbolColor}
                fontSize="11.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {element.address} · {element.preset}
              </text>
              <line
                x1="132"
                y1="38"
                x2="144"
                y2="38"
                stroke={rightWireColor}
                strokeWidth={activeRight ? 3.2 : 2}
              />
            </svg>
          </div>
        );

      case 'MOV':
        return (
          <div className="relative w-full h-full">
            <span
              className="absolute top-1 left-0 right-0 text-center text-[11px] font-mono font-bold leading-none px-1 whitespace-nowrap"
              style={{ color: symbolColor }}
            >
              MOV {element.source} {element.destination}
            </span>
            <svg viewBox="0 0 144 72" className="w-full h-full" aria-hidden="true">
              <line
                x1="0"
                y1="38"
                x2="12"
                y2="38"
                stroke={leftWireColor}
                strokeWidth={activeLeft ? 3.2 : 2}
              />
              <rect
                x="12"
                y="20"
                width="120"
                height="30"
                rx="2"
                fill={activeRight ? 'rgba(0, 200, 83, 0.16)' : '#F8FAFC'}
                stroke={symbolColor}
                strokeWidth="2"
              />
              <text
                x="72"
                y="39"
                textAnchor="middle"
                fill={symbolColor}
                fontSize="11.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {element.source} → {element.destination}
              </text>
              <line
                x1="132"
                y1="38"
                x2="144"
                y2="38"
                stroke={rightWireColor}
                strokeWidth={activeRight ? 3.2 : 2}
              />
            </svg>
          </div>
        );

      case 'ALT':
      case 'INCDEC':
      case 'TRD': {
        const opcode =
          element.kind === 'ALT'
            ? 'ALT'
            : element.kind === 'TRD'
              ? 'TRD'
              : element.operator;
        const targetText =
          element.kind === 'TRD' ? element.destination : element.target;
        return (
          <div className="relative w-full h-full">
            <span
              className="absolute top-1 left-0 right-0 text-center text-[11px] font-mono font-bold leading-none px-1 whitespace-nowrap"
              style={{ color: symbolColor }}
            >
              {opcode} {targetText}
            </span>
            <svg viewBox="0 0 156 72" className="w-full h-full" aria-hidden="true">
              <line
                x1="0"
                y1="38"
                x2="14"
                y2="38"
                stroke={leftWireColor}
                strokeWidth={activeLeft ? 3.2 : 2}
              />
              <rect
                x="14"
                y="20"
                width="128"
                height="30"
                rx="2"
                fill={activeRight ? 'rgba(0, 200, 83, 0.16)' : '#F8FAFC'}
                stroke={symbolColor}
                strokeWidth="2"
              />
              <text
                x="78"
                y="39"
                textAnchor="middle"
                fill={symbolColor}
                fontSize="11.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {opcode} · {targetText}
              </text>
              <line
                x1="142"
                y1="38"
                x2="156"
                y2="38"
                stroke={rightWireColor}
                strokeWidth={activeRight ? 3.2 : 2}
              />
            </svg>
          </div>
        );
      }

      case 'ZRST':
        return (
          <div className="relative w-full h-full">
            <span
              className="absolute top-1 left-0 right-0 text-center text-[11px] font-mono font-bold leading-none px-1 whitespace-nowrap"
              style={{ color: symbolColor }}
            >
              ZRST {element.start} {element.end}
            </span>
            <svg viewBox="0 0 156 72" className="w-full h-full" aria-hidden="true">
              <line
                x1="0"
                y1="38"
                x2="10"
                y2="38"
                stroke={leftWireColor}
                strokeWidth={activeLeft ? 3.2 : 2}
              />
              <rect
                x="10"
                y="20"
                width="136"
                height="30"
                rx="2"
                fill={activeRight ? 'rgba(0, 200, 83, 0.16)' : '#F8FAFC'}
                stroke={symbolColor}
                strokeWidth="2"
              />
              <text
                x="78"
                y="39"
                textAnchor="middle"
                fill={symbolColor}
                fontSize="11"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {element.start} .. {element.end}
              </text>
              <line
                x1="146"
                y1="38"
                x2="156"
                y2="38"
                stroke={rightWireColor}
                strokeWidth={activeRight ? 3.2 : 2}
              />
            </svg>
          </div>
        );

      case 'CMP':
      case 'MATH': {
        const opcode = element.kind === 'CMP' ? 'CMP' : element.operator;
        const innerText = `${element.source1} ${element.source2} ${element.destination}`;
        return (
          <div className="relative w-full h-full">
            <span
              className="absolute top-1 left-0 right-0 text-center text-[10.5px] font-mono font-bold leading-none px-1 whitespace-nowrap"
              style={{ color: symbolColor }}
            >
              {opcode}
            </span>
            <svg viewBox="0 0 156 72" className="w-full h-full" aria-hidden="true">
              <line
                x1="0"
                y1="38"
                x2="8"
                y2="38"
                stroke={leftWireColor}
                strokeWidth={activeLeft ? 3.2 : 2}
              />
              <rect
                x="8"
                y="20"
                width="140"
                height="30"
                rx="2"
                fill={activeRight ? 'rgba(0, 200, 83, 0.16)' : '#F8FAFC'}
                stroke={symbolColor}
                strokeWidth="2"
              />
              <text
                x="78"
                y="39"
                textAnchor="middle"
                fill={symbolColor}
                fontSize="10.2"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {innerText}
              </text>
              <line
                x1="148"
                y1="38"
                x2="156"
                y2="38"
                stroke={rightWireColor}
                strokeWidth={activeRight ? 3.2 : 2}
              />
            </svg>
          </div>
        );
      }

      case 'END':
        return (
          <svg viewBox="0 0 144 72" className="w-full h-full" aria-hidden="true">
            <line x1="0" y1="38" x2="24" y2="38" stroke="#1E293B" strokeWidth="2" />
            <rect
              x="24"
              y="22"
              width="96"
              height="32"
              rx="2"
              fill="#EEF4FC"
              stroke="#0B4EA2"
              strokeWidth="2"
            />
            <text
              x="72"
              y="42"
              textAnchor="middle"
              fill="#0B4EA2"
              fontSize="13"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              END
            </text>
            <line x1="120" y1="38" x2="144" y2="38" stroke="#1E293B" strokeWidth="2" />
          </svg>
        );
    }
  };

  const showLiveBadge = isOnline && Boolean(liveValueBadge);
  const isOnlineClickable =
    isOnline &&
    !isEndRung &&
    element.kind !== 'EMPTY' &&
    element.kind !== 'HLINE' &&
    element.kind !== 'END';

  return (
    <button
      type="button"
      onClick={isOnline ? (isOnlineClickable ? onOnlineClick : undefined) : onSelect}
      onDoubleClick={isOnline ? undefined : onActivate}
      disabled={isEndRung}
      aria-label={cellRoleLabel}
      aria-pressed={isSelected}
      data-testid={`cell-${rungIndex}-${rowIndex}-${colIndex}`}
      data-energized={activeRight ? 'true' : 'false'}
      data-conducting={isContactHighlighted ? 'true' : 'false'}
      data-diagnostic={diagnosticSeverity ?? 'none'}
      className={`relative ${widthClass} ${heightClass} border-r border-b border-[#E2E8F0] transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0B4EA2] ${
        isEndRung
          ? 'bg-[#F8FAFC] cursor-default'
          : isOnline
            ? isOnlineClickable
              ? activeRight || isContactHighlighted
                ? 'bg-[#00C853]/[0.08] hover:ring-2 hover:ring-inset hover:ring-[#0B4EA2]/50 cursor-pointer'
                : isCoilColumn
                  ? 'bg-[#FAFBFD] hover:bg-[#EEF4FC] hover:ring-2 hover:ring-inset hover:ring-[#0B4EA2]/50 cursor-pointer'
                  : 'bg-white hover:bg-[#EEF4FC] hover:ring-2 hover:ring-inset hover:ring-[#0B4EA2]/50 cursor-pointer'
              : isCoilColumn
                ? 'bg-[#FAFBFD] cursor-default'
                : 'bg-white cursor-default'
            : isSelected
              ? 'bg-[#2563EB]/[0.1] ring-2 ring-inset ring-[#0B4EA2] z-10 cursor-pointer'
              : diagnosticSeverity === 'error'
                ? 'bg-[#FEF2F2] ring-2 ring-inset ring-[#DC2626]/75 cursor-pointer'
                : diagnosticSeverity === 'warning'
                  ? 'bg-[#FFFBEB] ring-1 ring-inset ring-[#D97706]/70 cursor-pointer'
                  : isCoilColumn
                    ? 'bg-[#FAFBFD] hover:bg-[#EDF4FC]/70 cursor-pointer'
                    : 'bg-white hover:bg-[#F4F7FB] cursor-pointer'
      }`}
    >
      {diagnosticSeverity && !isEndRung && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute top-1 right-1 w-2 h-2 rounded-[2px] z-20 ${
            diagnosticSeverity === 'error' ? 'bg-[#DC2626]' : 'bg-[#D97706]'
          }`}
        />
      )}
      {renderElementGraphic()}

      {/* Live simulation value overlay for TMR / CNT / MOV / COMPARE */}
      {showLiveBadge ? (
        <span
          data-testid={`live-val-${rungIndex}-${rowIndex}-${colIndex}`}
          className={`pointer-events-none absolute bottom-0.5 left-1.5 right-1.5 text-center font-mono text-[10px] font-bold leading-tight px-1 py-0.5 rounded-[2px] truncate ${
            activeRight
              ? 'bg-[#008C3A] text-white'
              : 'bg-[#1E293B] text-white'
          }`}
        >
          {liveValueBadge}
        </span>
      ) : (
        deviceComment &&
        element.kind !== 'EMPTY' &&
        element.kind !== 'HLINE' && (
          <span className="pointer-events-none absolute bottom-1 left-1 right-1 text-center text-[10px] text-[#475569] truncate leading-none">
            {deviceComment}
          </span>
        )
      )}

      {/* Vertical OR-Branch connector coming down from cell above */}
      {branchUp && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[-1.5px] top-[-1px] h-[55%] w-[3px] z-20"
          style={{ backgroundColor: branchUpColor }}
        />
      )}

      {/* Vertical OR-Branch connector going down to cell below */}
      {branchDown && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[-1.5px] top-[51%] bottom-[-1px] w-[3px] z-20"
          style={{ backgroundColor: branchDownColor }}
        />
      )}
    </button>
  );
};
