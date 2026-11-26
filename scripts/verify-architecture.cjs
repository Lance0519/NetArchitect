/**
 * Static architecture, offline-privacy, dark-mode icon, and Hermes-safety gate.
 *
 * Enforces invariants that TypeScript, ESLint, and unit tests alone cannot catch:
 *  1. `src/core/**` stays 100% pure (no React, React Native, Expo, Zustand, UI, or DB imports).
 *  2. Zero network API calls (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`) in app/src.
 *  3. Every `lucide-react-native` icon used in `app/**` or `src/**` is registered in `src/theme/icons.ts`.
 *  4. Zero unguarded `crypto.randomUUID(` calls in `app/**` or `src/**` (Hermes crash vector).
 *  5. `app.json` registers `./plugins/with-privacy-hardening` and excludes `expo-web-browser`.
 *  6. No duplicate legacy component directories (`src/components/{ui,network,security}`).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(52) + detail);
};

const appFiles = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'src'))];
const coreFiles = walk(path.join(root, 'src', 'core'));

// 1. Core purity
const forbiddenCoreImports = [];
const FORBIDDEN_CORE_RE =
  /from\s+['"](?:react|react-native|expo(?:-[a-z0-9-]+)?|zustand|nativewind|lucide-react-native|@\/(?:components|database|store|theme|hooks)(?:\/.*)?|\.\.\/(?:components|database|store|theme|hooks)(?:\/.*)?)['"]/;

for (const file of coreFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const match = src.match(FORBIDDEN_CORE_RE);
  if (match) {
    forbiddenCoreImports.push(`${path.relative(root, file)} -> ${match[0]}`);
  }
}
check(
  'src/core has zero UI/RN/Expo/DB/store imports',
  forbiddenCoreImports.length === 0,
  forbiddenCoreImports.join('; '),
);

// 2. Offline posture: zero network API calls
const networkHits = [];
const NETWORK_API_RE = /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/;
for (const file of appFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (NETWORK_API_RE.test(line)) {
      networkHits.push(`${path.relative(root, file)}:${idx + 1}`);
    }
  });
}
check(
  'zero runtime network calls in app/ and src/',
  networkHits.length === 0,
  networkHits.join(', '),
);

// 3. Every Lucide icon imported in app/ or src/ is registered in src/theme/icons.ts
const iconsFile = path.join(root, 'src', 'theme', 'icons.ts');
const iconsSrc = fs.readFileSync(iconsFile, 'utf8');
const regBlockMatch = iconsSrc.match(/REGISTERED_ICONS[^=]*=\s*\[([\s\S]*?)\];/);
const registeredIcons = new Set(
  regBlockMatch
    ? regBlockMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[A-Za-z0-9_]+$/.test(s))
    : [],
);

const missingIcons = new Set();
for (const file of appFiles) {
  if (path.resolve(file) === path.resolve(iconsFile)) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const match of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'lucide-react-native'/g)) {
    for (const raw of match[1].split(',')) {
      const cleaned = raw
        .replace(/\btype\s+/g, '')
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (!cleaned || cleaned === 'LucideIcon' || cleaned === 'LucideProps') continue;
      if (!registeredIcons.has(cleaned)) {
        missingIcons.add(`${cleaned} (${path.relative(root, file)})`);
      }
    }
  }
}
check(
  'all Lucide icons registered in src/theme/icons.ts',
  missingIcons.size === 0,
  [...missingIcons].join(', '),
);

// 4. Zero unguarded crypto.randomUUID calls
const uuidHits = [];
const idHelperPath = path.resolve(root, 'src', 'utils', 'id.ts');
for (const file of appFiles) {
  if (path.resolve(file) === idHelperPath) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (line.includes('randomUUID')) {
      uuidHits.push(`${path.relative(root, file)}:${idx + 1}`);
    }
  });
}
check(
  'zero unguarded crypto.randomUUID() calls',
  uuidHits.length === 0,
  uuidHits.join(', '),
);

// 5. Privacy hardening config plugin registered & expo-web-browser removed
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const plugins = (appJson.expo?.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
check(
  'app.json registers ./plugins/with-privacy-hardening',
  plugins.includes('./plugins/with-privacy-hardening') ||
    plugins.includes('./plugins/with-privacy-hardening.js'),
);
check('app.json does not register expo-web-browser', !plugins.includes('expo-web-browser'));

// 6. Canonical component tree (no duplicate ui/network/security subdirectories)
const legacyDirs = ['ui', 'network', 'security'].filter((dir) =>
  fs.existsSync(path.join(root, 'src', 'components', dir)),
);
check(
  'no duplicate src/components/{ui,network,security}',
  legacyDirs.length === 0,
  legacyDirs.join(', '),
);

console.log(`\narchitecture gate: ${failed} failed check(s)`);
process.exit(failed === 0 ? 0 : 1);
