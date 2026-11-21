import type { LadderProgram } from '../types/plc';
import { offsetDeviceAddress } from './addressing';
import { PLC_MODELS, SX2_ANALOG_INPUT_CHANNELS } from './plcModels';

export type WireColor = 'red' | 'blue' | 'yellow' | 'green' | 'purple';

export type OutputWiringTarget = 'led' | 'relay';

export type WiringCategory = 'power' | 'ground' | 'input' | 'output' | 'analog';

export interface UsedDeviceTerminal {
  address: string;
  label: string;
  comment?: string;
  onboard: boolean;
  /** Numeric index: octal value for X/Y (0..15), channel index 0..3 for AD0..AD3 */
  index: number;
}

export interface WiringConnection {
  id: string;
  stepNumber: number;
  category: WiringCategory;
  color: WireColor;
  colorLabel: string;
  fromModule: string;
  fromTerminal: string;
  toModule: string;
  toTerminal: string;
  deviceAddress?: string;
  deviceComment?: string;
  description: string;
  /** Terminal IDs used by the SVG schematic for clean path routing & pin highlighting */
  fromPinId: string;
  toPinId: string;
}

export interface WiringPlan {
  projectName: string;
  model: LadderProgram['model'];
  outputTarget: OutputWiringTarget;
  usedInputs: UsedDeviceTerminal[];
  usedOutputs: UsedDeviceTerminal[];
  usedAnalogChannels: UsedDeviceTerminal[];
  expansionDevices: string[];
  connections: WiringConnection[];
  needsInputPower: boolean;
  needsOutputPower: boolean;
  needsAnalogWiring: boolean;
  modelMismatchWarning?: string;
  hardwareNotice: string;
}

const BETI_PANEL_MODEL: LadderProgram['model'] = 'DVP-SX2';
const HARDWARE_VERIFICATION_NOTICE =
  'Bu kablolama şeması yazılımsal devre analizine dayanan bir eğitim yardımcısıdır. Fiziksel panele enerji vermeden önce klemens numaralarını, 24V/0V polaritesini (NPN/Sink) ve çıkış tipini resmi Delta DVP ve BETİ eğitim seti dokümantasyonuyla doğrulayın.';

const ANALOG_REG_TO_INDEX: Record<string, number> = {
  D1110: 0,
  D1111: 1,
  D1112: 2,
  D1113: 3,
};

function parseOctalIoAddress(raw: string): { prefix: 'X' | 'Y'; normalized: string; octalVal: number } | null {
  const norm = raw.trim().toUpperCase();
  if (!norm || (norm[0] !== 'X' && norm[0] !== 'Y')) return null;
  const digits = norm.slice(1);
  if (!/^[0-7]+$/.test(digits)) return null;
  const octalVal = Number.parseInt(digits, 8);
  if (Number.isNaN(octalVal) || octalVal < 0) return null;
  return {
    prefix: norm[0] as 'X' | 'Y',
    normalized: `${norm[0]}${octalVal.toString(8)}`,
    octalVal,
  };
}

/**
 * Automatically inspects ANY LadderProgram (templates or custom circuits) and derives the exact
 * physical wiring connections for the BETİ Delta DVP-20SX2 PLC Educational Training Set (NPN/Sink).
 */
