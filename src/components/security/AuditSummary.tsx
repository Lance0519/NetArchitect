/**
 * AuditSummary - high-level audit results summary.
 *
 * Shows the plan being audited, total checks passed, and issue counts.
 * Used at the top of the Security Audit screen.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { Card } from '../Card';
import { cn } from '@/utils/cn';

export interface AuditSummaryProps {
  planName: string;
  parentCidr: string;
  subnetCount: number;
  checksPassed: number;
  warnings: number;
  critical: number;
  className?: string;
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
            Passed
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
            Critical
          </AppText>
          <AppText variant="title" tone="critical" mono>
            {critical}
          </AppText>
        </View>
      </View>
    </Card>
  );
}
