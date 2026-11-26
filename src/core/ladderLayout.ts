import type { LadderCellData, LadderProgram, LadderRung } from '../types/plc';
import { compileLadderToIl } from './ilCompiler';
import { createEndRung } from './gridFactory';
import { LADDER_COIL_COLUMN, LADDER_TOTAL_COLUMNS } from './plcModels';

/**
 * Komut listesinden çizilen ağlarda, yalnızca çıkıştan oluşan alt satırlar (SET/RST/OUT ...)
 * üst satıra en sağdaki dikey çizgiyle bağlanır. WPLSoft ve deney föyleri aynı bağlantıyı,
 * dalın ayrıldığı kontağın hemen sağından inen dikey çizgiyle gösterir. Bu fonksiyon çizimi
 * o biçime getirir.
 *
 * Değişiklik yalnızca görünüştür: üst satırda kontaktan sonra çıkışa kadar sadece yatay çizgi
 * olduğu için iki nokta aynı elektriksel düğümdür. Yine de her adımdan sonra ağ derlenir ve
 * komut listesi değişirse o adım geri alınır.
 */
export function alignOutputBranchesLeft(rung: LadderRung, model: LadderProgram['model']): LadderRung {
  if (rung.isEnd || rung.rows.length < 2) return rung;

  const compileRung = (r: LadderRung) =>
    compileLadderToIl({
      version: '1.0',
      projectName: 'layout-check',
      model,
      columns: LADDER_TOTAL_COLUMNS,
      rungs: [r, createEndRung()],
      deviceComments: {},
      updatedAt: '',
    })
      .instructions.map((i) => `${i.opcode} ${i.operands.join(' ')}`)
      .join('\n');

  const reference = compileRung(rung);
  let current: LadderRung = rung;

  for (let lower = 1; lower < current.rows.length; lower += 1) {
    const upper = lower - 1;
    const upperRow = current.rows[upper];
    const lowerRow = current.rows[lower];
    const out = lowerRow[LADDER_COIL_COLUMN]?.element.kind;
    if (!out || out === 'EMPTY' || out === 'HLINE' || out === 'END') continue;
    // Alt satırda çıkıştan başka eleman yok ve üst satıra sağdan bağlı
    if (lowerRow.slice(0, LADDER_COIL_COLUMN).some((c) => c.element.kind !== 'EMPTY')) continue;
    if (!upperRow[LADDER_COIL_COLUMN - 1]?.branchDown) continue;
    // Üst satırda çıkışa kadar uzanan yatay çizginin başladığı sütun
    let b = LADDER_COIL_COLUMN - 1;
    while (b >= 0 && upperRow[b].element.kind === 'HLINE') b -= 1;
    b += 1;
    if (b < 1 || b > LADDER_COIL_COLUMN - 1) continue;

    const rows = current.rows.map((row) => row.map((cell): LadderCellData => ({ ...cell })));
    for (let c = b; c < LADDER_COIL_COLUMN; c += 1) {
      rows[lower][c] = { ...rows[lower][c], element: { kind: 'HLINE' } };
    }
    rows[upper][LADDER_COIL_COLUMN - 1] = { ...rows[upper][LADDER_COIL_COLUMN - 1], branchDown: false };
    rows[upper][b - 1] = { ...rows[upper][b - 1], branchDown: true };
    // Alt satır sağdan başka bir satıra devam ediyorsa (zincir), o bağlantı korunur.

    const candidate: LadderRung = { ...current, rows };
    if (compileRung(candidate) === reference) current = candidate;
  }
  return current;
}
