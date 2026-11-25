import type { LadderProgram, LadderRung, PlcModelId } from '../types/plc';
import { createEmptyRow, createEndRung } from './gridFactory';
import { parseIlToLadder } from './ilParser';
import { LADDER_COIL_COLUMN, LADDER_TOTAL_COLUMNS } from './plcModels';

export type TemplateId =
  | 'start-stop'
  | 'star-delta'
  | 'forward-reverse'
  | 'traffic-light'
  | 'dynamic-counter'
  | 'adjustable-timer'
  | 'sx2-analog-temp'
  | 'deney4-camasir-makinesi'
  | 'deney5-dalgic-pompa'
  | 'deney6-su-kopuk';

export type TemplateCategory = 'classic' | 'textbook' | 'experiment';

export interface IndustrialTemplateMeta {
  id: TemplateId;
  category: TemplateCategory;
  referenceTag?: string;
  requiredModel?: PlcModelId;
  title: string;
  subtitle: string;
  difficulty: 'Temel' | 'Orta' | 'İleri';
  description: string;
  ioSummary: { address: string; role: string }[];
  buildProgram: (model: PlcModelId) => LadderProgram;
}

function bridgeRowToCoil(
  row: LadderRung['rows'][number],
  fromCol: number,
  branchDownAtCoilInput = false
): void {
  for (let c = fromCol; c < LADDER_COIL_COLUMN; c += 1) {
    row[c] = {
      element: { kind: 'HLINE' },
      branchDown: branchDownAtCoilInput && c === LADDER_COIL_COLUMN - 1,
    };
  }
}

function buildStartStopProgram(model: PlcModelId): LadderProgram {
  // Rung 0: (X0 || Y0) AND NOT X1 -> OUT Y0
  const r0a = createEmptyRow();
  r0a[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: true };
  r0a[1] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'X1' }, branchDown: false };
  bridgeRowToCoil(r0a, 2);
  r0a[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
    branchDown: false,
  };

  const r0b = createEmptyRow();
  r0b[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'Y0' }, branchDown: false };

  return {
    version: '1.0',
    projectName: 'Muhurlemeli_Start_Stop',
    model,
    columns: LADDER_TOTAL_COLUMNS,
    rungs: [
      { id: 'tpl-ss-0', rows: [r0a, r0b] },
      createEndRung(),
    ],
    deviceComments: {
      X0: 'Start',
      X1: 'Stop',
      Y0: 'Motor',
    },
    updatedAt: new Date().toISOString(),
  };
}

function buildStarDeltaProgram(model: PlcModelId): LadderProgram {
  // Rung 0: (X0 || Y0) AND NOT X1 -> OUT Y0 (Ana Kontaktör)
  const r0a = createEmptyRow();
  r0a[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: true };
  r0a[1] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'X1' }, branchDown: false };
  bridgeRowToCoil(r0a, 2);
  r0a[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
    branchDown: false,
  };
  const r0b = createEmptyRow();
  r0b[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'Y0' }, branchDown: false };

  // Rung 1: Y0 -> TMR T0 K50 (5.0 sn Yıldız -> Üçgen geçiş süresi)
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'Y0' }, branchDown: false };
  bridgeRowToCoil(r1, 1);
  r1[LADDER_COIL_COLUMN] = {
    element: { kind: 'TMR', address: 'T0', preset: 'K50' },
    branchDown: false,
  };

  // Rung 2: Y0 AND NOT T0 AND NOT Y2 -> OUT Y1 (Yıldız Kontaktörü — Üçgen NC Kilitlemeli)
  const r2 = createEmptyRow();
  r2[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'Y0' }, branchDown: false };
  r2[1] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'T0' }, branchDown: false };
  r2[2] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'Y2' }, branchDown: false };
  bridgeRowToCoil(r2, 3);
  r2[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y1' },
    branchDown: false,
  };

  // Rung 3: Y0 AND T0 AND NOT Y1 -> OUT Y2 (Üçgen Kontaktörü — Yıldız NC Kilitlemeli)
  const r3 = createEmptyRow();
  r3[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'Y0' }, branchDown: false };
  r3[1] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'T0' }, branchDown: false };
  r3[2] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'Y1' }, branchDown: false };
  bridgeRowToCoil(r3, 3);
  r3[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y2' },
    branchDown: false,
  };

  return {
    version: '1.0',
    projectName: 'Yildiz_Ucgen_Yol_Verme',
    model,
    columns: LADDER_TOTAL_COLUMNS,
    rungs: [
      { id: 'tpl-sd-0', rows: [r0a, r0b] },
      { id: 'tpl-sd-1', rows: [r1] },
      { id: 'tpl-sd-2', rows: [r2] },
      { id: 'tpl-sd-3', rows: [r3] },
      createEndRung(),
    ],
    deviceComments: {
      X0: 'Start',
      X1: 'Stop',
      Y0: 'Ana Kont.',
      Y1: 'Yıldız',
      Y2: 'Üçgen',
      T0: 'Y/Ü Süre',
    },
    updatedAt: new Date().toISOString(),
  };
}

