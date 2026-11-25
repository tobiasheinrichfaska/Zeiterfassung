// Running monthly PDF in headless Chromium (MT-29 to MT-36, in part) against the local stand-in relay.
// Start the harness first (see README). Needs Node >= 22; the PDF is read back with the app's own code
// (loaded through Vite's SSR loader) and every document time stamp is checked with `openssl ts -verify`.
const { open, go } = require('./lib.cjs');
const fs = require('fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.tmp', 'e2e', 'out');
const PKI = path.join(ROOT, '.tmp', 'e2e', 'pki');
fs.mkdirSync(OUT, { recursive: true });
const res = [];
const ok = (n, c, d = '') => {
  res.push((c ? 'PASS ' : 'FAIL ') + n + (d ? '  -> ' + String(d).slice(0, 220) : ''));
  console.log(res.at(-1));
};
const ctl = async (v) => (await fetch('http://localhost:8791/mode' + (v ? `?v=${v}` : ''))).json();
const body = (p) => p.evaluate(() => document.body.innerText);

/** Reads a downloaded running PDF with the app's code and verifies each stamp with openssl. */
async function checker() {
  const { createServer } = await import('vite');
  const vs = await createServer({
    configFile: false,
    root: ROOT,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
    ssr: { noExternal: ['pdf-fortschreiben'] },
  });
  const run = await vs.ssrLoadModule('/src/logic/runningPdf.ts');
  const pf = await vs.ssrLoadModule('pdf-fortschreiben');
  const { PDFDocument } = await import('pdf-lib');
  return {
    close: () => vs.close(),
    async check(file, label, expectDays) {
      const bytes = new Uint8Array(fs.readFileSync(file));
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      const st = await run.runningPdfState(bytes);
      const v = st.ok ? st.value : null;
      ok(`${label}: pdf-lib loads it (${doc.getPageCount()} pages)`, doc.getPageCount() >= 2);
      ok(
        `${label}: state days = ${expectDays.join(',')}`,
        v && JSON.stringify(v.days) === JSON.stringify(expectDays),
        JSON.stringify(v),
      );
      ok(
        `${label}: newest revision stamped, no changed attachments`,
        !!v && v.newestStamped && v.attachmentChanges.length === 0,
      );
      const names = (await pf.readAttachments(new pf.PdfFile(bytes))).map((a) => a.name);
      ok(
        `${label}: attachments = beginn + one per day`,
        names.some((n) => /-beginn\.json$/.test(n)) &&
          expectDays.every((d) =>
            names.includes(`zeiterfassung-${d.slice(0, 7)}-tag-${d.slice(8)}.json`),
          ),
        names.join(' '),
      );
      const stamps = pf.findDocTimeStamps(bytes);
      ok(
        `${label}: ${stamps.length} document time stamps, all rangeOk`,
        stamps.length >= 1 && stamps.every((s) => s.rangeOk),
      );
      for (const [i, s] of stamps.entries()) {
        fs.writeFileSync(path.join(PKI, 'd.token'), s.token);
        const r = spawnSync(
          'openssl',
          [
            'ts',
            '-verify',
            '-in',
            path.join(PKI, 'd.token'),
            '-token_in',
            '-digest',
            Buffer.from(s.digest).toString('hex'),
            '-sha256',
            '-CAfile',
            path.join(PKI, 'root.crt'),
            '-untrusted',
            path.join(PKI, 'chain.pem'),
          ],
          { encoding: 'utf8' },
        );
        ok(
          `${label}: openssl verifies stamp ${i + 1} (revision ${s.revision})`,
          r.status === 0,
          (r.stdout + r.stderr).trim(),
        );
      }
    },
  };
}

