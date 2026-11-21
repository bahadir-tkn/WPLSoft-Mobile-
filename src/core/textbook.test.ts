import test from 'node:test';
import assert from 'node:assert/strict';
import { compileLadderToIl } from './ilCompiler';
import { parseIlToLadder } from './ilParser';
import {
  createInitialSimState,
  decodeFloat32Registers,
  executeScanCycle,
  getTimerTimeBaseMs,
} from './scanner';
import { INDUSTRIAL_TEMPLATES } from './templates';
import { parseQuickCommand } from './quickCommand';
import { parseProgramJson } from './storage';
import { SPECIAL_RELAYS } from './plcModels';

test('All built-in templates compile cleanly with zero errors/warnings and round-trip via IL', () => {
  for (const tpl of INDUSTRIAL_TEMPLATES) {
    const program = tpl.buildProgram('DVP-SX2');
    const compiled = compileLadderToIl(program);
    assert.equal(
      compiled.hasErrors,
      false,
      `Template ${tpl.id} compiled with errors: ${JSON.stringify(compiled.diagnostics)}`
    );
    assert.equal(
      compiled.diagnostics.length,
      0,
      `Template ${tpl.id} has diagnostics: ${JSON.stringify(compiled.diagnostics)}`
    );
    assert.ok(compiled.stepCount >= 2, `Template ${tpl.id} stepCount must be >= 2`);

    const reparsed = parseIlToLadder(compiled.rawIlText, program.model, `${tpl.id}_RT`);
    assert.equal(
      reparsed.success,
      true,
      `Template ${tpl.id} IL re-parse failed: ${JSON.stringify(reparsed.errors)}`
    );
    const recompiled = compileLadderToIl(reparsed.program!);
    assert.equal(recompiled.rawIlText, compiled.rawIlText);
  }
});

test('Textbook Ch. 3 & Ch. 8: 1ms retentive timers (T246-T249) vs 10ms (T200-T245) vs 100ms (T0-T199)', () => {
  assert.equal(getTimerTimeBaseMs('T0'), 100);
  assert.equal(getTimerTimeBaseMs('T199'), 100);
  assert.equal(getTimerTimeBaseMs('T200'), 10);
  assert.equal(getTimerTimeBaseMs('T245'), 10);
  assert.equal(getTimerTimeBaseMs('T246'), 1);
  assert.equal(getTimerTimeBaseMs('T249'), 1);

  const il = [
    'LD X0',
    'TMR T246 K1500',
    'LD T246',
    'OUT Y0',
    'END',
  ].join('\n');
  const parsed = parseIlToLadder(il, 'DVP-SX2', 'Timer_1ms');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  let state = createInitialSimState({ X0: true });
  state = executeScanCycle(program, state, 1000);
  assert.equal(state.timers['T246']?.currentValue, 1000);
  assert.equal(state.outputs['Y0'], false);

  state = executeScanCycle(program, state, 500);
  assert.equal(state.timers['T246']?.currentValue, 1500);
  assert.equal(state.timers['T246']?.done, true);
  assert.equal(state.outputs['Y0'], true);
});

test('Textbook Ch. 7 (Örnek 7.5): DMOVR F10.000 D10, DMOVR F16.000 D20, DMULR D10 D20 D30, DESQR D30 D40', () => {
  const il = [
    'LD M1000',
    'DMOVR F10.000 D10',
    'DMOVR F16.000 D20',
    'DMULR D10 D20 D30',
    'DESQR D30 D40',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(il, 'DVP-SX2', 'Ornek_7_5');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;

  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.rawIlText, il);

  let state = createInitialSimState();
  state = executeScanCycle(program, state, 20);

  const f10 = decodeFloat32Registers(state.registers['D10'] ?? 0, state.registers['D11'] ?? 0);
  const f20 = decodeFloat32Registers(state.registers['D20'] ?? 0, state.registers['D21'] ?? 0);
  const f30 = decodeFloat32Registers(state.registers['D30'] ?? 0, state.registers['D31'] ?? 0);
  const f40 = decodeFloat32Registers(state.registers['D40'] ?? 0, state.registers['D41'] ?? 0);

  assert.ok(Math.abs(f10 - 10) < 1e-4, `Expected D10=10, got ${f10}`);
  assert.ok(Math.abs(f20 - 16) < 1e-4, `Expected D20=16, got ${f20}`);
  assert.ok(Math.abs(f30 - 160) < 1e-3, `Expected D30=160, got ${f30}`);
  assert.ok(Math.abs(f40 - Math.sqrt(160)) < 1e-3, `Expected D40=sqrt(160), got ${f40}`);
  assert.equal(state.relays['M1067'], false);
});

