/**
 * Security Issue Card.
 *
 * Renders a single audit finding with severity icon + label + color (never
 * color alone), the problem statement, why it matters, remediation, citation,
 * and affected subnet links.
 *
 * Severity is carried by three channels at once — color, shape (icon), and
 * text label — per the accessibility rule in `src/theme/severity.ts`.
 */

import { Pressable, View } from 'react-native';

import { AppText } from './AppText';
import { SeverityTag } from './Badge';
import { Card } from './Card';
import type { SecurityIssue } from '@/types/network';
import { severityMeta } from '@/theme/severity';

export interface SecurityIssueCardProps {
  readonly issue: SecurityIssue;
  /** Optional map of subnetId -> human-readable label (e.g. "LAN (10.0.1.0/24)"). */
  readonly subnetLabels?: Readonly<Record<string, string>> | undefined;
  readonly onSubnetPress?: ((subnetId: string) => void) | undefined;
}

export function SecurityIssueCard({
  issue,
  subnetLabels,
  onSubnetPress,
}: SecurityIssueCardProps) {
  const meta = severityMeta(issue.severity);
  const Icon = meta.icon;

  return (
    <Card padding="md">
      <View className="gap-3">
        {/* Header: severity icon + title + tag */}
        <View className="flex-row items-center gap-2">
          <Icon size={20} className={meta.textClass} accessibilityElementsHidden />
          <View className="flex-1">
            <AppText variant="label" tone="primary">
              {issue.title}
            </AppText>
          </View>
          <SeverityTag severity={issue.severity} size="sm" />
        </View>

        {/* Rule ID */}
        <AppText variant="caption" tone="faint">
          {issue.ruleId}
        </AppText>

        {/* Problem */}
        <View className="gap-1">
          <AppText variant="caption" tone="muted">
            PROBLEM
          </AppText>
          <AppText variant="body" tone="primary">
            {issue.problem}
          </AppText>
        </View>

        {/* Why it matters */}
        <View className="gap-1">
          <AppText variant="caption" tone="muted">
            WHY IT MATTERS
          </AppText>
          <AppText variant="body" tone="primary">
            {issue.whyItMatters}
          </AppText>
        </View>

        {/* Remediation */}
        <View className="gap-1">
          <AppText variant="caption" tone="muted">
            REMEDIATION
          </AppText>
          <AppText variant="body" tone="primary">
            {issue.remediation}
          </AppText>
        </View>

        {/* Citation */}
        <AppText variant="caption" tone="faint">
          Reference: {issue.citation}
        </AppText>

        {/* Affected subnets */}
        {issue.affectedSubnetIds.length > 0 && (
          <View className="gap-1">
            <AppText variant="caption" tone="muted">
              AFFECTED SUBNETS
            </AppText>
            <View className="flex-row flex-wrap gap-2">
              {issue.affectedSubnetIds.map((id) => {
                const label = subnetLabels?.[id] ?? id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => onSubnetPress?.(id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to subnet ${label}`}
                    className="min-h-touch justify-center rounded-pill border border-line bg-surface-raised px-3 py-1.5 active:bg-accent-soft"
                  >
                    <AppText variant="caption" tone="accent" mono>
                      {label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </Card>
  );
}
