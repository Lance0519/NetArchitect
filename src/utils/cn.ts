/**
 * Class name composition.
 *
 * ## Why tailwind-merge and not just string concatenation
 *
 * Concatenation is *almost* right and that is what makes it dangerous. NativeWind
 * turns a `className` into a style object in class order, so a later class
 * usually overwrites an earlier one - which makes `cn('p-4', 'px-2')` look like it
 * works. It does, by accident. The reverse, `cn('px-2', 'p-4')`, resolves to
 * `p-4` in NativeWind and to `px-2` in every other Tailwind setup, because
 * `padding` is a shorthand that the longhand has to win against. So the same
 * component API would behave differently here than it would anywhere else, and
 * only in the case where a caller tries to override padding on a component that
 * sets a shorthand.
 *
 * `tailwind-merge` resolves that properly: it knows `p-4` and `px-2` are related
 * and keeps both, and it knows `bg-surface` and `bg-accent` are alternatives and
 * keeps the last.
 *
 * The cost is a dependency and a small amount of work per call. That is cheaper
 * than a component whose `className` prop means something different in this
 * codebase than it does anywhere else.
 *
 * ## What tailwind-merge can and cannot group here - measured, not assumed
 *
 * tailwind-merge groups two classes by matching each against a *validator* for
 * its prefix. Its default validators recognise Tailwind's own values: numbers,
 * t-shirt sizes, fractions, arbitrary values. This project adds named tokens, and
 * a name matches none of those. So what works depends entirely on which kind of
 * token it is, and the difference is not something to guess at:
 *
 * | Token kind                    | Examples                              | Grouped correctly? |
 * | ----------------------------- | ------------------------------------- | ------------------ |
 * | Colours                      | `bg-surface`, `text-ink-muted`        | **yes**            |
 * | Colours with `/opacity`      | `bg-critical/10`                      | **yes**            |
 * | Type scale                   | `text-caption`, `text-display`        | **yes**            |
 * | Border radius (bespoke)      | `rounded-pill`, `rounded-control`     | **no**             |
 * | Max width (bespoke)          | `max-w-read`, `max-w-form`            | **no**             |
 * | Spacing (bespoke)            | `p-touch`, `px-gutter`, `min-h-touch` | **no**             |
 *
 * Colours work because any `bg-<name>` is a colour as far as tailwind-merge is
 * concerned - the value is never inspected, so a custom name is indistinguishable
 * from a stock one. Bespoke *sizes* are the opposite: the value is the whole
 * point, and an unrecognised one falls out of the group entirely.
 *
 * Consequence, and this is the part that matters at a call site:
 *
 *   cn('rounded-control', 'rounded-pill')  ->  'rounded-control rounded-pill'
 *
 * Both survive. The override still *appears* to work, because NativeWind resolves
 * the class list in order and the caller's class is later. That is incidental, and
 * it is exactly the accidental-correctness this module was introduced to remove.
 *
 * ## Why there is no `extendTailwindMerge` config
 *
 * Because all three of its extension routes were tried, and each one fails:
 *
 *   - `extend.classGroups` **adds an entry** to a group rather than widening it,
 *     creating a second group. `rounded-pill` then conflicts with
 *     `rounded-card` but not with `rounded-4`, which is the case that matters.
 *   - `extend.theme` replaces the theme scale wholesale, and `p-2` + `px-4` stops
 *     collapsing to `px-4 p-4` - it breaks the shorthand behaviour this entire
 *     module exists to get right, in exchange for a case that already works.
 *   - `override.classGroups` with hand-copied validators drops `isTshirtSize`,
 *     so `rounded-lg` and `rounded-sm` stop conflicting. Copying the validator
 *     list by hand is the fragile version of the same mistake.
 *
 * Configuring it is possible; every route to doing so costs more correctness than
 * it buys. So the guarantee for bespoke sizing tokens comes from argument order
 * instead, and that is checked rather than assumed:
 *
 *   **`className` must be the last argument to `cn()`.**
 *
 * `npm run check` enforces it across `src/` and `app/` via
 * `scripts/check-class-order.cjs`, because a reordering would not fail any test,
 * not fail typecheck, and not fail lint - it would quietly stop honouring a
 * caller's `rounded-*`, `max-w-*` or `p-*` override.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes, letting later arguments win conflicts.
 *
 * Accepts everything `clsx` accepts: strings, arrays, and `{ 'class': condition }`
 * objects, so a variant reads as one call rather than a string of ternaries.
 *
 * ```ts
 * cn('px-4 py-2', isWide && 'px-8', className)
 * ```
 *
 * `className` goes last, always. See the module docstring for why that is a hard
 * rule rather than a convention, and for the token kinds the merge handles on its
 * own.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export type { ClassValue };

