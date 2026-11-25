import type {
  CompileDiagnostic,
  CompileResult,
  CompareOperator,
  ContactKind,
  IlInstruction,
  IlOpcode,
  LadderProgram,
} from '../types/plc';
import { validateAddress, validateZrstRange } from './addressing';
import { buildRungAst, getStepHeader, type LogicAstNode, type OutputAstElement } from './ast';
import { LADDER_COIL_COLUMN, PLC_MODELS } from './plcModels';

type EmitMode = 'LD' | 'AND' | 'OR';

function contactOpcode(mode: EmitMode, contactType: ContactKind): IlOpcode {
  if (mode === 'LD') {
    switch (contactType) {
      case 'NO':
        return 'LD';
      case 'NC':
        return 'LDI';
      case 'RISING':
        return 'LDP';
      case 'FALLING':
        return 'LDF';
    }
  }
  if (mode === 'AND') {
    switch (contactType) {
      case 'NO':
        return 'AND';
      case 'NC':
        return 'ANI';
      case 'RISING':
        return 'ANDP';
      case 'FALLING':
        return 'ANDF';
    }
  }
  switch (contactType) {
    case 'NO':
      return 'OR';
    case 'NC':
      return 'ORI';
    case 'RISING':
      return 'ORP';
    case 'FALLING':
      return 'ORF';
  }
}

function compareOpcode(mode: EmitMode, operator: CompareOperator): IlOpcode {
  return `${mode}${operator}` as IlOpcode;
}

function isSimpleLeaf(node: LogicAstNode): boolean {
  return node.kind === 'CONTACT' || node.kind === 'COMPARE';
}

function instructionStepCost(opcode: IlOpcode): number {
  // Adım sayıları Delta DVP programlama kılavuzundaki komut tablosuna göredir.
  if (opcode === 'TMR' || opcode === 'CNT') {
    return 4;
  }
  if (
    opcode === 'LDP' ||
    opcode === 'LDF' ||
    opcode === 'ANDP' ||
    opcode === 'ANDF' ||
    opcode === 'ORP' ||
    opcode === 'ORF'
  ) {
    return 3;
  }
  if (
    opcode === 'ALT' ||
    opcode === 'INC' ||
    opcode === 'INCP' ||
    opcode === 'DEC' ||
    opcode === 'DECP' ||
    opcode === 'TRD' ||
    opcode === 'TWR' ||
    opcode === 'TWRP'
  ) {
    return 3;
  }
  if (opcode === 'MOV' || opcode === 'ZRST' || opcode === 'SQR' || opcode === 'FLT') return 5;
  if (
    opcode === 'CMP' ||
    opcode === 'ADD' ||
    opcode === 'SUB' ||
    opcode === 'MUL' ||
    opcode === 'DIV'
  ) {
    return 7;
  }
  if (opcode === 'DMOVR' || opcode === 'DESQR' || opcode === 'TZCP') {
    return 9;
  }
  if (
    opcode === 'DADDR' ||
    opcode === 'DSUBR' ||
    opcode === 'DMULR' ||
    opcode === 'DDIVR'
  ) {
    return 13;
  }
  if (
    opcode.startsWith('LD=') ||
    opcode.startsWith('LD>') ||
    opcode.startsWith('LD<') ||
    opcode.startsWith('AND=') ||
    opcode.startsWith('AND>') ||
    opcode.startsWith('AND<') ||
    opcode.startsWith('OR=') ||
    opcode.startsWith('OR>') ||
    opcode.startsWith('OR<')
  ) {
    return 5;
  }
  return 1;
}

