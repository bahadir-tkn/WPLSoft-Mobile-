import test from 'node:test';
import assert from 'node:assert/strict';
import type { LadderProgram } from '../types/plc';
import { createBlankProgram, createEmptyRow } from './gridFactory';
import { compileLadderToIl } from './ilCompiler';
import { LADDER_COIL_COLUMN } from './plcModels';
import {
  branchWireKey,
  cellKey,
  createInitialSimState,
  executeScanCycle,
  getTimerTimeBaseMs,
} from './scanner';
import { MAX_IL_LINES, parseIlToLadder } from './ilParser';
import { shouldAutoFocusInput } from './clipboard';
import { getTemplateById, INDUSTRIAL_TEMPLATES } from './templates';
import {
  MAX_PROJECT_JSON_BYTES,
  parseProgramJson,
  serializeProgramJson,
} from './storage';
import { nextOctalAddress, validateAddress, validateZrstRange } from './addressing';
import { analyzeProgramWiring } from './wiringAnalyzer';
import { parseQuickCommand } from './quickCommand';
import {
  applyQuickCommandOnProgram,
  buildAddressCrossReference,
  commitHistory,
  commitHistoryFromSnapshot,
  createInitialHistory,
  deleteCellOnProgram,
  deleteRungOnProgram,
  insertRungOnProgram,
  MAX_HISTORY_DEPTH,
  placeElementOnProgram,
  redoHistory,
  searchLadderProgram,
  setDeviceCommentOnProgram,
  setRungCommentOnProgram,
  toggleBranchDownOnProgram,
  undoHistory,
} from './ladderOperations';

test('Classic Seal-In Start-Stop circuit with F10 parallel branch compiles to exact Delta IL without line numbers', () => {
  const program = createBlankProgram('DVP-14SS2', 'Muhurleme_Test', 1);

  // Rung 0: (X0 OR Y0) AND NOT X1 -> OUT Y0
  const row0 = createEmptyRow();
  row0[0] = {
    element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' },
    branchDown: true, // F10 vertical branch down to Row 1
  };
  row0[1] = {
    element: { kind: 'CONTACT', contactType: 'NC', address: 'X1' },
    branchDown: false,
  };
  for (let c = 2; c < LADDER_COIL_COLUMN; c += 1) {
    row0[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  row0[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
    branchDown: false,
  };

  const row1 = createEmptyRow();
  row1[0] = {
    element: { kind: 'CONTACT', contactType: 'NO', address: 'Y0' },
    branchDown: false,
  };

  program.rungs[0].rows = [row0, row1];

  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false);
  assert.equal(compiled.diagnostics.length, 0);
  assert.equal(
    compiled.rawIlText,
    ['LD X0', 'OR Y0', 'ANI X1', 'OUT Y0', 'END'].join('\n')
  );
  // Confirm zero line numbers in raw WPLSoft clipboard text
  assert.equal(/^\d+\s/m.test(compiled.rawIlText), false);
});

test('Series-in-parallel branches compile to ORB instruction', () => {
  const program = createBlankProgram('DVP-14SS2', 'ORB_Test', 1);

  const row0 = createEmptyRow();
  row0[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: false };
  row0[1] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X1' }, branchDown: true };
  for (let c = 2; c < LADDER_COIL_COLUMN; c += 1) {
    row0[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  row0[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y1' },
    branchDown: false,
  };

  const row1 = createEmptyRow();
  row1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X2' }, branchDown: false };
  row1[1] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'X3' }, branchDown: false };

  program.rungs[0].rows = [row0, row1];

  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false);
  assert.equal(
    compiled.rawIlText,
    ['LD X0', 'AND X1', 'LD X2', 'ANI X3', 'ORB', 'OUT Y1', 'END'].join('\n')
  );
});

test('Mid-rung parallel branch compiles to ANB instruction', () => {
  const program = createBlankProgram('DVP-14SS2', 'ANB_Test', 1);

  const row0 = createEmptyRow();
  row0[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: true };
  row0[1] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X1' }, branchDown: true };
  for (let c = 2; c < LADDER_COIL_COLUMN; c += 1) {
    row0[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  row0[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y2' },
    branchDown: false,
  };

  const row1 = createEmptyRow();
  row1[1] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X2' }, branchDown: false };

  program.rungs[0].rows = [row0, row1];

  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false);
  assert.equal(
    compiled.rawIlText,
    ['LD X0', 'LD X1', 'OR X2', 'ANB', 'OUT Y2', 'END'].join('\n')
  );
});

test('Rising/Falling edge contacts, Compare instructions, TMR, CNT, MOV, SET, and RST compile accurately', () => {
  const program = createBlankProgram('DVP-14SS2', 'Advanced_Test', 3);

  // Rung 0: LDP X0, ORP M0, ANDF X1 -> MOV K100 D0
  const r0a = createEmptyRow();
  r0a[0] = { element: { kind: 'CONTACT', contactType: 'RISING', address: 'X0' }, branchDown: true };
  r0a[1] = { element: { kind: 'CONTACT', contactType: 'FALLING', address: 'X1' }, branchDown: false };
  for (let c = 2; c < LADDER_COIL_COLUMN; c += 1) {
    r0a[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r0a[LADDER_COIL_COLUMN] = {
    element: { kind: 'MOV', source: 'K100', destination: 'D0' },
    branchDown: false,
  };
  const r0b = createEmptyRow();
  r0b[0] = { element: { kind: 'CONTACT', contactType: 'RISING', address: 'M0' }, branchDown: false };
  program.rungs[0].rows = [r0a, r0b];

  // Rung 1: LD>= D0 K50, AND<> D1 K0 -> TMR T0 K50
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'COMPARE', operator: '>=', operandA: 'D0', operandB: 'K50' }, branchDown: false };
  r1[1] = { element: { kind: 'COMPARE', operator: '<>', operandA: 'D1', operandB: 'K0' }, branchDown: false };
  for (let c = 2; c < LADDER_COIL_COLUMN; c += 1) {
    r1[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r1[LADDER_COIL_COLUMN] = {
    element: { kind: 'TMR', address: 'T0', preset: 'K50' },
    branchDown: false,
  };
  program.rungs[1].rows = [r1];

  // Rung 2: LD T0 -> CNT C0 K5 (Row 0) + RST T0 (Row 1 via branchDown at col 7)
  const r2a = createEmptyRow();
  r2a[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'T0' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r2a[c] = { element: { kind: 'HLINE' }, branchDown: c === LADDER_COIL_COLUMN - 1 };
  }
  r2a[LADDER_COIL_COLUMN] = {
    element: { kind: 'CNT', address: 'C0', preset: 'K5' },
    branchDown: false,
  };
  const r2b = createEmptyRow();
  r2b[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'RST', address: 'T0' },
    branchDown: false,
  };
  program.rungs[2].rows = [r2a, r2b];

  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false);
  assert.equal(
    compiled.rawIlText,
    [
      'LDP X0',
      'ORP M0',
      'ANDF X1',
      'MOV K100 D0',
      'LD>= D0 K50',
      'AND<> D1 K0',
      'TMR T0 K50',
      'LD T0',
      'CNT C0 K5',
      'RST T0',
      'END',
    ].join('\n')
  );
});

test('Double Coil warning and Missing END error are reported by compiler', () => {
  const program = createBlankProgram('DVP-14SS2', 'Diag_Test', 2);

  for (let i = 0; i < 2; i += 1) {
    const row = createEmptyRow();
    row[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: `X${i}` }, branchDown: false };
    for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
      row[c] = { element: { kind: 'HLINE' }, branchDown: false };
    }
    row[LADDER_COIL_COLUMN] = {
      element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
      branchDown: false,
    };
    program.rungs[i].rows = [row];
  }

  const withDoubleCoil = compileLadderToIl(program);
  assert.equal(withDoubleCoil.hasErrors, false);
  assert.equal(
    withDoubleCoil.diagnostics.some((d) => d.code === 'DOUBLE_COIL' && d.address === 'Y0'),
    true
  );

  // Remove END rung and verify MISSING_END error
  const withoutEnd = {
    ...program,
    rungs: program.rungs.filter((r) => !r.isEnd),
  };
  const compiledNoEnd = compileLadderToIl(withoutEnd);
  assert.equal(compiledNoEnd.hasErrors, true);
  assert.equal(
    compiledNoEnd.diagnostics.some((d) => d.code === 'MISSING_END'),
    true
  );
});

test('Simulator: Classic Seal-In Start-Stop latches Y0 after X0 release and stops on X1', () => {
  const program = createBlankProgram('DVP-14SS2', 'Sim_SealIn', 1);
  const row0 = createEmptyRow();
  row0[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: true };
  row0[1] = { element: { kind: 'CONTACT', contactType: 'NC', address: 'X1' }, branchDown: false };
  for (let c = 2; c < LADDER_COIL_COLUMN; c += 1) {
    row0[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  row0[LADDER_COIL_COLUMN] = {
    element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
    branchDown: false,
  };
  const row1 = createEmptyRow();
  row1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'Y0' }, branchDown: false };
  program.rungs[0].rows = [row0, row1];

  // Scan 1: Idle (X0=0, X1=0) -> Y0=0
  let state = createInitialSimState();
  state = executeScanCycle(program, state, 20);
  assert.equal(state.outputs['Y0'], false);

  // Scan 2: Press Start (X0=1) -> Y0=1 and branch wire glows green
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.energizedCells[cellKey(0, 0, 0)], true);
  assert.equal(state.energizedCells[cellKey(0, 0, LADDER_COIL_COLUMN)], true);
  assert.equal(state.energizedWires[branchWireKey(0, 0, 0)], true);

  // Scan 3: Release Start (X0=0) -> Y0 stays latched ON via Row 1 parallel branch!
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.energizedCells[cellKey(0, 1, 0)], true);

  // Scan 4: Press Stop (X1=1) -> Y0 turns OFF
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  assert.equal(state.outputs['Y0'], false);

  // Scan 5: Release Stop (X1=0) -> Y0 stays OFF
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: false } }, 20);
  assert.equal(state.outputs['Y0'], false);
});

