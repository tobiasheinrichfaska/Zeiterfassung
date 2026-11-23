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
