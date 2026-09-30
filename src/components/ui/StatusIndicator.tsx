/**
 * StatusIndicator - a small colored dot with a label.
 *
 * Used for "Offline Ready", plan status, etc.
 * The label is always present; color is never the only signal.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { cn } from '@/utils/cn';

export interface StatusIndicatorProps {
  label: string;
  tone?: 'success' | 'warning' | 'critical' | 'neutral';
  className?: string;
}

const TONE_CLASS = {
  success: 'bg-success',
  warning: 'bg-medium',
  critical: 'bg-critical',
  neutral: 'bg-line',
} as const;

export function StatusIndicator({ label, tone = 'neutral', className }: StatusIndicatorProps) {
  return (
    <View className={cn('flex-row items-center gap-1.5', className)}>
      <View className={cn('h-2 w-2 rounded-pill', TONE_CLASS[tone])} />
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}
