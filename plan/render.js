// Renders ESG_improvement_plan.html → ESG_improvement_plan.pdf (A4, multi-page) and a per-page PNG preview.
const { chromium } = require('C:/Users/nikam/Desktop/Claude/vertical-ad-generator/node_modules/playwright');
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const BASE = process.argv[2] || 'ESG_improvement_plan';   // node render.js [basename]

(async () => {
  const logoB64 = fs.readFileSync(path.join(DIR, 'logo-dark.png')).toString('base64');
  const html = fs.readFileSync(path.join(DIR, BASE + '.html'), 'utf8')
    .split('src="logo-dark.png"').join('src="data:image/png;base64,' + logoB64 + '"');
  fs.writeFileSync(path.join(DIR, BASE + '.standalone.html'), html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // report every page's content height vs the page box so overflow is caught
  const report = await page.evaluate(() => [...document.querySelectorAll('.page')].map((p, i) => {
    const inner = p.querySelector('.inner'); const r = inner.getBoundingClientRect(); const kids=[...inner.children]; const last=kids[kids.length-1]; const used=last?Math.round(last.getBoundingClientRect().bottom-r.top):0;
    return 'p' + (i + 1) + ': used ' + used + ' / box ' + Math.round(r.height) + '  (' + (Math.round(r.height)-used) + 'px spare)' + (used > r.height + 1 ? '  ⚠ OVERFLOW' : '');
  }).join('\n'));
  console.log(report);

  await page.pdf({ path: path.join(DIR, BASE + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
                   margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  const n = await page.evaluate(() => document.querySelectorAll('.page').length);
  for (let i = 0; i < n; i++) {
    const el = (await page.$$('.page'))[i];
    await el.screenshot({ path: path.join(DIR, BASE + '-p' + (i + 1) + '.png') });
  }
  await browser.close();
  console.log('rendered ' + n + ' pages → ' + BASE + '.pdf');
})().catch(e => { console.error('RENDER FAILED', e); process.exit(1); });
