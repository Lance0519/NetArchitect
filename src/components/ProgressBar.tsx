/**
 * Progress bar component.
 *
 * A simple horizontal progress bar with an optional label. Used in the
 * learning screen to show topic accuracy.
 */

import { View } from 'react-native';

import { AppText } from './AppText';
import { cn } from '@/utils/cn';

export interface ProgressBarProps {
  /** Progress value between 0 and 1. */
  readonly value: number;
  /** Optional label shown below the bar. */
  readonly label?: string;
  readonly className?: string | undefined;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const percent = Math.round(clamped * 100);

  return (
    <View className={cn('gap-1', className)}>
      <View className="h-2 overflow-hidden rounded-pill bg-surface-inset">
        <View
          className="h-full rounded-pill bg-accent"
          style={{ width: `${percent}%` }}
        />
      </View>
      {label && (
        <AppText variant="caption" tone="faint">
          {label}
        </AppText>
      )}
    </View>
  );
}
