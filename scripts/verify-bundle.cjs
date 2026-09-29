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

// A check that has never failed proves nothing, and this project's history is a
// run of checks that passed while the thing they were checking was broken: the
// @layer base token drop, the :root.dark native-only drop, the missing font-mono,
// the no-op ESLint override, the cn() grouping gap. Every one of those had a green
// gate.
//
// So before trusting any marker below, prove the mechanism discriminates. Each case
// is a real marker deliberately perturbed in a way that must break the search: a
// casing change, a negation, a plausible rewording, and a full-width homoglyph. A
// search that cannot tell these from the real string is not a search, and finding
// that out here is far cheaper than finding it out after a regression ships.
console.log('\n--- negative control: does the marker search discriminate? ---');
let controlBad = 0;
const control = (label, ok) => {
  if (!ok) controlBad += 1;
  console.log((ok ? '  ok   ' : '  FAIL ') + label);
};
for (const [label, marker, shouldBeFound] of [
  ['a real marker is found', 'Both addresses are usable (RFC 3021)', true],
  ['a genuine prefix of it is found', 'Both addresses are usable', true],
  ['a casing change is not found', 'Both addresses are usable (rfc 3021)', false],
  ['a negation is not found', 'Both addresses are not usable', false],
  ['a plausible rewording is not found', 'Only one address is usable (RFC 3021)', false],
  // U+FF0F FULLWIDTH SOLIDUS where an ASCII slash belongs. A normaliser that folds
  // it would let a half-width string pass against a full-width one, which is the
  // class of near-miss that makes a green gate meaningless.
  ['a full-width homoglyph is not found', '／31 is a point-to-point link', false],
  // Phase 7's own markers, on the same terms. The offline statement above was originally
  // checked as a bare "NetArchitect never connects to a network", which is shared with
  // the calculator - so it passed against a bundle that contained no VLSM screen at all.
  // A check that cannot tell two screens apart is a check about the wrong screen.
  ['a Phase 7 marker is found', 'Point-to-point links are sized as /31', true],
  ['another Phase 7 marker is found', 'Send to Network Planner', true],
  // The lead-in the offline marker above is discriminated by. Checking that it is found
  // is the real assertion; the negative half is the rewording below, not the calculator's
  // own line - an earlier version of this control asserted that the calculator's copy
  // was absent, which is false, because the calculator screen is in the bundle too.
  ['the VLSM-only lead-in is found', 'Allocated on this device.', true],
  [
    'a copy of the Phase 6 line extended with the Phase 7 lead-in is not found',
    'Computed on this device. NetArchitect never connects to a network. Allocated on this device.',
    false,
  ],
  ['a plausible Phase 7 rewording is not found', 'Point-to-point links use a /31', false],
  // Phase 8's markers, on the same terms. The planner is the third screen with real
  // content, and it has the same trap: "NetArchitect never connects to a network" is now
  // on three screens, so a check for that clause alone would pass against a bundle with
  // no planner in it. Each check below is discriminated by a lead-in or a phrase that
  // belongs to exactly one route.
  ['a Phase 8 marker is found', 'Reallocate from host counts', true],
  ['the planner-only lead-in is found', 'Planned on this device.', true],
  [
    'a copy of the Phase 7 line extended with the Phase 8 lead-in is not found',
    'Allocated on this device. NetArchitect never connects to a network. Planned on this device.',
    false,
  ],
  // Two screens share the words "Network Planner" - the VLSM hand-off button and the
  // route heading - so the heading is checked with a phrase that only the route has.
  ['the planner subtitle is found', 'Build a plan from a site and its needs', true],
  ['a plausible Phase 8 rewording is not found', 'Reallocate from host counts and roles', false],
  // The preview sheet is the only place a destructive diff is described, and it is the
  // part most likely to be tree-shaken if a route stops resolving.
  ['a change-preview marker is found', 'Keep what I have', true],
  [
    'a copy of the preview title with the cancel label is not found',
    'Reallocate from host countsKeep what I have',
    false,
  ],
]) {
  control(label, hay.includes(marker) === shouldBeFound);
}
failed += controlBad;
if (controlBad > 0) {
  console.log(
    '\n  the marker search is not discriminating, so every result above it is\n' +
      '  unreliable. Fix the search before reading any other line of this output.',
  );
}

// A screen that is present in source but absent from the bundle is a completely
// ordinary outcome, not an exotic one: an unrouted file, a route the navigator never
// resolves, a dynamic import that got tree-shaken. `expo export` exits 0 for every
// one of them, and so does this script without the checks below.
//
// So the calculator is asserted on by its own string literals. These are greppable
// for the reason given at the top of this file - Hermes keeps string literals in a
// string table, just not object literals - and each one is pinned verbatim in
// tests/calculator-input.test.ts or tests/subnet-view.test.ts. A wording change is
// therefore a product decision, and it should surface as a failing check here rather
// than passing silently because a string stopped being grepped for.
console.log('\n--- Phase 6: the calculator screen and its confirmed rules ---');
for (const [label, marker] of [
  // Screen chrome, unique to this route.
  ['screen heading', 'IP Calculator'],
  ['screen empty state', 'Nothing to calculate yet'],
  // Accessibility strings. If the hint is gone, the rows shipped as unlabelled
  // pressables, which is the exact failure the labels exist to prevent - and it is
  // invisible in a screenshot.
  ['row copy hint', 'Copies this value to the clipboard'],
  // The input rules the user explicitly confirmed, verbatim from CALCULATOR_MESSAGES.
  ['rule: empty field', 'Enter an address and prefix, for example 192.168.1.50/24.'],
  ['rule: 24/24 refused as ambiguous', 'That is two prefix lengths with no address.'],
  ['rule: leading slash accepted', 'A leading slash is fine.'],
  // The special-case notices the plan asked for by name.
  ['notice: /31 is RFC 3021', 'Both addresses are usable (RFC 3021)'],
  ['notice: /32 is one address', 'One address, not a subnet'],
  ['notice: /30 has two', 'Only two usable addresses'],
  // The citation, which proves the view model shipped rather than only the screen.
  ['citation RFC 3021', 'RFC 3021'],
]) {
  check(label, hay.includes(marker), marker.length > 46 ? marker.slice(0, 46) + '...' : marker);
}

