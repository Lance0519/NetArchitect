/**
 * The VLSM requirement list.
 *
 * Add, reorder, remove and edit the rows that a VLSM allocation is computed from.
 *
 * ## Why this component holds no arithmetic and no validation
 *
 * Every decision is upstream. `updateRow` and friends are pure functions in
 * `src/core/vlsm-input.ts`; whether a row is usable is `evaluateVlsm`'s answer; the
 * per-row message arrives as a prop. This component moves values and renders them. A
 * component that re-derived any of it would be a second implementation of a rule that
 * already has one, and R4 has declined a component-test runner to catch the difference.
 *
 * ## The ref is the loading mechanism
 *
 * The parent re-evaluates the whole draft on every settled keystroke, which means this
 * list re-renders too. Re-rendering is not remounting - the `key` on each row is the
 * draft row's stable id, so React updates the existing inputs in place and the caret
 * stays where the user left it. `TextField` forwards its ref for React Hook Form in
 * Phase 8; nothing here depends on that yet.
 *
 * ## Ordering is a user-visible property, so reordering is explicit
 *
 * The packer sorts largest-first internally, which is correct and invisible. But the
 * *order the user typed* is the order they see, and it decides which of two
 * equal-sized requirements gets the lower address. So the list offers explicit move
 * controls rather than relying on the packing order, and disabling them at the ends is
 * better than silently doing nothing.
 *
 * ## Roles come from the shared table
 *
 * The `Select` options are derived from `ROLE_DEFINITION_BY_ROLE` rather than a local
 * list, so a role added for Phase 8 appears here automatically and cannot be missing
 * from the picker while present in the engine.
 */

import { View } from 'react-native';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react-native';

import { AppText, Card, IconButton, Select, TextField } from '@/components';
import { NETWORK_ROLES, ROLE_DEFINITION_BY_ROLE } from '@/core/roles';
import { cn } from '@/utils/cn';

import type { VlsmRowDraft } from '@/core/vlsm-input';
import type { NetworkRole } from '@/types/network';

export interface VlsmRequirementListProps {
  readonly rows: readonly VlsmRowDraft[];
  /** Per-row message, keyed by row id. Only for rows that have one. */
  readonly errors: ReadonlyMap<string, string>;
  /** A verified fix for the row's error, or `null`. */
  readonly suggestion: string | null;
  /** The id of the row an exhaustion error blames, if any. */
  readonly culpritId: string | null;
  readonly onChange: (id: string, patch: Partial<Omit<VlsmRowDraft, 'id'>>) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, by: -1 | 1) => void;
  readonly className?: string | undefined;
}

const ROLE_OPTIONS = NETWORK_ROLES.map((role) => ({
  value: role,
  label: ROLE_DEFINITION_BY_ROLE[role].label,
}));

export function VlsmRequirementList({
  rows,
  errors,
  suggestion,
  culpritId,
  onChange,
  onAdd,
  onRemove,
  onMove,
  className,
}: VlsmRequirementListProps) {
  const canRemove = rows.length > 1;

  return (
    <View className={cn('gap-3', className)}>
      <View className="flex-row items-center justify-between">
        <AppText variant="title" tone="primary">
          Requirements
        </AppText>
        <AppText variant="caption" tone="faint">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
        </AppText>
      </View>

      {rows.map((row, index) => {
        const error = errors.get(row.id);
        const isCulprit = culpritId === row.id;
        return (
          <Card key={row.id} padding="md" className="gap-3">
            <View className="flex-row items-center justify-between">
              <AppText variant="label" tone="muted">
                {index + 1}
              </AppText>

              <View className="flex-row items-center gap-1">
                <IconButton
                  label={`Move ${row.name || `requirement ${index + 1}`} up`}
                  onPress={() => onMove(row.id, -1)}
                  // Disabled rather than a no-op: a control that looks available and does
                  // nothing is worse than one that visibly is not.
                  disabled={index === 0}
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </IconButton>
                <IconButton
                  label={`Move ${row.name || `requirement ${index + 1}`} down`}
                  onPress={() => onMove(row.id, 1)}
                  disabled={index === rows.length - 1}
                >
                  <ArrowDown size={16} strokeWidth={2.5} />
                </IconButton>
                <IconButton
                  label={`Remove ${row.name || `requirement ${index + 1}`}`}
                  tone="danger"
                  onPress={() => onRemove(row.id)}
                  // The last row is not removable: a list that can reach zero rows has no
                  // way back but a reset, and emptying itself looks like data loss.
                  disabled={!canRemove}
                >
                  <Trash2 size={16} strokeWidth={2.5} />
                </IconButton>
              </View>
            </View>

            <TextField
              label="Name"
              value={row.name}
              onChangeText={(text) => onChange(row.id, { name: text })}
              placeholder="Students"
              autoCapitalize="words"
              returnKeyType="next"
              // The accessibility label carries the row number, because a list of six
              // fields all labelled "Name" gives a screen reader user no way to tell
              // which is which.
              accessibilityLabel={`Name for requirement ${index + 1}`}
              error={error}
            />

            <TextField
              label="Hosts required"
              value={row.hosts}
              onChangeText={(text) => onChange(row.id, { hosts: text })}
              placeholder="100"
              keyboardType="number-pad"
              // `number-pad` still allows a paste of letters on some platforms, and it
              // has no way to show a minus sign. The digits-only rule is enforced by the
              // schema, which reports it as a normal validation message.
              accessibilityLabel={`Hosts required for requirement ${index + 1}`}
              mono
            />

            <Select<NetworkRole>
              label="Role"
              value={row.role}
              options={ROLE_OPTIONS}
              onChange={(role) => onChange(row.id, { role })}
              hint={ROLE_DEFINITION_BY_ROLE[row.role].description}
            />

            {/*
              A fix suggestion belongs to the row the engine blamed. When nobody is
              blamed - a total shortfall, or a name two rows share - it is shown once at
              the form level instead, because attaching it to one arbitrary row would
              blame that row.
            */}
            {isCulprit && suggestion !== null ? (
              <AppText variant="caption" tone="muted">
                These requirements fit in {suggestion}.
              </AppText>
            ) : null}
          </Card>
        );
      })}

      <IconButton
        label="Add a requirement"
        onPress={onAdd}
        className="self-start border border-line bg-surface px-3 py-2"
      >
        <View className="flex-row items-center gap-1.5">
          <Plus size={16} strokeWidth={2.5} />
          <AppText variant="label" tone="accent">
            Add requirement
          </AppText>
        </View>
      </IconButton>
    </View>
  );
}