function emitLogicAst(
  node: LogicAstNode,
  mode: EmitMode,
  rungIndex: number,
  out: Omit<IlInstruction, 'stepAddress'>[]
): void {
  switch (node.kind) {
    case 'WIRE': {
      if (mode === 'LD') {
        out.push({ opcode: 'LD', operands: ['M1000'], rungIndex });
      }
      return;
    }

    case 'CONTACT': {
      out.push({
        opcode: contactOpcode(mode, node.contactType),
        operands: [node.address],
        rungIndex,
      });
      return;
    }

    case 'COMPARE': {
      out.push({
        opcode: compareOpcode(mode, node.operator),
        operands: [node.operandA, node.operandB],
        rungIndex,
      });
      return;
    }

    case 'EDGE': {
      // NP / PN önündeki seri bağlantının sonucuna uygulanır.
      // Doğrudan güç hattından başlıyorsa sonuç her zaman 1'dir (LD M1000).
      if (mode === 'LD') {
        out.push({ opcode: 'LD', operands: ['M1000'], rungIndex });
      }
      out.push({ opcode: node.edge, operands: [], rungIndex });
      return;
    }

    case 'AND': {
      if (node.children.length === 0) return;
      if (mode === 'LD') {
        emitLogicAst(node.children[0], 'LD', rungIndex, out);
        for (let i = 1; i < node.children.length; i += 1) {
          emitLogicAst(node.children[i], 'AND', rungIndex, out);
        }
      } else if (mode === 'AND') {
        for (const child of node.children) {
          emitLogicAst(child, 'AND', rungIndex, out);
        }
      } else {
        // mode === 'OR': push series sub-branch onto stack then ORB
        emitLogicAst(node, 'LD', rungIndex, out);
        out.push({ opcode: 'ORB', operands: [], rungIndex });
      }
      return;
    }

    case 'OR': {
      if (node.children.length === 0) return;
      if (mode === 'LD') {
        emitLogicAst(node.children[0], 'LD', rungIndex, out);
        for (let i = 1; i < node.children.length; i += 1) {
          const child = node.children[i];
          if (isSimpleLeaf(child)) {
            emitLogicAst(child, 'OR', rungIndex, out);
          } else {
            emitLogicAst(child, 'LD', rungIndex, out);
            out.push({ opcode: 'ORB', operands: [], rungIndex });
          }
        }
      } else if (mode === 'OR') {
        for (const child of node.children) {
          if (isSimpleLeaf(child)) {
            emitLogicAst(child, 'OR', rungIndex, out);
          } else {
            emitLogicAst(child, 'LD', rungIndex, out);
            out.push({ opcode: 'ORB', operands: [], rungIndex });
          }
        }
      } else {
        // mode === 'AND': evaluate parallel block on stack then ANB
        emitLogicAst(node, 'LD', rungIndex, out);
        out.push({ opcode: 'ANB', operands: [], rungIndex });
      }
      return;
    }
  }
}

function emitOutput(
  element: OutputAstElement,
  rungIndex: number,
  out: Omit<IlInstruction, 'stepAddress'>[]
): void {
  switch (element.kind) {
    case 'COIL':
      out.push({
        opcode: element.coilType,
        operands: [element.address],
        rungIndex,
      });
      return;
    case 'TMR':
      out.push({
        opcode: 'TMR',
        operands: [element.address, element.preset],
        rungIndex,
      });
      return;
    case 'CNT':
      out.push({
        opcode: 'CNT',
        operands: [element.address, element.preset],
        rungIndex,
      });
      return;
    case 'MOV':
      out.push({
        opcode: 'MOV',
        operands: [element.source, element.destination],
        rungIndex,
      });
      return;
    case 'ALT':
      out.push({
        opcode: 'ALT',
        operands: [element.target],
        rungIndex,
      });
      return;
    case 'ZRST':
      out.push({
        opcode: 'ZRST',
        operands: [element.start, element.end],
        rungIndex,
      });
      return;
    case 'CMP':
      out.push({
        opcode: 'CMP',
        operands: [element.source1, element.source2, element.destination],
        rungIndex,
      });
      return;
    case 'MATH':
      out.push({
        opcode: element.operator,
        operands: [element.source1, element.source2, element.destination],
        rungIndex,
      });
      return;
    case 'INCDEC':
      out.push({
        opcode: element.operator,
        operands: [element.target],
        rungIndex,
      });
      return;
    case 'TRD':
      out.push({
        opcode: 'TRD',
        operands: [element.destination],
        rungIndex,
      });
      return;
    case 'SQR':
      out.push({
        opcode: 'SQR',
        operands: [element.source, element.destination],
        rungIndex,
      });
      return;
    case 'FLOAT_MOV':
      out.push({
        opcode: 'DMOVR',
        operands: [element.source, element.destination],
        rungIndex,
      });
      return;
    case 'FLOAT_MATH':
      out.push({
        opcode: element.operator,
        operands: [element.source1, element.source2, element.destination],
        rungIndex,
      });
      return;
    case 'FLOAT_UNARY':
      out.push({
        opcode: element.operator,
        operands: [element.source, element.destination],
        rungIndex,
      });
      return;
    case 'TWR':
      out.push({
        opcode: element.pulsed ? 'TWRP' : 'TWR',
        operands: [element.source],
        rungIndex,
      });
      return;
    case 'TZCP':
      out.push({
        opcode: 'TZCP',
        operands: [element.start1, element.start2, element.current, element.destination],
        rungIndex,
      });
      return;
  }
}

