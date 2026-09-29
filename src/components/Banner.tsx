/**
 * Banner - an inline message that sits above or below content.
 *
 * ## The four tones, and why `warn` is not `medium`
 *
 * A banner is not a severity. Severity (`critical`..`info`) belongs to audit
 * findings and is defined in `src/theme/severity.ts`. A banner is a statement
 * the *interface* is making - a disclaimer, a hint, a failure - so it gets its own
 * four tones: `info`, `success`, `warn`, `error`. Conflating the two is how a
 * screen ends up showing a red banner for what is really an advisory note, which
 * trains people to ignore red.
 *
 * ## Why the disclaimer banner exists as a component
 *
 * The security disclaimer has to appear on the auditor, and `SECURITY_DISCLAIMER`
 * in `standards.ts` is a single frozen string. Rendering it through this component
 * means it cannot be shown as a bare paragraph of small grey text that reads as
 * boilerplate, and it means the "not a guarantee" wording is visually paired with
 * the claim it qualifies.
 */

import { type ReactNode } from 'react';
import { View } from 'react-native';
import {
  CircleCheck,
  CircleX,
  Info as InfoIcon,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';

import { AppText } from '@/components/AppText';
import { cn } from '@/utils/cn';

export type BannerTone = 'info' | 'success' | 'warn' | 'error';

const BANNER_TONE = {
  info: { surface: 'bg-info/10', border: 'border-info/40', text: 'text-info', Icon: InfoIcon },
  success: {
    surface: 'bg-success/10',
    border: 'border-success/40',
    text: 'text-success',
    Icon: CircleCheck,
  },
  warn: {
    surface: 'bg-high/10',
    border: 'border-high/40',
    text: 'text-high',
    Icon: TriangleAlert,
  },
  error: {
    surface: 'bg-critical/10',
    border: 'border-critical/40',
    text: 'text-critical',
    Icon: CircleX,
  },
} as const satisfies Record<
  BannerTone,
  { surface: string; border: string; text: string; Icon: LucideIcon }
>;

export interface BannerProps {
  tone?: BannerTone;
  /** Optional bold line above the body. */
  title?: string;
  children: ReactNode;
  className?: string | undefined;
}

export function Banner({ tone = 'info', title, children, className }: BannerProps) {
  const { surface, border, text, Icon } = BANNER_TONE[tone];

  return (
    <View
      // The whole banner is one accessibility element, so a screen reader reads
      // "Warning: <text>" once rather than announcing the icon, the title and the
      // body as three unrelated fragments.
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={cn('flex-row gap-2.5 rounded-card border p-3', surface, border, className)}
    >
      <Icon size={16} strokeWidth={2.5} className={cn('mt-0.5 shrink-0', text)} accessibilityElementsHidden />
      <View className="flex-1 gap-1">
        {title === undefined ? null : (
          <AppText variant="label" className={cn('font-semibold', text)}>
            {title}
          </AppText>
        )}
        <AppText variant="caption" tone="muted" className="leading-4">
          {children}
        </AppText>
      </View>
    </View>
  );
}
