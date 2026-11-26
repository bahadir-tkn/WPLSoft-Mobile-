import { expect, test, type Page } from '@playwright/test';

interface RectBox {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function attachErrorCollectors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore Vite HMR WebSocket notices if HMR is disabled in preview environments
      if (/websocket|hmr/i.test(text)) return;
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  return {
    assertZeroErrors() {
      expect(
        consoleErrors,
        `Unexpected console errors:\n${consoleErrors.join('\n')}`
      ).toEqual([]);
      expect(
        pageErrors,
        `Unexpected page errors:\n${pageErrors.join('\n')}`
      ).toEqual([]);
    },
  };
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `Horizontal overflow detected: scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth}`
  ).toBeLessThanOrEqual(metrics.clientWidth);
}

async function assertNoHeaderOverlap(page: Page) {
  const boxes = await page.evaluate<RectBox[]>(() => {
    const header = document.querySelector('header');
    if (!header) return [];
    const controls = Array.from(
      header.querySelectorAll<HTMLElement>('button, select')
    ).filter((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    return controls.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        label:
          el.getAttribute('data-testid') ||
          el.id ||
          el.getAttribute('aria-label') ||
          el.tagName,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    });
  });

  // Simülasyon modunda başlıkta daha az düğme bulunur; en az iki görünür kontrol yeterlidir.
  expect(boxes.length).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(
        overlapX > 1 && overlapY > 1,
        `Header controls overlap: ${a.label} and ${b.label}`
      ).toBe(false);
    }
  }
}

async function submitQuickCommand(page: Page, cmd: string) {
  const input = page.getByTestId('quick-command-input');
  // Mobil görünümde komut satırı ">_" düğmesiyle açılır.
  if (!(await input.isVisible())) {
    const toggle = page.getByTestId('toggle-quick-cmd-btn');
    if (await toggle.isVisible()) await toggle.click();
  }
  await input.fill(cmd);
  await page.getByTestId('quick-command-submit').click();
}

