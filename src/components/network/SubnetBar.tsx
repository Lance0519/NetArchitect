/**
 * SubnetBar - stacked bar visualization of address space allocation.
 *
 * Shows how the parent block is divided between allocated subnets and free space.
 * Each segment is labeled; color is never the only signal.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { cn } from '@/utils/cn';

export interface SubnetBarSegment {
  id: string;
  label: string;
  share: number;
  isFree: boolean;
  role?: string;
  percentLabel: string;
}

export interface SubnetBarProps {
  segments: readonly SubnetBarSegment[];
  parentCidr: string;
  summary: string;
  className?: string | undefined;
}

const MIN_WIDTH = 2;

const ROLE_CLASS: Readonly<Record<string, string>> = {
  LAN: 'bg-accent',
  SERVERS: 'bg-accent-soft',
  MANAGEMENT: 'bg-medium',
  VOIP: 'bg-info',
  IOT: 'bg-high',
  GUEST: 'bg-high',
  DMZ: 'bg-critical',
  POINT_TO_POINT: 'bg-line',
  CUSTOM: 'bg-line-subtle',
};

const FREE_CLASS = 'bg-surface-inset';

export function SubnetBar({ segments, parentCidr, summary, className }: SubnetBarProps) {
  if (segments.length === 0) return null;

  return (
    <View
      className={cn('gap-2', className)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Address space for ${parentCidr}. ${summary}`}
    >
      <View className="h-3 flex-row overflow-hidden rounded-pill border border-line bg-surface-inset">
        {segments.map((segment) => (
          <View
            key={segment.id}
            style={{ flexBasis: 0, flexGrow: segment.share, minWidth: MIN_WIDTH }}
            className={cn('h-full', segment.isFree ? FREE_CLASS : ROLE_CLASS[segment.role ?? ''] ?? 'bg-line-subtle')}
          />
        ))}
      </View>

      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <View key={`legend-${segment.id}`} className="flex-row items-center gap-1.5">
            <View className={cn('h-2 w-2 rounded-pill', segment.isFree ? FREE_CLASS : ROLE_CLASS[segment.role ?? ''] ?? 'bg-line-subtle')} />
            <AppText variant="caption" tone="muted">
              {segment.isFree ? 'Free' : segment.label}
            </AppText>
            <AppText variant="caption" tone="faint" mono>
              {segment.percentLabel}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}
