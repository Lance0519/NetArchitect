/**
 * The address-space bar.
 *
 * A stacked bar showing how the parent block is divided between the subnets that were
 * allocated and the space that was not.
 *
 * ## Views, not SVG
 *
 * The plan defers this to `react-native-svg` in Phase 12. Plain `View`s with percentage
 * widths are the right shape for a stacked bar - and for one that has to animate a
 * re-pack on every keystroke, `View` is both cheaper and easier to reason about. The
 * segment widths are the only thing SVG would add here, and `flexGrow` already does that.
 *
 * What SVG will be needed for later is the *refinement*: a legend with a real colour
 * ramp, per-role tinting, and the tick marks that show a misaligned boundary. None of
 * that is built here, and pretending to with `View`s would make the Phase 12 rewrite a
 * deletion rather than a change.
 *
 * ## Widths come from the view model, already summed to one
 *
 * Each segment's `share` is a fraction of the parent computed in `src/utils/vlsm-view.ts`
 * and asserted there to sum to 1. This component does not divide. A bar whose segments
 * do not add up misreports how full the address space is, which is the one thing it
 * exists to say, and that failure is invisible unless something checks the sum.
 *
 * ## A very small segment is still visible
 *
 * `minWidth` keeps a /31 from rendering as nothing. A point-to-point link is 2 addresses
 * out of a /22 - under a tenth of a percent - and a bar that simply omits it would be
 * claiming the address space is fully allocated when it is not. The segments therefore
 * overlap slightly rather than disappear. `flexBasis: 0` with `flexGrow: share` is what
 * lets a minimum and a proportion coexist: `width` alone would be overridden by the
 * minimum, and `flexGrow` alone would round the tiny ones to nothing.
 *
 * ## Colour is never the only signal
 *
 * Every segment is named, and the whole bar carries an accessibility label that reads out
 * the allocation in words. A bar is a chart, and a chart that only exists visually is
 * invisible to a screen reader and unreadable in greyscale - which is also how it looks
 * to a colour-blind reader, roughly 8% of men.
 */

import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { cn } from '@/utils/cn';

import type { VlsmBarSegment } from '@/utils/vlsm-view';

/**
 * Smallest width any segment is drawn at.
 *
 * A hairline rather than a few points: enough to be visible, small enough that adding it
 * to every segment cannot visibly distort the proportions it is reporting.
 */
const MIN_WIDTH = 2;

/**
 * Tint per role.
 *
 * Hand-written class names rather than a lookup into the token map, because these are
 * bespoke sizing/colour combinations that `cn()` does not group - and a name that does
 * not exist in `tailwind.config.js` is dropped silently, leaving an untinted segment that
 * still looks deliberate. Every one of these is asserted to exist by
 * `scripts/verify-bundle.cjs`.
 */
const ROLE_CLASS: Readonly<Record<string, string>> = {
  LAN: 'bg-accent',
  SERVERS: 'bg-accent-soft',
  MANAGEMENT: 'bg-medium',
  VOIP: 'bg-info',
  IOT: 'bg-high',
  GUEST: 'bg-high',
  DMZ: 'bg-critical',
  POINT_TO_POINT: 'bg-line',
  CUSTOM: 'bg-line-subtle',
};

const FREE_CLASS = 'bg-surface-inset';

const classFor = (segment: VlsmBarSegment): string => {
  if (segment.isFree) return FREE_CLASS;
  return ROLE_CLASS[segment.role ?? ''] ?? 'bg-line-subtle';
};

export interface SubnetBarProps {
  readonly segments: readonly VlsmBarSegment[];
  /** e.g. `192.168.1.0/24`. Named in the accessibility label. */
  readonly parentCidr: string;
  /** e.g. `4 subnets, 240 of 256 addresses allocated`. */
  readonly summary: string;
  readonly className?: string | undefined;
}

export function SubnetBar({ segments, parentCidr, summary, className }: SubnetBarProps) {
  if (segments.length === 0) return null;

  return (
    <View
      className={cn('gap-2', className)}
      // One label for the whole bar rather than one per segment: nine tiny focusable
      // rectangles in a row is worse to navigate with a screen reader than a single
      // sentence that says the same thing.
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Address space for ${parentCidr}. ${summary}`}
    >
      <View className="h-3 flex-row overflow-hidden rounded-pill border border-line bg-surface-inset">
        {segments.map((segment) => (
          <View
            key={segment.id}
            // `flexBasis: 0` plus `flexGrow: share` is what lets a floor and a proportion
            // coexist; see the note on MIN_WIDTH.
            style={{ flexBasis: 0, flexGrow: segment.share, minWidth: MIN_WIDTH }}
            className={cn('h-full', classFor(segment))}
          />
        ))}
      </View>

      {/*
        The legend repeats the information as text. It is not hidden from a screen reader
        even though the bar above is one image, because a reader who wants the breakdown
        of a specific subnet should not have to infer it from a sentence.
      */}
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <View key={`legend-${segment.id}`} className="flex-row items-center gap-1.5">
            <View className={cn('h-2 w-2 rounded-pill', classFor(segment))} />
            <AppText variant="caption" tone="muted">
              {segment.isFree ? 'Free' : segment.label}
            </AppText>
            <AppText variant="caption" tone="faint" mono>
              {segment.percentLabel}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}