export function analyzeProgramWiring(
  program: LadderProgram,
  outputTarget: OutputWiringTarget = 'led'
): WiringPlan {
  const inputSet = new Map<string, number>();
  const outputSet = new Map<string, number>();
  const analogSet = new Set<number>();

  const inspectAddress = (raw: string | undefined) => {
    if (!raw) return;
    const norm = raw.trim().toUpperCase();
    if (!norm) return;

    const io = parseOctalIoAddress(norm);
    if (io) {
      if (io.prefix === 'X') {
        inputSet.set(io.normalized, io.octalVal);
      } else {
        outputSet.set(io.normalized, io.octalVal);
      }
      return;
    }

    if (norm in ANALOG_REG_TO_INDEX) {
      analogSet.add(ANALOG_REG_TO_INDEX[norm]);
    }
  };

  for (const rung of program.rungs) {
    if (rung.isEnd) continue;
    for (const row of rung.rows) {
      for (const cell of row) {
        const el = cell.element;
        switch (el.kind) {
          case 'CONTACT':
          case 'COIL':
            inspectAddress(el.address);
            break;
          case 'TMR':
          case 'CNT':
            inspectAddress(el.preset);
            break;
          case 'MOV':
            inspectAddress(el.source);
            inspectAddress(el.destination);
            break;
          case 'COMPARE':
            inspectAddress(el.operandA);
            inspectAddress(el.operandB);
            break;
          case 'ALT':
            inspectAddress(el.target);
            break;
          case 'ZRST': {
            const s1 = parseOctalIoAddress(el.start);
            const s2 = parseOctalIoAddress(el.end);
            if (s1 && s2 && s1.prefix === 'Y' && s2.prefix === 'Y' && s1.octalVal <= s2.octalVal) {
              const limit = Math.min(s2.octalVal, s1.octalVal + 32);
              for (let idx = s1.octalVal; idx <= limit; idx += 1) {
                outputSet.set(`Y${idx.toString(8)}`, idx);
              }
            }
            break;
          }
          case 'CMP': {
            inspectAddress(el.source1);
            inspectAddress(el.source2);
            inspectAddress(el.destination);
            const d1 = offsetDeviceAddress(el.destination, 1);
            const d2 = offsetDeviceAddress(el.destination, 2);
            if (d1) inspectAddress(d1);
            if (d2) inspectAddress(d2);
            break;
          }
          case 'MATH':
          case 'FLOAT_MATH':
            inspectAddress(el.source1);
            inspectAddress(el.source2);
            inspectAddress(el.destination);
            break;
          case 'SQR':
          case 'FLOAT_MOV':
          case 'FLOAT_UNARY':
            inspectAddress(el.source);
            inspectAddress(el.destination);
            break;
          case 'INCDEC':
            inspectAddress(el.target);
            break;
          case 'TRD':
            inspectAddress(el.destination);
            break;
          case 'TWR':
            inspectAddress(el.source);
            break;
          case 'TZCP': {
            inspectAddress(el.start1);
            inspectAddress(el.start2);
            inspectAddress(el.current);
            inspectAddress(el.destination);
            const d1 = offsetDeviceAddress(el.destination, 1);
            const d2 = offsetDeviceAddress(el.destination, 2);
            if (d1) inspectAddress(d1);
            if (d2) inspectAddress(d2);
            break;
          }
          default:
            break;
        }
      }
    }
  }

  const comments = program.deviceComments ?? {};
  const modelSpec = PLC_MODELS[program.model];
  const betiSpec = PLC_MODELS[BETI_PANEL_MODEL];

  const usedInputs: UsedDeviceTerminal[] = Array.from(inputSet.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([address, octalVal]) => ({
      address,
      label: comments[address] ? `${address} (${comments[address]})` : address,
      comment: comments[address],
      onboard:
        modelSpec.onboardInputs.includes(address) &&
        betiSpec.onboardInputs.includes(address),
      index: octalVal,
    }));

  const usedOutputs: UsedDeviceTerminal[] = Array.from(outputSet.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([address, octalVal]) => ({
      address,
      label: comments[address] ? `${address} (${comments[address]})` : address,
      comment: comments[address],
      onboard:
        modelSpec.onboardOutputs.includes(address) &&
        betiSpec.onboardOutputs.includes(address),
      index: octalVal,
    }));

  const usedAnalogChannels: UsedDeviceTerminal[] = Array.from(analogSet.values())
    .sort((a, b) => a - b)
    .map((chIdx) => {
      const meta = SX2_ANALOG_INPUT_CHANNELS[chIdx];
      const reg = meta.register;
      const comment = comments[reg] ?? comments[meta.channel];
      return {
        address: reg,
        label: comment ? `${meta.channel} / ${reg} (${comment})` : `${meta.channel} (${reg})`,
        comment,
        onboard: modelSpec.analogInputCount > chIdx,
        index: chIdx,
      };
    });

  const onboardInputs = usedInputs.filter((d) => d.onboard);
  const onboardOutputs = usedOutputs.filter((d) => d.onboard);
  const onboardAnalogs = usedAnalogChannels.filter((d) => d.onboard);
  const expansionDevices = [
    ...usedInputs.filter((d) => !d.onboard).map((d) => d.address),
    ...usedOutputs.filter((d) => !d.onboard).map((d) => d.address),
    ...usedAnalogChannels.filter((d) => !d.onboard).map((d) => d.address),
  ];

  const needsInputPower = onboardInputs.length > 0;
  const needsOutputPower = onboardOutputs.length > 0;
  const needsAnalogWiring = onboardAnalogs.length > 0;

  const modelMismatchWarning =
    program.model !== BETI_PANEL_MODEL
      ? `Aktif program modeli ${modelSpec.label}, ancak BETİ eğitim seti paneli DVP-20SX2 donanımına göre düzenlenmiştir (${modelSpec.onboardInputCount} DI / ${modelSpec.onboardOutputCount} DO${
          modelSpec.analogInputCount === 0 ? ', dahili analog kanal yok' : ''
        }). Fiziksel klemens eşleşmesini seçili PLC modeliyle kontrol edin.`
      : undefined;

  const connections: WiringConnection[] = [];
  let step = 1;

  const pushConn = (conn: Omit<WiringConnection, 'stepNumber'>) => {
    connections.push({
      ...conn,
      stepNumber: step,
    });
    step += 1;
  };

  // 1. +24V DC Red common supply lines (NPN/Sink standard on BETİ DVP-20SX2)
  if (needsInputPower) {
    pushConn({
      id: 'pwr-24v-ss',
      category: 'power',
      color: 'red',
      colorLabel: 'Kırmızı',
      fromModule: 'Güç Kaynağı',
      fromTerminal: '+24V DC',
      toModule: 'DVP-20SX2 PLC',
      toTerminal: 'S/S',
      description: 'Giriş ortak besleme ucu (NPN/Sink bağlantı standardı).',
      fromPinId: 'psu-24v-1',
      toPinId: 'plc-ss',
    });
  }

  if (needsOutputPower) {
    pushConn({
      id: 'pwr-24v-up',
      category: 'power',
      color: 'red',
      colorLabel: 'Kırmızı',
      fromModule: 'Güç Kaynağı',
      fromTerminal: '+24V DC',
      toModule: 'DVP-20SX2 PLC',
      toTerminal: 'UP',
      description: 'PLC transistör çıkış bloğu +24V ortak besleme ucu.',
      fromPinId: 'psu-24v-2',
      toPinId: 'plc-up',
    });
  }

  // 2. GND (0V) Blue/Black common ground lines
  if (needsInputPower) {
    pushConn({
      id: 'gnd-btn-com',
      category: 'ground',
      color: 'blue',
      colorLabel: 'Mavi (GND)',
      fromModule: 'Güç Kaynağı',
      fromTerminal: 'GND (0V)',
      toModule: 'Anahtar / Buton Ünitesi',
      toTerminal: 'COM (-)',
      description: 'Kullanılan X giriş butonlarının ortak eksi (0V) hattı.',
      fromPinId: 'psu-gnd-1',
      toPinId: 'btn-com',
    });
  }

  if (needsOutputPower) {
    pushConn({
      id: 'gnd-plc-zp',
      category: 'ground',
      color: 'blue',
      colorLabel: 'Mavi (GND)',
      fromModule: 'Güç Kaynağı',
      fromTerminal: 'GND (0V)',
      toModule: 'DVP-20SX2 PLC',
      toTerminal: 'ZP',
      description: 'PLC çıkış bloğu ortak 0V (ZP) referans hattı.',
      fromPinId: 'psu-gnd-2',
      toPinId: 'plc-zp',
    });

    if (outputTarget === 'led') {
      pushConn({
        id: 'gnd-led-com',
        category: 'ground',
        color: 'blue',
        colorLabel: 'Mavi (GND)',
        fromModule: 'Güç Kaynağı',
        fromTerminal: 'GND (0V)',
        toModule: 'Sinyalizasyon LED',
        toTerminal: 'COM (-)',
        description: 'Sinyalizasyon LED modülü ortak katot (-) bağlantısı.',
        fromPinId: 'psu-gnd-3',
        toPinId: 'led-com',
      });
    } else {
      pushConn({
        id: 'gnd-relay-com',
        category: 'ground',
        color: 'blue',
        colorLabel: 'Mavi (GND)',
        fromModule: 'Güç Kaynağı',
        fromTerminal: 'GND (0V)',
        toModule: 'Röle Çıkış Devresi',
        toTerminal: 'COM (-)',
        description: 'Röle çıkış kartı bobin ortak (-) bağlantısı.',
        fromPinId: 'psu-gnd-3',
        toPinId: 'relay-com',
      });
    }
  }

  // 3. Yellow wires: Button/Switch outputs -> PLC X0..X7
  for (const input of onboardInputs) {
    pushConn({
      id: `in-${input.address}`,
      category: 'input',
      color: 'yellow',
      colorLabel: 'Sarı',
      fromModule: 'Anahtar / Buton',
      fromTerminal: input.comment ? `${input.address} (${input.comment})` : input.address,
      toModule: 'DVP-20SX2 PLC',
      toTerminal: input.address,
      deviceAddress: input.address,
      deviceComment: input.comment,
      description: input.comment
        ? `${input.comment} sinyali -> PLC ${input.address} dijital girişi.`
        : `Anahtar/Buton ${input.address} çıkışı -> PLC ${input.address} girişi.`,
      fromPinId: `btn-${input.address}`,
      toPinId: `plc-${input.address}`,
    });
  }

  // 4. Green wires: PLC Y0..Y5 -> LED Module or Relay Output Module
  const targetModuleName =
    outputTarget === 'led' ? 'Sinyalizasyon LED' : 'Röle Çıkış Devresi';
  const targetPinPrefix = outputTarget === 'led' ? 'led' : 'relay';
  const targetTerminalPrefix = outputTarget === 'led' ? 'L' : 'R';

  for (const output of onboardOutputs) {
    const targetTermName = `${targetTerminalPrefix}${output.index} (${output.address})`;
    pushConn({
      id: `out-${output.address}`,
      category: 'output',
      color: 'green',
      colorLabel: 'Yeşil',
      fromModule: 'DVP-20SX2 PLC',
      fromTerminal: output.comment ? `${output.address} (${output.comment})` : output.address,
      toModule: targetModuleName,
      toTerminal: targetTermName,
      deviceAddress: output.address,
      deviceComment: output.comment,
      description: output.comment
        ? `PLC ${output.address} çıkışı -> ${targetModuleName} (${output.comment}).`
        : `PLC ${output.address} çıkışı -> ${targetModuleName} ${targetTermName}.`,
      fromPinId: `plc-${output.address}`,
      toPinId: `${targetPinPrefix}-${output.address}`,
    });
  }

  // 5. Purple wires: Analog Potentiometer (0-10V) -> PLC Vn+ and GND -> VIn-
  for (const ai of onboardAnalogs) {
    const chLabel = `AD${ai.index}`;
    pushConn({
      id: `ai-vplus-${ai.index}`,
      category: 'analog',
      color: 'purple',
      colorLabel: 'Mor',
      fromModule: 'Analog Potansiyometre',
      fromTerminal: `0–10V ${chLabel}`,
      toModule: 'DVP-20SX2 PLC',
      toTerminal: `V${ai.index}+`,
      deviceAddress: ai.address,
      deviceComment: ai.comment,
      description: ai.comment
        ? `Potansiyometre 0–10V çıkışı -> PLC V${ai.index}+ (${ai.address}: ${ai.comment}).`
        : `Potansiyometre 0–10V çıkışı -> PLC V${ai.index}+ (${ai.address} kanalı).`,
      fromPinId: `pot-v${ai.index}`,
      toPinId: `plc-v${ai.index}p`,
    });

    pushConn({
      id: `ai-vminus-${ai.index}`,
      category: 'analog',
      color: 'purple',
      colorLabel: 'Mor',
      fromModule: 'Güç Kaynağı / Pot.',
      fromTerminal: 'GND (0V)',
      toModule: 'DVP-20SX2 PLC',
      toTerminal: `VI${ai.index}-`,
      deviceAddress: ai.address,
      deviceComment: ai.comment,
      description: `Analog ${chLabel} negatif referans ucu (GND -> VI${ai.index}-).`,
      fromPinId: 'psu-gnd-4',
      toPinId: `plc-vi${ai.index}m`,
    });
  }

  return {
    projectName: program.projectName,
    model: program.model,
    outputTarget,
    usedInputs,
    usedOutputs,
    usedAnalogChannels,
    expansionDevices,
    connections,
    needsInputPower,
    needsOutputPower,
    needsAnalogWiring,
    modelMismatchWarning,
    hardwareNotice: HARDWARE_VERIFICATION_NOTICE,
  };
}
