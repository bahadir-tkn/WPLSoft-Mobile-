import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decimalToOctalText,
  enumerateOctalAddresses,
  nextOctalAddress,
  validateAddress,
} from './addressing';
import { PLC_MODELS } from './plcModels';
import { createBlankProgram, deleteRungAt, insertRungAfter } from './gridFactory';

test('Delta octal X/Y addressing accepts valid octal X0-X7 and X10-X17', () => {
  assert.equal(validateAddress('X0', 'bit_contact', 'DVP-14SS2').valid, true);
  assert.equal(validateAddress('x7', 'bit_contact', 'DVP-14SS2').parsed?.normalized, 'X7');
  assert.equal(validateAddress('X10', 'bit_contact', 'DVP-14SS2').parsed?.numericValue, 8);
  assert.equal(validateAddress('Y17', 'bit_coil', 'DVP-14SS2').valid, true);
  assert.equal(decimalToOctalText(8), '10');
});

test('Delta octal addressing strictly rejects digits 8 and 9 and out-of-range addresses', () => {
  const x8 = validateAddress('X8', 'bit_contact', 'DVP-14SS2');
  assert.equal(x8.valid, false);
  assert.match(x8.error ?? '', /sekizlik/i);

  assert.equal(validateAddress('X9', 'bit_contact', 'DVP-14SS2').valid, false);
  assert.equal(validateAddress('Y8', 'bit_coil', 'DVP-14SS2').valid, false);
  assert.equal(validateAddress('Y18', 'bit_coil', 'DVP-14SS2').valid, false);
  assert.equal(validateAddress('X20', 'bit_contact', 'DVP-14SS2').valid, false);
});

test('Octal progression skips X8/X9 and goes directly from X7 to X10', () => {
  assert.equal(nextOctalAddress('X7'), 'X10');
  assert.equal(nextOctalAddress('Y7'), 'Y10');
  assert.equal(nextOctalAddress('X17'), null);

  const inputs = enumerateOctalAddresses('X');
  assert.equal(inputs.length, 16);
  assert.equal(inputs[7], 'X7');
  assert.equal(inputs[8], 'X10');
  assert.equal(inputs[15], 'X17');
});

test('Model onboard vs expansion I/O distinction works for DVP-14SS2 and DVP-12SA2', () => {
  const ss2Y5 = validateAddress('Y5', 'bit_coil', 'DVP-14SS2');
  assert.equal(ss2Y5.valid, true);
  assert.equal(ss2Y5.ioZone, 'onboard');

  const sa2Y5 = validateAddress('Y5', 'bit_coil', 'DVP-12SA2');
  assert.equal(sa2Y5.valid, true);
  assert.equal(sa2Y5.ioZone, 'expansion');
  assert.ok(sa2Y5.warning);

  assert.equal(PLC_MODELS['DVP-14SS2'].onboardOutputs.length, 6);
  assert.equal(PLC_MODELS['DVP-12SA2'].onboardOutputs.length, 4);
});

test('Special relays M1000-M1002 are read-only contacts and cannot be driven as coils', () => {
  const m1000Contact = validateAddress('M1000', 'bit_contact');
  assert.equal(m1000Contact.valid, true);
  assert.equal(m1000Contact.ioZone, 'special');

  const m1002Coil = validateAddress('M1002', 'bit_coil');
  assert.equal(m1002Coil.valid, false);

  const x0Coil = validateAddress('X0', 'bit_coil');
  assert.equal(x0Coil.valid, false);
});

test('T, C, D and K constant ranges validate accurately by role', () => {
  assert.equal(validateAddress('T0', 'timer').valid, true);
  assert.equal(validateAddress('T127', 'timer').valid, true);
  assert.equal(validateAddress('T128', 'timer').valid, false);

  assert.equal(validateAddress('C127', 'counter').valid, true);
  assert.equal(validateAddress('C128', 'counter').valid, false);

  assert.equal(validateAddress('D999', 'word_dest').valid, true);
  assert.equal(validateAddress('D1000', 'word_dest').valid, false);
  assert.equal(validateAddress('D0', 'bit_contact').valid, false);

  assert.equal(validateAddress('K50', 'preset').valid, true);
  assert.equal(validateAddress('K-5', 'preset').valid, false);
  assert.equal(validateAddress('K-100', 'word_source').valid, true);
  assert.equal(validateAddress('K10', 'word_dest').valid, false);
});

test('Blank Ladder program always ends with END rung and supports safe insert/delete', () => {
  const blank = createBlankProgram('DVP-14SS2', 'Test', 3);
  assert.equal(blank.rungs.length, 4);
  assert.equal(blank.rungs[3].isEnd, true);

  const inserted = insertRungAfter(blank, 1);
  assert.equal(inserted.program.rungs.length, 5);
  assert.equal(inserted.insertedIndex, 2);
  assert.equal(inserted.program.rungs[4].isEnd, true);

  // Deleting END rung is blocked
  const tryDeleteEnd = deleteRungAt(inserted.program, 4);
  assert.equal(tryDeleteEnd.deleted, false);

  // Deleting normal rung succeeds
  const deleted = deleteRungAt(inserted.program, 2);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.program.rungs.length, 4);
});
