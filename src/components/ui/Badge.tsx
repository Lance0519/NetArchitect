/**
 * Badge - small inline label.
 *
 * Shape carries meaning, not just color:
 *   - neutral, info, success: rounded rectangle
 *   - medium, high, critical: pill (fully rounded)
 *
 * CidrBadge and VlanBadge encode specific technical data.
 */

import { type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { AppText } from '../AppText';
import type { Severity } from '@/types/network';
import { severityMeta } from '@/theme/severity';
import { cn } from '@/utils/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'info' | Severity;

const BADGE_TONE: Readonly<Record<BadgeTone, string>> = Object.freeze({
  neutral: 'bg-surface-inset border-line',
  accent: 'bg-accent-soft border-accent/30',
  success: 'bg-success/10 border-success/30',
  info: 'bg-info/10 border-info/30',
  critical: 'bg-critical/10 border-critical/40',
  high: 'bg-high/10 border-high/40',
  medium: 'bg-medium/10 border-medium/40',
});

const BADGE_TEXT: Readonly<Record<BadgeTone, string>> = Object.freeze({
  neutral: 'text-ink-muted',
  accent: 'text-accent',
  success: 'text-success',
  info: 'text-info',
  critical: 'text-critical',
  high: 'text-high',
  medium: 'text-medium',
});

const PILL_TONES: readonly BadgeTone[] = Object.freeze(['critical', 'high', 'medium']);

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
 * CidrBadge - a CIDR value in monospace.
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
 * VlanBadge - a VLAN ID as "VLAN 10".
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
 * SeverityTag - icon, color, and written label together.
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
