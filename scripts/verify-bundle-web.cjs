// Confirms the compiled web bundle and assets are valid and intact.
//
// Usage: node scripts/verify-bundle-web.cjs [bundle-dir]
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const webDir = process.argv[2] ?? path.join(root, '.export-probe-web');

if (!fs.existsSync(webDir)) {
  console.error(`no web bundle at ${webDir}`);
  console.error('build one first:  npx expo export --platform web --output-dir .export-probe-web --clear');
  process.exit(2);
}

let failures = 0;

function check(desc, ok, detail) {
  const status = ok ? '  ok  ' : ' FAIL ';
  console.log(`${status} ${desc.padEnd(46)} ${detail ?? ''}`);
  if (!ok) failures++;
}

console.log(`\n=== Web Export Bundle Verification (${webDir}) ===\n`);

// 1. Check index.html
const indexHtmlPath = path.join(webDir, 'index.html');
check('index.html exists', fs.existsSync(indexHtmlPath));
if (fs.existsSync(indexHtmlPath)) {
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  check('index.html has viewport meta', indexHtml.includes('name="viewport"'));
  check('index.html contains root container', indexHtml.includes('id="root"'));
  check('index.html references CSS stylesheet', indexHtml.includes('.css'));
  check('index.html references JS bundle', indexHtml.includes('.js'));
}

// 2. Check CSS static assets
const cssDir = path.join(webDir, '_expo', 'static', 'css');
check('static css directory exists', fs.existsSync(cssDir));
if (fs.existsSync(cssDir)) {
  const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
  check('static css file emitted', cssFiles.length > 0, `${cssFiles.length} file(s)`);
  if (cssFiles.length > 0) {
    const cssContent = fs.readFileSync(path.join(cssDir, cssFiles[0]), 'utf8');
    check('CSS contains --bg-canvas variable', cssContent.includes('--bg-canvas'));
    check('CSS contains dark mode tokens', cssContent.includes('.dark'));
  }
}

// 3. Check JS bundle
const jsDir = path.join(webDir, '_expo', 'static', 'js', 'web');
check('static js/web directory exists', fs.existsSync(jsDir));
if (fs.existsSync(jsDir)) {
  const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
  const entryFile = jsFiles.find((f) => f.startsWith('entry-'));
  check('entry JS bundle exists', Boolean(entryFile), entryFile);

  if (entryFile) {
    const jsContent = fs.readFileSync(path.join(jsDir, entryFile), 'utf8');
    check('JS bundle contains NetArchitect content', jsContent.includes('NetArchitect'));
    check('JS bundle contains IP Calculator route', jsContent.includes('calculator') || jsContent.includes('Calculator'));
    check('JS bundle contains VLSM Allocator route', jsContent.includes('vlsm') || jsContent.includes('VLSM'));
    check('JS bundle contains Network Planner route', jsContent.includes('planner') || jsContent.includes('Planner'));
  }

  const workerFile = jsFiles.find((f) => f.startsWith('worker-'));
  check('sqlite web worker bundle exists', Boolean(workerFile), workerFile);
}

// 4. Check wasm asset (wa-sqlite for SQLite on Web)
function findWasm(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let wasms = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      wasms = wasms.concat(findWasm(fullPath));
    } else if (entry.name.endsWith('.wasm')) {
      wasms.push(fullPath);
    }
  }
  return wasms;
}

const wasmAssets = findWasm(path.join(webDir, 'assets'))
  .concat(findWasm(path.join(webDir, 'node_modules')))
  .concat(findWasm(webDir));

check('wa-sqlite wasm asset emitted', wasmAssets.length > 0, `${wasmAssets.length} wasm asset(s) found`);

console.log(`\n${failures} failed check(s)\n`);
if (failures > 0) {
  process.exit(1);
}