test('Textbook Ch. 7: SQR, FLT, DADDR, DSUBR, DDIVR and division-by-zero M1067/M1068 error flags', () => {
  const il = [
    'LD X0',
    'SQR K16 D0',
    'FLT K25 D10',
    'DADDR D10 F2.5 D12',
    'DSUBR D12 F7.5 D14',
    'DDIVR D14 F4.0 D16',
    'LD X1',
    'DIV K10 K0 D20',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(il, 'DVP-SX2', 'Float_Ops');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  const program = parsed.program!;
  assert.equal(compileLadderToIl(program).hasErrors, false);

  let state = createInitialSimState({ X0: true, X1: false });
  state = executeScanCycle(program, state, 20);
  assert.equal(state.registers['D0'], 4);
  assert.ok(
    Math.abs(decodeFloat32Registers(state.registers['D10'] ?? 0, state.registers['D11'] ?? 0) - 25) <
      1e-4
  );
  assert.ok(
    Math.abs(decodeFloat32Registers(state.registers['D12'] ?? 0, state.registers['D13'] ?? 0) - 27.5) <
      1e-4
  );
  assert.ok(
    Math.abs(decodeFloat32Registers(state.registers['D14'] ?? 0, state.registers['D15'] ?? 0) - 20) <
      1e-4
  );
  assert.ok(
    Math.abs(decodeFloat32Registers(state.registers['D16'] ?? 0, state.registers['D17'] ?? 0) - 5) <
      1e-4
  );
  assert.equal(state.relays['M1067'], false);
  assert.equal(state.relays['M1068'], false);

  // Trigger DIV K10 K0 D20 -> M1067 & M1068 turn ON; releasing X1 clears per-scan M1067 while M1068 latches
  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: true } }, 20);
  assert.equal(state.relays['M1067'], true);
  assert.equal(state.relays['M1068'], true);

  state = executeScanCycle(program, { ...state, inputs: { ...state.inputs, X1: false } }, 20);
  assert.equal(state.relays['M1067'], false);
  assert.equal(state.relays['M1068'], true);
});

test('Textbook Ch. 9 (RTC): writable M1016/M1017, TRW alias -> TWR, TWRP, TRD, TZCP, and 14SS2 RTC guard', () => {
  assert.equal(SPECIAL_RELAYS['M1016']?.readOnly, false);
  assert.equal(SPECIAL_RELAYS['M1017']?.readOnly, false);
  assert.equal(SPECIAL_RELAYS['M1000']?.readOnly, true);

  const ilWithTypoAlias = [
    'LD X0',
    'SET M1016',
    'LD M1002',
    'MOV K24 D10',
    'MOV K3 D11',
    'MOV K5 D12',
    'MOV K15 D13',
    'MOV K14 D14',
    'MOV K30 D15',
    'MOV K0 D16',
    'LD X1',
    'TRWP D10',
    'LD M1000',
    'TRD D20',
    'LD M1000',
    'MOV K12 D30',
    'MOV K0 D31',
    'MOV K0 D32',
    'MOV K16 D40',
    'MOV K0 D41',
    'MOV K0 D42',
    'LD M1000',
    'TZCP D30 D40 D24 M0',
    'END',
  ].join('\n');

  const parsed = parseIlToLadder(ilWithTypoAlias, 'DVP-SX2', 'RTC_Chapter9');
  assert.equal(parsed.success, true, JSON.stringify(parsed.errors));
  assert.ok(parsed.warnings.some((w) => w.includes('TRW') && w.includes('TWRP')));

  const program = parsed.program!;
  const compiled = compileLadderToIl(program);
  assert.equal(compiled.hasErrors, false, JSON.stringify(compiled.diagnostics));
  assert.ok(compiled.rawIlText.includes('TWRP D10'));
  assert.ok(compiled.rawIlText.includes('TZCP D30 D40 D24 M0'));

  // Same program on DVP-14SS2 must fail compilation because SS2 has no RTC
  const ss2Compiled = compileLadderToIl({ ...program, model: 'DVP-14SS2' });
  assert.equal(ss2Compiled.hasErrors, true);
  assert.ok(ss2Compiled.diagnostics.some((d) => d.message.includes('DVP-SX2')));

  // Simulate X0 -> M1016 ON, X1 -> TWRP sets RTC to 14:30:00 -> TRD reads D24..D26=14:30:00 -> TZCP (12:00..16:00) turns M1 ON
  let state = createInitialSimState({ X0: true, X1: true });
  state = executeScanCycle(program, state, 20);
  assert.equal(state.relays['M1016'], true);
  assert.equal(state.registers['D1315'], 14);
  assert.equal(state.registers['D1314'], 30);
  assert.equal(state.registers['D24'], 14);
  assert.equal(state.registers['D25'], 30);
  assert.equal(state.relays['M0'], false);
  assert.equal(state.relays['M1'], true);
  assert.equal(state.relays['M2'], false);
});

test('Quick Command & JSON Storage round-trip support SQR, DMOVR, DMULR, DESQR, FLT, TWRP, and TZCP', () => {
  const cmds = [
    'SQR D0 D2',
    'DMOVR F10.000 D10',
    'DMULR D10 D20 D30',
    'DESQR D30 D40',
    'FLT D0 D10',
    'TWRP D20',
    'TZCP D10 D20 D0 M0',
  ];
  for (const cmd of cmds) {
    const res = parseQuickCommand(cmd, 'DVP-SX2');
    assert.equal(res.valid, true, `QuickCommand "${cmd}" failed: ${res.valid ? '' : res.error}`);
  }

  const program = parseIlToLadder(
    [
      'LD M1000',
      'SQR D0 D2',
      'DMOVR F10.000 D10',
      'DMULR D10 D20 D30',
      'DESQR D30 D40',
      'FLT D0 D10',
      'TWRP D20',
      'TZCP D10 D20 D0 M0',
      'END',
    ].join('\n'),
    'DVP-SX2',
    'Storage_RT'
  ).program!;

  const json = JSON.stringify(program);
  const loaded = parseProgramJson(json);
  assert.equal(loaded.success, true, loaded.error);
  assert.equal(
    compileLadderToIl(loaded.program!).rawIlText,
    compileLadderToIl(program).rawIlText
  );
});
