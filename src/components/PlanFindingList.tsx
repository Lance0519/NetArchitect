/**
 * The plan's findings, as a list.
 *
 * ## What a finding is, and what it is not
 *
 * A finding from `evaluatePlan` is a **true statement about the plan**: these two subnets
 * overlap, this one sits outside its parent, two rows claim the same VLAN. Every field
 * parsed, and the values disagree with each other.
 *
 * That is a different thing from an **error**, which is a field with no parseable value -
 * no CIDR, no host count, no parent. The planner draws those two differently on purpose:
 * an error is a form problem the user fixes by typing, and a finding is a plan problem they
 * fix by deciding. Merging them into one "error" list would make a valid plan with a
 * conflict look like a broken form.
 *
 * ## No severity, and that is deliberate
 *
 * These carry a warning icon and a word, not a `Critical` or `High` tag. Assigning a
 * security severity to an overlap is a security judgement, and a security judgement made by
 * a formatting layer is unattributed advice - exactly what the standards registry exists to
 * prevent. Phase 11's auditor is what turns findings into rated issues, with a citation and
 * a remediation. See the module note in `@/utils/planner-view`.
 *
 * ## Findings naming no row the draft still holds
 *
 * `unassignedFindings` is rendered too. Every finding should name at least one row, so this
 * list is normally empty - but a finding whose rows have all been deleted should still be
 * visible here rather than silently vanishing from the one place a plan-level problem is
 * summarised.
 */

import { View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { cn } from '@/utils/cn';

import type { PlanFinding } from '@/core/planner-input';

export interface PlanFindingListProps {
  readonly findings: readonly PlanFinding[];
  /** A one-line explanation, above the list. */
  readonly title: string;
  /**
   * What produced them, said once.
   *
   * Written by the caller rather than hard-coded here, because there are two callers with
   * different stories: the plan screen says "every value parsed, the rows just disagree",
   * and the change preview says "this would still be wrong after applying". A shared
   * sentence would have to be the vaguer of the two.
   */
  readonly explanation: string;
  readonly className?: string | undefined;
}

/**
 * A short noun for each finding kind, for the badge on its row.
 *
 * The written label, not a colour. A reader who cannot distinguish the `medium` token from
 * the `critical` one still has three things to go on - the icon, this word, and the
 * message - which is the three-channel rule severity follows elsewhere in the app.
 */
const KIND_LABEL: Readonly<Record<PlanFinding['kind'], string>> = {
  overlap: 'Overlap',
  'outside-parent': 'Outside parent',
  'duplicate-vlan': 'Duplicate VLAN',
};

export function PlanFindingList({ findings, title, explanation, className }: PlanFindingListProps) {
  if (findings.length === 0) return null;

  return (
    <Card tone="medium" padding="md" className={cn('gap-2', className)}>
      <View className="flex-row items-center gap-2">
        <AlertTriangle size={16} strokeWidth={2.5} className="text-medium" />
        <AppText variant="label" tone="primary">
          {title}
        </AppText>
      </View>

      {/*
        The explanation is written once, above the list, rather than per finding. A
        repeated paragraph is a paragraph a reader learns to skip, and these messages are
        self-explanatory: "Server LAN overlaps Staff LAN" needs no gloss.
      */}
      <AppText variant="caption" tone="muted">
        {explanation}
      </AppText>

      <View className="gap-2">
        {findings.map((finding, index) => (
          <View key={`${finding.kind}-${index}`} className="gap-1">
            <View className="flex-row items-center gap-1.5">
              {/*
                The kind is spelled out, not encoded in the icon. Two of the three kinds
                share a triangle; a reader who has not learned the icon vocabulary still
                reads what is wrong.
              */}
              <AppText variant="caption" tone="medium">
                {KIND_LABEL[finding.kind]}
              </AppText>
            </View>
            <AppText variant="caption" tone="primary">
              {finding.message}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}