test('Simulator: Special relays M1000, M1001, and M1002 initial pulse work accurately', () => {
  const program = createBlankProgram('DVP-14SS2', 'Sim_SpecialRelays', 2);

  // Rung 0: M1002 -> SET M10 (initial pulse latch)
  const r0 = createEmptyRow();
  r0[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M1002' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r0[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r0[LADDER_COIL_COLUMN] = { element: { kind: 'COIL', coilType: 'SET', address: 'M10' }, branchDown: false };
  program.rungs[0].rows = [r0];

  // Rung 1: M1002 -> OUT Y0 (should only be ON during Scan #1)
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'M1002' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r1[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r1[LADDER_COIL_COLUMN] = { element: { kind: 'COIL', coilType: 'OUT', address: 'Y0' }, branchDown: false };
  program.rungs[1].rows = [r1];

  let state = createInitialSimState();
  // Scan 1
  state = executeScanCycle(program, state, 20);
  assert.equal(state.relays['M1000'], true);
  assert.equal(state.relays['M1001'], false);
  assert.equal(state.relays['M1002'], true);
  assert.equal(state.relays['M10'], true);
  assert.equal(state.outputs['Y0'], true);

  // Scan 2: M1002 goes OFF, Y0 goes OFF, M10 stays SET
  state = executeScanCycle(program, state, 20);
  assert.equal(state.relays['M1000'], true);
  assert.equal(state.relays['M1001'], false);
  assert.equal(state.relays['M1002'], false);
  assert.equal(state.relays['M10'], true);
  assert.equal(state.outputs['Y0'], false);
});

test('Simulator: 100ms ON-Delay TMR accumulates real delta-time and resets immediately on FALSE', () => {
  const program = createBlankProgram('DVP-14SS2', 'Sim_TMR', 2);

  // Rung 0: X0 -> TMR T0 K50 (5.0s)
  const r0 = createEmptyRow();
  r0[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r0[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r0[LADDER_COIL_COLUMN] = { element: { kind: 'TMR', address: 'T0', preset: 'K50' }, branchDown: false };
  program.rungs[0].rows = [r0];

  // Rung 1: T0 -> OUT Y1
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'T0' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r1[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r1[LADDER_COIL_COLUMN] = { element: { kind: 'COIL', coilType: 'OUT', address: 'Y1' }, branchDown: false };
  program.rungs[1].rows = [r1];

  let state = createInitialSimState({ X0: true });
  // Advance 2500ms -> T0 = 25/50, not done yet
  state = executeScanCycle(program, state, 2500);
  assert.equal(state.timers['T0']?.currentValue, 25);
  assert.equal(state.timers['T0']?.done, false);
  assert.equal(state.outputs['Y1'], false);

  // Advance another 2500ms -> T0 = 50/50, done = true, Y1 = true
  state = executeScanCycle(program, state, 2500);
  assert.equal(state.timers['T0']?.currentValue, 50);
  assert.equal(state.timers['T0']?.done, true);
  assert.equal(state.outputs['Y1'], true);

  // Drop X0 = false -> T0 resets immediately to 0 and Y1 turns OFF
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
  assert.equal(state.timers['T0']?.currentValue, 0);
  assert.equal(state.timers['T0']?.done, false);
  assert.equal(state.outputs['Y1'], false);
});

test('Simulator: CNT counts strictly on 0->1 rising edge and RST C0 holds 0 with priority', () => {
  const program = createBlankProgram('DVP-14SS2', 'Sim_CNT', 3);

  // Rung 0: X1 -> RST C0
  const r0 = createEmptyRow();
  r0[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X1' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r0[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r0[LADDER_COIL_COLUMN] = { element: { kind: 'COIL', coilType: 'RST', address: 'C0' }, branchDown: false };
  program.rungs[0].rows = [r0];

  // Rung 1: X0 -> CNT C0 K3
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'X0' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r1[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r1[LADDER_COIL_COLUMN] = { element: { kind: 'CNT', address: 'C0', preset: 'K3' }, branchDown: false };
  program.rungs[1].rows = [r1];

  // Rung 2: C0 -> OUT Y2
  const r2 = createEmptyRow();
  r2[0] = { element: { kind: 'CONTACT', contactType: 'NO', address: 'C0' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r2[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r2[LADDER_COIL_COLUMN] = { element: { kind: 'COIL', coilType: 'OUT', address: 'Y2' }, branchDown: false };
  program.rungs[2].rows = [r2];

  let state = createInitialSimState();
  // Pulse 1: X0=1 (rising edge -> 1), then hold X0=1 across another scan (stays 1!)
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.counters['C0']?.currentValue, 1);
  state = executeScanCycle(program, state, 20);
  assert.equal(state.counters['C0']?.currentValue, 1);
  assert.equal(state.outputs['Y2'], false);

  // Pulse 2
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.counters['C0']?.currentValue, 2);

  // Pulse 3 -> reaches K3 -> C0 done = true, Y2 = true
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.counters['C0']?.currentValue, 3);
  assert.equal(state.counters['C0']?.done, true);
  assert.equal(state.outputs['Y2'], true);

  // Activate RST C0 (X1=1) and try pulsing X0 -> must stay 0 and NOT count while RST is ON
  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X0: false, X1: true } },
    20
  );
  assert.equal(state.counters['C0']?.currentValue, 0);
  assert.equal(state.outputs['Y2'], false);

  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X0: true, X1: true } },
    20
  );
  assert.equal(state.counters['C0']?.currentValue, 0);
  
  assert.equal(state.counters['C0']?.done, false);
});

test('Simulator: LDP rising-edge MOV K100 D0 and LD>= D0 K50 comparison energize output', () => {
  const program = createBlankProgram('DVP-14SS2', 'Sim_MOV_CMP', 2);

  // Rung 0: LDP X2 -> MOV K100 D0
  const r0 = createEmptyRow();
  r0[0] = { element: { kind: 'CONTACT', contactType: 'RISING', address: 'X2' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r0[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r0[LADDER_COIL_COLUMN] = { element: { kind: 'MOV', source: 'K100', destination: 'D0' }, branchDown: false };
  program.rungs[0].rows = [r0];

  // Rung 1: LD>= D0 K50 -> OUT Y3
  const r1 = createEmptyRow();
  r1[0] = { element: { kind: 'COMPARE', operator: '>=', operandA: 'D0', operandB: 'K50' }, branchDown: false };
  for (let c = 1; c < LADDER_COIL_COLUMN; c += 1) {
    r1[c] = { element: { kind: 'HLINE' }, branchDown: false };
  }
  r1[LADDER_COIL_COLUMN] = { element: { kind: 'COIL', coilType: 'OUT', address: 'Y3' }, branchDown: false };
  program.rungs[1].rows = [r1];

  let state = createInitialSimState();
  // Scan 1: D0 = 0 < 50 -> Y3 = false
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers['D0'] ?? 0, 0);
  assert.equal(state.outputs['Y3'], false);

  // Scan 2: Rising edge X2 (0 -> 1) triggers LDP -> MOV K100 D0 -> LD>= D0 K50 -> Y3 = true
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X2: true } }, 20);
  assert.equal(state.registers['D0'], 100);
  assert.equal(state.outputs['Y3'], true);

  // Scan 3: Hold X2 = true, externally set D0 = 20 -> LDP must NOT re-trigger MOV while X2 stays HIGH!
  state = executeScanCycle(
    program,
    { ...state, registers: { ...state.registers, D0: 20 } },
    20
  );
  assert.equal(state.registers['D0'], 20);
  assert.equal(state.outputs['Y3'], false);
});

test('Templates: All 7 industrial & textbook templates compile cleanly with zero errors/warnings and no line numbers', () => {
  assert.equal(INDUSTRIAL_TEMPLATES.length, 7);
  for (const tpl of INDUSTRIAL_TEMPLATES) {
    const targetModel = tpl.requiredModel ?? 'DVP-14SS2';
    const program = tpl.buildProgram(targetModel);
    const compiled = compileLadderToIl(program);
    assert.equal(compiled.hasErrors, false, `Template ${tpl.id} had compile errors`);
    assert.equal(
      compiled.diagnostics.length,
      0,
      `Template ${tpl.id} had unexpected diagnostics: ${JSON.stringify(compiled.diagnostics)}`
    );
    assert.equal(/^\d+\s/m.test(compiled.rawIlText), false);
    assert.equal(compiled.rawIlText.trim().endsWith('END'), true);
    // Şablonlar hiçbir aygıta otomatik açıklama eklememelidir.
    assert.equal(Object.keys(program.deviceComments).length, 0, `Template ${tpl.id} must not add device comments`);
  }
});

test('Template Simulation: Star-Delta switches from Star (Y1) to Delta (Y2) after 5.0s with NC interlock', () => {
  const starDelta = getTemplateById('star-delta').buildProgram('DVP-14SS2');
  let state = createInitialSimState();

  // Press Start (X0=1), then release -> Y0 (Main) ON, Y1 (Star) ON, Y2 (Delta) OFF
  state = executeScanCycle(starDelta, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], true);
  assert.equal(state.outputs['Y2'], false);

  // Release X0, run 2.5s -> Y0 stays latched, Y1 still ON, Y2 still OFF, T0 = 25/50
  state = executeScanCycle(starDelta, { ...state, inputs: { ...state.inputs, X0: false } }, 2500);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], true);
  assert.equal(state.outputs['Y2'], false);
  assert.equal(state.timers['T0']?.currentValue, 25);

  // Advance another 2.5s (total 5.0s = K50) -> T0 done -> Y1 drops OFF first, then Y2 energizes ON (never both ON!)
  state = executeScanCycle(starDelta, state, 2500);
  assert.equal(state.timers['T0']?.done, true);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], true);

  // Press Stop (X1=1) -> Y0, Y1, Y2 all OFF and T0 resets to 0
  state = executeScanCycle(starDelta, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], false);
  assert.equal(state.timers['T0']?.currentValue, 0);
});

test('Template Simulation: Forward-Reverse cross NC interlock prevents simultaneous Y0 and Y1', () => {
  const fwdRev = getTemplateById('forward-reverse').buildProgram('DVP-14SS2');
  let state = createInitialSimState();

  // Press Forward (X0=1) -> Y0 latches ON
  state = executeScanCycle(fwdRev, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  state = executeScanCycle(fwdRev, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], false);

  // Try pressing Reverse (X1=1) while Forward (Y0) is running -> NC interlock blocks Y1!
  state = executeScanCycle(fwdRev, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], false);

  // Press Stop (X2=1) -> both stop
  state = executeScanCycle(
    fwdRev,
    { ...state, inputs: { ...state.inputs, X1: false, X2: true } },
    20
  );
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);

  // Release Stop and press Reverse (X1=1) -> Y1 latches ON safely
  state = executeScanCycle(
    fwdRev,
    { ...state, inputs: { ...state.inputs, X2: false, X1: true } },
    20
  );
  state = executeScanCycle(fwdRev, { ...state, inputs: { ...state.inputs, X1: false } }, 20);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], true);
});

test('Round-Trip (Ladder -> IL -> Ladder -> IL): Templates, ORB, ANB, Edge, Compare, TMR, CNT, MOV preserve exact IL', () => {
  // 1. Round-trip all 7 templates
  for (const tpl of INDUSTRIAL_TEMPLATES) {
    const targetModel = tpl.requiredModel ?? 'DVP-SX2';
    const orig = tpl.buildProgram(targetModel);
    const il1 = compileLadderToIl(orig);
    const parsed = parseIlToLadder(il1.rawIlText, targetModel, orig.projectName);
    assert.equal(parsed.success, true, `Failed parsing template ${tpl.id}: ${JSON.stringify(parsed.errors)}`);
    const il2 = compileLadderToIl(parsed.program!);
    assert.equal(il2.rawIlText, il1.rawIlText, `Round-trip mismatch on ${tpl.id}`);
  }

  // 2. Round-trip complex PC WPLSoft IL with step numbers, comments, ORB, ANB, LDP, MOV, COMPARE, TMR, CNT
  const rawWplSoftPaste = [
    '; PC WPLSoft Instruction List export with step numbers & comments',
    '0000 LD X0 // Start',
    '0001 AND X1',
    '0002 LD X2',
    '0003 ANI X3',
    '0004 ORB',
    '0005 OUT Y0',
    '',
    '0006 LD X4',
    '0007 LD X5',
    '0008 OR X6',
    '0009 ANB',
    '0010 OUT Y1',
    '0011 LDP X7',
    '0012 MOV K100 D0',
    '0015 LD>= D0 K50',
    '0018 TMR T0 K25',
    '0021 LD T0',
    '0022 CNT C0 K5',
    '0025 RST T0',
    '0026 END',
  ].join('\n');

  const parsedComplex = parseIlToLadder(rawWplSoftPaste, 'DVP-14SS2', 'Complex_RT');
  assert.equal(parsedComplex.success, true, JSON.stringify(parsedComplex.errors));
  const recompiled = compileLadderToIl(parsedComplex.program!);
  assert.equal(recompiled.hasErrors, false);
  assert.equal(
    recompiled.rawIlText,
    [
      'LD X0',
      'AND X1',
      'LD X2',
      'ANI X3',
      'ORB',
      'OUT Y0',
      'LD X4',
      'LD X5',
      'OR X6',
      'ANB',
      'OUT Y1',
      'LDP X7',
      'MOV K100 D0',
      'LD>= D0 K50',
      'TMR T0 K25',
      'LD T0',
      'CNT C0 K5',
      'RST T0',
      'END',
    ].join('\n')
  );
});

test('IL Parser reports exact line numbers on invalid opcodes or non-octal Delta addresses', () => {
  const brokenIl = [
    '0000 LD X0',
    '0001 ANI X8', // Invalid octal digit 8 on line 2
    '0002 FOOBAR Y0', // Unknown instruction on line 3
    '0003 END',
  ].join('\n');

  const parsed = parseIlToLadder(brokenIl, 'DVP-14SS2');
  assert.equal(parsed.success, false);
  assert.equal(parsed.errors.some((e) => e.lineNumber === 2), true);
  assert.equal(parsed.errors.some((e) => e.lineNumber === 3), true);
});

test('Storage: JSON project serialization round-trip preserves program and rejects invalid schema', () => {
  const starDelta = getTemplateById('star-delta').buildProgram('DVP-12SA2');
  const serialized = serializeProgramJson(starDelta);
  const restored = parseProgramJson(serialized);
  assert.equal(restored.success, true);
  assert.equal(restored.program?.model, 'DVP-12SA2');
  assert.equal(restored.program?.projectName, 'Yildiz_Ucgen_Yol_Verme');
  assert.equal(
    compileLadderToIl(restored.program!).rawIlText,
    compileLadderToIl(starDelta).rawIlText
  );

  const badJson = parseProgramJson('{"version": "99.0"}');
  assert.equal(badJson.success, false);
});

// ============================================================================
// PHASE 5 TESTS: DVP-SX2 & Textbook Full Compatibility
// ============================================================================

test('DVP-SX2 addressing: supports extended octal X/Y377, M4095, T255, C254, D9999 and protects special relays', () => {
  assert.equal(validateAddress('X377', 'bit_contact', 'DVP-SX2').valid, true);
  assert.equal(validateAddress('Y377', 'bit_coil', 'DVP-SX2').valid, true);
  assert.equal(validateAddress('X400', 'bit_contact', 'DVP-SX2').valid, false);
  assert.equal(validateAddress('X380', 'bit_contact', 'DVP-SX2').valid, false); // invalid octal digit 8
  assert.equal(validateAddress('M4095', 'bit_coil', 'DVP-SX2').valid, true);
  assert.equal(validateAddress('M4096', 'bit_coil', 'DVP-SX2').valid, false);
  assert.equal(validateAddress('T255', 'timer', 'DVP-SX2').valid, true);
  assert.equal(validateAddress('C254', 'counter', 'DVP-SX2').valid, true);
  assert.equal(validateAddress('D9999', 'word_dest', 'DVP-SX2').valid, true);
  assert.equal(validateAddress('D1110', 'word_source', 'DVP-SX2').valid, true);
  assert.equal(validateAddress('D1319', 'word_source', 'DVP-SX2').valid, true);

  // Special relays are valid contacts, but strictly forbidden as coils
  for (const sr of ['M1003', 'M1011', 'M1012', 'M1013', 'M1014', 'M1020', 'M1021', 'M1022']) {
    assert.equal(validateAddress(sr, 'bit_contact', 'DVP-SX2').valid, true, `${sr} contact`);
    assert.equal(validateAddress(sr, 'bit_coil', 'DVP-SX2').valid, false, `${sr} coil must fail`);
  }

  // ZRST range validation
  assert.equal(validateZrstRange('Y0', 'Y5', 'DVP-SX2').valid, true);
  assert.equal(validateZrstRange('C0', 'C1', 'DVP-SX2').valid, true);
  assert.equal(validateZrstRange('Y5', 'Y2', 'DVP-SX2').valid, false); // start > end
  assert.equal(validateZrstRange('Y0', 'M5', 'DVP-SX2').valid, false); // mismatched prefix
});

