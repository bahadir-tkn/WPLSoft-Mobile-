import type {
  CellElement,
  CompareOperator,
  ContactKind,
  LadderRung,
} from '../types/plc';
import { LADDER_COIL_COLUMN } from './plcModels';

export type LogicAstNode =
  | { kind: 'WIRE' }
  | {
      kind: 'CONTACT';
      contactType: ContactKind;
      address: string;
      rowIndex: number;
      colIndex: number;
    }
  | {
      kind: 'COMPARE';
      operator: CompareOperator;
      operandA: string;
      operandB: string;
      rowIndex: number;
      colIndex: number;
    }
  | {
      kind: 'AND';
      children: LogicAstNode[];
    }
  | {
      kind: 'OR';
      children: LogicAstNode[];
    };

export type OutputAstElement = Extract<
  CellElement,
  | { kind: 'COIL' }
  | { kind: 'TMR' }
  | { kind: 'CNT' }
  | { kind: 'MOV' }
  | { kind: 'ALT' }
  | { kind: 'ZRST' }
  | { kind: 'CMP' }
  | { kind: 'MATH' }
  | { kind: 'INCDEC' }
  | { kind: 'TRD' }
>;

export interface OutputGroupAst {
  logic: LogicAstNode | null;
  outputs: {
    rowIndex: number;
    element: OutputAstElement;
  }[];
  hasUnconnectedOutput: boolean;
}

export interface RungAst {
  rungIndex: number;
  isEnd: boolean;
  isEmpty: boolean;
  hasLogicWithoutOutput: boolean;
  outputGroups: OutputGroupAst[];
  unreducibleWarning?: string;
}

interface GraphEdge {
  id: number;
  from: string;
  to: string;
  orderKey: number;
  ast: LogicAstNode;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Keep LEFT_RAIL as canonical root whenever involved
    if (ra === 'LEFT_RAIL') {
      this.parent.set(rb, ra);
    } else if (rb === 'LEFT_RAIL') {
      this.parent.set(ra, rb);
    } else if (ra < rb) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(ra, rb);
    }
  }
}

export function isOutputElement(el: CellElement): el is OutputAstElement {
  return (
    el.kind === 'COIL' ||
    el.kind === 'TMR' ||
    el.kind === 'CNT' ||
    el.kind === 'MOV' ||
    el.kind === 'ALT' ||
    el.kind === 'ZRST' ||
    el.kind === 'CMP' ||
    el.kind === 'MATH' ||
    el.kind === 'INCDEC' ||
    el.kind === 'TRD'
  );
}

export function isLogicElement(el: CellElement): boolean {
  return el.kind === 'CONTACT' || el.kind === 'COMPARE' || el.kind === 'HLINE';
}

function combineAnd(a: LogicAstNode, b: LogicAstNode): LogicAstNode {
  if (a.kind === 'WIRE') return b;
  if (b.kind === 'WIRE') return a;
  const children: LogicAstNode[] = [];
  if (a.kind === 'AND') children.push(...a.children);
  else children.push(a);
  if (b.kind === 'AND') children.push(...b.children);
  else children.push(b);
  return { kind: 'AND', children };
}

function combineOr(a: LogicAstNode, b: LogicAstNode): LogicAstNode {
  if (a.kind === 'WIRE' && b.kind === 'WIRE') return { kind: 'WIRE' };
  const children: LogicAstNode[] = [];
  if (a.kind === 'OR') children.push(...a.children);
  else children.push(a);
  if (b.kind === 'OR') children.push(...b.children);
  else children.push(b);
  return { kind: 'OR', children };
}

/**
 * Reduces a directed series-parallel electrical graph from LEFT_RAIL to targetNet into a clean LogicAstNode.
 */
