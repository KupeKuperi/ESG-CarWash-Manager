// Local preview harness for the GAS webapp.
// Assembles index.html + style.html + script.html and injects a mock
// google.script.run (dev-preview/mock.js) so the app runs without Apps Script.
// NOT deployed — dev-preview/** is in .claspignore.
const http = require('http');
const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..');
const PORT = 3500;

http.createServer((req, res) => {
  try {
    const style  = fs.readFileSync(path.join(SRC, 'style.html'),  'utf8');
    const script = fs.readFileSync(path.join(SRC, 'script.html'), 'utf8');
    const mock   = fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
    let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    html = html
      .split("<?!= include('style'); ?>").join(style)
      .split("<?!= include('script'); ?>").join('<script>\n' + mock + '\n</scr' + 'ipt>\n' + script);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Harness error: ' + e.message);
  }
}).listen(PORT, () => console.log('ESG ERP preview harness on http://localhost:' + PORT));
