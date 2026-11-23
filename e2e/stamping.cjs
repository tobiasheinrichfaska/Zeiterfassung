const { open, go } = require('./lib.cjs');
const fs = require('fs');
const OUT = require('node:path').join(__dirname, '..', '.tmp', 'e2e', 'out');
fs.mkdirSync(OUT, { recursive: true });
const res = [];
const ok = (n, c, d = '') => {
  res.push((c ? 'PASS ' : 'FAIL ') + n + (d ? '  -> ' + String(d).slice(0, 200) : ''));
  console.log(res.at(-1));
};
const text = (p) => p.evaluate(() => document.body.innerText);
const ctl = async (v) => (await fetch('http://localhost:8791/mode' + (v ? `?v=${v}` : ''))).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { browser, ctx, page, log } = await open();
  const reqs = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:5178'))
      reqs.push({ m: r.method(), u: r.url(), b: r.postData() });
  });
  page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date() });
  await page.goto('http://localhost:5178/');
  await page.waitForTimeout(1500);
  const btn = (n) => page.getByRole('button', { name: n, exact: true });
  const sect = page.locator('section[aria-label="Zeitstempel"]');
  const state = async () => ({
    s: await sect.locator('p[data-state]').getAttribute('data-state'),
    t: await sect.locator('p[data-state]').innerText(),
  });
  const alertText = async () =>
    page
      .getByRole('alert')
      .first()
      .innerText()
      .catch(() => '');
  const dismiss = async () => {
    const g = page.getByRole('button', { name: 'Gelesen' });
    if (await g.count()) await g.first().click();
  };
  const anchorCount = async () => {
    const t = await sect.getByText(/^Externe Zeitstempel \(\d+\)/).innerText();
    return Number(t.match(/\((\d+)\)/)[1]);
  };
  const stamp = async (name) => {
    await go(page, 'Stempeln');
    await btn(name).click();
    await page.waitForTimeout(250);
  };
  const nstamp = async () => {
    await page.clock.fastForward('01:10');
    await go(page, 'Stempeln');
    const b = (await btn('Pause Beginn').isEnabled()) ? 'Pause Beginn' : 'Pause Ende';
    await btn(b).click();
    await page.waitForTimeout(250);
  };
  const toMonth = async () => {
    await go(page, 'Monat');
    await page.waitForTimeout(300);
  };
  const pressAnchor = async () => {
    await btn('Jetzt extern stempeln').click();
    await page.waitForTimeout(1500);
  };

  // --- 0 off by default
  await go(page, 'Einstellungen');
  const sel = page.getByLabel('Externer Zeitstempeldienst (Weiterreicher)');
  ok(
    'settings offer the relay of the build',
    (await sel.locator('option').allInnerTexts()).join('|').includes('http://localhost:8790'),
  );
  await sel.selectOption('http://localhost:8790');
  await btn('Speichern').click();
  await page.waitForTimeout(300);
  ok('relay saved', (await text(page)).includes('Gespeichert.'));
  ok('no request before the first stamp', reqs.length === 0, JSON.stringify(reqs));

  // --- 1 due -> ok
  await stamp('Kommen');
  await toMonth();
  let st = await state();
  ok('status due after a stamp', st.s === 'due', st.t);
  await sect.locator('summary').first().click();
  await pressAnchor();
  st = await state();
  ok('status ok after "Jetzt extern stempeln"', st.s === 'ok', st.t);
  ok('no red box', (await alertText()) === '', await alertText());
  ok('one anchor listed', (await anchorCount()) === 1);
  await sect.getByText(/^Externe Zeitstempel/).click();
  const row = await sect.locator('table').last().innerText();
  ok(
    'anchor row shows service, time, serial',
    /freetsa/.test(row) && /Nr\. 1/.test(row) && /[0-9a-f]{4}/.test(row),
    row.replace(/\s+/g, ' '),
  );
  const posts = reqs.filter((r) => r.m === 'POST');
  const gets = reqs.filter((r) => r.m === 'GET');
  ok(
    'only relay requests, GET services + POST stamp',
    reqs.every((r) => r.u.startsWith('http://localhost:8790/v1/')) &&
      gets.length >= 1 &&
      posts.length === 1,
    reqs.map((r) => r.m + ' ' + r.u).join(', '),
  );
  const body = JSON.parse(posts[0].b);
  ok(
    'POST body is only a 43-char base64url hash',
    Object.keys(body).join() === 'hash' && /^[A-Za-z0-9_-]{43}$/.test(body.hash),
    posts[0].b,
  );
  await page.screenshot({ path: OUT + '/month-ok.png', fullPage: true });

  // --- 2 PDF export with a fresh stamp
  await nstamp();
  await toMonth();
  st = await state();
  ok('due again after new stamps', st.s === 'due', st.t);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    btn('Monat als PDF speichern').click(),
  ]);
  const pdf = OUT + '/' + dl.suggestedFilename();
  await dl.saveAs(pdf);
  await page.waitForTimeout(800);
  st = await state();
  ok('export asked for a fresh anchor (status ok)', st.s === 'ok', st.t);
  ok('two anchors', (await anchorCount()) === 2);
  ok(
    'export message without a warning',
    !(await text(page)).includes('keinen frischen externen Zeitstempel'),
  );

  // --- 3 tampered answers are refused
  await sleep(62000); // the relay's window: 4 calls per minute and service
  const good = [];
  let tamper = null;
  await page.route('**/v1/stamp/**', async (route) => {
    const r = await route.fetch();
    const j = await r.json();
    good.push(j);
    if (tamper) tamper(j);
    await route.fulfill({ status: r.status(), headers: r.headers(), body: JSON.stringify(j) });
  });
  const attempt = async (name, f, expectRx) => {
    await nstamp();
    await toMonth();
    tamper = f;
    const before = await anchorCount();
    await pressAnchor();
    tamper = null;
    const a = await alertText();
    ok(name + ': refused with a message', expectRx.test(a), a);
    ok(name + ': no anchor added', (await anchorCount()) === before);
    await dismiss();
  };
  const flip = (t) => {
    const b = Buffer.from(t, 'base64url');
    b[b.length - 30] ^= 1;
    return b.toString('base64url');
  };
  await attempt(
    'changed token byte',
    (j) => {
      j.token = flip(j.token);
    },
    /nicht bestanden/,
  );
  const stale = good[0]; // an answer made for the hash of an older chain head
  await attempt(
    'older answer replayed',
    (j) => {
      j.token = good[0].token;
      j.serial = good[0].serial;
    },
    /anderer|nicht bestanden/,
  );
  await attempt(
    'wrong serial',
    (j) => {
      j.serial = 'ff';
    },
    /Seriennummer|ungültig/,
  );
  await attempt(
    'extra field',
    (j) => {
      j.extra = 1;
    },
    /ungültig/,
  );
  ok('anchors still 2 after tampering', (await anchorCount()) === 2);
  await page.unroute('**/v1/stamp/**');

  // --- 4 rate limit
  let a = '';
  for (let i = 0; i < 6 && !/vorerst/.test(a); i++) {
    await nstamp();
    await toMonth();
    await pressAnchor();
    a = await alertText();
    if (a) await dismiss();
  }
  ok('429 shown as pause message', /nimmt vorerst keine weitere Anfrage an/.test(a), a);
  const nreq = reqs.length;
  await pressAnchor();
  a = await alertText();
  ok(
    'during the pause: same message, no request sent',
    /vorerst/.test(a) && reqs.length === nreq,
    a + ' reqs ' + (reqs.length - nreq),
  );
  await dismiss();
  await page.clock.fastForward('01:30');
  await sleep(62000);
  await pressAnchor();
  st = await state();
  ok('after Retry-After the stamp works again', st.s === 'ok', st.t + ' | ' + (await alertText()));
  await dismiss();

  // --- 5 relay failures
  await ctl('fail502-first');
  await nstamp();
  await toMonth();
  await sect.getByText(/^Externe Zeitstempel/).click();
  const before = await anchorCount();
  await pressAnchor();
  const last = await sect.locator('table').last().innerText();
  ok(
    'first service down (502): next service used',
    (await anchorCount()) === before + 1 && /sectigo/.test(last),
    last.replace(/\s+/g, ' ').slice(-120) + ' | ' + (await alertText()),
  );
  await dismiss();
  await ctl('fail504');
  await nstamp();
  await toMonth();
  await pressAnchor();
  a = await alertText();
  ok(
    'all services time out (504): red box with the reason',
    /nicht erreichbar/.test(a) && /504/.test(a),
    a,
  );
  await dismiss();
  st = await state();
  ok('status due while unreachable', st.s === 'due', st.t);

  // --- 6 overdue
  await page.clock.fastForward('25:00:00');
  await page.waitForTimeout(500);
  await toMonth();
  st = await state();
  ok('status overdue after 25 h without anchor', st.s === 'overdue', st.t);
  await page.screenshot({ path: OUT + '/month-overdue.png', fullPage: true });
  const [dl2] = await Promise.all([
    page.waitForEvent('download'),
    btn('Monat als PDF speichern').click(),
  ]);
  const pdf2 = OUT + '/overdue-' + dl2.suggestedFilename();
  await dl2.saveAs(pdf2);
  await page.waitForTimeout(800);
  const t2 = await text(page);
  ok(
    'export still works when overdue, with a warning',
    /keinen frischen externen Zeitstempel/.test(t2),
    t2.match(/Es gab keinen[^\n]*/)?.[0],
  );
  await dismiss();
  await ctl('normal');
  await sleep(62000);
  await page.clock.fastForward('01:30');
  await pressAnchor();
  a = await alertText();
  ok(
    'relay time vs device clock 25 h off: refused (anchor-skew)',
    /passt nicht zur Geräteuhr/.test(a),
    a,
  );
  await dismiss();

  console.log('LOG', JSON.stringify(log));
  fs.writeFileSync(OUT + '/results.txt', res.join('\n'));
  console.log(res.filter((r) => r.startsWith('FAIL')).length + ' FAIL of ' + res.length);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