function reduceSeriesParallel(
  initialEdges: GraphEdge[],
  startNet: string,
  targetNet: string
): { ast: LogicAstNode | null; unreducible: boolean } {
  if (startNet === targetNet) {
    return { ast: { kind: 'WIRE' }, unreducible: false };
  }

  // Prune to edges on paths reachable from startNet and able to reach targetNet
  const pruneEdges = (edgeList: GraphEdge[]): GraphEdge[] => {
    const forward = new Map<string, string[]>();
    const backward = new Map<string, string[]>();
    for (const e of edgeList) {
      if (!forward.has(e.from)) forward.set(e.from, []);
      forward.get(e.from)!.push(e.to);
      if (!backward.has(e.to)) backward.set(e.to, []);
      backward.get(e.to)!.push(e.from);
    }

    const fromStart = new Set<string>([startNet]);
    const q1 = [startNet];
    while (q1.length > 0) {
      const cur = q1.shift()!;
      for (const nxt of forward.get(cur) ?? []) {
        if (!fromStart.has(nxt)) {
          fromStart.add(nxt);
          q1.push(nxt);
        }
      }
    }

    if (!fromStart.has(targetNet)) {
      return [];
    }

    const toTarget = new Set<string>([targetNet]);
    const q2 = [targetNet];
    while (q2.length > 0) {
      const cur = q2.shift()!;
      for (const prev of backward.get(cur) ?? []) {
        if (!toTarget.has(prev)) {
          toTarget.add(prev);
          q2.push(prev);
        }
      }
    }

    return edgeList.filter((e) => fromStart.has(e.from) && toTarget.has(e.to));
  };

  let edges = pruneEdges(initialEdges);
  if (edges.length === 0) {
    return { ast: null, unreducible: false };
  }

  let nextEdgeId = 10000;
  let changed = true;

  while (changed) {
    changed = false;

    // 1. Parallel reduction: merge edges with identical (from, to)
    const pairMap = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      const key = `${edge.from}->${edge.to}`;
      const list = pairMap.get(key);
      if (list) list.push(edge);
      else pairMap.set(key, [edge]);
    }

    const afterParallel: GraphEdge[] = [];
    for (const group of pairMap.values()) {
      if (group.length === 1) {
        afterParallel.push(group[0]);
      } else {
        group.sort((a, b) => a.orderKey - b.orderKey);
        let merged = group[0].ast;
        for (let i = 1; i < group.length; i += 1) {
          merged = combineOr(merged, group[i].ast);
        }
        afterParallel.push({
          id: nextEdgeId++,
          from: group[0].from,
          to: group[0].to,
          orderKey: group[0].orderKey,
          ast: merged,
        });
        changed = true;
      }
    }
    edges = afterParallel;

    // 2. Series reduction: collapse internal node with in-degree 1 and out-degree 1
    const incoming = new Map<string, GraphEdge[]>();
    const outgoing = new Map<string, GraphEdge[]>();
    const nodes = new Set<string>();

    for (const edge of edges) {
      nodes.add(edge.from);
      nodes.add(edge.to);
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from)!.push(edge);
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      incoming.get(edge.to)!.push(edge);
    }

    for (const node of nodes) {
      if (node === startNet || node === targetNet) continue;
      const inEdges = incoming.get(node) ?? [];
      const outEdges = outgoing.get(node) ?? [];
      if (inEdges.length === 1 && outEdges.length === 1) {
        const eIn = inEdges[0];
        const eOut = outEdges[0];
        if (eIn.id === eOut.id) continue;
        edges = edges.filter((e) => e.id !== eIn.id && e.id !== eOut.id);
        edges.push({
          id: nextEdgeId++,
          from: eIn.from,
          to: eOut.to,
          orderKey: Math.min(eIn.orderKey, eOut.orderKey),
          ast: combineAnd(eIn.ast, eOut.ast),
        });
        changed = true;
        break;
      }
    }
  }

  if (edges.length === 1 && edges[0].from === startNet && edges[0].to === targetNet) {
    return { ast: edges[0].ast, unreducible: false };
  }

  return { ast: null, unreducible: true };
}

/**
 * Extracts a structured Series-Parallel AST from a single LadderRung.
 */