function flattenAndFactors(node: LogicAstNode): LogicAstNode[] {
  if (node.kind === 'AND') {
    const out: LogicAstNode[] = [];
    for (const c of node.children) {
      out.push(...flattenAndFactors(c));
    }
    return out;
  }
  return [node];
}

function fingerprintLogicNode(node: LogicAstNode): string {
  switch (node.kind) {
    case 'WIRE':
      return 'W';
    case 'CONTACT':
      return `C:${node.contactType}:${node.address}@${node.rowIndex},${node.colIndex}`;
    case 'COMPARE':
      return `K:${node.operator}:${node.operandA}:${node.operandB}@${node.rowIndex},${node.colIndex}`;
    case 'EDGE':
      return `E:${node.edge}@${node.rowIndex},${node.colIndex}`;
    case 'AND':
      return `A(${node.children.map(fingerprintLogicNode).join('&')})`;
    case 'OR':
      return `O(${node.children.map(fingerprintLogicNode).join('|')})`;
  }
}

/** Paralel bir kolun ilk elemanı NP/PN ise WPLSoft'ta karşılığı yoktur. */
function hasEdgeAtBranchStart(node: LogicAstNode): boolean {
  const firstLeaf = (n: LogicAstNode): LogicAstNode =>
    n.kind === 'AND' && n.children.length > 0 ? firstLeaf(n.children[0]) : n;
  if (node.kind === 'OR') {
    return node.children.some((c) => firstLeaf(c).kind === 'EDGE' || hasEdgeAtBranchStart(c));
  }
  if (node.kind === 'AND') return node.children.some(hasEdgeAtBranchStart);
  return false;
}

function factorsToAst(factors: LogicAstNode[]): LogicAstNode {
  if (factors.length === 0) return { kind: 'WIRE' };
  if (factors.length === 1) return factors[0];
  return { kind: 'AND', children: factors };
}

function commonPrefixLength(a: LogicAstNode[], b: LogicAstNode[]): number {
  const maxLen = Math.min(a.length, b.length);
  let k = 0;
  while (k < maxLen && fingerprintLogicNode(a[k]) === fingerprintLogicNode(b[k])) {
    k += 1;
  }
  return k;
}

/**
 * STL / RET yerleşim kuralları: yalnızca ağın ilk hücresinde, tek satırlık ve
 * başka eleman içermeyen bir ağda bulunabilirler. STL adresi S aygıtı olmalıdır.
 */
