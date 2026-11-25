export type PlcModelId = 'DVP-SX2' | 'DVP-14SS2' | 'DVP-12SA2';

export type DevicePrefix = 'X' | 'Y' | 'M' | 'S' | 'T' | 'C' | 'D' | 'K' | 'F';

export type AddressRole =
  | 'any'
  | 'bit_contact'
  | 'bit_coil'
  | 'rst_target'
  | 'timer'
  | 'counter'
  | 'preset'
  | 'word_source'
  | 'word_dest'
  | 'float_source';

export type CompareOperator = '=' | '>' | '<' | '>=' | '<=' | '<>';

export type ContactKind = 'NO' | 'NC' | 'RISING' | 'FALLING';

export type CoilKind = 'OUT' | 'SET' | 'RST';

export type MathOperator = 'ADD' | 'SUB' | 'MUL' | 'DIV';

export type FloatMathOperator = 'DADDR' | 'DSUBR' | 'DMULR' | 'DDIVR';

export type FloatUnaryOperator = 'DESQR' | 'FLT';

export type IncDecOperator = 'INC' | 'INCP' | 'DEC' | 'DECP';

export type SimSpeedMultiplier = 1 | 2 | 10;

export type FunctionToolId =
  | 'F1'
  | 'F2'
  | 'F3'
  | 'F4'
  | 'F5'
  | 'F6'
  | 'F7'
  | 'F8'
  | 'F9'
  | 'F10'
  | 'F11'
  | 'F12';

export interface PlcModelSpec {
  id: PlcModelId;
  series: string;
  label: string;
  recommended?: boolean;
  summary: string;
  programCapacitySteps: number;
  onboardInputCount: number;
  onboardOutputCount: number;
  analogInputCount: number;
  analogOutputCount: number;
  hasRtc: boolean;
  maxOctalIo: number;
  onboardInputs: string[];
  onboardOutputs: string[];
  allInputs: string[];
  allOutputs: string[];
  relayRange: { min: number; max: number };
  /** Adım (step) röleleri S0–S1023 (STL / SFC adımları) */
  stepRange: { min: number; max: number };
  timerRange: { min: number; max: number; timeBaseMs: number };
  counterRange: { min: number; max: number };
  registerRange: { min: number; max: number };
}

export interface SpecialRelayInfo {
  address: string;
  name: string;
  description: string;
  readOnly: boolean;
  category: 'system' | 'clock' | 'flag';
}

export type CellElement =
  | { kind: 'EMPTY' }
  | { kind: 'HLINE' }
  | {
      kind: 'CONTACT';
      contactType: ContactKind;
      address: string;
      comment?: string;
    }
  | {
      kind: 'COMPARE';
      operator: CompareOperator;
      operandA: string;
      operandB: string;
      comment?: string;
    }
  | {
      kind: 'COIL';
      coilType: CoilKind;
      address: string;
      comment?: string;
    }
  | {
      kind: 'TMR';
      address: string;
      preset: string;
      comment?: string;
    }
  | {
      kind: 'CNT';
      address: string;
      preset: string;
      comment?: string;
    }
  | {
      kind: 'MOV';
      source: string;
      destination: string;
      comment?: string;
    }
  | {
      kind: 'ALT';
      target: string;
      /** ALTP: yalnızca giriş yükselen kenarında bir kez değiştirir */
      pulsed?: boolean;
      comment?: string;
    }
  | {
      kind: 'ZRST';
      start: string;
      end: string;
      comment?: string;
    }
  | {
      kind: 'CMP';
      source1: string;
      source2: string;
      destination: string;
      comment?: string;
    }
  | {
      kind: 'MATH';
      operator: MathOperator;
      source1: string;
      source2: string;
      destination: string;
      comment?: string;
    }
  | {
      kind: 'SQR';
      source: string;
      destination: string;
      comment?: string;
    }
  | {
      kind: 'FLOAT_MOV';
      source: string;
      destination: string;
      comment?: string;
    }
  | {
      kind: 'FLOAT_MATH';
      operator: FloatMathOperator;
      source1: string;
      source2: string;
      destination: string;
      comment?: string;
    }
  | {
      kind: 'FLOAT_UNARY';
      operator: FloatUnaryOperator;
      source: string;
      destination: string;
      comment?: string;
    }
  | {
      kind: 'INCDEC';
      operator: IncDecOperator;
      target: string;
      comment?: string;
    }
  | {
      kind: 'TRD';
      destination: string;
      comment?: string;
    }
  | {
      kind: 'TWR';
      pulsed?: boolean;
      source: string;
      comment?: string;
    }
  | {
      kind: 'TZCP';
      start1: string;
      start2: string;
      current: string;
      destination: string;
      comment?: string;
    }
  /** NP / PN: önündeki kontak dizisinin sonucunun yükselen (↑) / düşen (↓) kenarı */
  | { kind: 'EDGE'; edge: 'NP' | 'PN' }
  /** STL Sn: adım (step ladder) başlığı — yalnızca kendi ağının ilk hücresinde bulunur */
  | { kind: 'STL'; address: string; comment?: string }
  /** RET: adım (STL) bloklarının sonu — yalnızca kendi ağının ilk hücresinde bulunur */
  | { kind: 'RET' }
  | { kind: 'END' };