export function buildRungAst(rung: LadderRung, rungIndex: number): RungAst {
  if (rung.isEnd) {
    return {
      rungIndex,
      isEnd: true,
      isEmpty: false,
      hasLogicWithoutOutput: false,
      outputGroups: [],
    };
  }

  const rowCount = rung.rows.length;
  const logicCols = LADDER_COIL_COLUMN;

  let hasAnyLogicCell = false;
  const outputs: { rowIndex: number; element: OutputAstElement }[] = [];

  for (let r = 0; r < rowCount; r += 1) {
    const row = rung.rows[r];
    for (let c = 0; c < logicCols; c += 1) {
      if (row[c] && isLogicElement(row[c].element)) {
        hasAnyLogicCell = true;
      }
    }
    const outCell = row[LADDER_COIL_COLUMN];
    if (outCell && isOutputElement(outCell.element)) {
      outputs.push({ rowIndex: r, element: outCell.element });
    }
  }

  if (!hasAnyLogicCell && outputs.length === 0) {
    return {
      rungIndex,
      isEnd: false,
      isEmpty: true,
      hasLogicWithoutOutput: false,
      outputGroups: [],
    };
  }

  if (hasAnyLogicCell && outputs.length === 0) {
    return {
      rungIndex,
      isEnd: false,
      isEmpty: false,
      hasLogicWithoutOutput: true,
      outputGroups: [],
    };
  }

  const uf = new UnionFind();
  const nodeKey = (r: number, boundaryCol: number) => `n_${r}_${boundaryCol}`;

  // Every left boundary at col 0 connects to LEFT_RAIL
  for (let r = 0; r < rowCount; r += 1) {
    uf.union('LEFT_RAIL', nodeKey(r, 0));
  }

  // Vertical branchDown lines connect boundary (r, c+1) with (r+1, c+1)
  for (let r = 0; r < rowCount - 1; r += 1) {
    const row = rung.rows[r];
    for (let c = 0; c < logicCols; c += 1) {
      if (row[c]?.branchDown) {
        uf.union(nodeKey(r, c + 1), nodeKey(r + 1, c + 1));
      }
    }
  }

  // Collapse HLINE wires directly into nets and collect active logic edges
  const rawEdges: GraphEdge[] = [];
  let edgeId = 1;

  for (let r = 0; r < rowCount; r += 1) {
    const row = rung.rows[r];
    for (let c = 0; c < logicCols; c += 1) {
      const cell = row[c];
      if (!cell) continue;
      if (cell.element.kind === 'HLINE') {
        uf.union(nodeKey(r, c), nodeKey(r, c + 1));
      }
    }
  }

  for (let r = 0; r < rowCount; r += 1) {
    const row = rung.rows[r];
    for (let c = 0; c < logicCols; c += 1) {
      const cell = row[c];
      if (!cell) continue;
      const fromNet = uf.find(nodeKey(r, c));
      const toNet = uf.find(nodeKey(r, c + 1));
      const orderKey = c * 1000 + r;

      if (cell.element.kind === 'CONTACT') {
        rawEdges.push({
          id: edgeId++,
          from: fromNet,
          to: toNet,
          orderKey,
          ast: {
            kind: 'CONTACT',
            contactType: cell.element.contactType,
            address: cell.element.address,
            rowIndex: r,
            colIndex: c,
          },
        });
      } else if (cell.element.kind === 'COMPARE') {
        rawEdges.push({
          id: edgeId++,
          from: fromNet,
          to: toNet,
          orderKey,
          ast: {
            kind: 'COMPARE',
            operator: cell.element.operator,
            operandA: cell.element.operandA,
            operandB: cell.element.operandB,
            rowIndex: r,
            colIndex: c,
          },
        });
      }
    }
  }

  // Group outputs that share the exact same input net at boundary LADDER_COIL_COLUMN
  const groupsByNet = new Map<
    string,
    { rowIndex: number; element: OutputAstElement }[]
  >();
  for (const out of outputs) {
    const net = uf.find(nodeKey(out.rowIndex, LADDER_COIL_COLUMN));
    const list = groupsByNet.get(net);
    if (list) list.push(out);
    else groupsByNet.set(net, [out]);
  }

  const outputGroups: OutputGroupAst[] = [];
  let unreducibleWarning: string | undefined;

  for (const [targetNet, groupedOutputs] of groupsByNet.entries()) {
    const reduced = reduceSeriesParallel(rawEdges, uf.find('LEFT_RAIL'), targetNet);
    if (reduced.unreducible) {
      unreducibleWarning = `Ağ ${String(rungIndex).padStart(3, '0')} karmaşık köprü bağlantısı içeriyor; seri-paralel yapıya basitleştirin.`;
    }
    outputGroups.push({
      logic: reduced.ast,
      outputs: groupedOutputs,
      hasUnconnectedOutput: reduced.ast === null && !reduced.unreducible,
    });
  }

  return {
    rungIndex,
    isEnd: false,
    isEmpty: false,
    hasLogicWithoutOutput: false,
    outputGroups,
    unreducibleWarning,
  };
}
