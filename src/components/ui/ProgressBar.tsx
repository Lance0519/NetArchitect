/**
 * ProgressBar - horizontal progress indicator.
 *
 * Used for learning progress, utilization, etc.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { cn } from '@/utils/cn';

export interface ProgressBarProps {
  value: number;
  label?: string;
  tone?: 'default' | 'success' | 'warning' | 'critical';
  className?: string | undefined;
}

const TONE_CLASS = {
  default: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-medium',
  critical: 'bg-critical',
} as const;

export function ProgressBar({ value, label, tone = 'default', className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const percent = Math.round(clamped * 100);

  return (
    <View className={cn('gap-1', className)}>
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