function buildForwardReverseProgram(model: PlcModelId): LadderProgram {
  // Rung 0: (X0 || Y0) AND NOT X2 AND NOT Y1 -> OUT Y0 (İleri — Geri NC Kilitlemeli)
  const r0a = createEmptyRow();
  r0a[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: true };
  r0a[1] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'X2' }, branchDown: false };
  r0a[2] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'Y1' }, branchDown: false };
  bridgeRowToCoil(r0a, 3);
  r0a[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
    branchDown: false,
  };
  const r0b = createEmptyRow();
  r0b[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'Y0' }, branchDown: false };

  // Rung 1: (X1 || Y1) AND NOT X2 AND NOT Y0 -> OUT Y1 (Geri — İleri NC Kilitlemeli)
  const r1a = createEmptyRow();
  r1a[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X1' }, branchDown: true };
  r1a[1] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'X2' }, branchDown: false };
  r1a[2] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'Y0' }, branchDown: false };
  bridgeRowToCoil(r1a, 3);
  r1a[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y1' },
    branchDown: false,
  };
  const r1b = createEmptyRow();
  r1b[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'Y1' }, branchDown: false };

  return {
    version: '1.0',
    projectName: 'Ileri_Geri_Kilitlemeli',
    model,
    columns: LADDER_TOTAL_COLUMNS,
    rungs: [
      { id: 'tpl-fr-0', rows: [r0a, r0b] },
      { id: 'tpl-fr-1', rows: [r1a, r1b] },
      createEndRung(),
    ],
    deviceComments: {
      X0: 'İleri',
      X1: 'Geri',
      X2: 'Stop',
      Y0: 'İleri M.',
      Y1: 'Geri M.',
    },
    updatedAt: new Date().toISOString(),
  };
}

function buildTrafficLightProgram(model: PlcModelId): LadderProgram {
  // Rung 0: LDP X0 -> ALT M0 (Tek butonla başlat/durdur)
  const r0 = createEmptyRow();
  r0[0] = { element: { kind: 'CONTACT', contactType: 'RISING', address: 'X0' }, branchDown: false };
  bridgeRowToCoil(r0, 1);
  r0[LADDER_COIL_COLUMN] = {
    element: { kind: 'ALT', target: 'M0' },
    branchDown: false,
  };

  // Rung 1: M0 -> TMR T0 K800 (80.0 sn periyot)
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M0' }, branchDown: false };
  bridgeRowToCoil(r1, 1);
  r1[LADDER_COIL_COLUMN] = {
    element: { kind: 'TMR', address: 'T0', preset: 'K800' },
    branchDown: false,
  };

  // Rung 2: M0 AND (T0 < K300) -> OUT Y0 (Kırmızı, 0–30 sn)
  const r2 = createEmptyRow();
  r2[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M0' }, branchDown: false };
  r2[1] = {
    element: { kind: 'COMPARE', operator: '<', operandA: 'T0', operandB: 'K300' },
    branchDown: false,
  };
  bridgeRowToCoil(r2, 2);
  r2[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
    branchDown: false,
  };

  // Rung 3: (T0 >= K300) AND (T0 < K350) -> OUT Y1 (Sarı, 30–35 sn)
  const r3 = createEmptyRow();
  r3[0] = {
    element: { kind: 'COMPARE', operator: '>=', operandA: 'T0', operandB: 'K300' },
    branchDown: false,
  };
  r3[1] = {
    element: { kind: 'COMPARE', operator: '<', operandA: 'T0', operandB: 'K350' },
    branchDown: false,
  };
  bridgeRowToCoil(r3, 2);
  r3[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y1' },
    branchDown: false,
  };

  // Rung 4: (T0 >= K350 AND T0 < K750) OR (T0 >= K750 AND T0 < K800 AND M1013) -> OUT Y2
  // Tek bobinli birleştirilmiş yapı (çift bobin hatası giderilmiş)
  const r4a = createEmptyRow();
  r4a[0] = {
    element: { kind: 'COMPARE', operator: '>=', operandA: 'T0', operandB: 'K350' },
    branchDown: false,
  };
  r4a[1] = {
    element: { kind: 'COMPARE', operator: '<', operandA: 'T0', operandB: 'K750' },
    branchDown: false,
  };
  r4a[2] = { element: { kind: 'HLINE' }, branchDown: true };
  bridgeRowToCoil(r4a, 3);
  r4a[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y2' },
    branchDown: false,
  };

  const r4b = createEmptyRow();
  r4b[0] = {
    element: { kind: 'COMPARE', operator: '>=', operandA: 'T0', operandB: 'K750' },
    branchDown: false,
  };
  r4b[1] = {
    element: { kind: 'COMPARE', operator: '<', operandA: 'T0', operandB: 'K800' },
    branchDown: false,
  };
  r4b[2] = {
    element: { kind: 'CONTACT', contactType: 'NO', address: 'M1013' },
    branchDown: false,
  };

  // Rung 5: (T0 >= K800) -> RST T0 (Periyodik döngü sıfırlama)
  const r5 = createEmptyRow();
  r5[0] = {
    element: { kind: 'COMPARE', operator: '>=', operandA: 'T0', operandB: 'K800' },
    branchDown: false,
  };
  bridgeRowToCoil(r5, 1);
  r5[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'RST', address: 'T0' },
    branchDown: false,
  };

  return {
    version: '1.0',
    projectName: 'Trafik_Isigi_Ornek_6_1',
    model,
    columns: LADDER_TOTAL_COLUMNS,
    rungs: [
      { id: 'tpl-tl-0', rows: [r0] },
      { id: 'tpl-tl-1', rows: [r1] },
      { id: 'tpl-tl-2', rows: [r2] },
      { id: 'tpl-tl-3', rows: [r3] },
      { id: 'tpl-tl-4', rows: [r4a, r4b] },
      { id: 'tpl-tl-5', rows: [r5] },
      createEndRung(),
    ],
    deviceComments: {
      X0: 'Başlat/Dur',
      M0: 'Sistem Akt.',
      T0: '80sn Periyot',
      M1013: '1Hz Flaşör',
      Y0: 'Kırmızı',
      Y1: 'Sarı',
      Y2: 'Yeşil',
    },
    updatedAt: new Date().toISOString(),
  };
}

