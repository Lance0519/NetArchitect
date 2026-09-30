/**
 * Badge - a small inline label.
 *
 * ## Shape carries meaning here, not just colour
 *
 * A badge that only changes hue is unreadable in greyscale and for a reader with
 * a red/green deficiency. Every tone in this app therefore also changes *shape*:
 *
 *   neutral, info, success   rounded rectangle  (radii `sm`)
 *   medium, high, critical   pill              (fully rounded)
 *
 * A severity badge is a pill; an informational badge is a rectangle. A reader
 * scanning a column of audit findings sees the pill shape and knows the row is a
 * finding before reading a single character, and that conclusion survives being
 * printed in black and white.
 *
 * ## The CIDR and VLAN badges
 *
 * `CidrBadge` and `VlanBadge` are separate components rather than `Badge` with
 * different props, because both encode something specific: an address is
 * monospaced so digits align, and a VLAN id is presented as a *rounded rectangle
 * with a text prefix* so it cannot be confused with a CIDR at a glance. Two
 * different meanings, two different shapes.
 */

import { type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { AppText } from './AppText';
import type { Severity } from '@/types/network';
import { severityMeta } from '@/theme/severity';
import { cn } from '@/utils/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'info' | Severity;

/** Surfaces, keyed by tone. */
const BADGE_TONE: Readonly<Record<BadgeTone, string>> = Object.freeze({
  neutral: 'bg-surface-inset border-line',
  accent: 'bg-accent-soft border-accent/30',
  success: 'bg-success/10 border-success/30',
  info: 'bg-info/10 border-info/30',
  critical: 'bg-critical/10 border-critical/40',
  high: 'bg-high/10 border-high/40',
  medium: 'bg-medium/10 border-medium/40',
});

/** Text colours, keyed by tone. Separate from the surface so they can diverge. */
const BADGE_TEXT: Readonly<Record<BadgeTone, string>> = Object.freeze({
  neutral: 'text-ink-muted',
  accent: 'text-accent',
  success: 'text-success',
  info: 'text-info',
  critical: 'text-critical',
  high: 'text-high',
  medium: 'text-medium',
});

/** Tones that render as a pill rather than a rounded rectangle. */
const PILL_TONES: readonly BadgeTone[] = Object.freeze(['critical', 'high', 'medium']);

/**
 * `className` and `tone` are re-declared rather than inherited.
 *
 * NativeWind augments RN's own prop types with `className?: string`, and under
 * `exactOptionalPropertyTypes` that rejects an explicit `undefined` - so a caller
 * forwarding a possibly-absent value would get a type error for passing along a
 * value they do not have. `Omit` + redeclare is the fix. See src/types/props.ts.
 */
export interface BadgeProps extends Omit<ViewProps, 'className'> {
  tone?: BadgeTone | undefined;
  children: ReactNode;
  className?: string | undefined;
}

function isTextContent(node: ReactNode): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return true;
  }
  if (node === null || node === undefined || typeof node === 'boolean') {
    return true;
  }
  if (Array.isArray(node)) {
    return node.every(isTextContent);
  }
  return false;
}

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  const isPill = PILL_TONES.includes(tone);
  return (
    <View
      className={cn(
        'self-start border px-2 py-0.5',
        // The shape difference is the accessibility mechanism, so it is applied
        // from the tone list above rather than left to each call site.
        isPill ? 'rounded-pill' : 'rounded-[6px]',
        BADGE_TONE[tone],
        className,
      )}
      {...rest}
    >
      {isTextContent(children) ? (
        <AppText variant="caption" className={cn('font-medium', BADGE_TEXT[tone])}>
          {children}
        </AppText>
      ) : (
        children
      )}
    </View>
  );
}

/**
 * A CIDR value.
 *
 * Monospaced, so a vertical list of subnets has its digits aligned and the eye
 * can track the changing octet instead of re-reading each row.
 */
export function CidrBadge({ value, className, ...rest }: { value: string } & ViewProps) {
  return (
    <View
      className={cn(
        'self-start rounded-[6px] border border-line bg-surface-inset px-2 py-0.5',
        className,
      )}
      {...rest}
    >
      <AppText mono variant="caption" tone="muted">
        {value}
      </AppText>
    </View>
  );
}

/**
 * A VLAN id.
 *
 * Spelled `VLAN 10`, not `10`. A bare number next to a CIDR reads as another
 * prefix, and "VLAN 10" does not. The rectangle shape distinguishes it from
 * {@link CidrBadge} and from the pill severity badges.
 */
export function VlanBadge({ vlanId, className, ...rest }: { vlanId: number } & ViewProps) {
  return (
    <View
      className={cn(
        'self-start rounded-[6px] border border-accent/30 bg-accent-soft px-2 py-0.5',
        className,
      )}
      {...rest}
    >
      <AppText mono variant="caption" tone="accent">
        {`VLAN ${vlanId}`}
      </AppText>
    </View>
  );
}

/**
 * A severity tag: icon, colour and written label, together.
 *
 * This is the only component permitted to render a bare severity, and it always
 * renders all three channels. See `src/theme/severity.ts` for why.
 */
export function SeverityTag({
  severity,
  size = 'md',
}: {
  severity: Severity;
  size?: 'sm' | 'md';
}) {
  const meta = severityMeta(severity);
  const Icon = meta.icon;
  const isSmall = size === 'sm';

  return (
    <View
      // The whole tag is one accessibility element reading the level, so a screen
      // reader announces "High" rather than reading the icon and the text as two
      // separate things.
      accessibilityLabel={meta.label}
      className={cn(
        'flex-row items-center self-start gap-1.5 border',
        isSmall ? 'rounded-pill px-2 py-0.5' : 'rounded-pill px-2.5 py-1',
        BADGE_TONE[severity],
      )}
    >
      <Icon
        size={isSmall ? 12 : 14}
        strokeWidth={2.5}
        className={BADGE_TEXT[severity]}
        // The label beside it already states the level, so the icon adds nothing
        // for a screen reader.
        accessibilityElementsHidden
      />
      <AppText
        variant="caption"
        className={cn('font-semibold uppercase tracking-wide', BADGE_TEXT[severity])}
      >
        {meta.label}
      </AppText>
    </View>
  );
}
