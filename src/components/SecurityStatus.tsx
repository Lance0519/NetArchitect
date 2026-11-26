/**
 * SecurityStatus - severity breakdown card for audit results.
 */

import { View } from 'react-native';

import { AppText } from './AppText';
import { SeverityTag } from './Badge';
import { Card } from './Card';
import { SEVERITY_ORDERED } from '@/theme/severity';
import type { Severity } from '@/types/network';
import { cn } from '@/utils/cn';

export interface SecurityStatusProps {
  readonly issuesBySeverity: ReadonlyMap<Severity, number>;
  readonly totalIssues: number;
  readonly className?: string | undefined;
}

export function SecurityStatus({ issuesBySeverity, totalIssues, className }: SecurityStatusProps) {
  return (
    <Card padding="md" className={cn(className)}>
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <AppText variant="label" tone="primary">
            {totalIssues === 0
              ? 'All checks passed'
              : `${totalIssues} issue${totalIssues === 1 ? '' : 's'} found`}
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