test.describe('Desktop (1440x900) — WPLSoft Mobile Full Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('cell-0-0-0')).toBeVisible();
  });

  test('Ladder editing, QuickCommand seal-in, blank-rung OR rejection, and IL consistency', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);

    // 1. Blank rung must reject OR Y0 instead of silently converting to LD Y0
    await submitQuickCommand(page, 'OR Y0');
    await expect(page.getByTestId('quick-command-error')).toBeVisible();
    await expect(page.getByTestId('cell-0-0-0')).not.toContainText('Y0');

    // 2. Valid seal-in circuit via QuickCommand: LD X0 -> OR Y0 -> ANI X1 -> OUT Y0
    await submitQuickCommand(page, 'LD X0');
    await submitQuickCommand(page, 'OR Y0');
    await submitQuickCommand(page, 'ANI X1');
    await submitQuickCommand(page, 'OUT Y0');

    await expect(page.getByTestId('cell-0-0-0')).toContainText('X0');
    await expect(page.getByTestId('cell-0-1-0')).toContainText('Y0');
    await expect(page.getByTestId('cell-0-0-1')).toContainText('X1');
    await expect(page.getByTestId('cell-0-0-8')).toContainText('Y0');

    // Verify IL panel contains the exact Delta IL output
    const ilToggle = page.getByRole('button', {
      name: /Instruction List \(IL\) panelini/i,
    });
    if ((await ilToggle.getAttribute('aria-pressed')) !== 'true') {
      await ilToggle.click();
    }
    const normalizedBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    expect(normalizedBody).toContain('0000 LD X0');
    expect(normalizedBody).toContain('0001 OR Y0');
    expect(normalizedBody).toContain('0002 ANI X1');
    expect(normalizedBody).toContain('0003 OUT Y0');
    expect(normalizedBody).toContain('0004 END');

    await assertNoHorizontalOverflow(page);
    await assertNoHeaderOverlap(page);
    errors.assertZeroErrors();
  });

  test('WPLSoft drawing order: contact below first, then F10 joins it; Del/Enter keys; model-switch guard', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);
    const place = async (cell: string, key: string, addr: string) => {
      await page.getByTestId(cell).click();
      await page.keyboard.press(key);
      await page.locator('#cell-primary-input').fill(addr);
      await page.keyboard.press('Enter');
      await expect(page.locator('#cell-primary-input')).toBeHidden();
    };

    await place('cell-0-0-0', 'F1', 'X0');
    await place('cell-0-0-1', 'F2', 'X1');
    await place('cell-0-0-8', 'F7', 'Y0');
    // Gerçek WPLSoft sırası: önce alt satıra kontak, sonra dikey çizgi
    await place('cell-1-0-0', 'F1', 'Y0');
    await page.getByTestId('cell-0-0-1').click();
    await page.keyboard.press('F10');

    const ilList = page.getByTestId('il-code-list');
    await expect(ilList).toContainText(/LD\s*X0[\s\S]*OR\s*Y0[\s\S]*ANI\s*X1[\s\S]*OUT\s*Y0/);
    await expect(page.getByTestId('cell-0-1-0')).toContainText('Y0');

    // Seal-in works in simulation
    await page.getByTestId('toggle-online-btn').click();
    await page.getByTestId('input-btn-X0').click();
    await expect(page.getByTestId('output-led-Y0')).toHaveAttribute('aria-label', /ON/);
    await page.getByTestId('input-btn-X0').click();
    await expect(page.getByTestId('output-led-Y0')).toHaveAttribute('aria-label', /ON/);
    await page.getByTestId('input-btn-X1').click();
    await expect(page.getByTestId('output-led-Y0')).toHaveAttribute('aria-label', /OFF/);
    await page.getByTestId('toggle-online-btn').click();

    // Enter edits the selected element, Delete removes it
    await page.getByTestId('cell-0-0-0').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(page.locator('#cell-primary-input')).toHaveValue('X0');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('cell-0-0-0')).not.toContainText('X0');

    // Model switch is refused when the program uses SX2-only registers
    await page.getByTestId('open-templates-btn').click();
    await page.getByTestId('load-template-sx2-analog-temp').click();
    await page.locator('#plc-model-select').selectOption('DVP-14SS2');
    await expect(page.locator('#plc-model-select')).toHaveValue('DVP-SX2');
    await page.reload();
    await expect(page.getByTestId('il-code-list')).toContainText('D1110');

    errors.assertZeroErrors();
  });

  test('Textbook features: NP edge via contact dialog, STL/RET via dialog and quick command, step simulation', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);
    const ilList = page.getByTestId('il-code-list');

    // X0 → NP → INC D0
    await page.getByTestId('cell-0-0-0').click();
    await page.keyboard.press('F1');
    await page.locator('#cell-primary-input').fill('X0');
    await page.keyboard.press('Enter');
    await page.getByTestId('cell-0-0-1').click();
    await page.keyboard.press('F1');
    await page.getByTestId('contact-extra-NP').click();
    await expect(page.locator('#cell-primary-input')).toBeHidden();
    await page.locator('[role=dialog] button[type=submit]').click();
    await page.getByTestId('cell-0-0-8').click();
    await page.keyboard.press('F6');
    await page.getByTestId('app-cmd-INC').click();
    await page.locator('[role=dialog] button[type=submit]').click();
    await expect(ilList).toContainText(/LD\s*X0[\s\S]*NP[\s\S]*INC\s*D0/);

    // STL is refused on a non-empty rung
    await page.getByTestId('cell-0-0-0').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await page.getByTestId('contact-extra-STL').click();
    await expect(page.locator('[role=dialog] button[type=submit]')).toBeDisabled();
    await page.keyboard.press('Escape');

    // STL S10 on an empty rung, body + RET by quick command
    await page.getByTestId('cell-1-0-0').click();
    await page.keyboard.press('F1');
    await page.getByTestId('contact-extra-STL').click();
    await page.locator('#cell-primary-input').fill('S10');
    await page.locator('[role=dialog] button[type=submit]').click();
    await page.getByTestId('cell-2-0-0').click();
    for (const cmd of ['LD X1', 'OUT Y1', 'RET']) {
      await submitQuickCommand(page, cmd);
    }
    await expect(ilList).toContainText(/STL\s*S10[\s\S]*LD\s*X1[\s\S]*OUT\s*Y1[\s\S]*RET/);

    // Simulation: Y1 follows X1 only while step S10 is active
    await page.getByTestId('toggle-online-btn').click();
    await page.getByTestId('input-btn-X1').click();
    await expect(page.getByTestId('output-led-Y1')).toHaveAttribute('aria-label', /OFF/);
    await page.getByRole('tab', { name: 'M·T·C' }).click();
    await page.getByTestId('relay-S10').click();
    // Adım etkin: adım gövdesindeki Y1 bobini enerjilenir.
    await expect(page.getByTestId('cell-2-0-8')).toHaveAttribute('data-energized', 'true');

    errors.assertZeroErrors();
  });

  test('Output placed beside a dropped parallel branch connects to that branch (no extra branch)', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);
    const place = async (cell: string, key: string, addr: string) => {
      await page.getByTestId(cell).click();
      await page.keyboard.press(key);
      await page.locator('#cell-primary-input').fill(addr);
      await page.keyboard.press('Enter');
      await expect(page.locator('#cell-primary-input')).toBeHidden();
    };
    await place('cell-0-0-0', 'F1', 'X0');
    await place('cell-0-0-1', 'F1', 'X1');
    await place('cell-0-0-8', 'F7', 'Y0');
    await page.getByTestId('cell-0-0-1').click();
    await page.keyboard.press('F10');
    await place('cell-0-1-1', 'F7', 'Y1');
    // Y1, X0'dan sonra indirilen kola bağlanır: Y1 = X0, Y0 = X0 AND X1
    await expect(page.getByTestId('il-code-list')).toContainText(
      /LD\s*X0[\s\S]*MPS[\s\S]*AND\s*X1[\s\S]*OUT\s*Y0[\s\S]*MPP[\s\S]*OUT\s*Y1/
    );
    errors.assertZeroErrors();
  });

  test('Deney 4 repeat loop drawn by hand: T0/T1/C0 branches connect and the drum turns 4 times before draining', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = attachErrorCollectors(page);
    const at = async (cell: string, key: string, fields: string[], button?: string) => {
      await page.getByTestId(cell).click();
      await page.keyboard.press(key);
      await expect(page.locator('#cell-primary-input')).toBeVisible();
      if (button) await page.getByRole('button', { name: button, exact: true }).click();
      await page.locator('#cell-primary-input').fill(fields[0]);
      if (fields[1]) await page.locator('#cell-secondary-input').fill(fields[1]);
      await page.keyboard.press('Enter');
      await expect(page.locator('#cell-primary-input')).toBeHidden();
    };
    const branch = async (cell: string) => {
      await page.getByTestId(cell).click();
      await page.keyboard.press('F10');
    };
    const SET = 'SET (Mühürle)';
    const RST = 'RST (Sıfırla)';
    // Ağ 0: X0 -> SET M0, SET M13
    await at('cell-0-0-0', 'F1', ['X0']);
    await at('cell-0-0-8', 'F8', ['M0'], SET);
    await branch('cell-0-0-1');
    await at('cell-0-1-1', 'F8', ['M13'], SET);
    // Ağ 1: M0 M13 -> SET Y0 / TMR T0 K20 / T0 -> RST Y0, RST M13, SET M14
    await at('cell-1-0-0', 'F1', ['M0']);
    await at('cell-1-0-1', 'F1', ['M13']);
    await at('cell-1-0-8', 'F8', ['Y0'], SET);
    await branch('cell-1-0-2');
    await at('cell-1-1-2', 'F6', ['T0', 'K20']);
    await branch('cell-1-1-2');
    await at('cell-1-2-2', 'F1', ['T0']);
    await at('cell-1-2-3', 'F8', ['Y0'], RST);
    await branch('cell-1-2-3');
    await at('cell-1-3-3', 'F8', ['M13'], RST);
    await branch('cell-1-3-3');
    await at('cell-1-4-3', 'F8', ['M14'], SET);
    // Ağ 2: M0 M14 -> SET Y1 / TMR T1 K20 / T1 -> RST Y1, RST M14, SET M13, CNT C0 K4 / C0 -> RST M13, SET M15
    await at('cell-2-0-0', 'F1', ['M0']);
    await at('cell-2-0-1', 'F1', ['M14']);
    await at('cell-2-0-8', 'F8', ['Y1'], SET);
    await branch('cell-2-0-2');
    await at('cell-2-1-2', 'F6', ['T1', 'K20']);
    await branch('cell-2-1-2');
    await at('cell-2-2-2', 'F1', ['T1']);
    await at('cell-2-2-3', 'F8', ['Y1'], RST);
    await branch('cell-2-2-3');
    await at('cell-2-3-3', 'F8', ['M14'], RST);
    await branch('cell-2-3-3');
    await at('cell-2-4-3', 'F8', ['M13'], SET);
    await branch('cell-2-4-3');
    await at('cell-2-5-3', 'F6', ['C0', 'K4'], 'CNT');
    await branch('cell-2-5-3');
    await at('cell-2-6-3', 'F1', ['C0']);
    await at('cell-2-6-4', 'F8', ['M13'], RST);
    await branch('cell-2-6-4');
    await at('cell-2-7-4', 'F8', ['M15'], SET);
    // Ağ 3: M0 M15 -> SET Y4
    await at('cell-3-0-0', 'F1', ['M0']);
    await at('cell-3-0-1', 'F1', ['M15']);
    await at('cell-3-0-8', 'F8', ['Y4'], SET);

    // Föydeki komut listesiyle birebir aynı (T0/T1/C0 koşulları kaybolmaz)
    const il = (await page.getByTestId('il-code-list').innerText()).replace(/\d{4}/g, '').replace(/\s+/g, ' ');
    expect(il).toContain(
      'LD M0 AND M14 SET Y1 TMR T1 K20 AND T1 RST Y1 RST M14 SET M13 CNT C0 K4 AND C0 RST M13 SET M15'
    );
    expect(il).toContain('LD M0 AND M13 SET Y0 TMR T0 K20 AND T0 RST Y0 RST M13 SET M14');
    await expect(page.getByText('Derleme temiz')).toBeVisible();

    // Simülasyon (10x): kayıt X0'a basılmadan ÖNCE başlar, böylece ilk sağa dönüş kaçmaz.
    await page.getByTestId('toggle-online-btn').click();
    await page.getByTestId('sim-speed-10').click();
    await page.evaluate(() => {
      const w = window as unknown as { __seq: string[] };
      w.__seq = [];
      const read = () =>
        ['Y0', 'Y1', 'Y4']
          .filter((y) =>
            /ON/.test(document.querySelector(`[data-testid="output-led-${y}"]`)?.getAttribute('aria-label') ?? '')
          )
          .join('+') || '-';
      const timer = window.setInterval(() => {
        const v = read();
        if (w.__seq[w.__seq.length - 1] !== v) w.__seq.push(v);
        if (v === 'Y4') window.clearInterval(timer);
      }, 4);
    });
    await page.getByTestId('input-btn-X0').click();
    await page.getByTestId('input-btn-X0').click();
    await page.waitForFunction(() => (window as unknown as { __seq: string[] }).__seq.includes('Y4'), null, {
      timeout: 15_000,
    });
    const seq = await page.evaluate(() => (window as unknown as { __seq: string[] }).__seq);
    const rights = seq.filter((v) => v === 'Y0').length;
    const lefts = seq.filter((v) => v === 'Y1').length;
    expect(rights, seq.join(' ')).toBe(4);
    expect(lefts, seq.join(' ')).toBe(4);
    expect(seq[seq.length - 1]).toBe('Y4');
    errors.assertZeroErrors();
  });

  test('Deney 4 template (Deneyler tab) runs water → heat → detergent → 4 turns → drain', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = attachErrorCollectors(page);
    await page.getByTestId('open-templates-btn').click();
    await page.getByTestId('tpl-filter-experiment').click();
    await page.getByTestId('load-template-deney4-camasir-makinesi').click();
    await expect(page.getByTestId('il-code-list')).toContainText(/CNT\s*C0\s*K4/);
    await page.getByTestId('toggle-online-btn').click();
    await page.getByTestId('sim-speed-10').click();
    await page.getByTestId('input-btn-X0').click();
    await page.getByTestId('input-btn-X0').click();
    await expect(page.getByTestId('output-led-Y2')).toHaveAttribute('aria-label', /ON/);
    await page.getByTestId('input-btn-X1').click();
    await expect(page.getByTestId('output-led-Y5')).toHaveAttribute('aria-label', /ON/);
    await page.getByTestId('input-btn-X2').click();
    const seq = await page.evaluate(async () => {
      const read = () =>
        ['Y0', 'Y1', 'Y3', 'Y4']
          .filter((y) =>
            /ON/.test(document.querySelector(`[data-testid="output-led-${y}"]`)?.getAttribute('aria-label') ?? '')
          )
          .join('+') || '-';
      const out: string[] = [];
      const start = performance.now();
      while (performance.now() - start < 9000) {
        const v = read();
        if (out[out.length - 1] !== v) out.push(v);
        if (out.includes('Y4') && v === '-') break;
        await new Promise((r) => setTimeout(r, 5));
      }
      return out;
    });
    expect(seq.find((v) => v !== '-'), seq.join(' ')).toBe('Y3');
    expect(seq.filter((v) => v === 'Y0').length, seq.join(' ')).toBe(4);
    expect(seq.filter((v) => v === 'Y1').length, seq.join(' ')).toBe(4);
    expect(seq.slice(-2), seq.join(' ')).toEqual(['Y4', '-']);
    errors.assertZeroErrors();
  });

  test('WPLSoft .dvp export downloads a project file for DVP-SX2', async ({ page }) => {
    const errors = attachErrorCollectors(page);
    await page.getByTestId('open-templates-btn').click();
    await page.getByTestId('tpl-filter-experiment').click();
    await page.getByTestId('load-template-deney4-camasir-makinesi').click();
    await page.getByTestId('open-project-io-btn').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-dvp-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.dvp$/);
    const path = await download.path();
    const fs = await import('node:fs');
    const bytes = fs.readFileSync(path!);
    expect(bytes.length).toBeGreaterThan(100_000);
    expect(bytes[0]).toBe(0x57);
    expect(bytes.toString('latin1')).toContain('M0$&');
    await expect(page.getByTestId('dvp-errors')).toHaveCount(0);
    errors.assertZeroErrors();
  });

  test('StrictMode Undo/Redo reliability: single, sequential, redo, and future-clear on new edit', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);
    const undoBtn = page.getByRole('button', { name: 'Geri Al (Ctrl+Z)' });
    const redoBtn = page.getByRole('button', { name: 'İleri Al (Ctrl+Y)' });

    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Add 3 sequential commands
    await submitQuickCommand(page, 'LD X0');
    await submitQuickCommand(page, 'ANI X1');
    await submitQuickCommand(page, 'OUT Y0');

    await expect(page.getByTestId('cell-0-0-0')).toContainText('X0');
    await expect(page.getByTestId('cell-0-0-1')).toContainText('X1');
    await expect(page.getByTestId('cell-0-0-8')).toContainText('Y0');

    // Undo once -> removes OUT Y0 only
    await undoBtn.click();
    await expect(page.getByTestId('cell-0-0-8')).not.toContainText('Y0');
    await expect(page.getByTestId('cell-0-0-1')).toContainText('X1');
    await expect(redoBtn).toBeEnabled();

    // Undo second time -> removes ANI X1
    await undoBtn.click();
    await expect(page.getByTestId('cell-0-0-1')).not.toContainText('X1');
    await expect(page.getByTestId('cell-0-0-0')).toContainText('X0');

    // Redo restores ANI X1
    await redoBtn.click();
    await expect(page.getByTestId('cell-0-0-1')).toContainText('X1');

    // Undo once more, then add a brand-new command -> must clear Redo future
    await undoBtn.click();
    await expect(redoBtn).toBeEnabled();
    await page.getByTestId('cell-0-0-1').click();
    await submitQuickCommand(page, 'AND X2');
    await expect(page.getByTestId('cell-0-0-1')).toContainText('X2');
    await expect(redoBtn).toBeDisabled();

    // Undo all the way back to empty rung
    await undoBtn.click();
    await undoBtn.click();
    await expect(page.getByTestId('cell-0-0-0')).not.toContainText('X0');
    await expect(undoBtn).toBeDisabled();

    errors.assertZeroErrors();
  });

  test('Project library save, page reload persistence (zero data loss), and modal Escape closing', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);

    await submitQuickCommand(page, 'LD X0');
    await submitQuickCommand(page, 'OUT Y0');

    // Open Dosya / IL -> Projelerim -> save project
    await page.getByTestId('open-project-io-btn').click();
    await expect(page.getByTestId('project-io-modal')).toBeVisible();
    await page.getByTestId('io-tab-projects').click();
    await page.getByTestId('library-project-name-input').fill('Denetim_Test_Projesi');
    await page.getByTestId('save-project-library-btn').click();
    await expect(page.getByTestId('project-io-modal')).toContainText(
      'Denetim_Test_Projesi'
    );

    // Close modal with Escape key
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('project-io-modal')).toBeHidden();

    // Open and close Templates, Search, Wiring modals via Escape
    await page.getByTestId('open-templates-btn').click();
    await expect(page.getByTestId('templates-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('templates-modal')).toBeHidden();

    await page.getByTestId('open-search-btn').click();
    await expect(page.getByTestId('search-crossref-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-crossref-modal')).toBeHidden();

    await page.getByTestId('open-wiring-btn').click();
    await expect(page.getByTestId('wiring-diagram-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wiring-diagram-modal')).toBeHidden();

    // Reload browser and confirm zero data loss on both active Ladder draft and saved library
    await page.reload();
    await expect(page.getByTestId('cell-0-0-0')).toContainText('X0');
    await expect(page.getByTestId('cell-0-0-8')).toContainText('Y0');

    await page.getByTestId('open-project-io-btn').click();
    await page.getByTestId('io-tab-projects').click();
    await expect(page.getByTestId('project-io-modal')).toContainText(
      'Denetim_Test_Projesi'
    );

    await assertNoHorizontalOverflow(page);
    await assertNoHeaderOverlap(page);
    errors.assertZeroErrors();
  });
});

