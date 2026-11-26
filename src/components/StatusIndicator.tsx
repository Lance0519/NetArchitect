/**
 * StatusIndicator - a small colored dot paired with a written label.
 */

import { View } from 'react-native';

import { AppText } from './AppText';
import { cn } from '@/utils/cn';

export interface StatusIndicatorProps {
  readonly label: string;
  readonly tone?: 'success' | 'warning' | 'critical' | 'neutral' | undefined;
  readonly className?: string | undefined;
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