test('ALT Flip-Flop instruction toggles target output once per rising edge', () => {
  const parsed = parseIlToLadder(['LD X0', 'ALT Y0', 'END'].join('\n'), 'DVP-SX2', 'Alt_Test');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  // Round-trip IL fidelity
  assert.equal(compileLadderToIl(program).rawIlText, ['LD X0', 'ALT Y0', 'END'].join('\n'));

  let state = createInitialSimState();
  state = executeScanCycle(program, state, 20);
  assert.equal(state.outputs['Y0'], false);

  // Rising edge #1: X0 = 1 -> Y0 becomes ON and stays ON while X0 held HIGH
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.outputs['Y0'], true);
  state = executeScanCycle(program, state, 20);
  assert.equal(state.outputs['Y0'], true, 'ALT must not flicker while input remains HIGH');

  // Release X0 -> Y0 remains ON
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
  assert.equal(state.outputs['Y0'], true);

  // Rising edge #2: X0 = 1 -> Y0 toggles OFF
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.outputs['Y0'], false);
});

test('ZRST resets contiguous Y outputs and C counters in bulk', () => {
  const il = [
    'LD X0',
    'SET Y0',
    'LD X0',
    'SET Y2',
    'LD X0',
    'SET Y5',
    'LD X1',
    'CNT C0 K5',
    'LD X1',
    'CNT C1 K5',
    'LD X2',
    'ZRST Y0 Y5',
    'LD X2',
    'ZRST C0 C1',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(il, 'DVP-SX2', 'Zrst_Test');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  let state = createInitialSimState();
  // Set Y0, Y2, Y5 and pulse C0, C1 twice
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true, X1: true } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false, X1: false } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y2'], true);
  assert.equal(state.outputs['Y5'], true);
  assert.equal(state.counters['C0']?.currentValue, 2);
  assert.equal(state.counters['C1']?.currentValue, 2);

  // Trigger X2 -> ZRST Y0..Y5 and C0..C1
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: false, X2: true } }, 20);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y2'], false);
  assert.equal(state.outputs['Y5'], false);
  assert.equal(state.counters['C0']?.currentValue, 0);
  assert.equal(state.counters['C1']?.currentValue, 0);
});

test('CMP S1 S2 D sets D (>), D+1 (=), and D+2 (<) bits accurately', () => {
  const parsed = parseIlToLadder(
    ['LD M1000', 'CMP D0 K50 M0', 'END'].join('\n'),
    'DVP-SX2',
    'Cmp_Test'
  );
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  // Case 1: D0 = 80 > 50 -> M0=1, M1=0, M2=0
  let state = createInitialSimState();
  state.registers['D0'] = 80;
  state = executeScanCycle(program, state, 20);
  assert.equal(state.relays['M0'], true);
  assert.equal(state.relays['M1'], false);
  assert.equal(state.relays['M2'], false);

  // Case 2: D0 = 50 = 50 -> M0=0, M1=1, M2=0
  state.registers['D0'] = 50;
  state = executeScanCycle(program, state, 20);
  assert.equal(state.relays['M0'], false);
  assert.equal(state.relays['M1'], true);
  assert.equal(state.relays['M2'], false);

  // Case 3: D0 = 20 < 50 -> M0=0, M1=0, M2=1
  state.registers['D0'] = 20;
  state = executeScanCycle(program, state, 20);
  assert.equal(state.relays['M0'], false);
  assert.equal(state.relays['M1'], false);
  assert.equal(state.relays['M2'], true);
});

test('Arithmetic (ADD, SUB, MUL, DIV quotient+remainder, INC/INCP/DEC/DECP) and M1020/M1021/M1022 flags', () => {
  const il = [
    'LD X0',
    'ADD K10 K7 D0',
    'LD X1',
    'DIV D0 K5 D10',
    'LD X2',
    'MUL K6 K7 D20',
    'LD X3',
    'SUB K15 K15 D30',
    'LD X4',
    'INCP D40',
    'LD X5',
    'DECP D40',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(il, 'DVP-SX2', 'Math_Test');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  let state = createInitialSimState();
  // ADD 10 + 7 = 17 -> D0=17; DIV 17 / 5 -> D10=3 (quotient), D11=2 (remainder); MUL 6*7=42 -> D20=42
  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X0: true, X1: true, X2: true } },
    20
  );
  assert.equal(state.registers['D0'], 17);
  assert.equal(state.registers['D10'], 3);
  assert.equal(state.registers['D11'], 2);
  assert.equal(state.registers['D20'], 42);
  assert.equal(state.relays['M1020'], false);

  // SUB 15 - 15 = 0 -> D30=0 and M1020 (Zero flag) = ON
  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X0: false, X1: false, X2: false, X3: true } },
    20
  );
  assert.equal(state.registers['D30'], 0);
  assert.equal(state.relays['M1020'], true);

  // INCP D40 triggers once on rising edge, not while held HIGH
  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X3: false, X4: true } },
    20
  );
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers['D40'], 1);

  // DECP D40 decrements back to 0 and raises Zero flag M1020
  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X4: false, X5: true } },
    20
  );
  assert.equal(state.registers['D40'], 0);
  assert.equal(state.relays['M1020'], true);

  // Carry (M1022) & Borrow (M1021) overflow checks
  const overflowProg = parseIlToLadder(
    ['LD X0', 'ADD K32000 K2000 D50', 'LD X1', 'SUB K-32000 K2000 D51', 'END'].join('\n'),
    'DVP-SX2'
  ).program!;
  let ovState = createInitialSimState();
  ovState = executeScanCycle(
    overflowProg,
    { ...ovState, inputs: { ...ovState.inputs, X0: true } },
    20
  );
  assert.equal(ovState.relays['M1022'], true, 'Carry flag M1022 must be ON on >32767');
  ovState = executeScanCycle(
    overflowProg,
    { ...ovState, inputs: { ...ovState.inputs, X0: false, X1: true } },
    20
  );
  assert.equal(ovState.relays['M1021'], true, 'Borrow flag M1021 must be ON on <-32768');
});

test('Dynamic TMR T0 D500 and CNT C0 D10 read presets live from D registers', () => {
  const il = [
    'LD X0',
    'TMR T0 D500',
    'LD T0',
    'OUT Y0',
    'LD X1',
    'CNT C0 D10',
    'LD C0',
    'OUT Y1',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(il, 'DVP-SX2', 'Dynamic_Preset_Test');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  let state = createInitialSimState();
  state.registers['D500'] = 5; // 5 * 100ms = 500ms
  state.registers['D10'] = 2; // count to 2

  // 300ms -> T0=3 < 5 -> Y0 OFF
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 300);
  assert.equal(state.timers['T0']?.currentValue, 3);
  assert.equal(state.outputs['Y0'], false);

  // +200ms -> T0=5 >= D500 -> Y0 ON
  state = executeScanCycle(program, state, 200);
  assert.equal(state.timers['T0']?.currentValue, 5);
  assert.equal(state.outputs['Y0'], true);

  // Two rising edges on X1 -> C0=2 >= D10 -> Y1 ON
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  assert.equal(state.outputs['Y1'], false);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: false } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  assert.equal(state.counters['C0']?.currentValue, 2);
  assert.equal(state.outputs['Y1'], true);
});

test('Multi-output branching (MPS / MRD / MPP) round-trips IL -> Ladder -> IL and simulates cleanly', () => {
  const mpsIl = [
    'LD X0',
    'MPS',
    'AND X1',
    'OUT Y0',
    'MRD',
    'ANI X2',
    'OUT Y1',
    'MPP',
    'OUT Y2',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(mpsIl, 'DVP-SX2', 'Mps_Branch_Test');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  // Compile back to IL and verify MPS / MRD / MPP preservation
  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.rawIlText, mpsIl);

  // Simulate: X0=1, X1=1, X2=1 -> Y0=ON (X0&X1), Y1=OFF (X0&!X2), Y2=ON (X0)
  let state = createInitialSimState();
  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X0: true, X1: true, X2: true } },
    20
  );
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], true);

  // Simulate: X0=1, X1=0, X2=0 -> Y0=OFF, Y1=ON, Y2=ON
  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X0: true, X1: false, X2: false } },
    20
  );
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], true);
  assert.equal(state.outputs['Y2'], true);
});

test('Special relays (M1003, M1013, M1014 with 2x & 10x speed) + SX2 Analog D1110 + RTC D1313-D1319 & TRD', () => {
  const il = [
    'LD M1003',
    'OUT Y0',
    'LD>= D1110 K1000',
    'OUT Y1',
    'LD M1000',
    'TRD D20',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(il, 'DVP-SX2', 'SX2_Special_Test');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  // Fixed RTC date: 2026-05-15 14:30:45 (Friday -> Delta DayOfWeek = 5)
  const fixedEpoch = new Date(2026, 4, 15, 14, 30, 45).getTime();
  let state = createInitialSimState({}, fixedEpoch);
  state.registers['D1110'] = 1250; // AD0 >= 1000

  // Scan #1: M1002 = ON, M1003 = OFF -> Y0 = OFF, Y1 = ON (D1110=1250 >= 1000)
  state = executeScanCycle(program, state, 0, 1);
  assert.equal(state.relays['M1002'], true);
  assert.equal(state.relays['M1003'], false);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], true);

  // Verify TRD D20 copied RTC registers in Delta API 166 order (D20=Year..D26=Sec)
  assert.equal(state.registers['D20'], 26); // Year
  assert.equal(state.registers['D21'], 5); // Friday
  assert.equal(state.registers['D22'], 5); // May
  assert.equal(state.registers['D23'], 15); // Day
  assert.equal(state.registers['D24'], 14); // Hour
  assert.equal(state.registers['D25'], 30); // Min
  assert.equal(state.registers['D26'], 45); // Sec

  // Scan #2 with 200ms at 1x -> M1003 = ON (Y0=ON), M1013 (1s clock: 0..499ms OFF, 500..999ms ON)
  state = executeScanCycle(program, state, 200, 1);
  assert.equal(state.relays['M1003'], true);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.relays['M1013'], false, 'M1013 OFF during first 500ms half-period');

  // Advance with 2x speed multiplier (200ms * 2 = 400ms -> elapsed = 600ms)
  state = executeScanCycle(program, state, 200, 2);
  assert.equal(state.relays['M1013'], true, 'M1013 ON during second 500ms half-period (reached via 2x)');

  // Advance with 10x speed multiplier (3000ms * 10 = 30,000ms -> crosses 30s half-period of M1014!)
  state = executeScanCycle(program, state, 3000, 10); // elapsed = 30,600ms
  assert.equal(state.relays['M1014'], true, 'M1014 ON in 30s..60s half-period');
  assert.equal(state.registers['D1314'], 31, 'RTC minute advanced by 30s+45s -> 14:31:15');
});

// ============================================================================
// PHASE 6 TESTS: 4 Corrected University Lab / Textbook Templates
// ============================================================================

test('Phase 6 Template — Traffic Light (Örnek 6.1): Single-coil ORB IL, ALT start/stop, 80s phases, 1Hz green blink, and cyclic RST', () => {
  const program = getTemplateById('traffic-light').buildProgram('DVP-SX2');
  const compiled = compileLadderToIl(program);

  assert.equal(compiled.hasErrors, false);
  assert.equal(compiled.diagnostics.length, 0, 'Must have zero Double Coil or syntax warnings');
  assert.equal(
    compiled.rawIlText,
    [
      'LDP X0',
      'ALT M0',
      'LD M0',
      'TMR T0 K800',
      'LD M0',
      'AND< T0 K300',
      'OUT Y0',
      'LD>= T0 K300',
      'AND< T0 K350',
      'OUT Y1',
      'LD>= T0 K350',
      'AND< T0 K750',
      'LD>= T0 K750',
      'AND< T0 K800',
      'AND M1013',
      'ORB',
      'OUT Y2',
      'LD>= T0 K800',
      'RST T0',
      'END',
    ].join('\n')
  );

  // Idle (M0=0): all lights OFF
  let state = createInitialSimState();
  state = executeScanCycle(program, state, 20);
  assert.equal(state.relays['M0'] ?? false, false);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], false);

  // Rising edge X0 -> M0=ON, T0=0 (<300) -> Red (Y0) ON
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
  assert.equal(state.relays['M0'], true);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], false);

  // Advance to 32.0s (T0=320: 300..349) -> Yellow (Y1) ON
  state = executeScanCycle(program, state, 31960);
  assert.equal(state.timers['T0']?.currentValue, 320);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], true);
  assert.equal(state.outputs['Y2'], false);

  // Advance +18.0s to 50.0s (T0=500: 350..749) -> Solid Green (Y2) ON regardless of M1013
  state = executeScanCycle(program, state, 18000);
  assert.equal(state.timers['T0']?.currentValue, 500);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], true);

  // Advance +26.0s to 76.0s (T0=760: 750..799) -> Blinking Green follows M1013 (1Hz: 0..499ms OFF, 500..999ms ON)
  state = executeScanCycle(program, state, 26000);
  assert.equal(state.timers['T0']?.currentValue, 760);
  // Check exact half-period blink behavior at +200ms (M1013 OFF -> Y2 OFF) and +400ms (M1013 ON -> Y2 ON)
  state = executeScanCycle(program, state, 200);
  assert.equal(state.relays['M1013'], false);
  assert.equal(state.outputs['Y2'], false);
  state = executeScanCycle(program, state, 400);
  assert.equal(state.relays['M1013'], true);
  assert.equal(state.outputs['Y2'], true);

  // Advance past 80.0s (T0 hits 800 -> RST T0 resets T0 back to 0)
  state = executeScanCycle(program, state, 3500);
  assert.equal(state.timers['T0']?.currentValue, 0);
  // Next scan starts new Red phase cleanly
  state = executeScanCycle(program, state, 100);
  assert.equal(state.timers['T0']?.currentValue, 1);
  assert.equal(state.outputs['Y0'], true);

  // Second X0 rising edge toggles M0 OFF -> all lights OFF & T0 reset
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.relays['M0'], false);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], false);
  assert.equal(state.timers['T0']?.currentValue, 0);
});

