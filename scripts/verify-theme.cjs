// Compiles global.css through the SAME two stages the real build uses and
// asserts the dark tokens survive both.
//
// Stage 1: Tailwind. Stage 2: react-native-css-interop's lightningcss pass,
// which is where `:root.dark` was being silently dropped.
//
// This exists because two distinct bugs in this file produce the identical
// symptom - a build that exits 0, resolves every utility class, and leaves the
// app permanently in light mode. Reading global.css cannot detect either one.
// Only the compiled artifact can.
//
// Usage: node scripts/verify-theme.cjs [web|ios|android]   (default: android)
const path = require('path');
const { fork } = require('child_process');

const platform = process.argv[2] || 'android';

if (!['web', 'ios', 'android'].includes(platform)) {
  console.error(`unknown platform "${platform}" - expected one of web, ios, android`);
  process.exit(2);
}

// The project root, not this script's directory. This file lives in `scripts/`,
// so `__dirname` would resolve `node_modules` and `global.css` to the wrong place
// and fail in a way that reads like a broken build rather than a wrong path.
const root = path.resolve(__dirname, '..');

const childFile = path.join(
  root,
  'node_modules',
  'nativewind',
  'dist',
  'metro',
  'tailwind',
  'v3',
  'child.js',
);

const child = fork(childFile, {
  stdio: 'pipe',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NATIVEWIND_INPUT: path.join(root, 'global.css'),
    NATIVEWIND_OS: platform,
    NATIVEWIND_WATCH: 'false',
    BROWSERSLIST: 'last 1 version',
    BROWSERSLIST_ENV: 'native',
  },
});
let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(46) + (detail ?? ''));
};

// The Tailwind compiler's stderr is NOT discarded.
//
// This line was `child.stderr?.on('data', () => {})`, which is the same mistake
// this whole file exists to catch: a channel the build uses to report trouble,
// thrown away so the output looks clean. NativeWind's own wrapper forwards
// stderr containing "warn -" to the console, and this script bypasses that
// wrapper entirely - it forks the compiler child directly. So the warnings were
// being printed to a pipe that went nowhere, and `verify:theme` reported 0
// failures regardless of what the compiler had to say.
//
// NativeWind classifies a line as a warning by looking for the substring
// "warn -" in stderr; that is the contract, taken from
// `node_modules/nativewind/dist/metro/tailwind/v3/index.js`. Anything else on
// stderr is informational (the caniuse-lite notice, progress lines) and must not
// fail the run.
const stderrChunks = [];
child.stderr?.on('data', (d) => stderrChunks.push(d.toString()));

/**
 * Shut down and report.
 *
 * The child is killed and its exit is awaited before the tally is printed,
 * because that is when the buffered stderr has been fully flushed. Calling
 * `process.exit()` immediately after `child.kill()` instead would discard the
 * remaining pipe data and silently drop the warnings this exists to surface -
 * a check that looks like it works and does not.
 */
function finish() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child.exitCode === null && child.signalCode === null) child.kill();
  if (child.exitCode !== null || child.signalCode !== null) return finishReport();
  child.once('exit', finishReport);
}
let shuttingDown = false;

