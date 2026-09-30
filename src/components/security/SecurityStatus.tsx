/**
 * SecurityStatus - summary of audit results.
 *
 * Shows counts by severity with icons and labels.
 * Used at the top of the Security Audit screen.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { SeverityTag } from '../ui/Badge';
import { Card } from '../Card';
import { SEVERITY_ORDERED } from '@/theme/severity';
import type { Severity } from '@/types/network';

export interface SecurityStatusProps {
  issuesBySeverity: ReadonlyMap<Severity, number>;
  totalIssues: number;
  className?: string;
}

export function SecurityStatus({ issuesBySeverity, totalIssues, className }: SecurityStatusProps) {
  return (
    <Card padding="md" className={className ?? ''}>
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <AppText variant="label" tone="primary">
            {totalIssues === 0 ? 'All checks passed' : `${totalIssues} issue${totalIssues === 1 ? '' : 's'} found`}
          </AppText>
        </View>

        <View className="flex-row flex-wrap gap-2">
          {SEVERITY_ORDERED.map((severity) => {
            const count = issuesBySeverity.get(severity) ?? 0;
            return (
              <View key={severity} className="flex-row items-center gap-1.5">
                <SeverityTag severity={severity} size="sm" />
                <AppText variant="caption" tone="muted">
                  {count}
                </AppText>
              </View>
            );
          })}
        </View>
      </View>
    </Card>
  );
}