test('Phase 6 Template — MOV Dynamic Counter Conveyor (Örnek 6.2): M1002 initializes D10=10, X0/X1 switch preset, CNT C0 D10 drives Y0, X3 resets', () => {
  const program = getTemplateById('dynamic-counter').buildProgram('DVP-SX2');
  const compiled = compileLadderToIl(program);

  assert.equal(compiled.hasErrors, false);
  assert.equal(
    compiled.rawIlText,
    [
      'LD M1002',
      'MOV K10 D10',
      'LD X0',
      'MOV K15 D10',
      'LD X1',
      'MOV K10 D10',
      'LD X3',
      'RST C0',
      'LD X2',
      'CNT C0 D10',
      'LD C0',
      'OUT Y0',
      'END',
    ].join('\n')
  );

  // Scan 1: M1002 sets D10=10 so C0 does NOT spuriously trigger on D10=0
  let state = createInitialSimState();
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers['D10'], 10);
  assert.equal(state.counters['C0']?.presetValue, 10);
  assert.equal(state.outputs['Y0'], false);

  // X0 selects 15-item target (D10=15)
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
  assert.equal(state.registers['D10'], 15);

  // X1 switches back to 10-item target (D10=10)
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: false } }, 20);
  assert.equal(state.registers['D10'], 10);

  // Pulse X2 9 times -> Y0 still OFF; 10th pulse -> C0 done, Y0 ON
  for (let i = 0; i < 9; i += 1) {
    state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X2: true } }, 20);
    state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X2: false } }, 20);
  }
  assert.equal(state.counters['C0']?.currentValue, 9);
  assert.equal(state.outputs['Y0'], false);

  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X2: true } }, 20);
  assert.equal(state.counters['C0']?.currentValue, 10);
  assert.equal(state.outputs['Y0'], true);

  // X3 resets C0 and turns Y0 OFF
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X2: false, X3: true } }, 20);
  assert.equal(state.counters['C0']?.currentValue, 0);
  assert.equal(state.outputs['Y0'], false);
});

test('Phase 6 Template — INC/DEC Adjustable Timer (Örnek 7.8): M1002 defaults D1=50, rising-edge LDP INC/DEC adjusts preset, TMR T1 D1 drives Y1', () => {
  const program = getTemplateById('adjustable-timer').buildProgram('DVP-SX2');
  const compiled = compileLadderToIl(program);

  assert.equal(compiled.hasErrors, false);
  assert.equal(
    compiled.rawIlText,
    [
      'LD M1002',
      'MOV K50 D1',
      'LDP X2',
      'INC D1',
      'LDP X3',
      'AND> D1 K1',
      'DEC D1',
      'LD X1',
      'TMR T1 D1',
      'LD T1',
      'OUT Y1',
      'END',
    ].join('\n')
  );

  // Scan 1: D1 initialized to 50 (5.0s)
  let state = createInitialSimState();
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers['D1'], 50);

  // Press and HOLD X2 across 3 scans -> LDP protects INC so D1 increments strictly once (51)
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X2: true } }, 20);
  state = executeScanCycle(program, state, 20);
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers['D1'], 51);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X2: false } }, 20);

  // Press X3 twice -> D1 decrements to 49 (4.9s)
  for (let i = 0; i < 2; i += 1) {
    state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X3: true } }, 20);
    state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X3: false } }, 20);
  }
  assert.equal(state.registers['D1'], 49);

  // Run X1 for 4.8s -> T1=48 < 49 -> Y1 OFF; +0.1s -> T1=49 -> Y1 ON
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 4800);
  assert.equal(state.timers['T1']?.currentValue, 48);
  assert.equal(state.outputs['Y1'], false);

  state = executeScanCycle(program, state, 100);
  assert.equal(state.timers['T1']?.currentValue, 49);
  assert.equal(state.outputs['Y1'], true);

  // Repeated X3 presses clamp D1 at minimum 1 (0.1s) via AND> D1 K1 guard
  for (let i = 0; i < 55; i += 1) {
    state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X3: true } }, 20);
    state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X3: false } }, 20);
  }
  assert.equal(state.registers['D1'], 1);
});

test('Phase 6 Template — DVP-SX2 Analog AD0 Temperature Control (Örnek 8.1): D1115/D200 init, LM35 DIV K2 scaling, 30/60/90°C setpoints, and X0 E-Stop', () => {
  const program = getTemplateById('sx2-analog-temp').buildProgram('DVP-SX2');
  const compiled = compileLadderToIl(program);

  assert.equal(program.model, 'DVP-SX2');
  assert.equal(compiled.hasErrors, false);
  assert.equal(
    compiled.rawIlText,
    [
      'LD M1002',
      'MOV K0 D1115',
      'MOV K30 D200',
      'LD X1',
      'SET M0',
      'LD X0',
      'RST M0',
      'LD X2',
      'MOV K30 D200',
      'LD X3',
      'MOV K60 D200',
      'LD X4',
      'MOV K90 D200',
      'LD M0',
      'MOV D1110 D100',
      'DIV D100 K2 D101',
      'LD M0',
      'AND< D101 D200',
      'OUT Y0',
      'OUT Y1',
      'END',
    ].join('\n')
  );

  // Scan 1: M1002 initializes D1115=0 (0-10V mode) and D200=30°C; system stopped (M0=0)
  let state = createInitialSimState();
  state.registers['D1110'] = 50; // 25°C after DIV K2
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers['D1115'], 0);
  assert.equal(state.registers['D200'], 30);
  assert.equal(state.relays['M0'] ?? false, false);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);

  // Press Start (X1=1) -> M0 latched ON, D100=50, D101=25 < D200=30 -> Heater (Y0) & Lamp (Y1) ON
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: false } }, 20);
  assert.equal(state.relays['M0'], true);
  assert.equal(state.registers['D100'], 50);
  assert.equal(state.registers['D101'], 25);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], true);

  // Temperature rises: AD0=80 -> D101=40°C >= 30°C -> Heater & Lamp turn OFF
  state = executeScanCycle(
    program,
    { ...state, registers: { ...state.registers, D1110: 80 } },
    20
  );
  assert.equal(state.registers['D101'], 40);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);

  // Select 60°C tier via X3 -> D200=60 -> D101=40 < 60 -> Heater & Lamp turn ON
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X3: true } }, 20);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X3: false } }, 20);
  assert.equal(state.registers['D200'], 60);
  assert.equal(state.outputs['Y0'], true);
  assert.equal(state.outputs['Y1'], true);

  // Select 90°C tier via X4 -> D200=90; then back to 30°C via X2 -> D200=30
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X4: true } }, 20);
  assert.equal(state.registers['D200'], 90);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X4: false, X2: true } }, 20);
  assert.equal(state.registers['D200'], 30);
  assert.equal(state.outputs['Y0'], false);

  // Emergency Stop (X0=1) resets M0 and shuts down Y0 & Y1 even if temperature is low
  state = executeScanCycle(
    program,
    {
      ...state,
      inputs: { ...state.inputs, X2: false, X0: true },
      registers: { ...state.registers, D1110: 20 },
    },
    20
  );
  assert.equal(state.relays['M0'], false);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);
});

// ============================================================================
// PHASE 7 TESTS: BETİ Delta PLC Training Set Automatic Wiring Analyzer
// ============================================================================

test('Phase 7 WiringAnalyzer: Analyzes arbitrary custom Ladder circuit, carries device comments, and generates exact NPN/Sink cables', () => {
  const parsed = parseIlToLadder(
    ['LD X2', 'ANI X0', 'OUT Y3', 'LD X2', 'OUT Y1', 'END'].join('\n'),
    'DVP-SX2',
    'Ozel_Devre',
    {
      X0: 'Acil Stop',
      X2: 'Baslat',
      Y1: 'Motor',
      Y3: 'Alarm',
    }
  );
  assert.equal(parsed.success, true);

  const plan = analyzeProgramWiring(parsed.program!, 'led');
  assert.deepEqual(
    plan.usedInputs.map((d) => d.address),
    ['X0', 'X2']
  );
  assert.deepEqual(
    plan.usedOutputs.map((d) => d.address),
    ['Y1', 'Y3']
  );
  assert.equal(plan.usedAnalogChannels.length, 0);

  // Verify mandatory power/ground wires (S/S, UP, Button COM, ZP, LED COM) + 2 inputs + 2 outputs = 9 wires
  assert.equal(plan.connections.length, 9);
  assert.equal(plan.connections[0].id, 'pwr-24v-ss');
  assert.equal(plan.connections[0].color, 'red');
  assert.equal(plan.connections[1].id, 'pwr-24v-up');
  assert.equal(plan.connections[1].color, 'red');
  assert.equal(plan.connections[2].id, 'gnd-btn-com');
  assert.equal(plan.connections[2].color, 'blue');
  assert.equal(plan.connections[3].id, 'gnd-plc-zp');
  assert.equal(plan.connections[3].color, 'blue');
  assert.equal(plan.connections[4].id, 'gnd-led-com');
  assert.equal(plan.connections[4].color, 'blue');

  const x0Wire = plan.connections.find((c) => c.id === 'in-X0');
  assert.ok(x0Wire);
  assert.equal(x0Wire.color, 'yellow');
  assert.equal(x0Wire.deviceComment, 'Acil Stop');
  assert.ok(x0Wire.fromTerminal.includes('Acil Stop'));

  const y3Wire = plan.connections.find((c) => c.id === 'out-Y3');
  assert.ok(y3Wire);
  assert.equal(y3Wire.color, 'green');
  assert.equal(y3Wire.deviceComment, 'Alarm');
  assert.equal(y3Wire.toPinId, 'led-Y3');

  // Verify sequential 1..N step numbering
  plan.connections.forEach((c, idx) => {
    assert.equal(c.stepNumber, idx + 1);
  });
});

test('Phase 7 WiringAnalyzer: Detects SX2 Analog D1110 (AD0) purple wires and supports Relay output target mode', () => {
  const analogProg = getTemplateById('sx2-analog-temp').buildProgram('DVP-SX2');
  const plan = analyzeProgramWiring(analogProg, 'relay');

  assert.deepEqual(
    plan.usedInputs.map((d) => d.address),
    ['X0', 'X1', 'X2', 'X3', 'X4']
  );
  assert.deepEqual(
    plan.usedOutputs.map((d) => d.address),
    ['Y0', 'Y1']
  );
  assert.deepEqual(
    plan.usedAnalogChannels.map((d) => d.address),
    ['D1110']
  );
  assert.equal(plan.needsAnalogWiring, true);

  // Relay target switches common GND wire and green output pins to relay-*
  assert.ok(plan.connections.some((c) => c.id === 'gnd-relay-com' && c.toPinId === 'relay-com'));
  const y0Wire = plan.connections.find((c) => c.id === 'out-Y0');
  assert.equal(y0Wire?.toPinId, 'relay-Y0');
  assert.equal(y0Wire?.deviceComment, undefined);

  // Purple analog wires V0+ and VI0-
  const vPlus = plan.connections.find((c) => c.id === 'ai-vplus-0');
  const vMinus = plan.connections.find((c) => c.id === 'ai-vminus-0');
  assert.equal(vPlus?.color, 'purple');
  assert.equal(vPlus?.toTerminal, 'V0+');
  assert.equal(vMinus?.color, 'purple');
  assert.equal(vMinus?.toTerminal, 'VI0-');
});

test('Phase 7 WiringAnalyzer: Handles ZRST Y0 Y5, flags expansion I/O, and returns empty list for blank/internal-only programs', () => {
  const zrstProg = parseIlToLadder(
    ['LD X10', 'ZRST Y0 Y5', 'END'].join('\n'),
    'DVP-SX2',
    'Zrst_Wiring'
  ).program!;
  const zrstPlan = analyzeProgramWiring(zrstProg, 'led');
  assert.deepEqual(
    zrstPlan.usedOutputs.map((d) => d.address),
    ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5']
  );
  assert.deepEqual(zrstPlan.expansionDevices, ['X10']);
  // No onboard inputs -> S/S & Button COM not required, only output power + 6 green outputs
  assert.equal(zrstPlan.needsInputPower, false);
  assert.equal(zrstPlan.needsOutputPower, true);

  // Blank program -> 0 wires
  const blank = createBlankProgram('DVP-SX2', 'Bos', 2);
  const blankPlan = analyzeProgramWiring(blank, 'led');
  assert.equal(blankPlan.connections.length, 0);
  assert.equal(blankPlan.needsInputPower, false);
  assert.equal(blankPlan.needsOutputPower, false);
  assert.equal(blankPlan.needsAnalogWiring, false);
});

// =========================================================================
// PHASE 8 TESTS: Intra-Scan Order, SX2 10ms/100ms Timers, NC Highlight, Quick Command
// =========================================================================

