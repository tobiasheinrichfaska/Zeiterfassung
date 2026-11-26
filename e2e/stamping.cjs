const { open, go, enterKey, keyText, syncClock } = require('./lib.cjs');
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
/** The head of the relay authentication v3: v3.<kid>.<ts ms>.<jti>.<sig>. */
const AUTH_V3 = /^v3\.e2e-[a-z-]+\.\d{13}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{86}$/;
(async () => {
  const { browser, ctx, page, log } = await open();
  const reqs = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:5178'))
      reqs.push({
        m: r.method(),
        u: r.url(),
        b: r.postData(),
        auth: r.headers()['x-zeitstempel-auth'] ?? null,
      });
  });
  const statuses = [];
  page.on('response', (r) => {
    if (r.url().startsWith('http://localhost:8790/')) statuses.push(r.status());
  });
  page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: new Date() });
  await syncClock(page, 0);
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
  // anchors are thinned to the newest per day (`thinAnchors`): progress is the stamp the newest one covers
  const newestN = async () => {
    // the column „bis Stempel“ (third cell) of every row of the anchor table
    const cells = await sect
      .locator('table')
      .last()
      .locator('tbody tr td:nth-child(3)')
      .allTextContents();
    const ns = cells.map((c) => Number((/Nr\. (\d+)/.exec(c) ?? [])[1] ?? 0));
    return ns.length > 0 ? Math.max(...ns) : 0;
  };
  const stamp = async (name) => {
    await go(page, 'Stempeln');
    await btn(name).click();
    await page.waitForTimeout(250);
  };
  const nstamp = async () => {
    await page.clock.fastForward('01:10');
    await syncClock(page); // relay and service follow the device clock (not a wrong-clock scenario)
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
    // the client may wait inside the call (Retry-After of a 429 or 503 busy): until the button is free
    for (let t = 0; t < 140_000 && !(await btn('Jetzt extern stempeln').isEnabled()); t += 500) {
      await page.waitForTimeout(500);
    }
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

  // --- 0a without a device key: the device is not unlocked, nothing is sent, recording works
  await stamp('Kommen');
  await toMonth();
  let st = await state();
  ok('status due after a stamp', st.s === 'due', st.t);
  ok(
    'without a device key: month page says „Gerät nicht freigeschaltet (Geräteschlüssel fehlt)“',
    /Gerät nicht freigeschaltet \(Geräteschlüssel fehlt\)/.test(await sect.innerText()),
    await sect.innerText(),
  );
  ok(
    'without a device key: „Jetzt extern stempeln“ disabled',
    !(await btn('Jetzt extern stempeln').isEnabled()),
  );
  await sleep(1500);
  ok('without a device key: no request at all', reqs.length === 0, JSON.stringify(reqs));

  // --- 0b a key the relay does not know: 401, the app says the key is not accepted, no anchor
  const shown = await enterKey(page, 'unbekannt');
  const secret = keyText('unbekannt').split('.')[1];
  ok(
    'key entered: only the key id is shown, the field is emptied',
    /e2e-unbekannt/.test(shown) &&
      !(await text(page)).includes(secret.slice(0, 16)) &&
      (await page.locator('input[name="geraeteschluessel"]').inputValue()) === '',
    shown,
  );
  ok(
    'the key is not in the browser’s plain storage',
    await page.evaluate(
      (k) =>
        !Object.keys(localStorage).some((n) => (localStorage.getItem(n) ?? '').includes(k)) &&
        !Object.keys(sessionStorage).some((n) => (sessionStorage.getItem(n) ?? '').includes(k)),
      secret.slice(0, 16),
    ),
  );
  await toMonth();
  await pressAnchor();
  let keyAlert = await alertText();
  ok(
    'unknown key: „Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen“ (401)',
    /Geräteschlüssel wird vom Zeitstempeldienst nicht angenommen/.test(keyAlert) &&
      /401/.test(keyAlert),
    keyAlert,
  );
  ok('unknown key: no anchor', (await anchorCount()) === 0);
  await dismiss();

  // --- 0c a key without the solo permission: 403 solo-not-allowed, no anchor
  await enterKey(page, 'ohne-solo');
  await toMonth();
  await pressAnchor();
  keyAlert = await alertText();
  ok(
    'key without solo permission: not accepted (403, ohne Solo-Erlaubnis)',
    /nicht angenommen/.test(keyAlert) && /Solo-Erlaubnis/.test(keyAlert),
    keyAlert,
  );
  ok('key without solo permission: no anchor', (await anchorCount()) === 0);
  await dismiss();
  ok(
    'refused keys: only signed POSTs went out, never the key itself',
    reqs.filter((r) => r.m === 'POST').every((r) => AUTH_V3.test(r.auth)) &&
      !JSON.stringify(reqs).includes(secret.slice(0, 16)),
    JSON.stringify(reqs.map((r) => r.auth)),
  );

  // --- 0d the right key (type 2, solo): the device is unlocked (an anchor that is due is asked for at once)
  reqs.length = 0;
  const right = await enterKey(page, 'geraet');
  ok('right key entered: shows e2e-geraet', /e2e-geraet/.test(right), right);

  // --- 1 due -> ok
  await toMonth();
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
  ok(
    'only relay requests: POST stamp (no list of services any more)',
    reqs.every((r) => r.m === 'POST' && r.u.startsWith('http://localhost:8790/v1/stamp/')) &&
      posts.length === 1,
    reqs.map((r) => r.m + ' ' + r.u).join(', '),
  );
  const body = JSON.parse(posts[0].b);
  ok(
    'POST body is only a 43-char base64url hash and mode solo',
    Object.keys(body).join() === 'hash,mode' &&
      /^[A-Za-z0-9_-]{43}$/.test(body.hash) &&
      body.mode === 'solo',
    posts[0].b,
  );
  ok(
    'POST signed with the device key (X-Zeitstempel-Auth v3.e2e-geraet.<ms>.<jti>.<sig>)',
    AUTH_V3.test(posts[0].auth ?? '') && posts[0].auth.startsWith('v3.e2e-geraet.'),
    posts[0].auth,
  );
  await page.screenshot({ path: OUT + '/month-ok.png', fullPage: true });

  // --- 2 PDF export with a fresh stamp
  await nstamp();
  await toMonth();
  st = await state();
  ok('due again after new stamps', st.s === 'due', st.t);
  const nBeforeExport = await newestN();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    btn('Monat als PDF speichern').click(),
  ]);
  const pdf = OUT + '/' + dl.suggestedFilename();
  await dl.saveAs(pdf);
  await page.waitForTimeout(800);
  st = await state();
  ok('export asked for a fresh anchor (status ok)', st.s === 'ok', st.t);
  const nAfterExport = await newestN();
  ok(
    'the export anchor is the newest (one anchor per day kept)',
    nAfterExport > nBeforeExport && (await anchorCount()) >= 1,
    `${nBeforeExport} -> ${nAfterExport}, ${await anchorCount()} listed`,
  );
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
    // only a stamp is changed: a 401 (the device clock runs ahead after fastForward; the client corrects
    // it once by the relay's Date and signs again) passes as it is
    if (r.status() === 200) {
      good.push(j);
      if (tamper) tamper(j);
    }
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
  ok('newest anchor unchanged after tampering', (await newestN()) === nAfterExport);
  await page.unroute('**/v1/stamp/**');

  // --- 4 rate limit: the client waits Retry-After itself (at most 3 sends per service in 130 s)
  {
    let seen = false;
    let added = false;
    for (let i = 0; i < 6 && !seen; i++) {
      await nstamp();
      await toMonth();
      const n = await newestN();
      const from = statuses.length;
      await pressAnchor();
      const got = statuses.slice(from);
      seen = got.includes(429) || got.includes(503);
      const after = await newestN();
      added = after > n && got.at(-1) === 200;
      if (seen)
        ok(
          'real 429/503 busy of the relay: the client waited Retry-After and sent again, anchor added, no red box',
          added && (await alertText()) === '',
          `${got.join(',')} | newest ${n} -> ${after} | ${await alertText()}`,
        );
      await dismiss();
    }
    if (!seen) ok('real 429/503 busy of the relay seen within 6 stamps', false, statuses.join(','));
  }
  await sleep(62000);
  // three refusals in a row (the stand-in answers 429 itself): then the pause, nothing is sent during it
  let refusals = 0;
  await page.route('**/v1/stamp/**', async (route) => {
    refusals++;
    await route.fulfill({
      status: 429,
      headers: {
        'access-control-allow-origin': 'http://localhost:5178',
        'access-control-expose-headers': 'Retry-After, Date',
        'content-type': 'application/json',
        'retry-after': '20',
      },
      body: JSON.stringify({ error: 'rate-limited' }),
    });
  });
  await nstamp();
  await toMonth();
  await pressAnchor();
  let a = await alertText();
  ok(
    '429 three times: pause message after 3 sends',
    /nimmt vorerst keine weitere Anfrage an/.test(a) && refusals === 3,
    a + ' | sends ' + refusals,
  );
  await dismiss();
  const nreq = refusals;
  await pressAnchor();
  a = await alertText();
  ok(
    'during the pause: same message, no request sent',
    /vorerst/.test(a) && refusals === nreq,
    a + ' sends ' + (refusals - nreq),
  );
  await dismiss();
  await page.unroute('**/v1/stamp/**');
  await sleep(21000);
  await pressAnchor();
  st = await state();
  ok('after Retry-After the stamp works again', st.s === 'ok', st.t + ' | ' + (await alertText()));
  await dismiss();

  // --- 5 relay failures
  await ctl('fail502-first');
  await nstamp();
  await toMonth();
  await sect.getByText(/^Externe Zeitstempel/).click();
  const before = await newestN();
  await pressAnchor();
  const last = await sect.locator('table').last().innerText();
  ok(
    'first service down (502): next service used',
    (await newestN()) > before && /sectigo/.test(last),
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
  // the relay and the service go back to the true time: the device clock is now about a day ahead
  await syncClock(page, 0);
  await pressAnchor();
  a = await alertText();
  ok(
    'device clock a day ahead of the relay: 401 (the client corrects at most 65 s), no anchor',
    /nicht angenommen/.test(a) && /401/.test(a),
    a,
  );
  await dismiss();
  {
    const w = await page
      .locator('[data-clock-warning]')
      .first()
      .innerText()
      .catch(() => '');
    ok(
      'clock warning shown (device clock a day ahead, from the relay’s Date)',
      /geht .* vor – bitte die Uhrzeit des Geräts stellen/.test(w),
      w,
    );
  }
  await page.clock.setSystemTime(new Date(Date.now() - 3 * 3600e3));
  await toMonth();
  await sect.getByText(/^Externe Zeitstempel/).click();
  const n0 = await newestN();
  await pressAnchor();
  a = await alertText();
  ok(
    'device clock 3 h behind the relay: 401, no anchor added',
    /nicht angenommen/.test(a) && /401/.test(a) && (await newestN()) === n0,
    a,
  );
  await dismiss();
  {
    const w = await page
      .locator('[data-clock-warning]')
      .first()
      .innerText()
      .catch(() => '');
    ok(
      'clock warning shown (device clock 3 h behind)',
      /geht .* nach – bitte die Uhrzeit des Geräts stellen/.test(w),
      w,
    );
  }
  // the device clock is right again: stamping works again (anchor-skew itself is not reachable with a
  // real relay any more: a clock more than 65 s off gets 401 first; tests/anchors.test.ts covers it)
  await page.clock.setSystemTime(new Date());
  await sleep(1000);
  await pressAnchor();
  a = await alertText();
  ok(
    'device clock right again: the anchor is added, no red box',
    a === '' && (await newestN()) > n0,
    a,
  );
  await dismiss();
  st = await state();
  ok('status ok again', st.s === 'ok', st.t);
  const skewRow = await sect.locator('summary', { hasText: 'Stempelkette' }).count();
  ok('chain section present', skewRow === 1);

  console.log('LOG', JSON.stringify(log));
  fs.writeFileSync(OUT + '/results.txt', res.join('\n'));
  console.log(res.filter((r) => r.startsWith('FAIL')).length + ' FAIL of ' + res.length);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