function validateStepHeaders(program: LadderProgram, diagnostics: CompileDiagnostic[]): void {
  program.rungs.forEach((rung, rungIndex) => {
    if (rung.isEnd) return;
    const rungTag = `Ağ ${String(rungIndex).padStart(3, '0')}`;
    rung.rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const el = cell.element;
        if (el.kind !== 'STL' && el.kind !== 'RET') return;
        const label = el.kind === 'STL' ? `STL ${el.address}` : 'RET';
        const otherContent =
          rung.rows.length > 1 ||
          row.some((c, ci) => ci !== 0 && (c.element.kind !== 'EMPTY' || c.branchDown)) ||
          cell.branchDown;
        if (rowIndex !== 0 || colIndex !== 0 || otherContent) {
          diagnostics.push({
            severity: 'error',
            code: 'SYNTAX_ERROR',
            message: `${rungTag}: ${label} kendi ağının ilk hücresinde tek başına bulunmalıdır.`,
            rungIndex,
            rowIndex,
            colIndex,
          });
        }
        if (el.kind === 'STL') {
          const res = validateAddress(el.address, 'bit_contact', program.model);
          if (!res.valid || res.parsed?.prefix !== 'S') {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag}: STL adresi bir adım rölesi (S0, S10…) olmalıdır.`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.address,
            });
          }
        }
      });
    });
  });
}

function validateProgramCells(
  program: LadderProgram,
  diagnostics: CompileDiagnostic[]
): void {
  const modelSpec = PLC_MODELS[program.model];
  program.rungs.forEach((rung, rungIndex) => {
    if (rung.isEnd) return;
    const rungTag = `Ağ ${String(rungIndex).padStart(3, '0')}`;
    rung.rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const el = cell.element;
        if (el.kind === 'CONTACT') {
          const res = validateAddress(el.address, 'bit_contact', program.model);
          if (!res.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag}: ${res.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.address,
            });
          }
        } else if (el.kind === 'COMPARE') {
          const resA = validateAddress(el.operandA, 'word_source', program.model);
          const resB = validateAddress(el.operandB, 'word_source', program.model);
          if (!resA.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} Karşılaştırma S1: ${resA.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.operandA,
            });
          }
          if (!resB.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} Karşılaştırma S2: ${resB.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.operandB,
            });
          }
        } else if (el.kind === 'COIL') {
          const role = el.coilType === 'RST' ? 'rst_target' : 'bit_coil';
          const res = validateAddress(el.address, role, program.model);
          if (!res.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} Bobin: ${res.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.address,
            });
          }
        } else if (el.kind === 'TMR') {
          const tRes = validateAddress(el.address, 'timer', program.model);
          const pRes = validateAddress(el.preset, 'preset', program.model);
          if (!tRes.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} TMR: ${tRes.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.address,
            });
          }
          if (!pRes.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} TMR Süre: ${pRes.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.preset,
            });
          }
        } else if (el.kind === 'CNT') {
          const cRes = validateAddress(el.address, 'counter', program.model);
          const pRes = validateAddress(el.preset, 'preset', program.model);
          if (!cRes.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} CNT: ${cRes.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.address,
            });
          }
          if (!pRes.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} CNT Hedef: ${pRes.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.preset,
            });
          }
        } else if (el.kind === 'MOV') {
          const sRes = validateAddress(el.source, 'word_source', program.model);
          const dRes = validateAddress(el.destination, 'word_dest', program.model);
          if (!sRes.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} MOV Kaynak: ${sRes.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source,
            });
          }
          if (!dRes.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} MOV Hedef: ${dRes.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        } else if (el.kind === 'ALT') {
          const tRes = validateAddress(el.target, 'bit_coil', program.model);
          if (!tRes.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ALT Hedef: ${tRes.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.target,
            });
          }
        } else if (el.kind === 'ZRST') {
          const zRes = validateZrstRange(el.start, el.end, program.model);
          if (!zRes.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag}: ${zRes.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: `${el.start}-${el.end}`,
            });
          }
        } else if (el.kind === 'CMP') {
          const s1 = validateAddress(el.source1, 'word_source', program.model);
          const s2 = validateAddress(el.source2, 'word_source', program.model);
          const dst = validateAddress(el.destination, 'bit_coil', program.model);
          if (!s1.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} CMP S1: ${s1.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source1,
            });
          }
          if (!s2.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} CMP S2: ${s2.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source2,
            });
          }
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} CMP Hedef (D): ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        } else if (el.kind === 'MATH') {
          const s1 = validateAddress(el.source1, 'word_source', program.model);
          const s2 = validateAddress(el.source2, 'word_source', program.model);
          const dst = validateAddress(el.destination, 'word_dest', program.model);
          if (!s1.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} S1: ${s1.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source1,
            });
          }
          if (!s2.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} S2: ${s2.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source2,
            });
          }
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} Hedef: ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        } else if (el.kind === 'INCDEC') {
          const dst = validateAddress(el.target, 'word_dest', program.model);
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} Hedef: ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.target,
            });
          }
        } else if (el.kind === 'TRD') {
          if (!modelSpec.hasRtc) {
            diagnostics.push({
              severity: 'error',
              code: 'SYNTAX_ERROR',
              message: `${rungTag} TRD: ${modelSpec.label} modelinde dahili gerçek zaman saati (RTC) yoktur. TRD yalnızca DVP-SX2 modelinde desteklenir.`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
          const dst = validateAddress(el.destination, 'word_dest', program.model);
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} TRD Hedef: ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        } else if (el.kind === 'SQR') {
          const src = validateAddress(el.source, 'word_source', program.model);
          const dst = validateAddress(el.destination, 'word_dest', program.model);
          if (!src.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} SQR Kaynak: ${src.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source,
            });
          }
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} SQR Hedef: ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        } else if (el.kind === 'FLOAT_MOV') {
          const src = validateAddress(el.source, 'float_source', program.model);
          const dst = validateAddress(el.destination, 'word_dest', program.model);
          if (!src.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} DMOVR Kaynak: ${src.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source,
            });
          }
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} DMOVR Hedef: ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        } else if (el.kind === 'FLOAT_MATH') {
          const s1 = validateAddress(el.source1, 'float_source', program.model);
          const s2 = validateAddress(el.source2, 'float_source', program.model);
          const dst = validateAddress(el.destination, 'word_dest', program.model);
          if (!s1.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} S1: ${s1.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source1,
            });
          }
          if (!s2.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} S2: ${s2.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source2,
            });
          }
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} Hedef: ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        } else if (el.kind === 'FLOAT_UNARY') {
          const srcRole = el.operator === 'FLT' ? 'word_source' : 'float_source';
          const src = validateAddress(el.source, srcRole, program.model);
          const dst = validateAddress(el.destination, 'word_dest', program.model);
          if (!src.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} Kaynak: ${src.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source,
            });
          }
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.operator} Hedef: ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        } else if (el.kind === 'TWR') {
          if (!modelSpec.hasRtc) {
            diagnostics.push({
              severity: 'error',
              code: 'SYNTAX_ERROR',
              message: `${rungTag} ${el.pulsed ? 'TWRP' : 'TWR'}: ${modelSpec.label} modelinde dahili gerçek zaman saati (RTC) yoktur. TWR yalnızca DVP-SX2 modelinde desteklenir.`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source,
            });
          }
          const src = validateAddress(el.source, 'word_dest', program.model);
          if (!src.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} ${el.pulsed ? 'TWRP' : 'TWR'} Kaynak: ${src.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.source,
            });
          }
        } else if (el.kind === 'TZCP') {
          const s1 = validateAddress(el.start1, 'word_dest', program.model);
          const s2 = validateAddress(el.start2, 'word_dest', program.model);
          const cur = validateAddress(el.current, 'word_dest', program.model);
          const dst = validateAddress(el.destination, 'bit_coil', program.model);
          if (!s1.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} TZCP S1: ${s1.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.start1,
            });
          }
          if (!s2.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} TZCP S2: ${s2.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.start2,
            });
          }
          if (!cur.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} TZCP S (Saat): ${cur.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.current,
            });
          }
          if (!dst.valid) {
            diagnostics.push({
              severity: 'error',
              code: 'INVALID_ADDRESS',
              message: `${rungTag} TZCP Hedef (D): ${dst.error}`,
              rungIndex,
              rowIndex,
              colIndex,
              address: el.destination,
            });
          }
        }
      });
    });
  });
}

/**
 * Formats an IlInstruction as a pure WPLSoft-compatible line without step numbers.
 */
export function formatIlLine(inst: Pick<IlInstruction, 'opcode' | 'operands'>): string {
  if (inst.operands.length === 0) return inst.opcode;
  return `${inst.opcode} ${inst.operands.join(' ')}`;
}

/**
 * Compiles a LadderProgram into Delta Instruction List (IL) instructions, pure WPLSoft-pasteable rawIlText,
 * and compile-time diagnostics (Double Coil, Missing END, Open Circuit, Invalid Address).
 */
export function compileLadderToIl(program: LadderProgram): CompileResult {
  const diagnostics: CompileDiagnostic[] = [];
  const rawInstructions: Omit<IlInstruction, 'stepAddress'>[] = [];

  // 1. Validate cell addresses against active PLC model
  validateProgramCells(program, diagnostics);
  validateStepHeaders(program, diagnostics);

  // Adım (STL) bağlamı: STL Sn başlığından RET'e kadar olan ağlar Sn adımına aittir.
  let activeStep: string | null = null;
  // STL başlığından hemen sonra, henüz LD yazılmadan gelen çıkışlar doğrudan adım
  // barasına bağlanır (WPLSoft: STL S10 / OUT Y20).
  let stepBusFresh = false;

  // 2. Track OUT coil usage for Double Coil detection
  const outCoilUsage = new Map<
    string,
    { rungIndex: number; rowIndex: number; colIndex: number; step: string | null }[]
  >();
  const trackOutCoil = (element: OutputAstElement, rungIndex: number, rowIndex: number) => {
    if (element.kind === 'COIL' && element.coilType === 'OUT') {
      const addr = element.address.toUpperCase();
      const entry = { rungIndex, rowIndex, colIndex: LADDER_COIL_COLUMN, step: activeStep };
      const list = outCoilUsage.get(addr);
      if (list) list.push(entry);
      else outCoilUsage.set(addr, [entry]);
    }
  };

  let hasEndRung = false;

  program.rungs.forEach((rung, rungIndex) => {
    const header = getStepHeader(rung);
    if (header) {
      if (header.kind === 'STL') {
        rawInstructions.push({ opcode: 'STL', operands: [header.address], rungIndex });
        activeStep = header.address;
        stepBusFresh = true;
      } else {
        if (!activeStep) {
          diagnostics.push({
            severity: 'warning',
            code: 'SYNTAX_ERROR',
            message: `Ağ ${String(rungIndex).padStart(3, '0')}: RET komutundan önce STL adımı bulunmuyor.`,
            rungIndex,
            rowIndex: 0,
            colIndex: 0,
          });
        }
        rawInstructions.push({ opcode: 'RET', operands: [], rungIndex });
        activeStep = null;
        stepBusFresh = false;
      }
      return;
    }

    const ast = buildRungAst(rung, rungIndex);

    if (ast.isEnd) {
      hasEndRung = true;
      if (activeStep) {
        diagnostics.push({
          severity: 'warning',
          code: 'SYNTAX_ERROR',
          message: `${activeStep} adım bloğu RET ile kapatılmamış. Adımların sonuna RET ekleyin.`,
          rungIndex,
          rowIndex: 0,
          colIndex: 0,
        });
      }
      rawInstructions.push({
        opcode: 'END',
        operands: [],
        rungIndex,
      });
      return;
    }

    if (ast.isEmpty) return;

    if (ast.unreducibleWarning) {
      diagnostics.push({
        severity: 'error',
        code: 'SYNTAX_ERROR',
        message: ast.unreducibleWarning,
        rungIndex,
        rowIndex: 0,
        colIndex: 0,
      });
    }

    if (ast.hasLogicWithoutOutput) {
      let firstRow = 0;
      let firstCol = 0;
      outer: for (let r = 0; r < rung.rows.length; r += 1) {
        for (let c = 0; c < LADDER_COIL_COLUMN; c += 1) {
          if (rung.rows[r][c]?.element.kind !== 'EMPTY') {
            firstRow = r;
            firstCol = c;
            break outer;
          }
        }
      }
      diagnostics.push({
        severity: 'warning',
        code: 'OPEN_BRANCH',
        message: `Ağ ${String(rungIndex).padStart(3, '0')}: Kontak/hat yerleştirilmiş ancak çıkış bobini veya komut bloğu bağlı değil.`,
        rungIndex,
        rowIndex: firstRow,
        colIndex: firstCol,
      });
      return;
    }

    // Collect valid per-output branches sorted top-to-bottom by rowIndex
    const validBranches: {
      rowIndex: number;
      factors: LogicAstNode[];
      element: OutputAstElement;
    }[] = [];

    for (const group of ast.outputGroups) {
      if (group.hasUnconnectedOutput) {
        const firstOutRow = group.outputs[0]?.rowIndex ?? 0;
        diagnostics.push({
          severity: 'error',
          code: 'OPEN_BRANCH',
          message: `Ağ ${String(rungIndex).padStart(3, '0')}: Çıkış bloğu sol güç barasına bağlı değil. Eksik yatay bağlantı (F9) veya kontak ekleyin.`,
          rungIndex,
          rowIndex: firstOutRow,
          colIndex: LADDER_COIL_COLUMN,
        });
        continue;
      }

      if (group.logic) {
        const factors = flattenAndFactors(group.logic);
        for (const outItem of group.outputs) {
          validBranches.push({
            rowIndex: outItem.rowIndex,
            factors,
            element: outItem.element,
          });
        }
      }
    }

    validBranches.sort((a, b) => a.rowIndex - b.rowIndex);

    for (const group of ast.outputGroups) {
      if (group.logic && hasEdgeAtBranchStart(group.logic)) {
        diagnostics.push({
          severity: 'error',
          code: 'SYNTAX_ERROR',
          message: `Ağ ${String(rungIndex).padStart(3, '0')}: NP/PN (↑/↓) paralel bir kolun başında kullanılamaz; bir kontaktan sonra yerleştirin.`,
          rungIndex,
          rowIndex: group.outputs[0]?.rowIndex ?? 0,
          colIndex: 0,
        });
      }
    }

    // STL başlığından hemen sonra koşulsuz (yalnızca yatay hat) çıkışlar: LD olmadan yazılır.
    if (
      activeStep &&
      stepBusFresh &&
      validBranches.length > 0 &&
      validBranches.every((b) => b.factors.length === 1 && b.factors[0].kind === 'WIRE')
    ) {
      for (const b of validBranches) {
        emitOutput(b.element, rungIndex, rawInstructions);
        trackOutCoil(b.element, rungIndex, b.rowIndex);
      }
      return;
    }
    if (validBranches.length > 0) stepBusFresh = false;

    const emitBranchCluster = (
      startIdx: number,
      endIdx: number,
      prefixDepth: number,
      isRoot: boolean
    ): void => {
      if (startIdx >= endIdx) return;

      if (endIdx - startIdx === 1) {
        const single = validBranches[startIdx];
        const remaining = single.factors.slice(prefixDepth);
        if (remaining.length > 0) {
          if (isRoot) {
            emitLogicAst(factorsToAst(remaining), 'LD', rungIndex, rawInstructions);
          } else {
            for (const factor of remaining) {
              emitLogicAst(factor, 'AND', rungIndex, rawInstructions);
            }
          }
        }
        emitOutput(single.element, rungIndex, rawInstructions);
        trackOutCoil(single.element, rungIndex, single.rowIndex);
        return;
      }

      const firstFactors = validBranches[startIdx].factors;
      let sharedEnd = firstFactors.length;
      for (let k = startIdx + 1; k < endIdx; k += 1) {
        const matchLen = commonPrefixLength(
          firstFactors.slice(0, sharedEnd),
          validBranches[k].factors
        );
        sharedEnd = Math.min(sharedEnd, matchLen);
      }

      const sharedSlice = firstFactors.slice(prefixDepth, sharedEnd);
      if (sharedSlice.length > 0) {
        if (isRoot) {
          emitLogicAst(factorsToAst(sharedSlice), 'LD', rungIndex, rawInstructions);
        } else {
          for (const factor of sharedSlice) {
            emitLogicAst(factor, 'AND', rungIndex, rawInstructions);
          }
        }
      }

      // Group contiguous sub-branches that share the next factor after sharedEnd
      const childGroups: [number, number][] = [];
      let g = startIdx;
      while (g < endIdx) {
        if (validBranches[g].factors.length === sharedEnd) {
          childGroups.push([g, g + 1]);
          g += 1;
          continue;
        }
        const nextFp = fingerprintLogicNode(validBranches[g].factors[sharedEnd]);
        let gEnd = g + 1;
        while (
          gEnd < endIdx &&
          validBranches[gEnd].factors.length > sharedEnd &&
          fingerprintLogicNode(validBranches[gEnd].factors[sharedEnd]) === nextFp
        ) {
          gEnd += 1;
        }
        childGroups.push([g, gEnd]);
        g = gEnd;
      }

      // WPLSoft gibi: koşulsuz çıkışlardan sonra yalnızca SON dal ek koşul taşıyorsa MPS gerekmez;
      // çıkışlar yazılır, ardından son dalın kontakları AND ile devam eder
      // (ör. TMR T0 K200 / SET Y0 / AND T0 / RST Y0). Diğer durumlarda MPS/MRD/MPP kullanılır.
      const isDirectLeaf = ([cs, ce]: [number, number]) =>
        ce - cs === 1 && validBranches[cs].factors.length === sharedEnd;
      const continuationForm = childGroups.slice(0, -1).every(isDirectLeaf);
      const needsMpsStack =
        !continuationForm &&
        childGroups.some(([cs, ce]) => ce - cs > 1 || validBranches[cs].factors.length > sharedEnd);

      for (let ci = 0; ci < childGroups.length; ci += 1) {
        const [cs, ce] = childGroups[ci];
        if (needsMpsStack) {
          const stackOp: IlOpcode =
            ci === 0 ? 'MPS' : ci === childGroups.length - 1 ? 'MPP' : 'MRD';
          rawInstructions.push({ opcode: stackOp, operands: [], rungIndex });
        }
        emitBranchCluster(cs, ce, sharedEnd, false);
      }
    };

    // Emit single or recursive nested MPS / MRD / MPP multi-output branches sharing a common logic prefix
    let idx = 0;
    while (idx < validBranches.length) {
      const first = validBranches[idx];
      let endIdx = idx + 1;
      let sharedPrefixLen = first.factors.length;

      while (endIdx < validBranches.length) {
        const nextPrefixLen = commonPrefixLength(
          first.factors.slice(0, sharedPrefixLen),
          validBranches[endIdx].factors
        );
        if (nextPrefixLen === 0) break;
        sharedPrefixLen = nextPrefixLen;
        endIdx += 1;
      }

      emitBranchCluster(idx, endIdx, 0, true);
      idx = endIdx;
    }
  });

  // 3. Double Coil check
  for (const [address, allEntries] of outCoilUsage.entries()) {
    // Farklı STL adımlarındaki aynı çıkış geçerlidir (yalnızca etkin adım yazar).
    const stepKeys = new Set(allEntries.map((e) => e.step ?? '__main__'));
    const conflicts =
      stepKeys.size === allEntries.length && !stepKeys.has('__main__') ? [] : allEntries;
    const entries = conflicts;
    if (entries.length > 1) {
      const formattedRungs = entries
        .map((e) => `Ağ ${String(e.rungIndex).padStart(3, '0')}`)
        .join(', ');
      const last = entries[entries.length - 1];
      diagnostics.push({
        severity: 'warning',
        code: 'DOUBLE_COIL',
        message: `Çift Bobin (Double Coil) uyarısı: ${address} bobini birden fazla yerde OUT olarak kullanılmış (${formattedRungs}). Son satır diğerini ezer.`,
        rungIndex: last.rungIndex,
        rowIndex: last.rowIndex,
        colIndex: last.colIndex,
        address,
      });
    }
  }

  // 4. END instruction check
  if (!hasEndRung) {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_END',
      message: 'Program sonunda END komutu bulunamadı.',
    });
  }

  // Assign Delta step addresses
  let currentStep = 0;
  const instructions: IlInstruction[] = rawInstructions.map((inst) => {
    const stepAddress = currentStep;
    currentStep += instructionStepCost(inst.opcode);
    return {
      ...inst,
      stepAddress,
    };
  });

  // Pure WPLSoft-compatible output WITHOUT line/step numbers (Ctrl+V ready)
  const rawIlText = instructions.map(formatIlLine).join('\n');

  return {
    instructions,
    rawIlText,
    diagnostics,
    stepCount: currentStep,
    hasErrors: diagnostics.some((d) => d.severity === 'error'),
  };
}
