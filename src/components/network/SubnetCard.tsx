/**
 * SubnetCard - displays a subnet with its key properties.
 *
 * Used in VLSM results, network planner, and plan details.
 * Shows network, CIDR, host capacity, requested hosts, utilization, and VLAN.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { Badge, CidrBadge, VlanBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { cn } from '@/utils/cn';

export interface SubnetCardProps {
  name: string;
  cidr: string;
  capacity: string;
  requested: string;
  utilization: string;
  vlanId?: number;
  role?: string;
  isUntrusted?: boolean;
  className?: string;
}

export function SubnetCard({
  name,
  cidr,
  capacity,
  requested,
  utilization,
  vlanId,
  role,
  isUntrusted,
  className,
}: SubnetCardProps) {
  const utilPercent = parseFloat(utilization) || 0;

  return (
    <Card padding="md" className={cn('gap-3', className)}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-0.5">
          <AppText variant="subheading" tone="primary" numberOfLines={1}>
            {name}
          </AppText>
          <CidrBadge value={cidr} />
        </View>
        {vlanId !== undefined ? <VlanBadge vlanId={vlanId} /> : null}
      </View>

      <View className="gap-2">
        <View className="flex-row justify-between">
          <AppText variant="caption" tone="faint">
            Capacity
          </AppText>
          <AppText variant="caption" tone="muted" mono>
            {capacity}
          </AppText>
        </View>
        <View className="flex-row justify-between">
          <AppText variant="caption" tone="faint">
            Requested
          </AppText>
          <AppText variant="caption" tone="muted" mono>
            {requested}
          </AppText>
        </View>
        <ProgressBar value={utilPercent / 100} label={`${utilization} utilized`} />
      </View>

      {role ? (
        <View className="flex-row items-center gap-2">
          <Badge tone={isUntrusted ? 'medium' : 'neutral'}>{role}</Badge>
        </View>
      ) : null}
    </Card>
  );
}
