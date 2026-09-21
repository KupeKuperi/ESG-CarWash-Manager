// Renders ESG_menu_v2.html → ESG_menu_v2.pdf (A4, print) + ESG_menu_v2.png (preview)
// and a self-contained ESG_menu_v2.standalone.html (logo embedded).
// Uses the Playwright already installed in ../../vertical-ad-generator.
const { chromium } = require('C:/Users/nikam/Desktop/Claude/vertical-ad-generator/node_modules/playwright');
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const SRC = path.join(DIR, 'ESG_menu_v2.html');

(async () => {
  const logoB64 = fs.readFileSync(path.join(DIR, 'logo-dark.png')).toString('base64');
  const html = fs.readFileSync(SRC, 'utf8').replace('src="logo-dark.png"', 'src="data:image/png;base64,' + logoB64 + '"');
  fs.writeFileSync(path.join(DIR, 'ESG_menu_v2.standalone.html'), html);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  // Match the page background to the logo's own background so the PNG sits seamlessly
  const bg = await page.evaluate(() => {
    const img = document.getElementById('logo');
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(3, 3, 1, 1).data;
    return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
  });
  await page.evaluate(bg => document.documentElement.style.setProperty('--bg', bg), bg);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const overflow = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ph: document.querySelector('.page').getBoundingClientRect().height,
    bottoms: [...document.querySelectorAll('.page > *')].map(el => ({ cls: el.className, bottom: Math.round(el.getBoundingClientRect().bottom) })) }));
  console.log('bg', bg, 'scrollHeight', overflow.sh, 'page', Math.round(overflow.ph));
  console.log(overflow.bottoms.map(b => b.cls + ':' + b.bottom).join('  '));

  await page.screenshot({ path: path.join(DIR, 'ESG_menu_v2.png'), fullPage: false });
  await page.pdf({ path: path.join(DIR, 'ESG_menu_v2.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
                   margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await browser.close();
  console.log('rendered: ESG_menu_v2.pdf, ESG_menu_v2.png, ESG_menu_v2.standalone.html');
})().catch(e => { console.error('RENDER FAILED', e); process.exit(1); });
