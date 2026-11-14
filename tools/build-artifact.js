// public/ 의 게임을 claude.ai 아티팩트용 단일 HTML(dist/artifact.html)로 묶음
const fs = require('fs');
const path = require('path');
const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
let html = pub('index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const style = html.match(/<style>[\s\S]*?<\/style>/)[0].replace('<style>', '<style>\n  :root { color-scheme: dark; }');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace('<script src="shared.js"></script>', () => `<script>\n${pub('shared.js')}\n</script>`)
  .replace('<script src="game.js"></script>', () => `<script>\n${pub('game.js')}\n</script>`);
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'artifact.html'), `${title}\n${style}\n${body}`);
console.log('dist/artifact.html written');
