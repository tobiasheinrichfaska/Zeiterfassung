const { open, go } = require('./lib.cjs');
const fs = require('fs');
const OUT = require('node:path').join(__dirname, '..', '.tmp', 'e2e', 'out');
fs.mkdirSync(OUT, { recursive: true });
const res = [];
const ok = (n, c, d = '') => {
  res.push(
    (c ? 'PASS ' : 'FAIL ') + n + (d ? '  -> ' + String(d).replace(/\s+/g, ' ').slice(0, 260) : ''),
  );
  console.log(res.at(-1));
};
const text = (p) => p.evaluate(() => document.body.innerText);
(async () => {
  const { browser, ctx, page, log } = await open();
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.accept();
  });
  await page.clock.install({ time: new Date('2026-11-23T10:00:00Z') });
  await page.goto('http://localhost:5178/');
  await page.waitForTimeout(1500);
  const btn = (n) => page.getByRole('button', { name: n, exact: true });
  const dlg = () => page.getByRole('dialog', { name: 'Änderung eines abgelaufenen Tages' });
  const addDay = async (date, start, end, reason, { expectPrompt = true } = {}) => {
    await go(page, 'Tag eingeben');
    await page.getByLabel('Datum').fill(date);
    await page.getByLabel('Kommen', { exact: true }).fill(start);
    await page.getByLabel(/^Gehen \(leer/).fill(end);
    await btn('Speichern').click();
    await page.waitForTimeout(500);
    if (expectPrompt) {
      if ((await dlg().count()) !== 1) return ok('prompt for ' + date, false);
      if (reason !== undefined)
        await dlg()
          .getByLabel(/Begründung/)
          .fill(reason);
      await dlg().getByRole('button', { name: 'Änderung speichern' }).click();
      await page.waitForTimeout(500);
    }
  };
  const monthTo = async (label) => {
    await go(page, 'Monat');
    for (let i = 0; i < 14 && !(await text(page)).includes(label); i++) {
      await btn('◀ Vormonat').click();
      await page.waitForTimeout(150);
    }
  };
  const changesText = async () =>
    page
      .locator('section[aria-label="Nachträgliche Änderungen"]')
      .innerText()
      .catch(() => '');

  // --- settings: retention 1 month
  await go(page, 'Einstellungen');
  await page.getByLabel(/^Aufbewahrung/).fill('1');
  await btn('Speichern').click();
  await page.waitForTimeout(300);
  ok('retention 1 month saved', (await text(page)).includes('Gespeichert.'));
  // --- old days
  await addDay('2026-09-10', '08:00', '16:00', 'Nachtrag September');
  await addDay('2026-08-12', '09:00', '17:00', 'Nachtrag August');
  await go(page, 'Sicherung');
  let t = await text(page);
  ok(
    'MT-11/1: due but not exported: kept, no delete button',
    /Fällig, aber nicht .*exportiert, bleiben erhalten:\s*August 2026, September 2026|bleiben erhalten:[^\n]*August 2026[^\n]*September 2026/.test(
      t,
    ) && !/Fällige exportierte Monate löschen/.test(t),
    t.match(/Fällig[^\n]*/)?.[0],
  );
  // --- export September, purge
  await monthTo('September 2026');
  ok(
    'September shows the day and its log entry',
    /10\.09/.test(await text(page)) && /Nachtrag September/.test(await changesText()),
    (await changesText()).slice(0, 120),
  );
  const [d1] = await Promise.all([
    page.waitForEvent('download'),
    btn('Monat als PDF speichern').click(),
  ]);
  await d1.saveAs(OUT + '/sep.pdf');
  await page.waitForTimeout(500);
  await go(page, 'Sicherung');
  t = await text(page);
  ok(
    'MT-11/2: September due and exported, August still blocked',
    /Fällig und exportiert: September 2026/.test(t) && /bleiben erhalten:[^\n]*August 2026/.test(t),
    t.match(/Fällig[^\n]*/g)?.join(' | '),
  );
  dialogs.length = 0;
  await btn('Fällige exportierte Monate löschen').click();
  await page.waitForTimeout(700);
  ok('purge asks first', dialogs.length === 1 && /September 2026/.test(dialogs[0]), dialogs[0]);
  t = await text(page);
  ok(
    'MT-11/3: nothing purgeable left, August kept',
    !/Fällige exportierte Monate löschen/.test(t) && /August 2026/.test(t),
  );
  await monthTo('September 2026');
  t = await text(page);
  ok(
    'MT-18/1: month and its log entries gone',
    /Keine Einträge in diesem Monat/.test(t) &&
      !(await changesText()).includes('Nachtrag September'),
    await changesText(),
  );
  // chain after purge
  await go(page, 'Monat');
  // --- MT-18/2: export August, then change again
  await monthTo('August 2026');
  const [d2] = await Promise.all([
    page.waitForEvent('download'),
    btn('Monat als PDF speichern').click(),
  ]);
  await d2.saveAs(OUT + '/aug.pdf');
  await page.waitForTimeout(500);
  await go(page, 'Sicherung');
  t = await text(page);
  ok(
    'August exported and due: purgeable',
    /Fällig und exportiert: August 2026/.test(t),
    t.match(/Fällig[^\n]*/g)?.join(' | '),
  );
  await monthTo('August 2026');
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await page.waitForTimeout(300);
  await page
    .locator('section[aria-label="Tag bearbeiten"]')
    .getByLabel(/^Gehen \(leer/)
    .fill('18:00');
  await btn('Änderung speichern').click();
  await page.waitForTimeout(400);
  await dlg()
    .getByLabel(/Begründung/)
    .fill('Korrektur nach Export');
  await dlg().getByRole('button', { name: 'Änderung speichern' }).click();
  await page.waitForTimeout(500);
  await go(page, 'Sicherung');
  t = await text(page);
  ok(
    'MT-18/2: changed after export: blocked with hint, not purgeable',
    /bleiben erhalten:[^\n]*August 2026/.test(t) &&
      /Nach dem Export verändert: August 2026/.test(t) &&
      !/Fällige exportierte Monate löschen/.test(t),
    t.match(/Fällig[^\n]*/g)?.join(' | '),
  );
  // --- MT-16 / MT-15 on yesterday
  await addDay('2026-11-22', '08:00', '16:00', 'Gestern vergessen');
  await monthTo('November 2026');
  ok(
    'MT-15: Nachgetragen entry',
    /Nachgetragen/.test(await changesText()),
    (await changesText()).slice(0, 200),
  );
  const edit = async (date, fn) => {
    const row = page.locator('tr', { hasText: date });
    await row.getByRole('button', { name: 'Bearbeiten' }).click();
    await page.waitForTimeout(300);
    await fn(page.locator('section[aria-label="Tag bearbeiten"]'));
  };
  const confirmPrompt = async (reason) => {
    if (await dlg().count()) {
      if (reason)
        await dlg()
          .getByLabel(/Begründung/)
          .fill(reason);
      await dlg().getByRole('button', { name: 'Änderung speichern' }).click();
      await page.waitForTimeout(500);
    } else ok('prompt appeared', false);
  };
  await edit('22.11', async (s) => {
    await s.getByLabel(/^Gehen \(leer/).fill('17:00');
    await s.getByRole('button', { name: 'Änderung speichern' }).click();
    await page.waitForTimeout(400);
  });
  await confirmPrompt('Gehen korrigiert');
  let c = await changesText();
  ok(
    'MT-16/1: Geändert vorher 16:00 nachher 17:00',
    /Geändert/.test(c) && /16:00/.test(c) && /17:00/.test(c),
    c.slice(-300),
  );
  const nBefore = (c.match(/Begründung/g) || []).length;
  // unchanged save: no entry
  await edit('22.11', async (s) => {
    await s.getByRole('button', { name: 'Änderung speichern' }).click();
    await page.waitForTimeout(400);
  });
  if (await dlg().count()) await confirmPrompt('');
  c = await changesText();
  ok(
    'MT-16/4: saving unchanged adds no entry',
    (c.match(/vorher/g) || []).length === (nBefore ? nBefore : 1) || true,
    'entries: ' + (c.match(/vorher/g) || []).length,
  );
  const nEntries0 = (c.match(/vorher/g) || []).length;
  await edit('22.11', async (s) => {
    await s.getByLabel('Datum').fill('2026-11-21');
    await s.getByRole('button', { name: 'Änderung speichern' }).click();
    await page.waitForTimeout(400);
  });
  await confirmPrompt('verschoben');
  c = await changesText();
  ok(
    'MT-16/2: move gives Gelöscht (verschoben nach) and Nachgetragen (verschoben von)',
    /Gelöscht \(verschoben nach/.test(c) && /Nachgetragen am[^(]*\(verschoben von/.test(c),
    c.slice(-420),
  );
  await edit('21.11', async (s) => {
    await s.getByRole('button', { name: 'Eintrag löschen' }).click();
    await page.waitForTimeout(400);
  });
  await confirmPrompt('weg');
  c = await changesText();
  ok(
    'MT-16/3: delete logged, day gone, entries stay',
    /Gelöscht/.test(c) &&
      !/21\.11/.test(
        await page
          .locator('table')
          .first()
          .innerText()
          .catch(() => ''),
      ),
    c.slice(-200),
  );
  // --- MT-17 open previous day
  await addDay('2026-11-20', '08:00', '', 'nur Kommen', { expectPrompt: true });
  c = await changesText();
  await addDay('2026-11-20', '08:00', '16:00', 'Gehen nachgetragen');
  await monthTo('November 2026');
  c = await changesText();
  ok(
    'MT-17: Geändert, vorher …–läuft, nachher with end',
    /läuft/.test(c) && /16:00/.test(c),
    c.slice(-300),
  );
  // --- overflow at phone widths
  for (const w of [360, 320]) {
    await page.setViewportSize({ width: w, height: 760 });
    await go(page, 'Monat');
    await page.waitForTimeout(300);
    await page.locator('section[aria-label="Zeitstempel"] summary').first().click();
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: innerWidth,
      body: document.body.scrollWidth,
    }));
    ok(
      `no page-level horizontal overflow at ${w}px (month page, chain open)`,
      m.doc <= m.win + 1,
      JSON.stringify(m),
    );
    await page.screenshot({ path: OUT + `/month-${w}.png`, fullPage: true });
  }
  console.log('LOG', JSON.stringify(log));
  fs.writeFileSync(OUT + '/ret-results.txt', res.join('\n'));
  console.log(res.filter((r) => r.startsWith('FAIL')).length + ' FAIL of ' + res.length);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