function finishReport() {
  const text = stderrChunks.join('');
  const warnings = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes('warn -'));

  if (warnings.length > 0) {
    console.log('\n--- Tailwind reported warnings ---');
    for (const w of warnings) console.log('  ' + w);
    console.log(
      '  A rule that fails to compile is dropped, exactly like the :root.dark\n' +
        '  case documented in global.css. Treat these as failures until proven\n' +
        '  otherwise; the token assertions above cannot detect a lost rule.',
    );
    failed += warnings.length;
  }

  console.log(`\n${failed} failed check(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

child.on('message', async (msg) => {
  const css = String(msg);
  console.log(`\n=== STAGE 1: raw Tailwind output (${platform}), ${css.length} bytes ===`);

  check('light canvas 246 247 250', css.includes('246 247 250'));
  check('dark canvas 10 12 16', css.includes('10 12 16'));
  check('dark ink 240 242 247', css.includes('240 242 247'));
  check('dark critical 255 138 138', css.includes('255 138 138'));
  check('dark accent 96 156 255', css.includes('96 156 255'));
  check('.dark:root present', css.includes('.dark:root'), '');
  check('no stale :root.dark', !css.includes(':root.dark {'), 'would be dropped by stage 2');

  // ---- Stage 2 ---------------------------------------------------------
  // The two platforms take DIFFERENT paths through the compiler, and conflating
  // them is how this bug stayed hidden. In
  // `react-native-css-interop/dist/metro/index.js`:
  //
  //   const output = platform === "web"
  //     ? css.toString("utf-8")
  //     : getNativeJS(cssToReactNativeRuntime(css, options, debug), debug);
  //
  // So on web the stylesheet ships as real CSS text and the browser parses it,
  // which means `.dark:root` works and the lightningcss normalisation - the step
  // that was dropping the block - never runs. On native the same source is
  // compiled into a JS object, and the selector must match what that normaliser
  // recognises.
  //
  // `:root.dark` therefore fails NATIVE ONLY. It would have looked perfect in a
  // browser throughout, which is precisely why it survived a build and a review.
  if (platform === 'web') {
    console.log('\n=== STAGE 2: web ships the CSS verbatim, no normalisation ===');
    check('.dark:root survives as CSS text', css.includes('.dark:root'));
    check('light tokens in served CSS', css.includes('--bg-canvas: 246 247 250'));
    check('dark tokens in served CSS', css.includes('--bg-canvas: 10 12 16'));
    check('bg-canvas utility in served CSS', css.includes('.bg-canvas'));
    finish();
    return;
  }

  console.log('\n=== STAGE 2: react-native-css-interop (lightningcss) ===');
  const interop = require(path.join(root, 'node_modules/react-native-css-interop/dist/css-to-rn'));
  const compiled = interop.cssToReactNativeRuntime(css, {}, () => {});

  const rv = compiled.rootVariables;
  check('rootVariables emitted', rv !== undefined && Object.keys(rv).length > 0);

  if (rv === undefined) {
    finish();
    return;
  }

  const names = Object.keys(rv);
  console.log(`  ${names.length} variables: ${names.join(' ')}`);

  const withDark = names.filter((n) => rv[n].dark !== undefined);
  check('EVERY variable has a dark value', withDark.length === names.length, `${withDark.length}/${names.length}`);

  // Spot-check the actual dark channel triples, as compiled.
  const SPOT = [
    ['--bg-canvas', 'dark', [10, 12, 16]],
    ['--bg-surface', 'dark', [20, 23, 30]],
    ['--text-primary', 'dark', [240, 242, 247]],
    ['--accent-base', 'dark', [96, 156, 255]],
    ['--critical', 'dark', [255, 138, 138]],
    ['--success', 'dark', [84, 214, 168]],
    ['--bg-canvas', 'light', [246, 247, 250]],
    ['--critical', 'light', [190, 18, 34]],
  ];
  for (const [name, mode, expected] of SPOT) {
    const got = rv[name]?.[mode];
    const ok = Array.isArray(got) && got.length === 3 && got.every((v, i) => v === expected[i]);
    check(`${name}.${mode} = ${expected.join(' ')}`, ok, ok ? '' : `got ${JSON.stringify(got)}`);
  }

  // Utilities must still resolve, and must be var()-based rather than hard-coded.
  check('bg-canvas utility present', compiled.rules?.['bg-canvas'] !== undefined);
  check('text-ink utility present', compiled.rules?.['text-ink'] !== undefined);
  check('text-critical utility present', compiled.rules?.['text-critical'] !== undefined);
  check(
    'bg-canvas still uses var(), not a literal',
    JSON.stringify(compiled.rules['bg-canvas']).includes('--bg-canvas'),
  );
  check('darkMode flag set to class', JSON.stringify(compiled.flags).includes('dark'), JSON.stringify(compiled.flags));

  finish();
});

/**
 * The child exiting without ever sending a message is a failure in its own
 * right: it means Tailwind produced no CSS at all, which is the exact shape of
 * the original bug, and the token assertions never got the chance to run.
 */
child.on('exit', (code, signal) => {
  if (shuttingDown) return;
  console.log(
    `\n  FAIL the Tailwind compiler exited without producing any CSS (code=${code}, signal=${signal})`,
  );
  failed += 1;
  finishReport();
});
