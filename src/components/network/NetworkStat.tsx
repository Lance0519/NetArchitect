/**
 * NetworkStat - a compact statistic display.
 *
 * Used for dashboard cards showing counts, percentages, etc.
 * Label on top, value below, optional detail text.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { cn } from '@/utils/cn';

export interface NetworkStatProps {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'accent' | 'success' | 'medium' | 'critical';
  mono?: boolean;
  className?: string;
}

const TONE_CLASS = {
  default: 'text-ink',
  accent: 'text-accent',
  success: 'text-success',
  medium: 'text-medium',
  critical: 'text-critical',
} as const;

export function NetworkStat({
  label,
  value,
  detail,
  tone = 'default',
  mono = true,
  className,
}: NetworkStatProps) {
  return (
    <View className={cn('gap-0.5', className)}>
      <AppText variant="caption" tone="faint">
        {label}
      </AppText>
      <AppText variant="title" tone={tone === 'default' ? 'primary' : tone} mono={mono} className={TONE_CLASS[tone]}>
        {value}
      </AppText>
      {detail ? (
        <AppText variant="caption" tone="faint">
          {detail}
        </AppText>
      ) : null}
    </View>
  );
}