test.describe('Mobile (390x844) — WPLSoft Mobile Touch & Layout Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('cell-0-0-0')).toBeVisible();
  });

  test('Mobile command palette, zoom controls, grid horizontal scroll, and mobile Undo/Redo', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);

    // 1. No document-level overflow and no header control overlap on 390px viewport
    await assertNoHorizontalOverflow(page);
    await assertNoHeaderOverlap(page);

    // 2. Mobile Command Palette: open drawer, search TMR, verify 100ms & 10ms entries
    await page.getByTestId('mobile-command-menu-toggle').click();
    await expect(page.getByTestId('mobile-command-drawer')).toBeVisible();
    await page.getByTestId('mobile-command-search').fill('TMR');
    await expect(page.getByTestId('mobile-cmd-m-tmr-100')).toBeVisible();
    await expect(page.getByTestId('mobile-cmd-m-tmr-10')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mobile-command-drawer')).toBeHidden();

    // 3. Mobile zoom cycle button (75% → 100% → 125%) works without page overflow
    const zoomBtn = page.getByTestId('compact-zoom-btn');
    for (let i = 0; i < 3; i += 1) {
      await zoomBtn.click();
      await assertNoHorizontalOverflow(page);
    }

    // 4. Grid scroll container scrolls horizontally inside viewport while documentElement does not
    const scrollInfo = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(
        '[data-testid="ladder-scroll-container"]'
      );
      if (!scroller) return null;
      const before = scroller.scrollLeft;
      scroller.scrollLeft = 180;
      const after = scroller.scrollLeft;
      scroller.scrollLeft = 0;
      return {
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        before,
        after,
      };
    });
    expect(scrollInfo).not.toBeNull();
    expect(scrollInfo!.scrollWidth).toBeGreaterThan(scrollInfo!.clientWidth);
    expect(scrollInfo!.after).toBeGreaterThan(scrollInfo!.before);

    // 5. Mobile Undo / Redo buttons work accurately under StrictMode
    await submitQuickCommand(page, 'LD X0');
    await submitQuickCommand(page, 'OUT Y0');
    await expect(page.getByTestId('cell-0-0-0')).toContainText('X0');
    await expect(page.getByTestId('cell-0-0-8')).toContainText('Y0');

    await page.getByTestId('undo-btn').click();
    await expect(page.getByTestId('cell-0-0-8')).not.toContainText('Y0');
    await page.getByTestId('redo-btn').click();
    await expect(page.getByTestId('cell-0-0-8')).toContainText('Y0');

    await assertNoHorizontalOverflow(page);
    errors.assertZeroErrors();
  });

  test('Mobile virtual simulation mode, live I/O energization, and project library persistence', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);

    // Build LD X0 -> OUT Y0 and save to Projelerim
    await submitQuickCommand(page, 'LD X0');
    await submitQuickCommand(page, 'OUT Y0');

    // Mobilde Dosya / IL penceresi "⋯" menüsünden açılır.
    await page.getByTestId('header-more-btn').click();
    await page.getByTestId('header-more-menu').getByText('Dosya / IL Aktar').click();
    await page.getByTestId('io-tab-projects').click();
    await page.getByTestId('library-project-name-input').fill('Mobil_Test_Kayit');
    await page.getByTestId('save-project-library-btn').click();
    await expect(page.getByTestId('project-io-modal')).toContainText('Mobil_Test_Kayit');
    await page.getByTestId('close-project-io-btn').click();

    // Enter virtual simulation mode
    await page.getByTestId('toggle-online-btn').click();
    await expect(page.getByTestId('online-sim-bar')).toBeVisible();
    await expect(page.getByTestId('device-monitor')).toBeVisible();

    // Ensure no legacy "Online" wording appears in visible UI
    const simBodyText = await page.locator('body').innerText();
    expect(/\bOnline\b/.test(simBodyText)).toBe(false);

    // Toggle X0 ON and verify Y0 energizes in simulation
    await page.getByTestId('input-btn-X0').click();
    await expect(page.getByTestId('output-led-Y0')).toHaveAttribute(
      'aria-label',
      /ON|Aktif|Enerjili/i
    );

    await assertNoHorizontalOverflow(page);
    await assertNoHeaderOverlap(page);

    // Exit simulation and reload -> verify zero data loss
    await page.getByTestId('toggle-online-btn').click();
    await page.reload();
    await expect(page.getByTestId('cell-0-0-0')).toContainText('X0');
    await expect(page.getByTestId('cell-0-0-8')).toContainText('Y0');

    await assertNoHorizontalOverflow(page);
    errors.assertZeroErrors();
  });
});
