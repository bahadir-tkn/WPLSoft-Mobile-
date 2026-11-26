import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDvpFile, encodeCp1254, encodeInstruction, encodeProgramWords } from './dvpExport';
import { compileLadderToIl } from './ilCompiler';
import { parseIlToLadder } from './ilParser';
import { INDUSTRIAL_TEMPLATES } from './templates';
import { BOOK } from './fixtures/bookExamples';
import { WPLSOFT_DENEY6, WPLSOFT_SAMPLES } from './fixtures/wplsoftSamples';
import { getTemplateById } from './templates';

const hex = (words: number[]) => words.map((w) => w.toString(16).padStart(4, '0')).join(' ');

test('.dvp: every instruction encodes exactly like WPLSoft 2.52 saved it (real sample files)', () => {
  for (const sample of WPLSOFT_SAMPLES) {
    const words: number[] = [];
    for (const line of sample.il) {
      const [op, ...args] = line.split(/\s+/);
      words.push(...encodeInstruction(op, args));
    }
    assert.equal(hex(words), sample.words, sample.name);
    let checksum = 0;
    for (const w of words) checksum = (checksum + (((w & 0xff) << 8) | (w >> 8))) & 0xffff;
    assert.equal(checksum, sample.checksum, `${sample.name} checksum`);
  }
});

test('.dvp: step addresses shown in the app equal the WPLSoft step layout for templates and book examples', () => {
  const programs = [
    ...INDUSTRIAL_TEMPLATES.map((t) => ({ name: t.id, program: t.buildProgram(t.requiredModel ?? 'DVP-SX2') })),
    ...Object.entries(BOOK).map(([name, il]) => ({ name, program: parseIlToLadder(il, 'DVP-SX2').program! })),
  ];
  let checked = 0;
  for (const { name, program } of programs) {
    const compiled = compileLadderToIl(program);
    const { words, errors } = encodeProgramWords(compiled);
    if (errors.length) continue; // .dvp için desteklenmeyen komut içeriyor
    checked += 1;
    assert.equal(words.length, compiled.stepCount, `${name}: step count`);
    for (const inst of compiled.instructions) {
      const len = encodeInstruction(inst.opcode, inst.operands).length;
      const next = compiled.instructions[compiled.instructions.indexOf(inst) + 1];
      if (next) assert.equal(next.stepAddress - inst.stepAddress, len, `${name}: ${inst.opcode} ${inst.operands.join(' ')}`);
    }
  }
  assert.ok(checked >= 15, `only ${checked} programs were encodable`);
});

test('.dvp: file layout, encryption, checksum and Turkish comments', () => {
  const program = parseIlToLadder('LD X0\nOR Y0\nANI X1\nOUT Y0\nEND', 'DVP-SX2').program!;
  program.deviceComments = { X0: 'Başlat', X1: 'Dur', Y0: 'Motor Çıkışı' };
  const res = buildDvpFile(program, compileLadderToIl(program));
  assert.equal(res.ok, true, res.errors.join(', '));
  const b = res.bytes!;
  assert.equal(b[0], 0x57);
  const key = b[0x5e];
  const plain = [b[0x100] ^ key, b[0x101] ^ key, b[0x102] ^ key, b[0x103] ^ key];
  assert.deepEqual(plain, [0x00, 0x24, 0x00, 0x65]); // LD X0, OR Y0
  assert.equal(b[0x56] | (b[0x57] << 8), 0x11a2);
  // Boş adımlar 0xFFFF
  assert.equal(b[0x100 + 10] ^ key, 0xff);
  // Program alanı 15872 adım, ardından sabit bölüm
  assert.equal(b[0x7d00 + 1], 0x01);
  const text = Buffer.from(b).toString('latin1');
  const comments = Buffer.from(encodeCp1254('X0$&Başlat\nX1$&Dur\nY0$&Motor Çıkışı\n')).toString('latin1');
  assert.ok(text.includes(`<DataBegin>\n${comments}<DataEnd>`), 'device comments block');
  assert.ok(text.endsWith('<PrjectEnd>\n'));
  assert.deepEqual(encodeCp1254('ğüşıöçĞÜŞİÖÇ'), [0xf0, 0xfc, 0xfe, 0xfd, 0xf6, 0xe7, 0xd0, 0xdc, 0xde, 0xdd, 0xd6, 0xc7]);
});

test('.dvp: refuses models and instructions whose encoding is not verified', () => {
  const ss2 = parseIlToLadder('LD X0\nOUT Y0\nEND', 'DVP-14SS2').program!;
  assert.equal(buildDvpFile(ss2, compileLadderToIl(ss2)).ok, false);
  const rtc = parseIlToLadder('LD X0\nTRD D0\nEND', 'DVP-SX2').program!;
  const res = buildDvpFile(rtc, compileLadderToIl(rtc));
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /TRD/);
  assert.throws(() => encodeInstruction('LD', ['M2048']));
});

test('.dvp: Deney 6 template produces the same program and comments as the file WPLSoft saved for it', () => {
  const program = getTemplateById('deney6-su-kopuk').buildProgram('DVP-SX2');
  const compiled = compileLadderToIl(program);
  const { words, errors } = encodeProgramWords(compiled);
  assert.deepEqual(errors, []);
  assert.equal(hex(words), WPLSOFT_DENEY6.words);
  assert.equal(compiled.stepCount, 56);
  const res = buildDvpFile(program, compiled);
  const b = res.bytes!;
  assert.equal(b[0x56] | (b[0x57] << 8), WPLSOFT_DENEY6.checksum);
  const text = Buffer.from(b).toString('latin1');
  const expected = Buffer.from(encodeCp1254(WPLSOFT_DENEY6.comments.join('\n') + '\n')).toString('latin1');
  assert.ok(text.includes(`<DataBegin>\n${expected}<DataEnd>`), 'same comments in the same order as WPLSoft');
});
