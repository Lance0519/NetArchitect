/**
 * The change preview.
 *
 * A sheet showing what a proposed rewrite of the plan would do, before it is applied.
 *
 * ## Why a preview, and not a confirmation dialog
 *
 * Two of the three operations that produce a `PlanChange` are destructive in ways the
 * screen cannot undo: a repack moves addresses the user may have already written down, and
 * a profile replaces the whole subnet list. A yes/no dialog says "are you sure" without
 * saying "sure of *what*", and the user who taps through one has to accept a change they
 * have not read. This lists every row that moves, every row that goes, and what the plan
 * would still get wrong afterwards.
 *
 * ## The conflicts come from the same evaluator as the plan screen
 *
 * `PlanChange.conflicts` is `conflictsOf(next)`, which calls `evaluatePlan`. A preview that
 * ran its own overlap check could disagree with the plan the user is about to see - same
 * inputs, two implementations, one wrong - and it would show a conflict that does not exist
 * and then create one. See `conflictsOf`'s note.
 *
 * ## "Unchanged" rows are counted, not listed
 *
 * A profile application rewrites five rows, of which the user may recognise two. Listing
 * the three that did not move buries the two that did, and the count is enough - nothing is
 * hidden, it is just not worth the vertical space.
 *
 * ## Nothing here decides anything
 *
 * The change, the diff, the row labels and the conflict list all arrive as values. This
 * component decides only the wording of the buttons and which rows get which icon.
 */

import { type ReactNode } from 'react';
import { View } from 'react-native';
import { AlertTriangle, ArrowRight, Minus, Plus } from 'lucide-react-native';

import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { Divider } from './Divider';
import { Sheet } from './Sheet';
import { rowLabel } from '@/core/plan-changes';
import { EM_DASH } from '@/utils/formatting';

import type { PendingChange, ChangeReason } from '@/store/plan-store';
import type { ChangedField, RowChange } from '@/core/plan-changes';
import type { PlanDraft } from '@/core/planner-input';

/* ------------------------------------------------------------------ *
 * Wording
 * ------------------------------------------------------------------ */

const REASON_TITLE: Readonly<Record<ChangeReason, string>> = {
  repack: 'Reallocate from host counts',
  profile: 'Apply a profile',
  handoff: 'Replace with the VLSM allocation',
};

/**
 * What each reason means for the plan, in one sentence.
 *
 * Different for each, because the stakes are. A repack rearranges addresses inside the same
 * parent; a profile replaces the segments and usually the parent; a hand-off overwrites
 * whatever was there. Stating that is the point of the dialog.
 */
const REASON_BODY: Readonly<Record<ChangeReason, string>> = {
  repack:
    'Each CIDR is re-derived from its host count, packed largest first so nothing overlaps. The parent block does not change.',
  profile:
    'The subnet list is replaced with the profile segments, allocated inside the parent block you have entered. Rows you have already written are discarded.',
  handoff:
    'The subnets replace whatever is in the plan now, using the parent from the VLSM screen.',
};

/** The field names as the user wrote them, not as the draft spells them. */
const FIELD_LABEL: Readonly<Record<ChangedField, string>> = {
  name: 'name',
  role: 'role',
  customRoleLabel: 'custom role name',
  vlan: 'VLAN',
  cidr: 'subnet',
  gateway: 'gateway',
  gatewayMode: 'gateway mode',
  hosts: 'hosts',
};

/**
 * The header field names, as the draft spells them.
 *
 * A local `Record` over `PlanDraft`'s header keys rather than a cast at the point of use.
 * `HeaderChange` is a four-way union of exactly these, and a lookup table turns a
 * field-about-a-field into one lookup the compiler can check - where an index by
 * `keyof PlanDraft` would accept any draft key and return `undefined` on screen for a key
 * the diff somehow produced.
 */
const HEADER_VALUE: Readonly<
  Record<PendingChange['change']['header'][number], (draft: PlanDraft) => string>
> = {
  name: (draft) => draft.name,
  description: (draft) => draft.description,
  parent: (draft) => draft.parent,
  profile: (draft) => draft.profile,
};

