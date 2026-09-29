/**
 * The plan's subnet list.
 *
 * Add, reorder, remove and edit the rows a plan is built from, and show what each row
 * resolved to.
 *
 * ## Why this component holds no arithmetic and no validation
 *
 * Same rule as `VlsmRequirementList`. Every decision is upstream: the fields and their
 * defaults come from `planner-input.ts`, whether a row is usable is `evaluatePlan`'s
 * answer, and the derived columns are `planner-view.ts`'s. This file moves values and
 * renders strings. A component that re-derived any of it would be a second implementation
 * of a rule that already has one, and R4 has declined a component-test runner to catch
 * the difference.
 *
 * ## Every row is shown, including the broken ones
 *
 * The rows come from `buildPlanView`, which emits one view row per *draft* row whether or
 * not it parsed. That is the property that makes this editor safe to type into: a CIDR
 * that is half-entered has no derived columns and shows an error, and the row stays
 * exactly where it was with every other field intact. An editor that removed invalid rows
 * would delete a user's typing the moment they cleared a field to retype it.
 *
 * ## Rows are cards, not a table
 *
 * The VLSM table is ten columns wide and scrolls sideways. A plan row has seven inputs,
 * and a table would put them behind a horizontal scroll on a phone and force the reader to
 * hold a column header in their head while editing. A card per row stacks the inputs where
 * a thumb can reach them and puts the derived address block underneath, read-only and
 * monospaced, where it cannot be mistaken for something to type into.
 *
 * ## The derived block is a definition list, not a grid of equal columns
 *
 * Label above value, value monospaced. Side-by-side columns would need a fixed width per
 * column to stop the values drifting as the plan grows, and any fixed width is wrong on
 * some phone. Labels carry the meaning on their own, which is also what a screen reader
 * needs - a value announced as bare "192.168.1.1" says nothing about what it is.
 */

import { View } from 'react-native';
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react-native';

import { AppText, Card, IconButton, SegmentedControl, Select, TextField } from '@/components';
import { NETWORK_ROLES, ROLE_DEFINITION_BY_ROLE } from '@/core/roles';
import { cn } from '@/utils/cn';
import { EM_DASH } from '@/utils/formatting';
import { rowCardTone, vlanHintFor } from '@/utils/planner-view';

import type { GatewayMode, SubnetRowDraft } from '@/core/planner-input';
import type { PlanRowView } from '@/utils/planner-view';
import type { NetworkRole } from '@/types/network';

export interface SubnetEditorProps {
  readonly rows: readonly PlanRowView[];
  /** The draft rows, for the fields a view row does not carry. */
  readonly drafts: readonly SubnetRowDraft[];
  readonly onChange: (id: string, patch: Partial<Omit<SubnetRowDraft, 'id'>>) => void;
  readonly onGatewayMode: (id: string, mode: GatewayMode) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, by: -1 | 1) => void;
  readonly className?: string | undefined;
}

const ROLE_OPTIONS = NETWORK_ROLES.map((role) => ({
  value: role,
  label: ROLE_DEFINITION_BY_ROLE[role].label,
}));

/**
 * The three gateway states, as options.
 *
 * Built from the literal rather than from a tuple, because a tuple would need a fourth
 * entry the moment someone added one and the segmented control would silently drop it.
 * Three options is the documented range for this control, so a fourth is a design change
 * rather than an oversight.
 */
const GATEWAY_OPTIONS = [
  { value: 'auto' as const, label: 'Auto' },
  { value: 'manual' as const, label: 'Manual' },
  { value: 'none' as const, label: 'None' },
];