export interface LadderCellData {
  element: CellElement;
  branchDown: boolean;
}

export interface LadderRung {
  id: string;
  rows: LadderCellData[][];
  comment?: string;
  isEnd?: boolean;
}

export interface LadderProgram {
  version: string;
  model: PlcModelId;
  projectName: string;
  columns: number;
  rungs: LadderRung[];
  deviceComments: Record<string, string>;
  updatedAt: string;
}

export interface CursorPosition {
  rungIndex: number;
  rowIndex: number;
  colIndex: number;
}

export type IlOpcode =
  | 'LD'
  | 'LDI'
  | 'LDP'
  | 'LDF'
  | 'AND'
  | 'ANI'
  | 'ANDP'
  | 'ANDF'
  | 'OR'
  | 'ORI'
  | 'ORP'
  | 'ORF'
  | 'ANB'
  | 'ORB'
  | 'MPS'
  | 'MRD'
  | 'MPP'
  | 'LD='
  | 'LD>'
  | 'LD<'
  | 'LD>='
  | 'LD<='
  | 'LD<>'
  | 'AND='
  | 'AND>'
  | 'AND<'
  | 'AND>='
  | 'AND<='
  | 'AND<>'
  | 'OR='
  | 'OR>'
  | 'OR<'
  | 'OR>='
  | 'OR<='
  | 'OR<>'
  | 'OUT'
  | 'SET'
  | 'RST'
  | 'TMR'
  | 'CNT'
  | 'MOV'
  | 'ALT'
  | 'ALTP'
  | 'ZRST'
  | 'CMP'
  | 'ADD'
  | 'SUB'
  | 'MUL'
  | 'DIV'
  | 'SQR'
  | 'DMOVR'
  | 'DADDR'
  | 'DSUBR'
  | 'DMULR'
  | 'DDIVR'
  | 'DESQR'
  | 'FLT'
  | 'INC'
  | 'INCP'
  | 'DEC'
  | 'DECP'
  | 'TRD'
  | 'TWR'
  | 'TWRP'
  | 'TZCP'
  | 'NP'
  | 'PN'
  | 'STL'
  | 'RET'
  | 'END';

export interface IlInstruction {
  opcode: IlOpcode;
  operands: string[];
  rungIndex: number;
  stepAddress: number;
}

export type DiagnosticSeverity = 'error' | 'warning';

export type DiagnosticCode =
  | 'DOUBLE_COIL'
  | 'MISSING_END'
  | 'INVALID_ADDRESS'
  | 'OPEN_BRANCH'
  | 'SYNTAX_ERROR';

export interface CompileDiagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  rungIndex?: number;
  rowIndex?: number;
  colIndex?: number;
  address?: string;
}

export interface CompileResult {
  instructions: IlInstruction[];
  /** Pure WPLSoft-compatible IL text without line numbers (ready for Ctrl+V into PC WPLSoft) */
  rawIlText: string;
  diagnostics: CompileDiagnostic[];
  stepCount: number;
  hasErrors: boolean;
}

export interface TimerRuntime {
  currentValue: number;
  presetValue: number;
  accumulatedMs: number;
  coilEnergized: boolean;
  done: boolean;
}

export interface CounterRuntime {
  currentValue: number;
  presetValue: number;
  previousInput: boolean;
  done: boolean;
}

export type InputSwitchMode = 'toggle' | 'momentary';

export interface SimState {
  running: boolean;
  scanCount: number;
  scanTimeMs: number;
  /** Accumulated simulated time (ms), scaled by speedMultiplier */
  elapsedSimMs: number;
  /** Simulated RTC timestamp (ms since Unix epoch) synced to D1313–D1319 */
  rtcEpochMs: number;
  inputs: Record<string, boolean>;
  outputs: Record<string, boolean>;
  relays: Record<string, boolean>;
  /** Previous scan bit states used by LDP/LDF/ANDP/ANDF/ORP/ORF rising/falling edge detection */
  previousBitStates: Record<string, boolean>;
  /** Per-cell previous rung input power for rising-edge output instructions (ALT, INCP, DECP) */
  instructionEdgeStates: Record<string, boolean>;
  timers: Record<string, TimerRuntime>;
  counters: Record<string, CounterRuntime>;
  registers: Record<string, number>;
  energizedCells: Record<string, boolean>;
  energizedWires: Record<string, boolean>;
  /** Tracks whether each contact/compare cell is currently closed/conducting (e.g. NC contact when bit=0) */
  conductingCells?: Record<string, boolean>;
}

export interface FunctionToolDefinition {
  id: FunctionToolId;
  shortcut: FunctionToolId;
  label: string;
  shortLabel: string;
  mnemonic: string;
  description: string;
  columnScope: 'logic' | 'output' | 'any' | 'rung';
}