function buildDynamicCounterProgram(model: PlcModelId): LadderProgram {
  // Rung 0: M1002 -> MOV K10 D10 (İlk taramada D10=0 hatasını önlemek için varsayılan hedef)
  const r0 = createEmptyRow();
  r0[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M1002' }, branchDown: false };
  bridgeRowToCoil(r0, 1);
  r0[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K10', destination: 'D10' },
    branchDown: false,
  };

  // Rung 1: X0 (1. Sensör) -> MOV K15 D10
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: false };
  bridgeRowToCoil(r1, 1);
  r1[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K15', destination: 'D10' },
    branchDown: false,
  };

  // Rung 2: X1 (2. Sensör) -> MOV K10 D10
  const r2 = createEmptyRow();
  r2[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X1' }, branchDown: false };
  bridgeRowToCoil(r2, 1);
  r2[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K10', destination: 'D10' },
    branchDown: false,
  };

  // Rung 3: X3 (Reset/Stop) -> RST C0 (RST öncelikli sıfırlama)
  const r3 = createEmptyRow();
  r3[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X3' }, branchDown: false };
  bridgeRowToCoil(r3, 1);
  r3[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'RST', address: 'C0' },
    branchDown: false,
  };

  // Rung 4: X2 (Ürün Sensörü) -> CNT C0 D10 (Dinamik D10 hedefli sayıcı)
  const r4 = createEmptyRow();
  r4[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X2' }, branchDown: false };
  bridgeRowToCoil(r4, 1);
  r4[LADDER_COIL_COLUMN] = {
    element: { kind: 'CNT', address: 'C0', preset: 'D10' },
    branchDown: false,
  };

  // Rung 5: C0 -> OUT Y0 (Motor)
  const r5 = createEmptyRow();
  r5[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'C0' }, branchDown: false };
  bridgeRowToCoil(r5, 1);
  r5[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
    branchDown: false,
  };

  return {
    version: '1.0',
    projectName: 'Dinamik_Urun_Sayma_Ornek_6_2',
    model,
    columns: LADDER_TOTAL_COLUMNS,
    rungs: [
      { id: 'tpl-dc-0', rows: [r0] },
      { id: 'tpl-dc-1', rows: [r1] },
      { id: 'tpl-dc-2', rows: [r2] },
      { id: 'tpl-dc-3', rows: [r3] },
      { id: 'tpl-dc-4', rows: [r4] },
      { id: 'tpl-dc-5', rows: [r5] },
      createEndRung(),
    ],
    deviceComments: {
      M1002: 'İlk Tarama',
      X0: '1. Sensör',
      X1: '2. Sensör',
      X2: 'Ürün Sens.',
      X3: 'Reset/Stop',
      D10: 'Sayma Hedef',
      C0: 'Ürün Sayıcı',
      Y0: 'Bant Motor',
    },
    updatedAt: new Date().toISOString(),
  };
}

function buildAdjustableTimerProgram(model: PlcModelId): LadderProgram {
  // Rung 0: M1002 -> MOV K50 D1 (Varsayılan 5.0 sn)
  const r0 = createEmptyRow();
  r0[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M1002' }, branchDown: false };
  bridgeRowToCoil(r0, 1);
  r0[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K50', destination: 'D1' },
    branchDown: false,
  };

  // Rung 1: LDP X2 -> INC D1 (Yükselen kenar korumalı +0.1 sn artırma)
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'CONTACT', contactType: 'RISING', address: 'X2' }, branchDown: false };
  bridgeRowToCoil(r1, 1);
  r1[LADDER_COIL_COLUMN] = {
    element: { kind: 'INCDEC', operator: 'INC', target: 'D1' },
    branchDown: false,
  };

  // Rung 2: LDP X3 AND (D1 > K1) -> DEC D1 (0.1sn alt sınır korumalı azaltma)
  const r2 = createEmptyRow();
  r2[0] = { element: { kind: 'CONTACT', contactType: 'RISING', address: 'X3' }, branchDown: false };
  r2[1] = {
    element: { kind: 'COMPARE', operator: '>', operandA: 'D1', operandB: 'K1' },
    branchDown: false,
  };
  bridgeRowToCoil(r2, 2);
  r2[LADDER_COIL_COLUMN] = {
    element: { kind: 'INCDEC', operator: 'DEC', target: 'D1' },
    branchDown: false,
  };

  // Rung 3: X1 -> TMR T1 D1 (D1 registerından dinamik süre okuyan zamanlayıcı)
  const r3 = createEmptyRow();
  r3[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X1' }, branchDown: false };
  bridgeRowToCoil(r3, 1);
  r3[LADDER_COIL_COLUMN] = {
    element: { kind: 'TMR', address: 'T1', preset: 'D1' },
    branchDown: false,
  };

  // Rung 4: T1 -> OUT Y1 (Çıkış Motoru)
  const r4 = createEmptyRow();
  r4[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'T1' }, branchDown: false };
  bridgeRowToCoil(r4, 1);
  r4[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y1' },
    branchDown: false,
  };

  return {
    version: '1.0',
    projectName: 'Ayarlanabilir_Zamanlayici_Ornek_7_8',
    model,
    columns: LADDER_TOTAL_COLUMNS,
    rungs: [
      { id: 'tpl-at-0', rows: [r0] },
      { id: 'tpl-at-1', rows: [r1] },
      { id: 'tpl-at-2', rows: [r2] },
      { id: 'tpl-at-3', rows: [r3] },
      { id: 'tpl-at-4', rows: [r4] },
      createEndRung(),
    ],
    deviceComments: {
      M1002: 'İlk Tarama',
      X1: 'Zaman Başlat',
      X2: 'Süre Artır+',
      X3: 'Süre Azalt-',
      D1: 'Süre (x0.1s)',
      T1: 'Ayarlı TMR',
      Y1: 'Çıkış Motor',
    },
    updatedAt: new Date().toISOString(),
  };
}

