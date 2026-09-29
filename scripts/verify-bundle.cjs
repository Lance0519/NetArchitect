// Confirms the compiled stylesheet survived into the SHIPPED bundle.
//
// ## What this can and cannot prove
//
// A note on method, because the first version of this script reported 16 false
// failures and the cause is worth recording.
//
// The first version grepped the bundle for the dark channel values as text -
// `10,12,16`, `255,138,138`. Those are ABSENT from the bundle by construction,
// and their absence means nothing:
//
//   * Hermes does not keep object literals as source text. It compiles them to
//     bytecode, and numeric constants live in a binary table, not as readable
//     characters. `10,12,16` is never a contiguous string in the file.
//   * lightningcss rewrites the stylesheet into a JS object, so the CSS text form
//     (`--bg-canvas: 10 12 16`) is gone even before Hermes sees it.
//
// So the values cannot be text-grepped at this stage, and a script that tries
// reports a working build as broken. The value assertions belong one stage
// earlier, in `verify-theme.cjs`, which inspects the compiled object directly
// rather than searching bytes.
//
// What IS greppable at this stage is the set of *identifiers* and string
// literals, because Hermes stores those in a string table. Those are what this
// script checks, and they are sufficient to prove the stylesheet was bundled at
// all:
//
//   $compiled      the compiler's own marker on its output
//   rootVariables  the token map survived
//   class dark     the darkMode flag still names the `dark` class
//   injectData     the runtime registration call is present
//
// Pairing this with `npm run verify:theme` covers both ends: that the values are
// correct, and that the compiled result actually shipped.
//
// Usage: node scripts/verify-bundle.cjs [bundle-dir]
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bundleDir =
  process.argv[2] ?? path.join(root, '.export-probe', '_expo', 'static', 'js', 'android');

if (!fs.existsSync(bundleDir)) {
  console.log(`no bundle at ${bundleDir}`);
  console.log('build one first:  npx expo export --platform android --output-dir .export-probe');
  process.exit(2);
}

const file = fs.readdirSync(bundleDir).find((f) => f.endsWith('.hbc') || f.endsWith('.js'));
if (!file) {
  console.log(`no bundle file in ${bundleDir}`);
  process.exit(2);
}

const buf = fs.readFileSync(path.join(bundleDir, file));
// latin1 rather than utf8: it maps every byte to a character, so a multi-byte
// sequence in the binary cannot truncate a search.
const hay = buf.toString('latin1');

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(48) + (detail ?? ''));
};

console.log(`=== ${file} (${buf.length.toLocaleString('en-US')} bytes) ===\n`);

console.log('--- the compiled stylesheet reached the bundle ---');
// $compiled is the marker react-native-css-interop puts on its own output, so
// this is proof of provenance and not just of a coincidental substring.
check('compiler marker $compiled', hay.includes('$compiled'));
check('rootVariables key', hay.includes('rootVariables'));
check('injectData runtime call', hay.includes('injectData'));
check(
  'darkMode flag names the dark class',
  hay.includes('class dark'),
  'if this is missing, colorScheme.set() targets a class nothing responds to',
);
check('css-interop runtime present', hay.includes('css-interop'));

console.log('\n--- design tokens referenced by the compiled utilities ---');
// These resolve as `var(--bg-canvas)` inside the rules. The token NAMES survive
// the compilation even though the channel values do not, so their presence is
// meaningful.
const TOKENS = [
  '--bg-canvas',
  '--bg-surface',
  '--bg-raised',
  '--bg-inset',
  '--border-subtle',
  '--border-default',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--accent-base',
  '--accent-pressed',
  '--accent-soft',
  '--on-accent',
  '--critical',
  '--high',
  '--medium',
  '--info',
  '--success',
];
for (const t of TOKENS) {
  check('token ' + t, hay.includes(t));
}

console.log('\n--- utilities the app actually uses ---');
for (const u of [
  'bg-canvas',
  'bg-surface',
  'text-ink',
  'text-ink-muted',
  'text-ink-faint',
  'bg-accent',
  'text-critical',
  'bg-critical',
  'border-line',
  'rounded-card',
  'rounded-control',
  'rounded-pill',
  'text-display',
  'text-title',
  'text-caption',
  'min-h-touch',
  'max-w-read',
  'max-w-form',
  'bg-accent-soft',
  'bg-accent-pressed',
  'bg-surface-raised',
  'bg-surface-inset',
  'text-accent-on',
  'border-line-subtle',
  'text-success',
  'text-info',
  'text-medium',
  'text-high',
]) {
  check('utility ' + u, hay.includes(u));
}

console.log('\n--- app content sanity ---');
check('app name present', hay.includes('NetArchitect'));
check('offline statement present', hay.includes('Works entirely offline'));

console.log(
  '\nnote: token VALUES are not checked here. Hermes stores object literals as\n' +
    'bytecode, so `10,12,16` is not greppable. Run `npm run verify:theme` for that.',
);
console.log(`\n${failed} failed check(s)`);
process.exit(failed === 0 ? 0 : 1);