export interface ChangePreviewProps {
  readonly pending: PendingChange | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * The preview sheet, or nothing when there is no change to preview.
 *
 * Returns `null` rather than rendering a hidden sheet, so the screen does not have to
 * decide whether a change is pending before deciding whether to draw anything.
 */
export function ChangePreview({ pending, onConfirm, onCancel }: ChangePreviewProps) {
  if (pending === null) return null;

  const { change, reason, subject, discardedRowIds } = pending;
  const moved = change.rows.filter((row) => row.kind === 'changed');
  const added = change.rows.filter((row) => row.kind === 'added');
  const removed = change.rows.filter((row) => row.kind === 'removed');
  const unchanged = change.rows.filter((row) => row.kind === 'unchanged');

  return (
    <Sheet
      visible
      onClose={onCancel}
      title={REASON_TITLE[reason]}
      subtitle={subject}
      footer={
        <View className="gap-2">
          <Button variant="primary" block onPress={onConfirm}>
            Apply this change
          </Button>
          <Button variant="ghost" block onPress={onCancel}>
            Keep what I have
          </Button>
        </View>
      }
    >
      <View className="gap-4">
        <AppText variant="caption" tone="muted">
          {REASON_BODY[reason]}
        </AppText>

        {change.isEmpty ? (
          <Card tone="inset" padding="sm">
            <AppText variant="caption" tone="muted">
              Nothing would change. The plan already matches.
            </AppText>
          </Card>
        ) : null}

        {change.header.length === 0 ? null : (
          <Section title="Plan">
            {change.header.map((field) => (
              <View key={field} className="flex-row items-center gap-2">
                <AppText variant="caption" tone="faint" className="w-28">
                  {field}
                </AppText>
                <AppText variant="caption" tone="primary" mono>
                  {HEADER_VALUE[field](change.next)}
                </AppText>
              </View>
            ))}
          </Section>
        )}

        {moved.length === 0 ? null : (
          <Section title={`Changes (${moved.length})`}>
            {moved.map((row) => (
              <MovedRow key={row.kind === 'changed' ? row.after.id : ''} row={row} />
            ))}
          </Section>
        )}

        {added.length === 0 ? null : (
          <Section title={`Added (${added.length})`}>
            {added.map((row) => (
              <RowLine
                key={row.kind === 'added' ? row.row.id : ''}
                icon={<Plus size={14} strokeWidth={2.5} className="text-success" />}
                label={rowLabelOf(row)}
                detail={cidrOf(row)}
              />
            ))}
          </Section>
        )}

        {removed.length === 0 ? null : (
          <Section title={`Removed (${removed.length})`}>
            {removed.map((row) => (
              <RowLine
                key={row.kind === 'removed' ? row.row.id : ''}
                icon={<Minus size={14} strokeWidth={2.5} className="text-critical" />}
                label={rowLabelOf(row)}
                detail={cidrOf(row)}
              />
            ))}
          </Section>
        )}

        {unchanged.length === 0 ? null : (
          <AppText variant="caption" tone="faint">
            {unchanged.length} {unchanged.length === 1 ? 'row stays' : 'rows stay'} as they
            are.
          </AppText>
        )}

        {discardedRowIds.length === 0 ? null : (
          <View className="flex-row items-start gap-2 rounded-card bg-surface-inset p-3">
            <AlertTriangle size={14} strokeWidth={2.5} className="mt-0.5 text-medium" />
            <AppText variant="caption" tone="muted" className="flex-1">
              {discardedRowIds.length}{' '}
              {discardedRowIds.length === 1
                ? 'row you have written will be'
                : 'rows you have written will be'}{' '}
              discarded. They are listed under Removed above.
            </AppText>
          </View>
        )}

        {change.conflicts.length === 0 ? null : (
          <View className="gap-2">
            <Divider />
            <View className="flex-row items-center gap-2">
              <AlertTriangle size={16} strokeWidth={2.5} className="text-medium" />
              <AppText variant="label" tone="primary">
                Problems this would leave behind
              </AppText>
            </View>
            <AppText variant="caption" tone="muted">
              {change.conflicts.length === 1
                ? 'The plan would still build, but this would remain wrong:'
                : `The plan would still build, but ${change.conflicts.length} things would remain wrong:`}
            </AppText>
            {change.conflicts.map((message) => (
              <AppText key={message} variant="caption" tone="primary">
                {message}
              </AppText>
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <AppText variant="label" tone="muted">
        {title.toUpperCase()}
      </AppText>
      {children}
    </View>
  );
}

/** One line in a list of rows: an icon, a label, and a monospaced detail. */
function RowLine({
  icon,
  label,
  detail,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly detail: string | null;
}) {
  return (
    <View className="flex-row items-center gap-2">
      {icon}
      <AppText variant="caption" tone="primary" className="flex-1">
        {label}
      </AppText>
      {detail === null ? null : (
        <AppText variant="caption" tone="faint" mono>
          {detail}
        </AppText>
      )}
    </View>
  );
}

/** A changed row: what it was, an arrow, what it becomes, and which fields moved. */
function MovedRow({ row }: { readonly row: RowChange }) {
  if (row.kind !== 'changed') return null;

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <AppText variant="caption" tone="primary" className="flex-1">
          {rowLabel(row.before)}
        </AppText>
        <ArrowRight size={14} strokeWidth={2} className="text-ink-faint" />
        <AppText variant="caption" tone="primary" className="flex-1" mono>
          {rowLabel(row.after)}
        </AppText>
      </View>
      <AppText variant="caption" tone="faint">
        {row.fields.map((field) => FIELD_LABEL[field]).join(', ')}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Row accessors
 *
 * `RowChange` is a four-way union and the callers have already filtered by `kind`, so these
 * switch exhaustively rather than cast. No `default`: a fifth kind would fall through to a
 * type error here rather than render a blank line for every row in the list.
 * ------------------------------------------------------------------ */

const rowLabelOf = (row: RowChange): string => {
  switch (row.kind) {
    case 'added':
    case 'removed':
    case 'unchanged':
      return rowLabel(row.row);
    case 'changed':
      return rowLabel(row.after);
  }
};

/**
 * A row's CIDR, or the em dash when it has none.
 *
 * The em dash rather than an omitted detail: the preview lists every row that goes, and a
 * row disappearing from a list is indistinguishable from a row that was never there.
 */
const cidrOf = (row: RowChange): string => {
  switch (row.kind) {
    case 'added':
    case 'removed':
    case 'unchanged':
      return row.row.cidr.trim() === '' ? EM_DASH : row.row.cidr.trim();
    case 'changed':
      return row.after.cidr.trim() === '' ? EM_DASH : row.after.cidr.trim();
  }
};