// Phase 7, same reasoning as Phase 6 above. The VLSM screen is the second screen with
// real content, and the failure mode is identical: a route that builds, exports and
// reports success while the navigator never resolves it, leaving the user with no way to
// reach a feature the plan says exists.
//
// The strings below are the ones that carry meaning rather than chrome. A screen title
// proves the route shipped; a standards citation and the specific notice copy prove the
// view model shipped, which is the part most likely to be tree-shaken and the part a
// screenshot would not reveal.
console.log('\n--- Phase 7: the VLSM allocator and its confirmed rules ---');
for (const [label, marker] of [
  ['screen heading', 'VLSM Allocator'],
  ['screen subtitle', 'Fit variable-length subnets into a parent block'],
  ['screen empty state', 'No requirements yet'],
  // The hand-off. If this is gone the button navigated to a planner it could not have
  // been given anything for - a dead end with no error, which is the worst shape a
  // broken feature can take.
  ['hand-off action', 'Send to Network Planner'],
  ['copy action', 'Copy as a table'],
  // The offline promise, restated on the screen that writes plans. The lead-in matters:
  // the shared clause "NetArchitect never connects to a network" is on the calculator
  // too, so grepping that alone would pass on a bundle with no VLSM screen in it at all.
  // Found by the negative control below, after the first version of this check passed
  // against a Phase 6 bundle.
  ['offline statement', 'Allocated on this device. NetArchitect never connects'],
  // The three explanations the plan asked for by name, each with its citation. A
  // citation is the strongest available evidence that the notice came from the view
  // model and not from a hand-written placeholder in the component.
  ['notice: /31 is RFC 3021', 'Point-to-point links are sized as /31'],
  ['citation RFC 3021', 'RFC 3021'],
  ['notice: alignment strands addresses', 'Some free space is too small to use'],
  ['citation RFC 7600', 'RFC 7600'],
  ['notice: parent fully allocated', 'The parent is fully allocated'],
  // The exhaustion path, which has no result to show and so is the easiest state to
  // lose in a refactor that only ever tested the happy path.
  ['notice: requirements do not fit', 'These requirements do not fit'],
  // The table's own guidance, which is what tells a user the table scrolls.
  ['table scroll hint', 'Scroll the table sideways for the address columns'],
]) {
  check(label, hay.includes(marker), marker.length > 46 ? marker.slice(0, 46) + '...' : marker);
}

// Phase 8, the same reasoning again. The planner is the third screen with real content and
// the same failure mode: a route that builds, exports and reports success while the
// navigator never resolves it. The user has no VLSM hand-off to reach it by, and a
// "Send to Network Planner" button that lands on an unresolvable route looks like a
// dead end rather than a build failure.
//
// Two of the markers below are deliberately *not* the route title. "Network Planner" also
// appears on the VLSM screen's hand-off button, so checking the bare title would pass
// against a bundle with no planner in it - the same mistake the Phase 7 offline check
// made and had to be fixed for. The subtitle and the lead-in below are unique to this
// route, which is what the negative control above demonstrates.
console.log('\n--- Phase 8: the network planner and its findings ---');
for (const [label, marker] of [
  ['screen subtitle', 'Build a plan from a site and its needs'],
  ['screen empty state', 'No subnets yet'],
  // The two operations that rewrite the plan. Both are destructive and both are behind a
  // preview; if either is gone the feature it belongs to is unreachable, and neither is
  // visible on screen until tapped.
  ['repack action', 'Reallocate from host counts'],
  ['template action', 'Start from a template'],
  // The preview sheet. The cancel label is checked rather than the title, because the
  // title is one of three and would not tell us which sheet this is.
  ['preview cancel', 'Keep what I have'],
  ['preview confirm', 'Apply this change'],
  // The finding list, which is the Phase 8 exit criterion rendered: an overlap is
  // representable and flagged. The word "Overlap" is also the only place the app names
  // the condition in a list, so its absence means the finding has nowhere to show.
  ['finding: overlap is named', 'Overlap'],
  ['finding: outside the parent is named', 'Outside parent'],
  ['finding: duplicate VLAN is named', 'Duplicate VLAN'],
  ['finding explanation', 'these rows just disagree with each other'],
  // The offline promise, third wording of the same clause. Each screen says the same
  // thing in its own words, which is the point - the promise is repeated where a plan is
  // made, not parked on one screen.
  ['offline statement', 'Planned on this device. NetArchitect never connects'],
  // The honest statement about what this screen cannot do yet. Losing it would leave a
  // user believing their plan was saved, which is the worst thing this screen could imply.
  ['saving is deferred, and says so', 'Saving arrives with the local database'],
]) {
  check(label, hay.includes(marker), marker.length > 46 ? marker.slice(0, 46) + '...' : marker);
}

console.log(
  '\nnote: token VALUES are not checked here. Hermes stores object literals as\n' +
    'bytecode, so `10,12,16` is not greppable. Run `npm run verify:theme` for that.',
);
console.log(`\n${failed} failed check(s)`);
process.exit(failed === 0 ? 0 : 1);
