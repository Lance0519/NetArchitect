/**
 * SubnetCard - displays an allocated or planned subnet with key capacity metrics.
 */

import { View } from 'react-native';

import { AppText } from './AppText';
import { Badge, CidrBadge, VlanBadge } from './Badge';
import { Card } from './Card';
import { ProgressBar } from './ProgressBar';
import { useUiStore } from '@/store/ui-store';
import { cn } from '@/utils/cn';

export interface SubnetCardProps {
  readonly name: string;
  readonly cidr: string;
  readonly capacity: string;
  readonly requested: string;
  readonly utilization: string;
  readonly vlanId?: number | undefined;
  readonly role?: string | undefined;
  readonly isUntrusted?: boolean | undefined;
  readonly className?: string | undefined;
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
  const cidrDisplayFormat = useUiStore((s) => s.cidrDisplayFormat);
  const utilPercent = parseFloat(utilization) || 0;

  return (
    <Card padding="md" className={cn('gap-3', className)}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <AppText variant="subheading" tone="primary" numberOfLines={1}>
            {name}
          </AppText>
          {cidrDisplayFormat === 'badge' ? (
            <CidrBadge value={cidr} />
          ) : (
            <AppText mono variant="caption" tone="accent">
              {cidr}
            </AppText>
          )}
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
