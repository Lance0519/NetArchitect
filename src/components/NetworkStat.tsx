/**
 * NetworkStat - compact label + value + optional detail metric block.
 */

import { View } from 'react-native';

import { AppText } from './AppText';
import { cn } from '@/utils/cn';

export interface NetworkStatProps {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
  readonly tone?: 'default' | 'accent' | 'success' | 'medium' | 'critical' | undefined;
  readonly mono?: boolean | undefined;
  readonly className?: string | undefined;
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
      <AppText
        variant="title"
        tone={tone === 'default' ? 'primary' : tone}
        mono={mono}
        className={TONE_CLASS[tone]}
      >
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
