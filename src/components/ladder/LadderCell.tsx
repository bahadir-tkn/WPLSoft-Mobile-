import React from 'react';
import type { CursorPosition, LadderCellData } from '../../types/plc';

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
  onSelect: (pos: CursorPosition) => void;
  onActivate?: (pos: CursorPosition) => void;
  onOnlineClick?: (pos: CursorPosition) => void;
}

const LadderCellComponent: React.FC<LadderCellProps> = ({
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
      case 'SQR':
        return `SQR ${element.source} ${element.destination}`;
      case 'FLOAT_MOV':
        return `DMOVR ${element.source} ${element.destination}`;
      case 'FLOAT_MATH':
        return `${element.operator} ${element.source1} ${element.source2} ${element.destination}`;
      case 'FLOAT_UNARY':
        return `${element.operator} ${element.source} ${element.destination}`;
      case 'INCDEC':
        return `${element.operator} ${element.target}`;
      case 'TRD':
        return `TRD ${element.destination}`;
      case 'TWR':
        return `${element.pulsed ? 'TWRP' : 'TWR'} ${element.source}`;
      case 'TZCP':
        return `TZCP ${element.start1} ${element.start2} ${element.current} ${element.destination}`;
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
      ? 'h-[56px]'
      : zoomDensity === 'large'
        ? 'h-[82px]'
        : 'h-[70px]';

  const isCompact = zoomDensity === 'compact';
  const isLarge = zoomDensity === 'large';

  const leftWireThickness = activeLeft ? 3 : 2;
  const rightWireThickness = activeRightWire ? 3 : 2;
  const coilRightWireThickness = activeRight ? 3 : 2;

  const topLabelClass = `pointer-events-none absolute ${
    isCompact ? 'top-0.5 text-[10px]' : 'top-1 text-[11px]'
  } left-0.5 right-0.5 text-center font-mono font-bold leading-none whitespace-nowrap truncate`;

  const boxHeightClass = isCompact ? 'h-[22px]' : isLarge ? 'h-[30px]' : 'h-[26px]';
  const boxTextClass = isCompact
    ? 'text-[9.5px]'
    : isLarge
      ? 'text-[11.5px]'
      : 'text-[10.5px]';

  /**
   * Renders a full edge-to-edge horizontal wire rail centered at y = 52%
   * with the element glyph sandwiched tightly between flex-1 left/right wires.
   * This guarantees zero gaps between cells, HLINEs, and power rails at any width or zoom.
   */
  const renderWireRailRow = (
    centerNode: React.ReactNode,
    opts?: {
      rightColor?: string;
      rightThickness?: number;
      leftColor?: string;
      leftThickness?: number;
      minWirePx?: number;
    }
  ) => {
    const lColor = opts?.leftColor ?? leftWireColor;
    const rColor = opts?.rightColor ?? rightWireColor;
    const lThick = opts?.leftThickness ?? leftWireThickness;
    const rThick = opts?.rightThickness ?? rightWireThickness;
    const minW = opts?.minWirePx ?? 4;

    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-1px] right-[-1px] top-[52%] -translate-y-1/2 flex items-center"
      >
        <span
          className="flex-1"
          style={{
            minWidth: `${minW}px`,
            height: `${lThick}px`,
            backgroundColor: lColor,
          }}
        />
        {centerNode}
        <span
          className="flex-1"
          style={{
            minWidth: `${minW}px`,
            height: `${rThick}px`,
            backgroundColor: rColor,
          }}
        />
      </div>
    );
  };

  const renderFunctionBox = (
    topLabel: string,
    innerText: string,
    options?: {
      compactFontSize?: string;
      fillBg?: string;
      borderColor?: string;
      textColor?: string;
      leftColor?: string;
      rightColor?: string;
      leftThickness?: number;
      rightThickness?: number;
    }
  ) => {
    const borderCol = options?.borderColor ?? symbolColor;
    const txtCol = options?.textColor ?? symbolColor;
    const bgCol =
      options?.fillBg ?? (activeRight ? 'rgba(0, 200, 83, 0.16)' : '#F8FAFC');

    return (
      <div className="relative w-full h-full">
        {topLabel && (
          <span className={topLabelClass} style={{ color: txtCol }}>
            {topLabel}
          </span>
        )}
        {renderWireRailRow(
          <span
            className={`shrink-0 ${boxHeightClass} max-w-[calc(100%-14px)] px-1.5 rounded-[2px] border-2 font-mono font-bold leading-none flex items-center justify-center truncate ${
              options?.compactFontSize ?? boxTextClass
            }`}
            style={{
              backgroundColor: bgCol,
              borderColor: borderCol,
              color: txtCol,
            }}
          >
            <span className="truncate">{innerText}</span>
          </span>,
          {
            leftColor: options?.leftColor ?? leftWireColor,
            rightColor: options?.rightColor ?? rightWireColor,
            leftThickness: options?.leftThickness ?? leftWireThickness,
            rightThickness: options?.rightThickness ?? coilRightWireThickness,
            minWirePx: 7,
          }
        )}
      </div>
    );
  };

  const renderElementGraphic = () => {
    switch (element.kind) {
      case 'EMPTY':
        return <div className="w-full h-full" />;

      case 'HLINE':
        return (
          <div className="relative w-full h-full" aria-hidden="true">
            <span
              className="pointer-events-none absolute left-[-1px] right-[-1px] top-[52%] -translate-y-1/2"
              style={{
                height: `${activeRightWire ? 3 : 2}px`,
                backgroundColor: rightWireColor,
              }}
            />
          </div>
        );

      case 'CONTACT': {
        const isNC = element.contactType === 'NC';
        const isRising = element.contactType === 'RISING';
        const isFalling = element.contactType === 'FALLING';
        const svgSize = isCompact
          ? 'w-[24px] h-[22px]'
          : isLarge
            ? 'w-[34px] h-[30px]'
            : 'w-[28px] h-[26px]';

        return (
          <div className="relative w-full h-full">
            <span className={topLabelClass} style={{ color: symbolColor }}>
              {element.address}
            </span>
            {renderWireRailRow(
              <svg
                viewBox="0 0 34 30"
                className={`${svgSize} shrink-0 block overflow-visible`}
                aria-hidden="true"
              >
                {(activeRight || isContactHighlighted) && (
                  <rect
                    x="2"
                    y="2"
                    width="30"
                    height="26"
                    rx="1.5"
                    fill="rgba(0, 200, 83, 0.22)"
                  />
                )}
                <line x1="1.5" y1="2" x2="1.5" y2="28" stroke={symbolColor} strokeWidth="2.6" />
                <line x1="32.5" y1="2" x2="32.5" y2="28" stroke={symbolColor} strokeWidth="2.6" />
                {isNC && (
                  <line x1="27" y1="4" x2="7" y2="26" stroke={symbolColor} strokeWidth="2.2" />
                )}
                {isRising && (
                  <path
                    d="M17 24V6M11 12l6-6 6 6"
                    fill="none"
                    stroke={symbolColor}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {isFalling && (
                  <path
                    d="M17 6v18M11 18l6 6 6-6"
                    fill="none"
                    stroke={symbolColor}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>,
              {
                leftColor: leftWireColor,
                rightColor: rightWireColor,
                leftThickness: leftWireThickness,
                rightThickness: rightWireThickness,
                minWirePx: 6,
              }
            )}
          </div>
        );
      }

      case 'COMPARE':
        return renderFunctionBox(
          `${element.operandA} ${element.operator} ${element.operandB}`,
          `LD${element.operator}`,
          {
            fillBg: activeRight || isContactHighlighted ? 'rgba(0, 200, 83, 0.18)' : '#F8FAFC',
            rightThickness: rightWireThickness,
          }
        );

      case 'COIL': {
        const svgSize = isCompact
          ? 'w-[50px] h-[24px]'
          : isLarge
            ? 'w-[68px] h-[32px]'
            : 'w-[58px] h-[28px]';

        return (
          <div className="relative w-full h-full">
            <span className={topLabelClass} style={{ color: symbolColor }}>
              {element.address}
            </span>
            {renderWireRailRow(
              <svg
                viewBox="0 0 64 32"
                className={`${svgSize} shrink-0 block overflow-visible`}
                aria-hidden="true"
              >
                {activeRight && (
                  <ellipse
                    cx="32"
                    cy="16"
                    rx="27"
                    ry="14"
                    fill="rgba(0, 200, 83, 0.18)"
                  />
                )}
                {/* Tiny anchor caps guarantee seamless sub-pixel join to left/right bus rails */}
                <line
                  x1="-0.5"
                  y1="16"
                  x2="2.5"
                  y2="16"
                  stroke={leftWireColor}
                  strokeWidth={leftWireThickness}
                />
                <line
                  x1="61.5"
                  y1="16"
                  x2="64.5"
                  y2="16"
                  stroke={rightWireColor}
                  strokeWidth={coilRightWireThickness}
                />
                <path
                  d="M11 2Q-8 16 11 30"
                  fill="none"
                  stroke={symbolColor}
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
                <path
                  d="M53 2Q72 16 53 30"
                  fill="none"
                  stroke={symbolColor}
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
                {element.coilType !== 'OUT' && (
                  <text
                    x="32"
                    y="20"
                    textAnchor="middle"
                    fill={symbolColor}
                    fontSize="12"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {element.coilType}
                  </text>
                )}
              </svg>,
              {
                leftColor: leftWireColor,
                rightColor: rightWireColor,
                leftThickness: leftWireThickness,
                rightThickness: coilRightWireThickness,
                minWirePx: 10,
              }
            )}
          </div>
        );
      }

      case 'TMR':
      case 'CNT':
        return renderFunctionBox(element.kind, `${element.address} ${element.preset}`);

      case 'MOV':
      case 'SQR':
      case 'FLOAT_MOV':
      case 'FLOAT_UNARY': {
        const opcode =
          element.kind === 'MOV'
            ? 'MOV'
            : element.kind === 'SQR'
              ? 'SQR'
              : element.kind === 'FLOAT_MOV'
                ? 'DMOVR'
                : element.operator;
        return renderFunctionBox(opcode, `${element.source} → ${element.destination}`);
      }

      case 'ALT':
      case 'INCDEC':
      case 'TRD':
      case 'TWR': {
        const opcode =
          element.kind === 'ALT'
            ? 'ALT'
            : element.kind === 'TRD'
              ? 'TRD'
              : element.kind === 'TWR'
                ? element.pulsed
                  ? 'TWRP'
                  : 'TWR'
                : element.operator;
        const targetText =
          element.kind === 'TRD'
            ? element.destination
            : element.kind === 'TWR'
              ? element.source
              : element.target;
        return renderFunctionBox(opcode, targetText);
      }

      case 'ZRST':
        return renderFunctionBox('ZRST', `${element.start} .. ${element.end}`);

      case 'CMP':
      case 'MATH':
      case 'FLOAT_MATH':
      case 'TZCP': {
        const opcode =
          element.kind === 'CMP'
            ? 'CMP'
            : element.kind === 'TZCP'
              ? 'TZCP'
              : element.operator;
        const innerText =
          element.kind === 'TZCP'
            ? `${element.start1} ${element.start2} ${element.current}→${element.destination}`
            : `${element.source1} ${element.source2} ${element.destination}`;
        return renderFunctionBox(opcode, innerText, {
          compactFontSize:
            element.kind === 'TZCP'
              ? isCompact
                ? 'text-[8.5px]'
                : 'text-[9.5px]'
              : isCompact
                ? 'text-[9px]'
                : 'text-[10px]',
        });
      }

      case 'END':
        return renderFunctionBox('', 'END', {
          fillBg: '#EEF4FC',
          borderColor: '#0B4EA2',
          textColor: '#0B4EA2',
          leftColor: '#1E293B',
          rightColor: '#1E293B',
          leftThickness: 2,
          rightThickness: 2,
          compactFontSize: isCompact ? 'text-[11px] px-3' : 'text-xs px-4',
        });
    }
  };

  const showLiveBadge = isOnline && Boolean(liveValueBadge);
  const isOnlineClickable =
    isOnline &&
    !isEndRung &&
    element.kind !== 'EMPTY' &&
    element.kind !== 'HLINE' &&
    element.kind !== 'END';

  const handleClick = () => {
    const pos: CursorPosition = { rungIndex, rowIndex, colIndex };
    if (isOnline) {
      if (isOnlineClickable) onOnlineClick?.(pos);
    } else {
      onSelect(pos);
    }
  };

  const handleDoubleClick = () => {
    if (!isOnline) {
      onActivate?.({ rungIndex, rowIndex, colIndex });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={isOnline ? undefined : handleDoubleClick}
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

      {/* Vertical OR-Branch connector coming down from cell above — aligned cleanly to 52% horizontal wire */}
      {branchUp && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[-1.5px] top-[-1px] w-[3px] z-20"
          style={{
            height: 'calc(52% + 2px)',
            backgroundColor: branchUpColor,
          }}
        />
      )}

      {/* Vertical OR-Branch connector going down to cell below — aligned cleanly to 52% horizontal wire */}
      {branchDown && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[-1.5px] bottom-[-1px] w-[3px] z-20"
          style={{
            top: 'calc(52% - 1.5px)',
            backgroundColor: branchDownColor,
          }}
        />
      )}
    </button>
  );
};

export const LadderCell = React.memo(LadderCellComponent);
LadderCell.displayName = 'LadderCell';
