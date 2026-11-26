/**
 * AuditSummary - high-level static security audit results summary.
 */

import { View } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { cn } from '@/utils/cn';

export interface AuditSummaryProps {
  readonly planName: string;
  readonly parentCidr: string;
  readonly subnetCount: number;
  readonly checksPassed: number;
  readonly warnings: number;
  readonly critical: number;
  readonly className?: string | undefined;
}

export function AuditSummary({
  planName,
  parentCidr,
  subnetCount,
  checksPassed,
  warnings,
  critical,
  className,
}: AuditSummaryProps) {
  return (
    <Card padding="md" className={cn('gap-3', className)}>
      <View className="gap-1">
        <AppText variant="subheading" tone="primary">
          {planName}
        </AppText>
        <AppText variant="caption" tone="muted">
          {parentCidr} · {subnetCount} subnet{subnetCount === 1 ? '' : 's'}
        </AppText>
      </View>

      <View className="flex-row gap-4">
        <View className="gap-0.5">
          <AppText variant="caption" tone="faint">
            Rules Passed
          </AppText>
          <AppText variant="title" tone="success" mono>
            {checksPassed}
          </AppText>
        </View>
        <View className="gap-0.5">
          <AppText variant="caption" tone="faint">
            Warnings
          </AppText>
          <AppText variant="title" tone="medium" mono>
            {warnings}
          </AppText>
        </View>
        <View className="gap-0.5">
          <AppText variant="caption" tone="faint">
            Critical / High
          </AppText>
          <AppText variant="title" tone="critical" mono>
            {critical}
          </AppText>
        </View>
      </View>
    </Card>
  );
}