export function SubnetEditor({
  rows,
  drafts,
  onChange,
  onGatewayMode,
  onAdd,
  onRemove,
  onMove,
  className,
}: SubnetEditorProps) {
  // The view rows and the draft rows are the same rows in the same order, keyed by the
  // same id. The view carries the derived columns; the draft carries the raw text. A
  // lookup by id rather than by index, because an index pairing would survive a reorder
  // that changed which row is which - and the symptom would be a CIDR typed into the wrong
  // row's field.
  const draftById = new Map(drafts.map((row) => [row.id, row]));

  return (
    <View className={cn('gap-3', className)}>
      <View className="flex-row items-center justify-between">
        <AppText variant="title" tone="primary">
          Subnets
        </AppText>
        <AppText variant="caption" tone="faint">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
        </AppText>
      </View>

      {rows.map((row) => {
        const draft = draftById.get(row.id);
        if (draft === undefined) return null;
        const ordinal = row.index + 1;
        const label = row.name === '' ? `subnet ${ordinal}` : row.name;
        const vlanHint = vlanHintFor(row);

        return (
          <Card
            key={row.id}
            padding="md"
            // The border is the row's third channel for "needs a look", after the inline
            // error and the finding list. `rowCardTone` is the single decision, in the view
            // model, so the border cannot disagree with the messages beside it.
            tone={rowCardTone(row)}
            className="gap-3"
          >
            <View className="flex-row items-center justify-between">
              <AppText variant="label" tone="muted">
                {ordinal}
              </AppText>

              <View className="flex-row items-center gap-1">
                <IconButton
                  label={`Move ${label} up`}
                  onPress={() => onMove(row.id, -1)}
                  // Disabled rather than a no-op: a control that looks available and does
                  // nothing is worse than one that visibly is not.
                  disabled={!row.canMoveUp}
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </IconButton>
                <IconButton
                  label={`Move ${label} down`}
                  onPress={() => onMove(row.id, 1)}
                  disabled={!row.canMoveDown}
                >
                  <ArrowDown size={16} strokeWidth={2.5} />
                </IconButton>
                <IconButton
                  label={`Remove ${label}`}
                  tone="danger"
                  onPress={() => onRemove(row.id)}
                  // The last row is not removable. A list that can reach zero rows has no
                  // way back but a reset, and emptying itself looks like data loss.
                  disabled={!row.canRemove}
                >
                  <Trash2 size={16} strokeWidth={2.5} />
                </IconButton>
              </View>
            </View>

            <TextField
              label="Name"
              value={draft.name}
              onChangeText={(text) => onChange(row.id, { name: text })}
              placeholder="Student LAN"
              autoCapitalize="words"
              returnKeyType="next"
              // The accessibility label carries the row number, because a list of seven
              // fields all labelled "Name" gives a screen reader user no way to tell
              // which is which.
              accessibilityLabel={`Name for subnet ${ordinal}`}
            />

            <TextField
              label="Subnet"
              value={draft.cidr}
              onChangeText={(text) => onChange(row.id, { cidr: text })}
              placeholder="192.168.1.0/26"
              mono
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="numbers-and-punctuation"
              accessibilityLabel={`Subnet for ${label}`}
              hint="A host address is accepted and normalised to its network address."
              error={row.error ?? undefined}
            />

            <TextField
              label="Hosts"
              value={draft.hosts}
              onChangeText={(text) => onChange(row.id, { hosts: text })}
              placeholder="50"
              mono
              keyboardType="number-pad"
              accessibilityLabel={`Hosts for subnet ${ordinal}`}
            />

            <Select<NetworkRole>
              label="Role"
              value={draft.role}
              options={ROLE_OPTIONS}
              onChange={(role) => onChange(row.id, { role })}
              hint={ROLE_DEFINITION_BY_ROLE[draft.role].description}
            />

            {/*
              Only a `CUSTOM` row can name itself, so the field is not rendered for the
              other twelve roles. Offering an empty text field next to every role picker
              would be thirteen fields per row, twelve of which do nothing.
            */}
            {draft.role === 'CUSTOM' ? (
              <TextField
                label="Custom role name"
                value={draft.customRoleLabel}
                onChangeText={(text) => onChange(row.id, { customRoleLabel: text })}
                placeholder="Loading dock"
                autoCapitalize="words"
                accessibilityLabel={`Custom role name for subnet ${ordinal}`}
                hint="What this subnet is for, in your own words."
              />
            ) : null}

            <TextField
              label="VLAN"
              value={draft.vlan}
              onChangeText={(text) => onChange(row.id, { vlan: text })}
              placeholder="untagged"
              mono
              keyboardType="number-pad"
              accessibilityLabel={`VLAN for subnet ${ordinal}`}
              hint={vlanHint ?? '1 to 4094. Leave blank for an untagged segment.'}
            />

            <View className="gap-2">
              <SegmentedControl<GatewayMode>
                label="Gateway"
                options={GATEWAY_OPTIONS}
                value={draft.gatewayMode}
                onChange={(mode) => onGatewayMode(row.id, mode)}
              />
              {draft.gatewayMode === 'manual' ? (
                <TextField
                  label="Gateway address"
                  value={draft.gateway}
                  onChangeText={(text) => onChange(row.id, { gateway: text })}
                  placeholder="192.168.1.1"
                  mono
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel={`Gateway address for ${label}`}
                />
              ) : null}
            </View>

            {/*
              The derived block. Rendered for every row, including one that does not
              parse, because the em-dash columns are what tell the user *which* part is
              missing - and `row.cidr === EM_DASH` on its own is invisible.
            */}
            <View className="gap-1.5 rounded-card bg-surface-inset p-3">
              <AppText variant="label" tone="faint">
                RESOLVED
              </AppText>

              <Derived label="Network" value={`${row.network}  ${row.mask}`} />
              <Derived label="Subnet" value={row.cidr} />
              <Derived label="Range" value={row.range} />
              <Derived label="Broadcast" value={row.broadcast} />
              <Derived label="Gateway" value={row.gateway} />
              <Derived label="Hosts" value={row.hostsUsed} />
              <Derived label="Utilisation" value={row.utilization} />

              {row.overCapacity ? (
                <View className="mt-1 flex-row items-start gap-1.5">
                  <AlertTriangle size={14} strokeWidth={2.5} className="mt-0.5 text-medium" />
                  <AppText variant="caption" tone="muted" className="flex-1">
                    More hosts than this block holds. Reallocate from the host count, or widen
                    the subnet.
                  </AppText>
                </View>
              ) : null}
            </View>

            {/*
              The findings naming this row. Inside the row rather than only in the
              plan-level list, because "Servers overlaps Student LAN" is only actionable
              if it is on the row you are about to edit.
            */}
            {row.conflicts.length === 0 ? null : (
              <View className="gap-1">
                {row.conflicts.map((message) => (
                  <View key={message} className="flex-row items-start gap-1.5">
                    <AlertTriangle size={14} strokeWidth={2.5} className="mt-0.5 text-medium" />
                    <AppText variant="caption" tone="muted" className="flex-1">
                      {message}
                    </AppText>
                  </View>
                ))}
              </View>
            )}
          </Card>
        );
      })}

      <IconButton
        label="Add a subnet"
        onPress={onAdd}
        className="self-start border border-line bg-surface px-3 py-2"
      >
        <View className="flex-row items-center gap-1.5">
          <Plus size={16} strokeWidth={2.5} />
          <AppText variant="label" tone="accent">
            Add subnet
          </AppText>
        </View>
      </IconButton>
    </View>
  );
}

/** One label-above-value pair in the resolved block. */
function Derived({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <AppText variant="caption" tone="faint">
        {label}
      </AppText>
      {/*
        The value is monospaced when it is a real figure, and faint when it is the em dash.
        The em dash is a deliberate "nothing here" rather than a zero, and monospacing it
        would make it line up with the addresses as though it were one.
      */}
      <AppText
        variant="caption"
        tone={value === EM_DASH ? 'faint' : 'primary'}
        mono={value !== EM_DASH}
        className="flex-1 text-right"
      >
        {value}
      </AppText>
    </View>
  );
}