test('Phase 8 Scan Engine: Intra-scan immediate updates apply top-to-bottom within the exact same scan', () => {
  const il = [
    'LD X0',
    'CNT C0 K2',
    'LD C0',
    'INC D0',
    'LD C0',
    'RST C0',
    'LD X1',
    'MOV K25 D10',
    'LD= D10 K25',
    'OUT M10',
    'LD M10',
    'OUT Y0',
    'END',
  ].join('\n');
  const parsed = parseIlToLadder(il, 'DVP-SX2', 'IntraScan_Test');
  assert.equal(parsed.success, true);
  const program = parsed.program!;

  let state = createInitialSimState();

  // Rising edge #1 on X0: C0 becomes 1 (not done yet)
  state.inputs.X0 = true;
  state = executeScanCycle(program, state, 20);
  assert.equal(state.counters.C0?.currentValue, 1);
  assert.equal(state.counters.C0?.done, false);
  assert.equal(state.registers.D0 ?? 0, 0);

  // Fall X0 back to 0
  state.inputs.X0 = false;
  state = executeScanCycle(program, state, 20);

  // Rising edge #2 on X0: C0 hits K2 -> IMMEDIATELY triggers INC D0 (D0=1) -> IMMEDIATELY RST C0 (C0=0) in the same scan!
  state.inputs.X0 = true;
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers.D0, 1, 'INC D0 must observe C0=done immediately within the same scan');
  assert.equal(state.counters.C0?.currentValue, 0, 'RST C0 must clear C0 immediately in the same scan');
  assert.equal(state.counters.C0?.done, false);

  // Now energize X1: MOV K25 D10 -> LD= D10 K25 -> OUT M10 -> LD M10 -> OUT Y0 all in 1 single scan!
  state.inputs.X1 = true;
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers.D10, 25);
  assert.equal(state.relays.M10, true, 'M10 must observe updated D10 within the same scan');
  assert.equal(state.outputs.Y0, true, 'Y0 must observe updated M10 within the same scan');
});

test('Phase 8 SX2 Timers: T0-T199 run at 100ms timebase and T200-T245 run at 10ms timebase', () => {
  assert.equal(getTimerTimeBaseMs('T0'), 100);
  assert.equal(getTimerTimeBaseMs('T199'), 100);
  assert.equal(getTimerTimeBaseMs('T200'), 10);
  assert.equal(getTimerTimeBaseMs('T245'), 10);

  const il = [
    'LD X0',
    'TMR T0 K5',    // 5 * 100ms = 500ms
    'LD X0',
    'TMR T200 K50', // 50 * 10ms = 500ms
    'LD T0',
    'OUT Y0',
    'LD T200',
    'OUT Y1',
    'END',
  ].join('\n');
  const parsed = parseIlToLadder(il, 'DVP-SX2', 'SX2_Timebase_Test');
  assert.equal(parsed.success, true);
  const program = parsed.program!;

  let state = createInitialSimState();
  state.inputs.X0 = true;

  // After 250ms: T0 (100ms base) = 2, T200 (10ms base) = 25; neither done yet
  state = executeScanCycle(program, state, 250);
  assert.equal(state.timers.T0?.currentValue, 2);
  assert.equal(state.timers.T0?.done, false);
  assert.equal(state.timers.T200?.currentValue, 25);
  assert.equal(state.timers.T200?.done, false);
  assert.equal(state.outputs.Y0, false);
  assert.equal(state.outputs.Y1, false);

  // After another 250ms (total 500ms): BOTH T0 (5) and T200 (50) finish together!
  state = executeScanCycle(program, state, 250);
  assert.equal(state.timers.T0?.currentValue, 5);
  assert.equal(state.timers.T0?.done, true);
  assert.equal(state.timers.T200?.currentValue, 50);
  assert.equal(state.timers.T200?.done, true);
  assert.equal(state.outputs.Y0, true);
  assert.equal(state.outputs.Y1, true);
});

test('Phase 8 NC Contact Live Highlight: conductingCells lights NC contact green when bit is 0 even with upstream OFF', () => {
  const il = ['LD X0', 'ANI X1', 'OUT Y0', 'END'].join('\n');
  const parsed = parseIlToLadder(il, 'DVP-SX2', 'NC_Highlight_Test');
  assert.equal(parsed.success, true);
  const program = parsed.program!;

  let state = createInitialSimState();
  // X0 = 0 (upstream OFF), X1 = 0 (NC bit is 0 -> conducting!)
  state.inputs.X0 = false;
  state.inputs.X1 = false;
  state = executeScanCycle(program, state, 20);

  // Wire power-flow through cell (0,0,1) is OFF because X0 is OFF
  assert.equal(Boolean(state.energizedCells[cellKey(0, 0, 1)]), false);
  // Yet NC contact itself IS conducting (WPLSoft green contact highlight!)
  assert.equal(Boolean(state.conductingCells?.[cellKey(0, 0, 1)]), true);
  assert.equal(Boolean(state.conductingCells?.[cellKey(0, 0, 0)]), false);
  assert.equal(state.outputs.Y0, false);

  // Now press X1 = 1 -> NC contact opens (green highlight turns OFF)
  state.inputs.X1 = true;
  state = executeScanCycle(program, state, 20);
  assert.equal(Boolean(state.conductingCells?.[cellKey(0, 0, 1)]), false);

  // Release X1 = 0 and press X0 = 1 -> both conduct and Y0 energizes
  state.inputs.X1 = false;
  state.inputs.X0 = true;
  state = executeScanCycle(program, state, 20);
  assert.equal(Boolean(state.conductingCells?.[cellKey(0, 0, 0)]), true);
  assert.equal(Boolean(state.conductingCells?.[cellKey(0, 0, 1)]), true);
  assert.equal(Boolean(state.energizedCells[cellKey(0, 0, 8)]), true);
  assert.equal(state.outputs.Y0, true);
});

test('Phase 8 QuickCommandBar Parser: Parses Delta WPLSoft instructions accurately and rejects invalid syntax/octal', () => {
  const ld = parseQuickCommand('ld x0', 'DVP-SX2');
  assert.equal(ld.valid, true);
  if (ld.valid) {
    assert.deepEqual(ld.element, { kind: 'CONTACT', contactType: 'NO', address: 'X0' });
    assert.equal(ld.isParallelOr, false);
  }

  const orY0 = parseQuickCommand('OR Y0', 'DVP-SX2');
  assert.equal(orY0.valid, true);
  if (orY0.valid) {
    assert.deepEqual(orY0.element, { kind: 'CONTACT', contactType: 'NO', address: 'Y0' });
    assert.equal(orY0.isParallelOr, true);
  }

  const cmp = parseQuickCommand('LD>= T0 K300', 'DVP-SX2');
  assert.equal(cmp.valid, true);
  if (cmp.valid) {
    assert.deepEqual(cmp.element, { kind: 'COMPARE', operator: '>=', operandA: 'T0', operandB: 'K300' });
    assert.equal(cmp.targetScope, 'logic');
  }

  const tmr = parseQuickCommand('TMR T200 K50', 'DVP-SX2');
  assert.equal(tmr.valid, true);
  if (tmr.valid) {
    assert.deepEqual(tmr.element, { kind: 'TMR', address: 'T200', preset: 'K50' });
    assert.equal(tmr.targetScope, 'output');
  }

  const mov = parseQuickCommand('MOV K10 D0', 'DVP-SX2');
  assert.equal(mov.valid, true);
  if (mov.valid) {
    assert.deepEqual(mov.element, { kind: 'MOV', source: 'K10', destination: 'D0' });
  }

  const add = parseQuickCommand('ADD D0 K5 D1', 'DVP-SX2');
  assert.equal(add.valid, true);
  if (add.valid) {
    assert.deepEqual(add.element, {
      kind: 'MATH',
      operator: 'ADD',
      source1: 'D0',
      source2: 'K5',
      destination: 'D1',
    });
  }

  const alt = parseQuickCommand('ALT M0', 'DVP-SX2');
  assert.equal(alt.valid, true);

  const zrst = parseQuickCommand('ZRST Y0 Y5', 'DVP-SX2');
  assert.equal(zrst.valid, true);

  // Invalid octal address X8 must be rejected
  const badOctal = parseQuickCommand('LD X8', 'DVP-SX2');
  assert.equal(badOctal.valid, false);

  // Unknown opcode must be rejected
  const badOp = parseQuickCommand('FOOBAR X0', 'DVP-SX2');
  assert.equal(badOp.valid, false);
});

// ============================================================================
// PHASE 9 TESTS: Audit Fixes, Atomic Undo/Redo, Model Gating, Strict JSON,
// Search/Cross-Reference, Diagnostic Coords & Mobile Editor Logic
// ============================================================================

test('Atomic Undo/Redo history reducer records single entries with zero StrictMode duplicates', () => {
  const initial = createBlankProgram('DVP-SX2', 'History_Test', 1);
  let hist = createInitialHistory(initial);
  assert.equal(hist.past.length, 0);
  assert.equal(hist.future.length, 0);

  hist = commitHistory(hist, (p) =>
    placeElementOnProgram(
      p,
      { rungIndex: 0, rowIndex: 0, colIndex: 0 },
      { kind: 'CONTACT', contactType: 'NO', address: 'X0' },
      'Start'
    )
  );
  assert.equal(hist.past.length, 1);
  assert.equal(hist.future.length, 0);

  hist = commitHistory(hist, (p) =>
    placeElementOnProgram(
      p,
      { rungIndex: 0, rowIndex: 0, colIndex: LADDER_COIL_COLUMN },
      { kind: 'COIL', coilType: 'OUT', address: 'Y0' },
      'Motor'
    )
  );
  assert.equal(hist.past.length, 2);

  // Undo once -> back to step1
  hist = undoHistory(hist);
  assert.equal(hist.past.length, 1);
  assert.equal(hist.future.length, 1);
  assert.equal(hist.present.rungs[0].rows[0][LADDER_COIL_COLUMN].element.kind, 'EMPTY');
  assert.equal(hist.present.rungs[0].rows[0][0].element.kind, 'CONTACT');

  // Undo twice -> back to initial
  hist = undoHistory(hist);
  assert.equal(hist.past.length, 0);
  assert.equal(hist.future.length, 2);
  assert.equal(hist.present.rungs[0].rows[0][0].element.kind, 'EMPTY');

  // Redo twice -> restored to step2
  hist = redoHistory(redoHistory(hist));
  assert.equal(hist.past.length, 2);
  assert.equal(hist.future.length, 0);
  assert.equal(hist.present.rungs[0].rows[0][LADDER_COIL_COLUMN].element.kind, 'COIL');
});

test('Ladder editing operations: place, delete, toggleBranchDown, insertRung, deleteRung, and comments', () => {
  let prog = createBlankProgram('DVP-SX2', 'Edit_Ops_Test', 1);
  prog = placeElementOnProgram(
    prog,
    { rungIndex: 0, rowIndex: 0, colIndex: 0 },
    { kind: 'CONTACT', contactType: 'NO', address: 'X0' },
    'Baslat'
  );
  prog = setRungCommentOnProgram(prog, 0, 'Motor Kontrol Devresi');
  assert.equal(prog.rungs[0].comment, 'Motor Kontrol Devresi');
  assert.equal(prog.deviceComments['X0'], 'Baslat');

  // Toggle parallel branch down creates sub-row 1
  prog = toggleBranchDownOnProgram(prog, { rungIndex: 0, rowIndex: 0, colIndex: 0 });
  assert.equal(prog.rungs[0].rows.length, 2);
  assert.equal(prog.rungs[0].rows[0][0].branchDown, true);

  // Insert rung & delete rung
  const ins = insertRungOnProgram(prog, 0);
  assert.equal(ins.newRungIndex, 1);
  prog = ins.program;
  assert.equal(prog.rungs.filter((r) => !r.isEnd).length, 2);
  const del = deleteRungOnProgram(prog, 1);
  prog = del.program;
  assert.equal(prog.rungs.filter((r) => !r.isEnd).length, 1);

  // Delete cell clears element
  prog = deleteCellOnProgram(prog, { rungIndex: 0, rowIndex: 0, colIndex: 0 });
  assert.equal(prog.rungs[0].rows[0][0].element.kind, 'EMPTY');

  // Update & clear device comment
  prog = setDeviceCommentOnProgram(prog, 'y0', 'Ana Kontaktör');
  assert.equal(prog.deviceComments['Y0'], 'Ana Kontaktör');
  prog = setDeviceCommentOnProgram(prog, 'Y0', '   ');
  assert.equal(prog.deviceComments['Y0'], undefined);
});

test('QuickCommand workflow: LD X0 -> OR Y0 -> ANI X1 -> OUT Y0 places OR branch directly under X0 and compiles cleanly', () => {
  let prog = createBlankProgram('DVP-SX2', 'QuickCmd_SealIn', 1);
  let cursor = { rungIndex: 0, rowIndex: 0, colIndex: 0 };

  const steps = ['LD X0', 'OR Y0', 'ANI X1', 'OUT Y0'];
  for (const cmd of steps) {
    const res = applyQuickCommandOnProgram(prog, cursor, cmd);
    assert.equal(res.ok, true, `Failed on ${cmd}: ${res.error}`);
    prog = res.program!;
    cursor = res.nextCursor!;
  }

  // Verify X0 is at (0,0,0) with branchDown=true, Y0 is directly below at (0,1,0), X1 at (0,0,1), OUT Y0 at col 8
  assert.equal(prog.rungs[0].rows[0][0].branchDown, true);
  assert.deepEqual(prog.rungs[0].rows[0][0].element, {
    kind: 'CONTACT',
    contactType: 'NO',
    address: 'X0',
  });
  assert.deepEqual(prog.rungs[0].rows[1][0].element, {
    kind: 'CONTACT',
    contactType: 'NO',
    address: 'Y0',
  });
  assert.deepEqual(prog.rungs[0].rows[0][1].element, {
    kind: 'CONTACT',
    contactType: 'NC',
    address: 'X1',
  });

  const compiled = compileLadderToIl(prog);
  assert.equal(compiled.hasErrors, false, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.rawIlText, ['LD X0', 'OR Y0', 'ANI X1', 'OUT Y0', 'END'].join('\n'));
});