(async () => {
  const chk = await checker();
  const { browser, ctx, page, log } = await open();
  const reqs = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:5178')) reqs.push(r.method() + ' ' + r.url());
  });
  page.on('dialog', (d) => d.accept());
  await ctl('normal');
  await page.clock.install({ time: new Date() });
  await page.goto('http://localhost:5178/');
  await page.waitForTimeout(1500);
  const btn = (n) => page.getByRole('button', { name: n, exact: true });
  const sleep = (ms) => page.waitForTimeout(ms);
  const wait = async (f, ms = 20000) => {
    for (let t = 0; t < ms; t += 500) {
      if (await f().catch(() => false)) return true;
      await sleep(500);
    }
    return false;
  };
  const section = () => page.locator('section[aria-label="Laufendes Monats-PDF"]');
  const secText = () => section().innerText();
  const toMonth = async () => {
    await go(page, 'Monat');
    await sleep(300);
  };
  const dismiss = async () => {
    const g = page.getByRole('button', { name: 'Gelesen' });
    while (await g.count()) await g.first().click();
  };
  const dayStamp = async (scope, hoursBetween = 2) => {
    await btn('Kommen').first().click();
    await sleep(300);
    await page.clock.fastForward(`${String(hoursBetween).padStart(2, '0')}:00:00`);
    await btn('Gehen').first().click();
    await sleep(300);
  };
  const stampPage = async () => go(page, 'Stempeln');
  const download = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), btn(name).click()]);
    const f = path.join(OUT, 'rp-' + dl.suggestedFilename());
    await dl.saveAs(f);
    return f;
  };

  await go(page, 'Einstellungen');
  await page
    .getByLabel('Externer Zeitstempeldienst (Weiterreicher)')
    .selectOption('http://localhost:8790');
  await btn('Speichern').click();
  await sleep(500);
  const d1 = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  console.log('device date', d1);

  // --- 1 first day: appended and stamped
  await stampPage();
  await dayStamp();
  await toMonth();
  ok(
    '1 section: day appended and stamped',
    await wait(async () => /Der neueste Stand ist gestempelt/.test(await secText())),
    (await secText()).replace(/\s+/g, ' '),
  );
  const t1 = await secText();
  ok(
    '1 section lines: 1 Tag, 1 Dokument-Zeitstempel (laut Token)',
    /1 Tag\(e\) enthalten/.test(t1) && /1 Dokument-Zeitstempel, letzter .*laut Token/.test(t1),
    t1.replace(/\s+/g, ' '),
  );
  ok('1 no red alert in the section', (await section().getByRole('alert').count()) === 0);
  const f1 = await download('Laufendes PDF speichern');
  const size1 = fs.statSync(f1).size;
  console.log('PDF size after day 1:', size1);
  await chk.check(f1, '1 download', [d1]);
  const posts = reqs.filter((r) => r.startsWith('POST'));
  ok(
    '1 only relay requests (GET services / POST stamp)',
    reqs.every((r) => r.includes('localhost:8790/v1/')) && posts.length >= 1,
    reqs.length + ' reqs, ' + posts.length + ' posts',
  );

  // --- 4a reload keeps everything
  await page.reload();
  await sleep(2500);
  await toMonth();
  const t1r = await secText();
  ok(
    '4a reload: same section text',
    t1r === t1 || (/1 Tag\(e\)/.test(t1r) && /gestempelt/.test(t1r) && !/noch nicht/.test(t1r)),
    t1r.replace(/\s+/g, ' '),
  );

  // --- 2 relay down at Gehen, then back
  await sleep(61000); // relay budget per minute
  await ctl('fail504');
  await page.clock.fastForward('24:00:00');
  await page.waitForTimeout(500);
  const d2 = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  await stampPage();
  await dayStamp();
  await toMonth();
  ok(
    '2 day 2 appended while relay is down',
    await wait(async () => /2 Tag\(e\) enthalten/.test(await secText())),
    (await secText()).replace(/\s+/g, ' '),
  );
  await sleep(2000);
  const t2 = await secText();
  ok(
    '2 unstamped state kept and shown',
    /Der neueste Stand ist noch nicht gestempelt/.test(t2) && /1 Dokument-Zeitstempel/.test(t2),
    t2.replace(/\s+/g, ' '),
  );
  const alert = section().getByRole('alert').first();
  const al = (await alert.count()) ? await alert.innerText() : '';
  ok('2 red alert with reason', /nicht gestempelt|nicht erreichbar|Zeitstempel/i.test(al), al);
  const col = (await alert.count())
    ? await alert.evaluate(
        (e) => getComputedStyle(e).color + ' / ' + getComputedStyle(e).borderColor,
      )
    : '';
  console.log('alert colours:', col);
  await page.screenshot({ path: OUT + '/rp-unstamped.png', fullPage: true });
  await dismiss();
  await ctl('normal');
  await sleep(61000);
  await page.clock.fastForward('15:10');
  ok(
    '2 relay back: stamped by the 15-minute retry',
    await wait(async () => /Der neueste Stand ist gestempelt/.test(await secText()), 30000),
    (await secText()).replace(/\s+/g, ' '),
  );
  ok(
    '2 now 2 document stamps',
    /2 Dokument-Zeitstempel/.test(await secText()),
    (await secText()).replace(/\s+/g, ' '),
  );
  ok('2 alert gone', (await section().getByRole('alert').count()) === 0);
  const f2 = await download('Laufendes PDF speichern');
  console.log('PDF size after day 2:', fs.statSync(f2).size);
  await chk.check(f2, '2 download', [d1, d2]);

  // --- 3 month change
  const mon = (d) => d.slice(0, 7);
  const next = new Date(Date.UTC(Number(d2.slice(0, 4)), Number(d2.slice(5, 7)), 3, 9, 0, 0)); // 3rd of next month
  const nextKey = next.toISOString().slice(0, 7);
  await sleep(61000);
  await page.clock.setSystemTime(next);
  await page.reload();
  await sleep(3000);
  console.log('device date after set', await page.evaluate(() => new Date().toISOString()));
  const banner = page.getByRole('status').filter({ hasText: 'Monatsdatei bitte speichern' });
  ok(
    '3a reminder banner on the 3rd',
    await wait(async () => (await banner.count()) > 0),
    (await body(page)).slice(0, 200),
  );
  ok(
    '3a banner names the previous month',
    (await banner.first().innerText()).includes('November 2026'),
    await banner.first().innerText(),
  );
  ok(
    '3a no forced dialog yet',
    (await page.getByRole('dialog', { name: 'Monatsdatei speichern' }).count()) === 0,
  );
  await toMonth();
  await btn('◀ Vormonat')
    .click()
    .catch(() => {});
  await sleep(300);
  const hasMonth = (await page.locator('strong[aria-live]').innerText()).includes('November');
  if (!hasMonth) await btn('◀ Vormonat').click();
  const tPrev = await secText();
  ok(
    '3a previous month still in the vault (2 days)',
    /2 Tag\(e\) enthalten/.test(tPrev),
    tPrev.replace(/\s+/g, ' '),
  );
  await dismiss();
  await btn('Später').click();
  // a day in the new month starts its file
  await stampPage();
  await dayStamp();
  await toMonth();
  const dNew = nextKey;
  const cur = await wait(async () => {
    const m = await page.locator('strong[aria-live]').innerText();
    if (/Dezember/.test(m)) return /1 Tag\(e\) enthalten/.test(await secText());
    await btn('Nächster Monat ▶').click();
    return false;
  });
  ok(
    `3a current month (${dNew}) started with its day`,
    cur,
    (await secText()).replace(/\s+/g, ' '),
  );
  ok(
    '3a current month stamped',
    await wait(async () => /Der neueste Stand ist gestempelt/.test(await secText()), 20000),
    (await secText()).replace(/\s+/g, ' '),
  );
  const fDec = await download('Laufendes PDF speichern');
  console.log('PDF size December:', fs.statSync(fDec).size);

  // 8th: forced
  await sleep(61000);
  await page.clock.setSystemTime(
    new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 8, 9, 0, 0)),
  );
  await page.reload();
  await sleep(3000);
  const dlg = page.getByRole('dialog', { name: 'Monatsdatei speichern' });
  ok(
    '3b forced overlay on the 8th',
    await wait(async () => (await dlg.count()) > 0),
    (await body(page)).slice(0, 200),
  );
  const covered = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Monatsdatei speichern"]'); // (rad-navi's frame is a dialog too)
    const at = (x, y) => document.elementFromPoint(x, y);
    return [
      [200, 100],
      [200, 400],
      [200, 700],
      [60, 760],
    ].every(([x, y]) => dlg && dlg.contains(at(x, y)));
  });
  ok('3b overlay covers pages (wheel area included)', covered);
  const sec = dlg.getByRole('region', { name: /Monatsdatei November/ });
  const confirmBtn = dlg.getByRole('button', { name: 'Gespeichert – aus der App entfernen' });
  ok('3b confirm disabled before saving', await confirmBtn.isDisabled());
  ok(
    '3b hint "Erst speichern oder teilen"',
    (await dlg.innerText()).includes('Erst speichern oder teilen'),
  );
  // stamping still works inside the overlay
  await dlg.getByRole('button', { name: 'Kommen', exact: true }).click();
  await sleep(400);
  const goBtn = dlg.getByRole('button', { name: 'Gehen', exact: true });
  ok('3b stamping works in the overlay (Kommen -> Gehen enabled)', await goBtn.isEnabled());
  await page.clock.fastForward('02:00:00');
  await goBtn.click();
  await sleep(500);
  ok('3b overlay still there after stamping', (await dlg.count()) === 1);
  const [dl8] = await Promise.all([
    page.waitForEvent('download'),
    dlg.getByRole('button', { name: 'Speichern', exact: true }).click(),
  ]);
  const fNov = path.join(OUT, 'rp-forced-' + dl8.suggestedFilename());
  await dl8.saveAs(fNov);
  await sleep(300);
  ok('3b confirm enabled after the download', await confirmBtn.isEnabled());
  console.log('PDF size forced save (November):', fs.statSync(fNov).size);
  await chk.check(fNov, '3b saved November file', [d1, d2]);
  await confirmBtn.click();
  ok('3b overlay gone after confirming', await wait(async () => (await dlg.count()) === 0));
  await toMonth();
  await btn('◀ Vormonat').click();
  await sleep(300);
  const gone = await secText();
  ok(
    '3c previous month removed from the vault',
    /gespeichert und aus der App entfernt/.test(gone) && /keine laufende Monatsdatei/.test(gone),
    gone.replace(/\s+/g, ' '),
  );
  await btn('Nächster Monat ▶').click();
  ok(
    '3c current month file still there',
    /Tag\(e\) enthalten/.test(await secText()),
    (await secText()).replace(/\s+/g, ' '),
  );

  // --- 4b reload at the end
  await page.reload();
  await sleep(3000);
  ok(
    '4b reload: no forced dialog, no banner',
    (await dlg.count()) === 0 && (await banner.count()) === 0,
  );
  await toMonth();
  await btn('◀ Vormonat').click();
  await sleep(300);
  ok(
    '4b reload: November stays removed and not recreated',
    /aus der App entfernt/.test(await secText()),
    (await secText()).replace(/\s+/g, ' '),
  );
  await btn('Nächster Monat ▶').click();
  ok(
    '4b reload: December file kept (2 days)',
    /2 Tag\(e\) enthalten/.test(await secText()),
    (await secText()).replace(/\s+/g, ' '),
  );

  // --- 5 console
  const bad = log.filter((l) => !/504|502|Failed to load resource/.test(l));
  const csp = log.filter((l) => /CSPV|Content Security|Content-Security/i.test(l));
  console.log('LOG', JSON.stringify(log));
  ok('5 no CSP violations', csp.length === 0, csp.join(' | '));
  ok(
    '5 no console errors / page errors (relay 504 resource lines excluded)',
    bad.length === 0,
    bad.join(' | '),
  );
  fs.writeFileSync(OUT + '/runningpdf-results.txt', res.join('\n'));
  console.log(res.filter((r) => r.startsWith('FAIL')).length + ' FAIL of ' + res.length);
  await browser.close();
  await chk.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
