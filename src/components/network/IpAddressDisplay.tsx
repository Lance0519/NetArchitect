/**
 * IpAddressDisplay - renders an IP address or CIDR in monospace.
 *
 * Technical values use monospace so digits align vertically.
 * The component is presentation-only; it receives already-formatted strings.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { cn } from '@/utils/cn';

export interface IpAddressDisplayProps {
  value: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'primary' | 'muted' | 'accent';
  className?: string;
}

const SIZE_CLASS = {
  sm: 'caption',
  md: 'body',
  lg: 'title',
} as const;

export function IpAddressDisplay({
  value,
  size = 'md',
  tone = 'primary',
  className,
}: IpAddressDisplayProps) {
  return (
    <View className={cn('flex-row', className)}>
      <AppText mono variant={SIZE_CLASS[size]} tone={tone}>
        {value}
      </AppText>
    </View>
  );
}