test('Strict JSON import validation rejects corrupted elements, invalid octal X8, unknown models, and bad versions', () => {
  const base = createBlankProgram('DVP-SX2', 'Valid_RoundTrip', 1);
  const placed = placeElementOnProgram(
    base,
    { rungIndex: 0, rowIndex: 0, colIndex: 0 },
    { kind: 'CONTACT', contactType: 'NO', address: 'X0' },
    'Start'
  );
  const validJson = serializeProgramJson(placed);
  const ok = parseProgramJson(validJson);
  assert.equal(ok.success, true);
  assert.equal(ok.program?.projectName, 'Valid_RoundTrip');
  assert.equal(ok.program?.deviceComments['X0'], 'Start');

  // Unknown model must be rejected instead of silently coerced
  const badModel = JSON.parse(validJson);
  badModel.model = 'DVP-999FAKE';
  const badModelRes = parseProgramJson(JSON.stringify(badModel));
  assert.equal(badModelRes.success, false);

  // Invalid version rejected
  const badVer = JSON.parse(validJson);
  badVer.version = '2.0';
  assert.equal(parseProgramJson(JSON.stringify(badVer)).success, false);

  // Invalid octal address X8 inside cell rejected
  const badOctal = JSON.parse(validJson);
  badOctal.rungs[0].rows[0][0].element.address = 'X8';
  assert.equal(parseProgramJson(JSON.stringify(badOctal)).success, false);

  // Unknown cell element kind rejected
  const badKind = JSON.parse(validJson);
  badKind.rungs[0].rows[0][0].element = { kind: 'MAGIC_BLOCK', foo: 'bar' };
  assert.equal(parseProgramJson(JSON.stringify(badKind)).success, false);

  // Missing required operand on TMR rejected
  const badTmr = JSON.parse(validJson);
  badTmr.rungs[0].rows[0][LADDER_COIL_COLUMN].element = { kind: 'TMR', address: 'T0' };
  assert.equal(parseProgramJson(JSON.stringify(badTmr)).success, false);
});

test('PLC model capability enforcement: TRD RTC command accepted on DVP-SX2 and rejected on DVP-14SS2 & DVP-12SA2', () => {
  const il = ['LD M1000', 'TRD D20', 'END'].join('\n');

  // DVP-SX2 has built-in RTC -> allowed across parser, compiler, and quickCommand
  const sx2Parsed = parseIlToLadder(il, 'DVP-SX2', 'RTC_SX2');
  assert.equal(sx2Parsed.success, true);
  const sx2Compiled = compileLadderToIl(sx2Parsed.program!);
  assert.equal(sx2Compiled.hasErrors, false);
  assert.equal(parseQuickCommand('TRD D20', 'DVP-SX2').valid, true);

  // DVP-14SS2 lacks built-in RTC -> rejected in parser, quickCommand, and compiler
  const ss2Parsed = parseIlToLadder(il, 'DVP-14SS2', 'RTC_SS2');
  assert.equal(ss2Parsed.success, false);
  assert.equal(parseQuickCommand('TRD D20', 'DVP-14SS2').valid, false);

  // If a program containing TRD is switched to DVP-12SA2, compiler emits error with exact cell coords
  const switchedToSa2 = { ...sx2Parsed.program!, model: 'DVP-12SA2' as const };
  const sa2Compiled = compileLadderToIl(switchedToSa2);
  assert.equal(sa2Compiled.hasErrors, true);
  const trdDiag = sa2Compiled.diagnostics.find((d) => d.message.includes('TRD'));
  assert.ok(trdDiag, 'Expected TRD unsupported diagnostic');
  assert.equal(trdDiag.rungIndex, 0);
  assert.equal(trdDiag.rowIndex, 0);
  assert.equal(trdDiag.colIndex, LADDER_COIL_COLUMN);
});

test('Compile diagnostics include exact (rungIndex, rowIndex, colIndex) for invalid addresses and Double Coil warnings', () => {
  let prog = createBlankProgram('DVP-SX2', 'Diag_Coords_Test', 2);
  // Rung 0: invalid address X8 at (0,0,0), OUT Y0 at (0,0,8) with auto-bridged HLINE
  prog = placeElementOnProgram(prog, { rungIndex: 0, rowIndex: 0, colIndex: 0 }, { kind: 'CONTACT', contactType: 'NO', address: 'X8' });
  prog = placeElementOnProgram(prog, { rungIndex: 0, rowIndex: 0, colIndex: LADDER_COIL_COLUMN }, { kind: 'COIL', coilType: 'OUT', address: 'Y0' });
  // Rung 1: LD X0 at (1,0,0), duplicate OUT Y0 at (1,0,8) with auto-bridged HLINE
  prog = placeElementOnProgram(prog, { rungIndex: 1, rowIndex: 0, colIndex: 0 }, { kind: 'CONTACT', contactType: 'NO', address: 'X0' });
  prog = placeElementOnProgram(prog, { rungIndex: 1, rowIndex: 0, colIndex: LADDER_COIL_COLUMN }, { kind: 'COIL', coilType: 'OUT', address: 'Y0' });

  const compiled = compileLadderToIl(prog);
  const invalidDiag = compiled.diagnostics.find((d) => d.code === 'INVALID_ADDRESS');
  assert.ok(invalidDiag);
  assert.equal(invalidDiag.rungIndex, 0);
  assert.equal(invalidDiag.rowIndex, 0);
  assert.equal(invalidDiag.colIndex, 0);

  const doubleCoilDiag = compiled.diagnostics.find((d) => d.code === 'DOUBLE_COIL');
  assert.ok(doubleCoilDiag);
  assert.equal(doubleCoilDiag.rungIndex, 1);
  assert.equal(doubleCoilDiag.rowIndex, 0);
  assert.equal(doubleCoilDiag.colIndex, LADDER_COIL_COLUMN);
});

test('IL parser preserves standalone // and ; comment lines as Ladder Segment Comments', () => {
  const ilWithComments = [
    '// Motor Mühürleme Devresi',
    'LD X0',
    'OR Y0',
    'ANI X1',
    'OUT Y0',
    '; Zamanlayıcı Ağı',
    'LD Y0',
    'TMR T0 K50',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(ilWithComments, 'DVP-SX2', 'Comment_Test');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.program?.rungs[0].comment, 'Motor Mühürleme Devresi');
  assert.equal(parsed.program?.rungs[1].comment, 'Zamanlayıcı Ağı');
});

test('Wiring analyzer respects PLC model limits and exposes modelMismatchWarning + hardwareNotice', () => {
  // DVP-12SA2 has only 4 onboard outputs (Y0..Y3), so Y4 must be flagged as expansion + mismatch warning
  const sa2Il = ['LD X0', 'OUT Y4', 'END'].join('\n');
  const parsed = parseIlToLadder(sa2Il, 'DVP-12SA2', 'SA2_Wiring_Test');
  assert.equal(parsed.success, true);

  const plan = analyzeProgramWiring(parsed.program!, 'led');
  assert.ok(plan.modelMismatchWarning && plan.modelMismatchWarning.includes('DVP-12SA2'));
  assert.ok(plan.hardwareNotice.length > 20);
  assert.ok(plan.expansionDevices.includes('Y4'));

  // On DVP-SX2, Y4 is onboard and modelMismatchWarning is absent
  const sx2Plan = analyzeProgramWiring({ ...parsed.program!, model: 'DVP-SX2' }, 'led');
  assert.equal(sx2Plan.modelMismatchWarning, undefined);
  assert.equal(sx2Plan.expansionDevices.includes('Y4'), false);
});

test('Search & Cross-Reference finds addresses, opcodes, comments, and accurately counts reads vs writes', () => {
  const traffic = getTemplateById('traffic-light').buildProgram('DVP-SX2');

  // Search by address 'T0'
  const t0Hits = searchLadderProgram(traffic, 'T0');
  assert.ok(t0Hits.length >= 6, `Expected >=6 matches for T0, got ${t0Hits.length}`);

  // Search by opcode 'ALT'
  const altHits = searchLadderProgram(traffic, 'ALT');
  assert.equal(altHits.length, 1);
  assert.equal(altHits[0].rungIndex, 0);
  assert.equal(altHits[0].colIndex, LADDER_COIL_COLUMN);

  // Cross-reference lists Y0, Y1, Y2, T0, M0, X0 with proper read/write separation
  const crossRef = buildAddressCrossReference(traffic);
  const m0Entry = crossRef.find((e) => e.address === 'M0');
  assert.ok(m0Entry);
  assert.ok(m0Entry.writeCount >= 1, 'ALT M0 writes M0');
  assert.ok(m0Entry.readCount >= 2, 'M0 is read as contact');

  const y2Entry = crossRef.find((e) => e.address === 'Y2');
  assert.ok(y2Entry);
  assert.equal(y2Entry.writeCount, 1, 'Corrected traffic light writes Y2 in a single coil');
});

test('nextOctalAddress respects model maxOctalIo when modelId is provided', () => {
  assert.equal(nextOctalAddress('X7'), 'X10');
  assert.equal(nextOctalAddress('X17'), null); // Default cap returns null
  assert.equal(nextOctalAddress('X17', 'DVP-SX2'), 'X20'); // SX2 expanded octal range
  assert.equal(nextOctalAddress('X377', 'DVP-SX2'), null); // SX2 max octal cap returns null
});

test('Rung ID uniqueness: generated rung IDs never collide with legacy rung-1/rung-2 and parseProgramJson heals duplicate keys', () => {
  const base = createBlankProgram('DVP-SX2', 'Key_Uniqueness_Test', 2);
  // Simulate legacy localStorage draft containing duplicate rung-1 & rung-2 IDs
  const corrupted = {
    ...base,
    rungs: [
      { ...base.rungs[0], id: 'rung-1' },
      { ...base.rungs[1], id: 'rung-1' },
      { ...base.rungs[0], id: 'rung-2' },
      { ...base.rungs[1], id: 'rung-2' },
      base.rungs[2],
    ],
  };

  const parsed = parseProgramJson(JSON.stringify(corrupted));
  assert.equal(parsed.success, true, parsed.error);
  const loaded = parsed.program!;
  const loadedIds = loaded.rungs.map((r) => r.id);
  assert.equal(
    new Set(loadedIds).size,
    loadedIds.length,
    `Expected all loaded rung IDs to be unique, got: ${loadedIds.join(', ')}`
  );

  // Inserting additional rungs must also produce strictly unique IDs never colliding with rung-1/rung-2
  const inserted1 = insertRungOnProgram(loaded, 0);
  const inserted2 = insertRungOnProgram(inserted1.program, 1);
  const finalIds = inserted2.program.rungs.map((r) => r.id);
  assert.equal(
    new Set(finalIds).size,
    finalIds.length,
    `Expected all rung IDs after insert to be unique, got: ${finalIds.join(', ')}`
  );
  assert.ok(!finalIds.slice(-3).includes('rung-1'));
});

test('Undo/Redo StrictMode purity: deterministic external timestamp, double-invocation idempotency, single entry per edit, and 40-step cap', () => {
  const initial = createBlankProgram('DVP-SX2', 'StrictMode_Undo_Test', 1);
  let hist = createInitialHistory(initial);

  // Simulate React 19 StrictMode invoking every state updater twice with the same `prev`
  const strictApply = <T,>(state: T, updater: (prev: T) => T): T => {
    const first = updater(state);
    const second = updater(state);
    assert.deepEqual(first, second, 'State updater must be 100% pure under React StrictMode');
    return second;
  };

  // 1. Add single contact X0 and undo once
  const ts1 = '2026-01-01T10:00:01.000Z';
  hist = strictApply(hist, (prev) =>
    commitHistory(
      prev,
      (curr) =>
        placeElementOnProgram(
          curr,
          { rungIndex: 0, rowIndex: 0, colIndex: 0 },
          { kind: 'CONTACT', contactType: 'NO', address: 'X0' }
        ),
      ts1
    )
  );
  assert.equal(hist.past.length, 1);
  assert.equal(hist.future.length, 0);
  assert.equal(hist.present.updatedAt, ts1);
  assert.equal(hist.lastTransition?.kind, 'commit');
  assert.equal(hist.lastTransition?.seq, 1);

  hist = strictApply(hist, (prev) => undoHistory(prev));
  assert.equal(hist.past.length, 0);
  assert.equal(hist.future.length, 1);
  assert.equal(hist.present.rungs[0].rows[0][0].element.kind, 'EMPTY');
  assert.equal(hist.lastTransition?.kind, 'undo');
  assert.equal(hist.lastTransition?.seq, 2);

  // Undo on empty past is a strict no-op (same reference, no transition advance)
  const noopUndo = strictApply(hist, (prev) => undoHistory(prev));
  assert.equal(noopUndo, hist);

  // 2. Redo restores X0 cleanly
  hist = strictApply(hist, (prev) => redoHistory(prev));
  assert.equal(hist.past.length, 1);
  assert.equal(hist.future.length, 0);
  assert.equal(hist.present.rungs[0].rows[0][0].element.kind, 'CONTACT');
  assert.equal(hist.lastTransition?.kind, 'redo');
  assert.equal(hist.lastTransition?.seq, 3);

  // Redo on empty future is a strict no-op
  const noopRedo = strictApply(hist, (prev) => redoHistory(prev));
  assert.equal(noopRedo, hist);

  // 3. Multiple sequential contacts + sequential undo + new edit clears future
  const ts2 = '2026-01-01T10:00:02.000Z';
  const ts3 = '2026-01-01T10:00:03.000Z';
  hist = strictApply(hist, (prev) =>
    commitHistory(
      prev,
      (curr) =>
        placeElementOnProgram(
          curr,
          { rungIndex: 0, rowIndex: 0, colIndex: 1 },
          { kind: 'CONTACT', contactType: 'NC', address: 'X1' }
        ),
      ts2
    )
  );
  hist = strictApply(hist, (prev) =>
    commitHistory(
      prev,
      (curr) =>
        placeElementOnProgram(
          curr,
          { rungIndex: 0, rowIndex: 0, colIndex: LADDER_COIL_COLUMN },
          { kind: 'COIL', coilType: 'OUT', address: 'Y0' }
        ),
      ts3
    )
  );
  assert.equal(hist.past.length, 3);

  // Undo twice (removes OUT Y0 and ANI X1)
  hist = strictApply(hist, (prev) => undoHistory(prev));
  hist = strictApply(hist, (prev) => undoHistory(prev));
  assert.equal(hist.past.length, 1);
  assert.equal(hist.future.length, 2);
  assert.equal(hist.present.rungs[0].rows[0][1].element.kind, 'EMPTY');

  // New edit via commitHistoryFromSnapshot clears future
  const baseBeforeModal = hist.present;
  const afterModal = placeElementOnProgram(
    baseBeforeModal,
    { rungIndex: 0, rowIndex: 0, colIndex: 1 },
    { kind: 'CONTACT', contactType: 'NO', address: 'X2' }
  );
  hist = strictApply(hist, (prev) =>
    commitHistoryFromSnapshot(prev, baseBeforeModal, afterModal, '2026-01-01T10:00:04.000Z')
  );
  assert.equal(hist.future.length, 0);
  assert.equal(hist.past.length, 2);
  assert.equal(
    hist.present.rungs[0].rows[0][1].element.kind === 'CONTACT'
      ? hist.present.rungs[0].rows[0][1].element.address
      : '',
    'X2'
  );

  // 4. Rapid consecutive edits respect MAX_HISTORY_DEPTH (40)
  for (let i = 0; i < MAX_HISTORY_DEPTH + 12; i += 1) {
    const label = `Etiket_${i}`;
    hist = strictApply(hist, (prev) =>
      commitHistory(
        prev,
        (curr) => setDeviceCommentOnProgram(curr, 'X0', label),
        `2026-01-01T10:01:${String(i).padStart(2, '0')}.000Z`
      )
    );
  }
  assert.equal(hist.past.length, MAX_HISTORY_DEPTH);
  assert.equal(hist.future.length, 0);
});

