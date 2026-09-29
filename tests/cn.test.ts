/**
 * Tests for `cn`.
 *
 * This function gets no coverage from anywhere else, and the project depends on
 * it from two directions at once. Every component in `src/components` uses it to
 * accept a `className` override, so a wrong answer here does not look wrong in
 * one place - it changes the padding of a Button, the background of a Card, and
 * the colour of a severity tag all at once, and each in a way that is easy to
 * read as a design mistake rather than a merge failure.
 *
 * The cases below are not padding. Each one is a claim made in the module
 * docstring, written down so that a future `tailwind-merge` upgrade cannot
 * quietly invalidate it. A comment asserting behaviour is not a test; this file
 * is what makes those comments true.
 */

import { describe, expect, it } from 'vitest';

import { cn } from '@/utils/cn';

describe('cn', () => {
  describe('composition', () => {
    it('returns a single string unchanged', () => {
      expect(cn('bg-canvas')).toBe('bg-canvas');
    });

    it('joins disjoint classes', () => {
      expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
    });

    it('always returns a string, never undefined', () => {
      // Call sites spread the result straight into `className`, and several pass
      // a possibly-undefined prop straight through. A return type of
      // `string | undefined` here would put a hole in every one of them.
      expect(cn()).toBe('');
      expect(cn(undefined)).toBe('');
      expect(cn(false)).toBe('');
      expect(cn(null)).toBe('');
      expect(cn(undefined, 'p-4', undefined)).toBe('p-4');
    });

    it('accepts arrays and conditional objects, as clsx does', () => {
      // This is why clsx is a dependency at all: a variant reads as one call
      // instead of a string of ternaries.
      expect(cn(['p-4', 'text-ink'])).toBe('p-4 text-ink');
      expect(cn({ 'p-4': true, 'py-2': false })).toBe('p-4');
      expect(cn('p-4', { 'px-2': true })).toBe('p-4 px-2');
    });

    it('treats a falsy conditional as absent', () => {
      expect(cn('p-4', false && 'px-2')).toBe('p-4');
      expect(cn('p-4', '')).toBe('p-4');
    });
  });

  describe('conflict resolution - the whole reason this module exists', () => {
    it('lets a later class override an earlier one of the same group', () => {
      // The call-site override contract. A component renders
      // `cn('bg-surface', className)`; if the override does not win, the
      // component's own styling is a permanent feature.
      expect(cn('bg-surface', 'bg-accent')).toBe('bg-accent');
      expect(cn('text-ink', 'text-critical')).toBe('text-critical');
      expect(cn('p-2', 'p-4')).toBe('p-4');
    });

    it('keeps a shorthand and its longhand, letting the longhand win', () => {
      // The claim in the module docstring, and the reason string concatenation
      // is not good enough. In NativeWind `cn('px-2', 'p-4')` would resolve to
      // `p-4` only by accident of class ordering; in a standard Tailwind setup
      // it resolves to `px-2`. tailwind-merge makes both agree.
      expect(cn('px-2', 'p-4')).toBe('p-4');
      expect(cn('pt-1', 'p-4')).toBe('p-4');
      // The winner keeps the loser's position, so this is `p-4` THEN `px-2` -
      // both present, with the longhand applied last.
      expect(cn('p-4', 'px-2')).toBe('p-4 px-2');
    });

    it('keeps the non-conflicting axis when only one is overridden', () => {
      // `p-4 px-2` is a real instruction: padding everywhere except a tighter
      // inline axis. Dropping the `p-4` here would silently discard intent.
      const result = cn('p-4', 'px-2');
      expect(result).toContain('p-4');
      expect(result).toContain('px-2');
    });

    it('resolves this project\'s own tokens, not just stock Tailwind names', () => {
      // The specific case the docstring says a hand-rolled version gets wrong.
      // These are non-default colour names declared in tailwind.config.js, and
      // tailwind-merge has to recognise them as one colour group.
      expect(cn('bg-surface', 'bg-accent')).toBe('bg-accent');
      expect(cn('text-ink', 'text-ink-muted')).toBe('text-ink-muted');
      expect(cn('bg-surface-raised', 'bg-surface-inset')).toBe('bg-surface-inset');
      expect(cn('border-line', 'border-line-subtle')).toBe('border-line-subtle');
      expect(cn('bg-accent-soft', 'bg-critical')).toBe('bg-critical');
    });

    it('handles the opacity modifier without confusing it for a different colour', () => {
      // `bg-critical/10` and `bg-critical` are the same group; leaving both
      // would put an alpha tint and a solid on the same element.
      expect(cn('bg-critical', 'bg-critical/10')).toBe('bg-critical/10');
      expect(cn('bg-critical/10', 'bg-critical')).toBe('bg-critical');
    });

    it('does not treat distinct properties as conflicting', () => {
      // A regression guard in the other direction. If `cn` were over-eager it
      // would start eating unrelated utilities, and every component would
      // quietly lose part of its layout.
      expect(cn('bg-canvas', 'text-ink')).toBe('bg-canvas text-ink');
      expect(cn('flex-row', 'items-center')).toBe('flex-row items-center');
      expect(cn('p-4', 'mt-2')).toBe('p-4 mt-2');
    });

    it('keeps radius and width groups independent of each other', () => {
      expect(cn('rounded-card', 'max-w-read')).toBe('rounded-card max-w-read');
    });

    it('resolves a stock radius scale, where the values are Tailwind\'s own', () => {
      // Bespoke radius names are NOT grouped - see the next test. Stock ones
      // are, because tailwind-merge recognises the values. Both are asserted so
      // a tailwind-merge upgrade that changed either would be caught.
      expect(cn('rounded-lg', 'rounded-sm')).toBe('rounded-sm');
      expect(cn('rounded-full', 'rounded-2xl')).toBe('rounded-2xl');
    });

    it('resolves a long override chain down to the last of each group', () => {
      // The realistic shape of a call site: a component's own classes, a
      // variant, then a caller override.
      const merged = cn('rounded-control bg-surface p-4', 'bg-surface-raised p-2', 'bg-critical p-1');
      expect(merged).toBe('rounded-control bg-critical p-1');
    });
  });

  /**
   * The one behaviour with a real trap in it, pinned deliberately.
   *
   * Bespoke SIZING tokens are not grouped by tailwind-merge, because it matches
   * a value against a list of Tailwind's own and `pill` is not in it. Both
   * classes therefore survive the merge.
   *
   * This is not a bug report - it is the documented contract, and the reason
   * `className` must be the last argument to `cn()`:
   *
   *   1. Both classes reach NativeWind, which applies them in order.
   *   2. The caller's class is later, so the override still wins.
   *   3. Reorder the arguments and it stops winning, with no error anywhere.
   *
   * Step 3 is what `scripts/check-class-order.cjs` exists to prevent. If that
   * check is ever deleted, these assertions are the remaining record that the
   * behaviour was known rather than accidental.
   */
  describe('bespoke sizing tokens are not grouped by the merge', () => {
    it('keeps both radius classes, so order decides', () => {
      expect(cn('rounded-control', 'rounded-pill')).toBe('rounded-control rounded-pill');
      expect(cn('rounded-pill', 'rounded-control')).toBe('rounded-pill rounded-control');
      // And against Tailwind's own scale, which is the case that shows the gap.
      expect(cn('rounded-control', 'rounded-4')).toBe('rounded-control rounded-4');
    });

    it('keeps both max-width classes, so order decides', () => {
      expect(cn('max-w-read', 'max-w-form')).toBe('max-w-read max-w-form');
      expect(cn('max-w-read', 'max-w-4xl')).toBe('max-w-read max-w-4xl');
    });

    it('keeps both bespoke spacing classes, so order decides', () => {
      expect(cn('min-h-touch', 'min-h-0')).toBe('min-h-touch min-h-0');
      expect(cn('p-touch', 'p-4')).toBe('p-touch p-4');
      expect(cn('px-gutter', 'px-2')).toBe('px-gutter px-2');
    });

    it('does NOT need the above for colours or the type scale', () => {
      // Stated as a positive assertion, because "colours work" was assumed in
      // the module docstring for a long time without anyone checking. These are
      // values tailwind-merge never inspects, so the custom names are
      // indistinguishable from stock ones.
      expect(cn('bg-surface', 'bg-accent')).toBe('bg-accent');
      expect(cn('text-caption', 'text-body')).toBe('text-body');
    });
  });
});