function buildSx2AnalogTempProgram(): LadderProgram {
  // Rung 0: M1002 -> MOV K0 D1115 (0-10V Gerilim modu) & MOV K30 D200 (Varsayılan 30°C hedef)
  const r0a = createEmptyRow();
  r0a[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M1002' }, branchDown: false };
  bridgeRowToCoil(r0a, 1, true);
  r0a[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K0', destination: 'D1115' },
    branchDown: false,
  };
  const r0b = createEmptyRow();
  r0b[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K30', destination: 'D200' },
    branchDown: false,
  };

  // Rung 1: X1 (Başlat) -> SET M0
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X1' }, branchDown: false };
  bridgeRowToCoil(r1, 1);
  r1[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'SET', address: 'M0' },
    branchDown: false,
  };

  // Rung 2: X0 (Acil Durdur) -> RST M0 (Durdurma öncelikli)
  const r2 = createEmptyRow();
  r2[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: false };
  bridgeRowToCoil(r2, 1);
  r2[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'RST', address: 'M0' },
    branchDown: false,
  };

  // Rung 3: X2 -> MOV K30 D200 (30°C Kademesi)
  const r3 = createEmptyRow();
  r3[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X2' }, branchDown: false };
  bridgeRowToCoil(r3, 1);
  r3[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K30', destination: 'D200' },
    branchDown: false,
  };

  // Rung 4: X3 -> MOV K60 D200 (60°C Kademesi)
  const r4 = createEmptyRow();
  r4[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X3' }, branchDown: false };
  bridgeRowToCoil(r4, 1);
  r4[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K60', destination: 'D200' },
    branchDown: false,
  };

  // Rung 5: X4 -> MOV K90 D200 (90°C Kademesi)
  const r5 = createEmptyRow();
  r5[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X4' }, branchDown: false };
  bridgeRowToCoil(r5, 1);
  r5[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K90', destination: 'D200' },
    branchDown: false,
  };

  // Rung 6: M0 -> MOV D1110 D100 & DIV D100 K2 D101 (LM35 10mV/°C -> °C dönüşümü)
  const r6a = createEmptyRow();
  r6a[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M0' }, branchDown: false };
  bridgeRowToCoil(r6a, 1, true);
  r6a[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'D1110', destination: 'D100' },
    branchDown: false,
  };
  const r6b = createEmptyRow();
  r6b[LADDER_COIL_COLUMN] = {
    element: { kind: 'MATH', operator: 'DIV', source1: 'D100', source2: 'K2', destination: 'D101' },
    branchDown: false,
  };

  // Rung 7: M0 AND (D101 < D200) -> OUT Y0 (Isıtıcı) & OUT Y1 (İzleme Lambası)
  const r7a = createEmptyRow();
  r7a[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M0' }, branchDown: false };
  r7a[1] = {
    element: { kind: 'COMPARE', operator: '<', operandA: 'D101', operandB: 'D200' },
    branchDown: false,
  };
  bridgeRowToCoil(r7a, 2, true);
  r7a[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
    branchDown: false,
  };
  const r7b = createEmptyRow();
  r7b[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y1' },
    branchDown: false,
  };

  return {
    version: '1.0',
    projectName: 'SX2_Analog_Sicaklik_Ornek_8_1',
    model: 'DVP-SX2',
    columns: LADDER_TOTAL_COLUMNS,
    rungs: [
      { id: 'tpl-sx2t-0', rows: [r0a, r0b] },
      { id: 'tpl-sx2t-1', rows: [r1] },
      { id: 'tpl-sx2t-2', rows: [r2] },
      { id: 'tpl-sx2t-3', rows: [r3] },
      { id: 'tpl-sx2t-4', rows: [r4] },
      { id: 'tpl-sx2t-5', rows: [r5] },
      { id: 'tpl-sx2t-6', rows: [r6a, r6b] },
      { id: 'tpl-sx2t-7', rows: [r7a, r7b] },
      createEndRung(),
    ],
    deviceComments: {
      M1002: 'İlk Tarama',
      X0: 'Acil Durdur',
      X1: 'Başlat',
      X2: '30°C Kademe',
      X3: '60°C Kademe',
      X4: '90°C Kademe',
      M0: 'Sistem Akt.',
      D1115: 'AD Mod (0-10V)',
      D1110: 'AD0 (LM35)',
      D100: 'AD0 Kopya',
      D101: 'Sıcaklık °C',
      D102: 'DIV Kalan',
      D200: 'Hedef °C',
      Y0: 'Isıtıcı',
      Y1: 'İzleme Lamba',
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Laboratuvar föyündeki IL'den şablon programı kurar (föyün Ladder diyagramıyla birebir). */
function buildFromIl(
  il: string,
  model: PlcModelId,
  projectName: string,
  deviceComments: Record<string, string>
): LadderProgram {
  const parsed = parseIlToLadder(il, model, projectName, deviceComments);
  if (!parsed.success || !parsed.program) {
    throw new Error(`Şablon IL kodu okunamadı: ${JSON.stringify(parsed.errors)}`);
  }
  return { ...parsed.program, projectName, updatedAt: new Date().toISOString() };
}

// Deney 4 — PLC ile Çamaşır Makinesi Uygulaması (Şekil 3)
const DENEY4_IL = [
  'LD X0',
  'SET M0',
  '// SU AL: Y2 su valfi, X1 su seviye şamandırası',
  'LD M0',
  'ANI M10',
  'SET Y2',
  'AND X1',
  'RST Y2',
  'SET M10',
  'SET M11',
  '// ISITICI: 60 derece X2 sensörü, ısıtıcı Y5',
  'LD M0',
  'AND M11',
  'SET Y5',
  'AND X2',
  'RST Y5',
  'RST M11',
  'SET M12',
  '// DETERJAN ALMA: 5 saniye, valf Y3',
  'LD M0',
  'AND M12',
  'SET Y3',
  'TMR T3 K50',
  'AND T3',
  'RST Y3',
  'RST M12',
  'SET M13',
  '// TAMBURU SAĞA ÇEVİR',
  'LD M0',
  'AND M13',
  'SET Y0',
  'TMR T0 K20',
  'AND T0',
  'RST Y0',
  'RST M13',
  'SET M14',
  '// TAMBURU SOLA ÇEVİR, 4 KEZ İŞLEMİ TEKRARLA',
  'LD M0',
  'AND M14',
  'SET Y1',
  'TMR T1 K20',
  'AND T1',
  'RST Y1',
  'RST M14',
  'SET M13',
  'CNT C0 K4',
  'AND C0',
  'RST M13',
  'SET M15',
  '// SUYU TAHLİYE ET: 10 saniye',
  'LD M0',
  'AND M15',
  'SET Y4',
  'TMR T2 K100',
  'AND T2',
  'RST M15',
  'SET M16',
  '// TÜM ÇIKIŞLARI (Y0–Y5) SIFIRLA',
  'LD M0',
  'AND M16',
  'ZRST Y0 Y5',
  'RST M0',
  'END',
].join('\n');

function buildDeney4Program(model: PlcModelId): LadderProgram {
  return buildFromIl(DENEY4_IL, model, 'Deney4_Camasir_Makinesi', {
    X0: 'Açma-Kapama Düğmesi',
    X1: 'Su Seviyesi Sensörü',
    X2: 'Sıcaklık Sensörü',
    Y0: 'Motor İleri Sağa',
    Y1: 'Motor Geri Sola',
    Y2: 'Su Valfi',
    Y3: 'Deterjan',
    Y4: 'Pompa Tahliye',
    Y5: 'Isıtıcı',
    M0: 'Çalışma (RUN)',
    M10: 'Su Alındı',
    M11: 'Isıtma',
    M12: 'Deterjan Alma',
    M13: 'Sağa Dönüş',
    M14: 'Sola Dönüş',
    M15: 'Su Boşaltma',
    M16: 'Bitiş',
    T0: 'Sağa Süre',
    T1: 'Sola Süre',
    T2: 'Tahliye Süresi',
    T3: 'Deterjan Süresi',
    C0: 'Tekrar Sayısı',
  });
}

// Deney 5 — PLC ile Dalgıç Pompa Uygulaması (Şekil 3)
const DENEY5_IL = [
  'LDI X0',
  'SET Y1',
  'SET Y2',
  'LD X1',
  'ANI X2',
  'OUT M1',
  'LD M1',
  'MPS',
  'TMR T0 K100',
  'MRD',
  'ANI T0',
  'SET Y1',
  'RST Y2',
  'MPP',
  'AND T0',
  'TMR T1 K100',
  'RST Y1',
  'SET Y2',
  'AND T1',
  'RST Y2',
  'RST T0',
  'LD X2',
  'RST Y1',
  'RST Y2',
  'LD X0',
  'ANI X3',
  'SET Y3',
  'LD X4',
  'RST Y3',
  'END',
].join('\n');

function buildDeney5Program(model: PlcModelId): LadderProgram {
  return buildFromIl(DENEY5_IL, model, 'Deney5_Dalgic_Pompa', {
    X0: 'Ana Depo Alt %25',
    X1: 'Ana Depo Orta %50',
    X2: 'Ana Depo Üst %100',
    X3: 'Tali Depo Alt %25',
    X4: 'Tali Depo Üst %100',
    Y1: 'P1 Dalgıç Pompa',
    Y2: 'P2 Dalgıç Pompa',
    Y3: 'Yatay Milli Pompa',
    M1: 'Dönüşümlü Çalışma',
    T0: 'P1 Süresi',
    T1: 'P2 Süresi',
  });
}

// Deney 6 — Benzin İstasyonu Su / Köpük Otomasyonu
const DENEY6_IL = [
  'LD X0',
  'ANI C0',
  'SET M0',
  'CNT C0 K50',
  'LD M0',
  'AND X1',
  'ANI M2',
  'SET M1',
  'LD M0',
  'AND X2',
  'ANI M1',
  'SET M2',
  'LD M1',
  'MPS',
  'TMR T1 K150',
  'MRD',
  'ANI T1',
  'SET Y1',
  'MPP',
  'AND T1',
  'RST Y1',
  'RST M1',
  'RST M0',
  'LD M2',
  'MPS',
  'TMR T2 K250',
  'MRD',
  'ANI T2',
  'SET Y2',
  'MPP',
  'AND T2',
  'RST Y2',
  'RST M2',
  'RST M0',
  'END',
].join('\n');

function buildDeney6Program(model: PlcModelId): LadderProgram {
  return buildFromIl(DENEY6_IL, model, 'Deney6_Su_Kopuk', {
    X0: '1 TL',
    X1: 'Köpük Buton',
    X2: 'Su Buton',
    Y1: 'Köpük Pompa',
    Y2: 'Su Pompa',
    T1: 'Köpük Süresi',
    T2: 'Su Süresi',
    C0: '50 Adet Sayıcı',
    M0: '1 TL Kilit',
    M1: 'Köpük Kilit',
    M2: 'Su Kilit',
  });
}

export const INDUSTRIAL_TEMPLATES: IndustrialTemplateMeta[] = [
  {
    id: 'start-stop',
    category: 'classic',
    title: '1. Mühürlemeli Start-Stop Devresi',
    subtitle: 'Klasik 3 telli motor kumanda ve paralel mühürleme (OR Branch)',
    difficulty: 'Temel',
    description:
      'X0 anlık Start butonuna basıldığında Y0 motor kontaktörü enerjilenir ve paralel Y0 kontağı üzerinden kendini mühürler. X1 Stop butonuna basıldığında devre kesilir.',
    ioSummary: [
      { address: 'X0', role: 'Start (Anlık)' },
      { address: 'X1', role: 'Stop' },
      { address: 'Y0', role: 'Motor' },
    ],
    buildProgram: buildStartStopProgram,
  },
  {
    id: 'star-delta',
    category: 'classic',
    title: '2. Yıldız-Üçgen Yol Verme Devresi',
    subtitle: '5.0sn TMR T0 geçişli, elektriksel NC kilitlemeli yol verme',
    difficulty: 'Orta',
    description:
      'X0 ile Y0 Ana ve Y1 Yıldız kontaktörleri aynı anda devreye girer. T0 (K50 = 5.0sn) süresi dolduğunda Y1 devreden çıkar ve NC elektriksel kilitlemeyle Y2 Üçgen kontaktörü enerjilenir.',
    ioSummary: [
      { address: 'X0 / X1', role: 'Start / Stop' },
      { address: 'Y0', role: 'Ana Kontaktör' },
      { address: 'Y1 / Y2', role: 'Yıldız / Üçgen (NC Kilit)' },
      { address: 'T0 (K50)', role: '5.0 sn Geçiş Zamanlayıcı' },
    ],
    buildProgram: buildStarDeltaProgram,
  },
  {
    id: 'forward-reverse',
    category: 'classic',
    title: '3. Kilitlemeli İleri-Geri Motor Kontrolü',
    subtitle: 'Y0 ve Y1 çapraz NC kilitlemeli çift yönlü motor devresi',
    difficulty: 'Orta',
    description:
      'X0 İleri (Y0), X1 Geri (Y1) kontaktörünü mühürleyerek çalıştırır. Y0 ve Y1 birbirinin yolunda NC kontakla kilitlendiği için X2 Stop butonuna basmadan yön değiştirilerek faz çakışması engellenir.',
    ioSummary: [
      { address: 'X0 / X1', role: 'İleri / Geri Start' },
      { address: 'X2', role: 'Ortak Stop' },
      { address: 'Y0 / Y1', role: 'İleri / Geri (Çapraz NC)' },
    ],
    buildProgram: buildForwardReverseProgram,
  },
  {
    id: 'traffic-light',
    category: 'textbook',
    referenceTag: 'Örnek 6.1',
    title: '4. Trafik Işığı Kontrolü (Örnek 6.1 — Düzeltilmiş)',
    subtitle: 'ALT Flip-Flop başlat/durdur, 80sn TMR ve tek bobinli 1Hz yeşil flaşör',
    difficulty: 'Orta',
    description:
      'LDP X0 -> ALT M0 ile sistem tek butonla açılır/kapanır. T0 (K800 = 80sn) boyunca 0–30sn Kırmızı (Y0), 30–35sn Sarı (Y1), 35–75sn sabit Yeşil + 75–80sn M1013 (1Hz) flaşörlü Yeşil tek bobinde (OUT Y2, çift bobin hatasız) sürülür; 80sn sonunda RST T0 ile periyot yenilenir. 2x/10x hızla hızlıca test edilebilir.',
    ioSummary: [
      { address: 'X0 / M0', role: 'Tek Buton Başlat-Dur (ALT)' },
      { address: 'T0 (K800)', role: '80 sn Periyot Zamanlayıcı' },
      { address: 'Y0 / Y1', role: 'Kırmızı (30sn) / Sarı (5sn)' },
      { address: 'Y2 + M1013', role: 'Yeşil (40sn + 5sn 1Hz Flaş)' },
    ],
    buildProgram: buildTrafficLightProgram,
  },
  {
    id: 'dynamic-counter',
    category: 'textbook',
    referenceTag: 'Örnek 6.2',
    title: '5. MOV ile Dinamik Ürün Sayma Bandı (Örnek 6.2 — Düzeltilmiş)',
    subtitle: 'M1002 güvenli başlatma ve D10 registerı üzerinden değişken sayıcı hedefi',
    difficulty: 'Orta',
    description:
      'İlk taramada M1002 -> MOV K10 D10 komutuyla D10=0 başlangıç hatası önlenir. X0 sensörü hedefi 15 (K15), X1 sensörü 10 (K10) olarak D10 registerına yükler. X2 ürün sensörü yükselen kenarlarla CNT C0 D10 sayıcısını ilerletir, hedefe ulaşılınca Y0 motoru çalışır; X3 (Reset/Stop) sayıcıyı sıfırlar.',
    ioSummary: [
      { address: 'M1002 -> D10', role: 'Varsayılan Hedef = 10' },
      { address: 'X0 / X1', role: 'Mod Seçimi (K15 / K10)' },
      { address: 'X2 / C0', role: 'Ürün Sensörü / Dinamik CNT' },
      { address: 'X3 / Y0', role: 'Reset-Stop / Bant Motoru' },
    ],
    buildProgram: buildDynamicCounterProgram,
  },
  {
    id: 'adjustable-timer',
    category: 'textbook',
    referenceTag: 'Örnek 7.8',
    title: '6. INC/DEC ile Ayarlanabilir Zamanlayıcı (Örnek 7.8 — Düzeltilmiş)',
    subtitle: 'LDP yükselen kenar korumalı 0.1sn adımlı süre ayarı (min K1) ve dinamik TMR T1 D1',
    difficulty: 'Orta',
    description:
      'M1002 ilk tarama palsiyle D1 varsayılan 50 (5.0sn) olarak yüklenir. LDP X2 -> INC D1 her basışta süreyi +0.1sn artırır, LDP X3 AND (D1 > K1) -> DEC D1 ile süre güvenli alt sınır 0.1sn (K1) altına düşmeden -0.1sn azaltılır. X1 aktif olduğunda T1, D1 değerine ulaşınca Y1 motorunu sürer.',
    ioSummary: [
      { address: 'M1002 -> D1', role: 'Varsayılan 5.0 sn (K50)' },
      { address: 'X2 / X3 (LDP)', role: '+0.1sn INC / -0.1sn DEC' },
      { address: 'X1 / T1 D1', role: 'Başlat / Dinamik Zamanlayıcı' },
      { address: 'Y1', role: 'Çıkış Motoru' },
    ],
    buildProgram: buildAdjustableTimerProgram,
  },
  {
    id: 'sx2-analog-temp',
    category: 'textbook',
    referenceTag: 'Örnek 8.1',
    requiredModel: 'DVP-SX2',
    title: '7. DVP-SX2 Analog (AD0) Sıcaklık Kontrolü (Örnek 8.1 — Düzeltilmiş)',
    subtitle: 'AD0 (D1110) LM35 sıcaklık dönüşümü (DIV K2), 30/60/90°C kademeli termostat',
    difficulty: 'İleri',
    description:
      'İlk taramada M1002 ile D1115=0 (0–10V gerilim modu) ve D200=30°C hedefi yüklenir. X1 (Başlat) M0\'ı set eder, X0 (Acil Durdur) sıfırlar. X2/X3/X4 ile 30°C/60°C/90°C kademesi seçilir. M0 aktifken D1110 (AD0) değeri D100\'e alınır, DIV D100 K2 D101 ile °C\'ye dönüştürülür (örn. AD0=50 -> 25°C). D101 < D200 iken Y0 Isıtıcı ve Y1 İzleme Lambası çalışır.',
    ioSummary: [
      { address: 'X1 / X0', role: 'Başlat (SET M0) / Acil Dur' },
      { address: 'X2 / X3 / X4', role: '30°C / 60°C / 90°C Kademe' },
      { address: 'D1110 -> D101', role: 'AD0 LM35 -> Ölçülen °C (/2)' },
      { address: 'Y0 / Y1', role: 'Isıtıcı / İzleme Lambası' },
    ],
    buildProgram: buildSx2AnalogTempProgram,
  },
  {
    id: 'deney4-camasir-makinesi',
    category: 'experiment',
    referenceTag: 'Deney 4',
    title: 'Deney 4: PLC ile Çamaşır Makinesi Uygulaması',
    subtitle: 'SET, RST, ZRST, TMR ve CNT ile su alma, ısıtma, yıkama ve tahliye',
    difficulty: 'Orta',
    description:
      'X0 ile makine çalışır (M0). Su valfi (Y2) X1 seviyesine kadar açık kalır, ısıtıcı (Y5) X2 sıcaklık sensörüne kadar çalışır, deterjan valfi (Y3) 5 sn açılır. Tambur sağa (Y0) ve sola (Y1) 2’şer sn döner; C0 sayıcısı 4 tur sayınca su 10 sn tahliye edilir (Y4) ve ZRST Y0 Y5 ile tüm çıkışlar kapanır. Föydeki Şekil 3 diyagramıyla aynıdır. Not: M10, M16 ve C0 sıfırlanmadığı için makineyi yeniden çalıştırmadan önce simülasyonu sıfırlayın (gerçek PLC’de STOP→RUN).',
    ioSummary: [
      { address: 'X0', role: 'Açma-kapama düğmesi' },
      { address: 'X1 / X2', role: 'Su seviyesi / Sıcaklık (60 °C)' },
      { address: 'Y0 / Y1', role: 'Motor sağa / sola' },
      { address: 'Y2 / Y3 / Y4 / Y5', role: 'Su valfi / Deterjan / Tahliye / Isıtıcı' },
      { address: 'C0', role: '4 tekrar sayıcı' },
    ],
    buildProgram: buildDeney4Program,
  },
  {
    id: 'deney5-dalgic-pompa',
    category: 'experiment',
    referenceTag: 'Deney 5',
    title: 'Deney 5: PLC ile Dalgıç Pompa Uygulaması',
    subtitle: 'SET, RST ve TMR ile iki dalgıç pompa ve yatay milli pompa kontrolü',
    difficulty: 'Orta',
    description:
      'Ana depo %25 seviyesinin altındayken P1 (Y1) ve P2 (Y2) birlikte çalışır. Seviye %50 ile %100 arasındayken pompalar T0/T1 ile sırayla (10’ar sn) çalışır, %100 olunca ikisi de durur. Ana depo %25 üstündeyken tali depo boşalırsa yatay milli pompa (Y3) çalışır, tali depo dolunca durur. Föydeki Şekil 3 diyagramıyla aynıdır.',
    ioSummary: [
      { address: 'X0 / X1 / X2', role: 'Ana depo %25 / %50 / %100' },
      { address: 'X3 / X4', role: 'Tali depo %25 / %100' },
      { address: 'Y1 / Y2', role: 'P1 / P2 dalgıç pompa' },
      { address: 'Y3', role: 'Yatay milli pompa' },
    ],
    buildProgram: buildDeney5Program,
  },
  {
    id: 'deney6-su-kopuk',
    category: 'experiment',
    referenceTag: 'Deney 6',
    title: 'Deney 6: Benzin İstasyonu Su–Köpük Otomasyonu',
    subtitle: 'Jetonlu (1 TL) köpük ve su pompası, süre ve sayıcı ile',
    difficulty: 'Orta',
    description:
      '1 TL atılınca (X0) M0 kilitlenir ve C0 sayıcısı bir artar (50 adet olunca para kabul edilmez). Köpük butonu (X1) köpük pompasını (Y1) 15 sn, su butonu (X2) su pompasını (Y2) 25 sn çalıştırır; ikisi aynı anda seçilemez. Süre bitince pompa durur ve yeniden para atılması gerekir.',
    ioSummary: [
      { address: 'X0', role: '1 TL girişi' },
      { address: 'X1 / X2', role: 'Köpük / Su butonu' },
      { address: 'Y1 / Y2', role: 'Köpük / Su pompası' },
      { address: 'T1 / T2 / C0', role: '15 sn / 25 sn / 50 adet' },
    ],
    buildProgram: buildDeney6Program,
  },
];

export function getTemplateById(id: TemplateId): IndustrialTemplateMeta {
  return (
    INDUSTRIAL_TEMPLATES.find((t) => t.id === id) ?? INDUSTRIAL_TEMPLATES[0]
  );
}
