import type { CompileResult, LadderProgram } from '../types/plc';
import { formatIlLine } from './ilCompiler';
import { commentTargetForInstruction } from './ilParser';

/** Bir IL komutunun açıklamasını (varsa) döndürür. */
export function commentForInstruction(
  opcode: string,
  operands: string[],
  deviceComments: Record<string, string>
): string | undefined {
  const target = commentTargetForInstruction(opcode, [opcode, ...operands]);
  if (!target) return undefined;
  const text = deviceComments[target]?.trim();
  return text || undefined;
}

/**
 * Açıklamalı IL metni üretir:
 * - Ağ (segment) başlıkları, ağın ilk komutundan önce "// başlık" satırı olarak,
 * - Aygıt açıklamaları komutun sonunda "// açıklama" olarak yazılır.
 * Bu uygulamanın IL içe aktarıcısı bu biçimi okuyup açıklamaları geri yükler.
 */
export function buildCommentedIlText(program: LadderProgram, compiled: CompileResult): string {
  const lines: string[] = [];
  let lastRung = -1;
  const width = Math.max(14, ...compiled.instructions.map((i) => formatIlLine(i).length + 2));
  for (const inst of compiled.instructions) {
    if (inst.rungIndex !== lastRung) {
      lastRung = inst.rungIndex;
      const rungComment = program.rungs[inst.rungIndex]?.comment?.trim();
      if (rungComment && inst.opcode !== 'END') lines.push(`// ${rungComment}`);
    }
    const base = formatIlLine(inst);
    const comment = commentForInstruction(inst.opcode, inst.operands, program.deviceComments);
    lines.push(comment ? `${base.padEnd(width)}// ${comment}` : base);
  }
  return lines.join('\n');
}

/** Yalnızca açıklaması olan aygıtları adres sırasına göre listeler. */
export function listDeviceComments(program: LadderProgram): { address: string; comment: string }[] {
  const order = 'XYMTCD';
  return Object.entries(program.deviceComments)
    .filter(([, c]) => c.trim())
    .map(([address, comment]) => ({ address, comment: comment.trim() }))
    .sort((a, b) => {
      const ka = order.indexOf(a.address[0]);
      const kb = order.indexOf(b.address[0]);
      if (ka !== kb) return ka - kb;
      return Number(a.address.slice(1)) - Number(b.address.slice(1));
    });
}

/** Aygıt açıklama listesini sekmeyle ayrılmış metin olarak verir (Excel/WPLSoft tablosuna elle giriş için). */
export function buildDeviceCommentListText(program: LadderProgram): string {
  return listDeviceComments(program)
    .map((e) => `${e.address}\t${e.comment}`)
    .join('\n');
}
