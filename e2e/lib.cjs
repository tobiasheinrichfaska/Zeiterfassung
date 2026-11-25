const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
exports.open = async (opts = {}) => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 420, height: 800 },
    ...opts,
  });
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) log.push('console.' + m.type() + ': ' + m.text());
  });
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => log.push('reqfailed: ' + r.url().slice(0, 100)));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error('CSPV ' + e.violatedDirective + ' ' + e.blockedURI),
    );
  });
  return { browser, ctx, page, log };
};
const areas = {
  Stempeln: 'Erfassen',
  'Tag eingeben': 'Erfassen',
  Monat: 'Monat',
  Einstellungen: 'Einstellungen',
  Sicherung: 'Einstellungen',
};
const labels = {
  Stempeln: 'Stempeln · Erfassen',
  'Tag eingeben': 'Tag eingeben · Erfassen',
  Monat: 'Monat · Monat',
  Einstellungen: 'Einstellungen · Einstellungen',
  Sicherung: 'Sicherung · Einstellungen',
};
exports.go = async (page, name) => {
  const back = page.locator('button[aria-label^="Zurück zu"]');
  if (await back.count()) {
    await back.first().click();
    await page.waitForTimeout(700);
  }
  await page.getByLabel(areas[name], { exact: true }).first().click({ force: true });
  await page.waitForTimeout(900);
  if (!(await back.count())) {
    await page.getByLabel(labels[name], { exact: true }).click({ force: true });
    await page.waitForTimeout(900);
  }
  const nb = page.getByLabel('Daneben: ' + name, { exact: true });
  if (await nb.count()) {
    await nb.click();
    await page.waitForTimeout(800);
  }
};

/** The device key text of a test key (.tmp/e2e/keys/<name>.txt, made by make-keys.cjs). */
exports.keyText = (name) =>
  require('node:fs')
    .readFileSync(
      require('node:path').join(__dirname, '..', '.tmp', 'e2e', 'keys', name + '.txt'),
      'utf8',
    )
    .trim();
/** Enters a device key in the settings, as an employee would (paste, „Schlüssel speichern“). */
exports.enterKey = async (page, name) => {
  const field = page.locator('input[name="geraeteschluessel"]');
  if (!(await field.isVisible().catch(() => false))) await exports.go(page, 'Einstellungen');
  await field.fill(exports.keyText(name));
  await page.getByRole('button', { name: 'Schlüssel speichern', exact: true }).click();
  await page.waitForTimeout(500);
  return page.locator('form[aria-label="Geräteschlüssel"] p[data-device-key]').innerText();
};

/**
 * Lets the stand-in relay and service run on the page's clock (harness `/clock`): after the device clock
 * was moved for a scenario that is not about a wrong clock. `offsetMs` overrides (0 = real time).
 */
exports.syncClock = async (page, offsetMs) => {
  const off = offsetMs ?? (await page.evaluate(() => Date.now())) - Date.now();
  await fetch('http://localhost:8791/clock?offset=' + Math.round(off));
  return off;
};
