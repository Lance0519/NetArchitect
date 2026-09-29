/**
 * Enforces one rule: `className` must be the last argument to every `cn()` call.
 *
 * ## Why this needs a machine check
 *
 * tailwind-merge groups classes by matching each value against a list of
 * Tailwind's own. This project's bespoke *sizing* tokens - `rounded-pill`,
 * `max-w-read`, `p-touch`, `min-h-touch` - are not in that list, so they are not
 * grouped, so both survive the merge:
 *
 *     cn('rounded-control', 'rounded-pill')  ->  'rounded-control rounded-pill'
 *
 * The override still works, because NativeWind applies the class list in order
 * and the caller's class is later. That is what makes the rule worth enforcing
 * rather than merely documenting: reorder the arguments and the override stops
 * winning, and **nothing fails**. Not a test, not `tsc`, not ESLint, not the
 * bundler. The component simply stops accepting a `rounded-*`, `max-w-*` or
 * `p-*` override, and the only symptom is that a button looks slightly wrong.
 *
 * Colours and the type scale are unaffected - any `bg-<name>` is a colour to
 * tailwind-merge and its value is never inspected. So a reordering would be
 * *partly* harmless, which is worse: it looks fine until the one component that
 * overrides a radius is touched.
 *
 * The alternative - an `extendTailwindMerge` config - was attempted three ways
 * and each either fails to group custom values against stock ones or breaks
 * stock behaviour, including the shorthand resolution `cn` exists to provide.
 * The reasoning and the measurements are in `src/utils/cn.ts`; this file is the
 * enforcement half of that contract.
 *
 * ## Method
 *
 * Arguments are split with a quote- and paren-aware scanner, not a regex. A
 * regular expression cannot tell `cn('a', 'b')` from `cn(foo(a, b), c)`, and a
 * naive one silently passes on the cases that matter. The scanner also skips
 * matches where `cn(` is the tail of a longer identifier, so `myCn(` is not
 * mistaken for a call.
 *
 * Usage: node scripts/check-class-order.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DIRS = ['src', 'app'];

/** Every source file under `dir`, recursively. */
function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, entry.name);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * Split a call's argument list on top-level commas.
 *
 * Tracks string state and bracket depth, because a comma inside `cn(a, b)` or
 * inside a quoted class string is not a separator.
 */
function splitArgs(src) {
  const args = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote !== null) {
      current += c;
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      current += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    if (c === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim().length > 0) args.push(current.trim());
  return args;
}

const files = DIRS.flatMap((d) => walk(d));
const violations = [];
let calls = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let at = 0;
  while (at < src.length) {
    at = src.indexOf('cn(', at);
    if (at === -1) break;

    // `cn` must be its own identifier, not the tail of `myCn` or `foo.cn`.
    const before = at > 0 ? src[at - 1] : '';
    if (before && /[A-Za-z0-9_$.]/.test(before)) {
      at += 3;
      continue;
    }

    // Find the matching close paren.
    let depth = 0;
    let end = -1;
    for (let j = at + 2; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      at += 3;
      continue;
    }

    calls += 1;
    const args = splitArgs(src.slice(at + 3, end));
    const index = args.findIndex((a) => /\bclassName\b/.test(a));
    if (index !== -1 && index !== args.length - 1) {
      violations.push({
        file: path.relative(root, file),
        line: src.slice(0, at).split('\n').length,
        index,
        total: args.length,
        found: args[index].replace(/\s+/g, ' '),
        last: args[args.length - 1].replace(/\s+/g, ' '),
      });
    }
    at = end + 1;
  }
}

if (violations.length === 0) {
  console.log(`class order: ok, ${calls} cn() call(s) across ${files.length} file(s)`);
  process.exit(0);
}

console.error(`class order: ${violations.length} violation(s) in ${calls} cn() call(s)\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    className is argument ${v.index + 1} of ${v.total}: ${v.found}`);
  console.error(`    last argument is                              : ${v.last}`);
  console.error('');
}
console.error('Move `className` to the last argument. Bespoke sizing tokens');
console.error('(rounded-*, max-w-*, p-*, min-h-*) are not grouped by');
console.error('tailwind-merge, so position is the only thing making the');
console.error("override work. See src/utils/cn.ts and PLAN.md Phase 5.");
process.exit(1);