test('OR / ORI / ORP / ORF / OR-compare rejected on blank rung and invalid columns (never falls back to LD)', () => {
  const blank = createBlankProgram('DVP-SX2', 'OR_Reject_Test', 1);
  const startCursor = { rungIndex: 0, rowIndex: 0, colIndex: 0 };

  for (const cmd of ['OR Y0', 'ORI X1', 'ORP X2', 'ORF X3', 'OR= D0 K10', 'OR>= T0 K50']) {
    const res = applyQuickCommandOnProgram(blank, startCursor, cmd);
    assert.equal(res.ok, false, `Expected ${cmd} to fail on blank rung`);
    assert.ok(res.error && res.error.length > 10, `Expected clear Turkish error for ${cmd}`);
  }

  // Disconnected column (col 3 on a rung that only has LD X0 at col 0 -> gap at col 1..2)
  const afterLd = applyQuickCommandOnProgram(blank, startCursor, 'LD X0');
  assert.equal(afterLd.ok, true);
  const badColRes = applyQuickCommandOnProgram(
    afterLd.program,
    { rungIndex: 0, rowIndex: 0, colIndex: 3 },
    'OR Y0'
  );
  assert.equal(badColRes.ok, false, 'OR at disconnected column 3 must be rejected');

  // Cursor placed directly on an empty cell at col 0 of a second empty rung must also reject OR
  const twoRung = createBlankProgram('DVP-SX2', 'OR_Rung2_Blank', 2);
  const resRung1 = applyQuickCommandOnProgram(
    twoRung,
    { rungIndex: 1, rowIndex: 0, colIndex: 0 },
    'OR M0'
  );
  assert.equal(resRung1.ok, false);
});

test('Consecutive OR / ORI / ORP / ORF / parallel compare, multi-column ANB, and multiple parallel branches compile cleanly', () => {
  // Case A: Consecutive OR + ORI + ORP + ORF + OR>= on col 0 -> AND X5 -> OUT Y0
  let progA = createBlankProgram('DVP-SX2', 'Multi_OR_Stack', 1);
  let curA = { rungIndex: 0, rowIndex: 0, colIndex: 0 };
  for (const cmd of ['LD X0', 'OR Y0', 'ORI M0', 'ORP X1', 'ORF X2', 'OR>= D0 K10', 'AND X5', 'OUT Y0']) {
    const res = applyQuickCommandOnProgram(progA, curA, cmd);
    assert.equal(res.ok, true, `Failed on ${cmd}: ${res.error}`);
    progA = res.program;
    curA = res.nextCursor;
  }
  const compA = compileLadderToIl(progA);
  assert.equal(compA.hasErrors, false, JSON.stringify(compA.diagnostics));
  assert.equal(
    compA.rawIlText,
    ['LD X0', 'OR Y0', 'ORI M0', 'ORP X1', 'ORF X2', 'OR>= D0 K10', 'AND X5', 'OUT Y0', 'END'].join('\n')
  );

  // Case B: OR at column 1 after series contact (LD X0 -> AND X1 -> OR X2 -> AND X3 -> OUT Y0) -> exact ANB
  let progB = createBlankProgram('DVP-SX2', 'Col1_ANB', 1);
  let curB = { rungIndex: 0, rowIndex: 0, colIndex: 0 };
  for (const cmd of ['LD X0', 'AND X1', 'OR X2', 'AND X3', 'OUT Y0']) {
    const res = applyQuickCommandOnProgram(progB, curB, cmd);
    assert.equal(res.ok, true, `Failed on ${cmd}: ${res.error}`);
    progB = res.program;
    curB = res.nextCursor;
  }
  const compB = compileLadderToIl(progB);
  assert.equal(compB.hasErrors, false, JSON.stringify(compB.diagnostics));
  assert.equal(
    compB.rawIlText,
    ['LD X0', 'LD X1', 'OR X2', 'ANB', 'AND X3', 'OUT Y0', 'END'].join('\n')
  );

  // Case C: Two separate parallel blocks in the same rung (LD X0 OR Y0) AND (X1 OR X2) -> OUT Y0
  let progC = createBlankProgram('DVP-SX2', 'Two_Parallel_Blocks', 1);
  let curC = { rungIndex: 0, rowIndex: 0, colIndex: 0 };
  for (const cmd of ['LD X0', 'OR Y0', 'AND X1', 'OR X2', 'OUT Y0']) {
    const res = applyQuickCommandOnProgram(progC, curC, cmd);
    assert.equal(res.ok, true, `Failed on ${cmd}: ${res.error}`);
    progC = res.program;
    curC = res.nextCursor;
  }
  const compC = compileLadderToIl(progC);
  assert.equal(compC.hasErrors, false, JSON.stringify(compC.diagnostics));
  assert.equal(
    compC.rawIlText,
    ['LD X0', 'OR Y0', 'LD X1', 'OR X2', 'ANB', 'OUT Y0', 'END'].join('\n')
  );

  // Case D: Full logic row (cols 0..7 occupied) refuses silent overwrite on 9th logic command
  let progD = createBlankProgram('DVP-SX2', 'Full_Row_Guard', 1);
  let curD = { rungIndex: 0, rowIndex: 0, colIndex: 0 };
  const eight = ['LD X0', 'AND X1', 'AND X2', 'AND X3', 'AND X4', 'AND X5', 'AND X6', 'AND X7'];
  for (const cmd of eight) {
    const res = applyQuickCommandOnProgram(progD, curD, cmd);
    assert.equal(res.ok, true, `Failed on ${cmd}: ${res.error}`);
    progD = res.program;
    curD = res.nextCursor;
  }
  const ninth = applyQuickCommandOnProgram(progD, curD, 'AND M0');
  assert.equal(ninth.ok, false, '9th logic element must not overwrite column 7');
  assert.equal(
    progD.rungs[0].rows[0][7].element.kind === 'CONTACT'
      ? progD.rungs[0].rows[0][7].element.address
      : '',
    'X7'
  );
});

test('Strengthened JSON import validation catches corrupted branchDown, isEnd, versions, END rung anomalies, column errors, and oversized files while keeping valid v1.0 compatibility', () => {
  const base = createBlankProgram('DVP-SX2', 'Strict_JSON_Test', 1);
  const withContact = placeElementOnProgram(
    base,
    { rungIndex: 0, rowIndex: 0, colIndex: 0 },
    { kind: 'CONTACT', contactType: 'NO', address: 'X0' },
    'Baslat'
  );
  const validObj = JSON.parse(serializeProgramJson(withContact));

  // 1. Corrupted branchDown (string, number, missing)
  for (const badVal of ['true', 1, null, undefined]) {
    const clone = structuredClone(validObj);
    if (badVal === undefined) {
      delete clone.rungs[0].rows[0][0].branchDown;
    } else {
      clone.rungs[0].rows[0][0].branchDown = badVal;
    }
    const res = parseProgramJson(JSON.stringify(clone));
    assert.equal(res.success, false, `branchDown=${String(badVal)} must be rejected`);
  }

  // 2. Corrupted isEnd (string, number, object)
  for (const badEnd of ['true', 'false', 1, {}]) {
    const clone = structuredClone(validObj);
    clone.rungs[0].isEnd = badEnd;
    const res = parseProgramJson(JSON.stringify(clone));
    assert.equal(res.success, false, `isEnd=${JSON.stringify(badEnd)} must be rejected`);
  }

  // 3. Invalid schema versions
  for (const badVer of ['1.1', '2.0', 1, '', undefined]) {
    const clone = structuredClone(validObj);
    if (badVer === undefined) delete clone.version;
    else clone.version = badVer;
    const res = parseProgramJson(JSON.stringify(clone));
    assert.equal(res.success, false, `version=${String(badVer)} must be rejected`);
  }

  // 4. Multiple END rungs
  {
    const clone = structuredClone(validObj);
    clone.rungs.push(structuredClone(clone.rungs[clone.rungs.length - 1]));
    clone.rungs[clone.rungs.length - 1].id = 'rung-end-dup';
    const res = parseProgramJson(JSON.stringify(clone));
    assert.equal(res.success, false, 'Multiple END rungs must be rejected');
  }

  // 5. END rung in the middle
  {
    const clone = structuredClone(validObj);
    const endRung = clone.rungs.pop();
    clone.rungs.unshift(endRung);
    const res = parseProgramJson(JSON.stringify(clone));
    assert.equal(res.success, false, 'END rung not at final position must be rejected');
  }

  // 6. Missing END rung
  {
    const clone = structuredClone(validObj);
    clone.rungs.pop();
    const res = parseProgramJson(JSON.stringify(clone));
    assert.equal(res.success, false, 'Program without END rung must be rejected');
  }

  // 7. END element placed inside non-END rung
  {
    const clone = structuredClone(validObj);
    clone.rungs[0].rows[0][LADDER_COIL_COLUMN].element = { kind: 'END' };
    const res = parseProgramJson(JSON.stringify(clone));
    assert.equal(res.success, false, 'END element in non-END rung must be rejected');
  }

  // 8. Extra columns (10) and missing columns (8) and wrong columns metadata
  {
    const extra = structuredClone(validObj);
    extra.rungs[0].rows[0].push({ element: { kind: 'EMPTY' }, branchDown: false });
    assert.equal(parseProgramJson(JSON.stringify(extra)).success, false);

    const missing = structuredClone(validObj);
    missing.rungs[0].rows[0].pop();
    assert.equal(parseProgramJson(JSON.stringify(missing)).success, false);

    const badColMeta = structuredClone(validObj);
    badColMeta.columns = 10;
    assert.equal(parseProgramJson(JSON.stringify(badColMeta)).success, false);
  }

  // 9. Column role mismatch: COIL in logic col 0 or CONTACT in output col 8
  {
    const coilInLogic = structuredClone(validObj);
    coilInLogic.rungs[0].rows[0][0].element = { kind: 'COIL', coilType: 'OUT', address: 'Y0' };
    assert.equal(parseProgramJson(JSON.stringify(coilInLogic)).success, false);

    const contactInCoil = structuredClone(validObj);
    contactInCoil.rungs[0].rows[0][LADDER_COIL_COLUMN].element = {
      kind: 'CONTACT',
      contactType: 'NO',
      address: 'X0',
    };
    assert.equal(parseProgramJson(JSON.stringify(contactInCoil)).success, false);
  }

  // 10. Oversized JSON (> MAX_PROJECT_JSON_BYTES) rejected safely
  {
    const oversized = `{"version":"1.0","pad":"${'x'.repeat(MAX_PROJECT_JSON_BYTES + 128)}"}`;
    const res = parseProgramJson(oversized);
    assert.equal(res.success, false);
    assert.ok(res.error && res.error.includes('MB'));
  }

  // 11. Valid legacy v1.0 file (omits optional columns, updatedAt, deviceComments, and isEnd on normal rung) loads cleanly
  {
    const legacy = structuredClone(validObj);
    legacy.model = 'DVP-14SS2';
    delete legacy.columns;
    delete legacy.updatedAt;
    delete legacy.deviceComments;
    delete legacy.rungs[0].isEnd;
    const res = parseProgramJson(JSON.stringify(legacy));
    assert.equal(res.success, true, `Legacy v1.0 project should load cleanly: ${res.error}`);
    assert.equal(res.program?.model, 'DVP-14SS2');
    assert.equal(res.program?.columns, 9);
  }
});

