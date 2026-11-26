/**
 * Progress bar component with full accessibility semantics.
 */

import { View } from 'react-native';

import { AppText } from './AppText';
import { cn } from '@/utils/cn';

export type ProgressBarTone = 'default' | 'success' | 'warning' | 'critical';

export interface ProgressBarProps {
  /** Progress value between 0 and 1. */
  readonly value: number;
  /** Optional label shown below the bar. */
  readonly label?: string | undefined;
  readonly tone?: ProgressBarTone | undefined;
  readonly className?: string | undefined;
}

const TONE_CLASS: Readonly<Record<ProgressBarTone, string>> = Object.freeze({
  default: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-medium',
  critical: 'bg-critical',
});

export function ProgressBar({
  value,
  label,
  tone = 'default',
  className,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const percent = Math.round(clamped * 100);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? `${percent}%`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      className={cn('gap-1', className)}
    >
      <View className="h-2 overflow-hidden rounded-pill bg-surface-inset">
        <View
          className={cn('h-full rounded-pill', TONE_CLASS[tone])}
          style={{ width: `${percent}%` }}
        />
      </View>
      {label ? (
        <AppText variant="caption" tone="faint">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}
