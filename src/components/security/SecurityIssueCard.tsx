/**
 * SecurityIssueCard - displays a single audit finding.
 *
 * Severity is carried by three channels: color, shape (icon), and text label.
 * Shows problem, why it matters, remediation, citation, and affected subnets.
 */

import { Pressable, View } from 'react-native';

import { AppText } from '../AppText';
import { SeverityTag } from '../ui/Badge';
import { Card } from '../Card';
import type { SecurityIssue } from '@/types/network';
import { severityMeta } from '@/theme/severity';

export interface SecurityIssueCardProps {
  readonly issue: SecurityIssue;
  readonly onSubnetPress?: (subnetId: string) => void;
}

export function SecurityIssueCard({ issue, onSubnetPress }: SecurityIssueCardProps) {
  const meta = severityMeta(issue.severity);
  const Icon = meta.icon;

  return (
    <Card padding="md">
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <Icon size={20} className={meta.textClass} accessibilityElementsHidden />
          <View className="flex-1">
            <AppText variant="label" tone="primary">
              {issue.title}
            </AppText>
          </View>
          <SeverityTag severity={issue.severity} size="sm" />
        </View>

        <AppText variant="caption" tone="faint">
          {issue.ruleId}
        </AppText>

        <View className="gap-1">
          <AppText variant="caption" tone="muted">
            PROBLEM
          </AppText>
          <AppText variant="body" tone="primary">
            {issue.problem}
          </AppText>
        </View>

        <View className="gap-1">
          <AppText variant="caption" tone="muted">
            WHY IT MATTERS
          </AppText>
          <AppText variant="body" tone="primary">
            {issue.whyItMatters}
          </AppText>
        </View>

        <View className="gap-1">
          <AppText variant="caption" tone="muted">
            REMEDIATION
          </AppText>
          <AppText variant="body" tone="primary">
            {issue.remediation}
          </AppText>
        </View>

        <AppText variant="caption" tone="faint">
          Reference: {issue.citation}
        </AppText>

        {issue.affectedSubnetIds.length > 0 ? (
          <View className="gap-1">
            <AppText variant="caption" tone="muted">
              AFFECTED SUBNETS
            </AppText>
            <View className="flex-row flex-wrap gap-2">
              {issue.affectedSubnetIds.map((id) => (
                <Pressable
                  key={id}
                  onPress={() => onSubnetPress?.(id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to subnet ${id}`}
                >
                  <AppText variant="caption" tone="accent">
                    {id}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