test('Audit 3: Deterministic history without timestamp uses existing updatedAt (zero Date() non-determinism)', () => {
  const base = createBlankProgram('DVP-SX2', 'Pure_History', 1);
  base.updatedAt = '2026-01-01T00:00:00.000Z';
  const h0 = createInitialHistory(base);

  const h1 = commitHistory(h0, (cur) => ({ ...cur, projectName: 'Updated_A' }));
  assert.equal(h1.present.updatedAt, '2026-01-01T00:00:00.000Z');

  const modified = { ...base, projectName: 'Updated_B' };
  const h2 = commitHistoryFromSnapshot(h1, base, modified);
  assert.equal(h2.present.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('Audit 3: JSON import enforces MAX_PROJECT_JSON_BYTES by UTF-8 byte length on Turkish multi-byte text', () => {
  const base = createBlankProgram('DVP-SX2', 'Turkce_Boyut_Testi', 1);
  const templateJson = serializeProgramJson(base);
  const charCount = 1_100_000; // 1.1M chars < 2MB char limit, yet ~2.2MB UTF-8 bytes > MAX_PROJECT_JSON_BYTES
  const multiByteObj = JSON.parse(templateJson) as LadderProgram;
  multiByteObj.deviceComments = { X0: 'ğ'.repeat(charCount) };
  const payload = JSON.stringify(multiByteObj);

  assert.ok(payload.length < MAX_PROJECT_JSON_BYTES, 'UTF-16 char length should be under 2M');
  assert.ok(
    new TextEncoder().encode(payload).length > MAX_PROJECT_JSON_BYTES,
    'UTF-8 byte length should exceed 2 MB'
  );

  const rejected = parseProgramJson(payload);
  assert.equal(rejected.success, false);
  assert.ok(rejected.error && rejected.error.includes('bayt'));
});

test('Audit 3: Nested MPS / MRD / MPP parses cleanly and round-trips Ladder <-> IL', () => {
  const nestedIl = [
    'LD M0',
    'AND M14',
    'MPS',
    'SET Y1',
    'MRD',
    'TMR T1 K20',
    'MPP',
    'AND T1',
    'MPS',
    'RST Y1',
    'MRD',
    'CNT C0 K4',
    'MPP',
    'AND C0',
    'SET M15',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(nestedIl, 'DVP-SX2', 'Nested_MPS_Test');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const compiled = compileLadderToIl(parsed.program!);
  assert.equal(compiled.hasErrors, false, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.rawIlText, nestedIl);

  // Also test parent MRD after a completed nested MPS...MPP branch
  const parentMrdIl = [
    'LD X0',
    'MPS',
    'AND X1',
    'MPS',
    'OUT Y0',
    'MPP',
    'OUT Y1',
    'MRD',
    'OUT Y2',
    'MPP',
    'OUT Y3',
    'END',
  ].join('\n');
  const parsedParent = parseIlToLadder(parentMrdIl, 'DVP-SX2', 'Parent_MRD_Nested');
  assert.equal(parsedParent.success, true, JSON.stringify(parsedParent.errors));
  const recompiled = compileLadderToIl(parsedParent.program!);
  assert.equal(recompiled.hasErrors, false, JSON.stringify(recompiled.diagnostics));
  // Compiler canonicalizes equal-prefix outputs cleanly and round-trips identically
  const reParsedParent = parseIlToLadder(recompiled.rawIlText, 'DVP-SX2', 'Parent_MRD_Nested_2');
  assert.equal(reParsedParent.success, true, JSON.stringify(reParsedParent.errors));
  assert.equal(compileLadderToIl(reParsedParent.program!).rawIlText, recompiled.rawIlText);
});

test('DENEY 1-2 (PLC Temel Komutlar ve TMR Komutu): Y1 20s -> Y2 10s -> Y3 until X1 stop', () => {
  const deney12Il = [
    'LD X0',
    'MPS',
    'ANI T0',
    'OUT Y1',
    'MPP',
    'TMR T0 K200',
    'LD T0',
    'MPS',
    'ANI T1',
    'OUT Y2',
    'MPP',
    'TMR T1 K100',
    'LD T1',
    'ANI X1',
    'OUT Y3',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(deney12Il, 'DVP-SX2', 'Deney_1_2');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;
  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false, JSON.stringify(compiled.diagnostics));

  let state = createInitialSimState({ X0: true, X1: false });
  // Step 10s: Y1 active
  state = executeScanCycle(program, state, 10000);
  assert.equal(state.outputs['Y1'], true);
  assert.equal(state.outputs['Y2'], false);
  assert.equal(state.outputs['Y3'], false);
  assert.equal(state.timers['T0']?.currentValue, 100);

  // Step 10s more in 5s steps so T0 finishes at 20s; next scan updates ANI T0 -> Y1 OFF and starts T1
  state = executeScanCycle(program, state, 5000);
  state = executeScanCycle(program, state, 5000);
  assert.equal(state.timers['T0']?.done, true);
  state = executeScanCycle(program, state, 20);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], true);
  assert.equal(state.outputs['Y3'], false);

  // Step 5s more -> T1 hits 10s; next 20ms scan updates ANI T1 -> Y2 off and turns Y3 active
  state = executeScanCycle(program, state, 5000);
  assert.equal(state.timers['T1']?.done, true);
  state = executeScanCycle(program, state, 20);
  assert.equal(state.outputs['Y2'], false);
  assert.equal(state.outputs['Y3'], true);

  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  assert.equal(state.outputs['Y3'], false);
});

test('DENEY 3 (PLC ile Sayıcı Uygulaması): 45 pulses on X0 drive Y0 via CNT C1 K45 and X1 resets', () => {
  const deney3Il = [
    'LD X0',
    'CNT C1 K45',
    'LD C1',
    'OUT Y0',
    'LD X1',
    'RST C1',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(deney3Il, 'DVP-SX2', 'Deney_3_Sayici');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;
  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false, JSON.stringify(compiled.diagnostics));

  let state = createInitialSimState();
  for (let p = 0; p < 44; p += 1) {
    state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
    state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: false } }, 20);
    assert.equal(state.outputs['Y0'], false, `Pulse ${p + 1} must not trigger Y0 yet`);
  }
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X0: true } }, 20);
  assert.equal(state.counters['C1']?.currentValue, 45);
  assert.equal(state.counters['C1']?.done, true);
  assert.equal(state.outputs['Y0'], true);

  // Press X1 (Rung 2 RST C1 runs after Rung 1 OUT Y0, so Y0 turns OFF on next scan)
  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X0: false, X1: true } },
    20
  );
  assert.equal(state.counters['C1']?.currentValue, 0);
  state = executeScanCycle(program, state, 20);
  assert.equal(state.outputs['Y0'], false);
});

test('DENEY 4 (PLC ile Çamaşır Makinesi Uygulaması): Full 8-rung washing cycle with nested MPS, CNT C0 K4 + AND C0, and ZRST Y0 Y5', () => {
  const deney4Il = [
    'LD X0',
    'SET M0',
    'LD M0',
    'ANI M10',
    'MPS',
    'SET Y2',
    'MPP',
    'AND X1',
    'MPS',
    'RST Y2',
    'MRD',
    'SET M10',
    'MPP',
    'SET M11',
    'LD M0',
    'AND M11',
    'MPS',
    'SET Y5',
    'MPP',
    'AND X2',
    'MPS',
    'RST Y5',
    'MRD',
    'RST M11',
    'MPP',
    'SET M12',
    'LD M0',
    'AND M12',
    'MPS',
    'SET Y3',
    'MRD',
    'TMR T3 K50',
    'MPP',
    'AND T3',
    'MPS',
    'RST Y3',
    'MRD',
    'RST M12',
    'MPP',
    'SET M13',
    'LD M0',
    'AND M13',
    'MPS',
    'SET Y0',
    'MRD',
    'TMR T0 K20',
    'MPP',
    'AND T0',
    'MPS',
    'RST Y0',
    'MRD',
    'RST M13',
    'MPP',
    'SET M14',
    'LD M0',
    'AND M14',
    'MPS',
    'SET Y1',
    'MRD',
    'TMR T1 K20',
    'MPP',
    'AND T1',
    'MPS',
    'RST Y1',
    'MRD',
    'RST M14',
    'MRD',
    'SET M13',
    'MRD',
    'CNT C0 K4',
    'MPP',
    'AND C0',
    'MPS',
    'RST M13',
    'MPP',
    'SET M15',
    'LD M0',
    'AND M15',
    'MPS',
    'SET Y4',
    'MRD',
    'TMR T2 K100',
    'MPP',
    'AND T2',
    'MPS',
    'RST Y4',
    'MRD',
    'RST M15',
    'MPP',
    'SET M16',
    'LD M0',
    'AND M16',
    'MPS',
    'ZRST Y0 Y5',
    'MPP',
    'RST M0',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(deney4Il, 'DVP-SX2', 'Deney_4_Camasir_Makinesi');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;
  assert.equal(parsed.parsedRungCount, 8);

  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false, JSON.stringify(compiled.diagnostics));

  const reparsed = parseIlToLadder(compiled.rawIlText, 'DVP-SX2', 'Deney_4_RoundTrip');
  assert.equal(reparsed.success, true, JSON.stringify(reparsed.errors));

  let state = createInitialSimState({ X0: true });
  state = executeScanCycle(program, state, 20);
  assert.equal(state.relays['M0'], true);
  assert.equal(state.outputs['Y2'], true);

  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X0: false, X1: true } },
    20
  );
  assert.equal(state.outputs['Y2'], false);
  assert.equal(state.outputs['Y5'], true);

  state = executeScanCycle(
    program,
    { ...state, inputs: { ...state.inputs, X1: false, X2: true } },
    20
  );
  assert.equal(state.outputs['Y5'], false);
  assert.equal(state.outputs['Y3'], true);

  const stepMs = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) {
      state = executeScanCycle(program, state, 20);
    }
  };

  stepMs(4960);
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X2: false } }, 20);
  assert.equal(state.outputs['Y3'], false);
  assert.equal(state.outputs['Y0'], true);

  // Run 4 right/left drum cycles in 20ms PLC scan increments so each 2s timer stage is cleanly observed
  for (let cycle = 1; cycle <= 4; cycle += 1) {
    stepMs(1000);
    assert.equal(state.outputs['Y0'], true, `Cycle ${cycle}: Y0 should be active at 1s`);
    stepMs(1000);
    assert.equal(state.outputs['Y0'], false, `Cycle ${cycle}: Y0 should stop at 2s`);
    assert.equal(state.outputs['Y1'], true, `Cycle ${cycle}: Y1 should start at 2s`);

    stepMs(1000);
    assert.equal(state.outputs['Y1'], true, `Cycle ${cycle}: Y1 should remain active at 1s`);
    stepMs(1000);
    assert.equal(state.outputs['Y1'], false, `Cycle ${cycle}: Y1 should stop at 2s`);
    assert.equal(state.counters['C0']?.currentValue, cycle);
  }

  assert.equal(state.counters['C0']?.done, true);
  assert.equal(state.relays['M13'], false);
  assert.equal(state.relays['M15'], true);
  assert.equal(state.outputs['Y4'], true);

  stepMs(10020);
  assert.equal(state.outputs['Y0'], false);
  assert.equal(state.outputs['Y1'], false);
  assert.equal(state.outputs['Y2'], false);
  assert.equal(state.outputs['Y3'], false);
  assert.equal(state.outputs['Y4'], false);
  assert.equal(state.outputs['Y5'], false);
  assert.equal(state.relays['M0'], false);
});

test('Security hardening: parseProgramJson rejects prototype-pollution keys and malformed deviceComments', () => {
  const base = createBlankProgram('DVP-SX2', 'Sec_Test', 1);
  const rawBase = JSON.parse(serializeProgramJson(base)) as Record<string, unknown>;

  const maliciousJson = JSON.stringify({
    ...rawBase,
    deviceComments: {
      __proto__: 'polluted',
      X0: 'Start',
    },
  }).replace('"__proto__"', '"__proto__"');

  // Raw JSON string with literal __proto__ property key
  const literalProtoPayload = `{"version":"1.0","projectName":"Sec_Test","model":"DVP-SX2","columns":9,"rungs":${JSON.stringify(
    base.rungs
  )},"deviceComments":{"__proto__":"polluted","X0":"Start"},"updatedAt":"2026-01-01T00:00:00.000Z"}`;

  const protoRes = parseProgramJson(literalProtoPayload);
  assert.equal(protoRes.success, false);
  assert.match(protoRes.error ?? '', /geçersiz aygıt anahtarı/i);

  const ctorRes = parseProgramJson(
    JSON.stringify({ ...rawBase, deviceComments: { constructor: 'bad' } })
  );
  assert.equal(ctorRes.success, false);

  const invalidKeyRes = parseProgramJson(
    JSON.stringify({ ...rawBase, deviceComments: { '<script>': 'xss' } })
  );
  assert.equal(invalidKeyRes.success, false);

  assert.equal(maliciousJson.length > 0, true);
});

test('Security hardening: parseIlToLadder enforces MAX_IL_LINES bound', () => {
  const oversizedIl = Array.from({ length: MAX_IL_LINES + 5 }, () => 'NOP').join('\n');
  const res = parseIlToLadder(oversizedIl, 'DVP-SX2', 'Oversize_IL');
  assert.equal(res.success, false);
  assert.match(res.errors[0]?.message ?? '', /maksimum satır sayısını/i);
});

test('UX: shouldAutoFocusInput returns false on non-desktop / touch devices', () => {
  assert.equal(shouldAutoFocusInput(), false);
});




