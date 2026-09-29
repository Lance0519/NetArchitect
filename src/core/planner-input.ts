/**
 * Planner draft input rules.
 *
 * PURE MODULE. No React, no React Native, no Expo, no styling. It takes what the user has
 * typed and returns one of four states, or throws nothing at all.
 *
 * ## Why the planner is not the VLSM screen
 *
 * The VLSM screen owns no addresses: it takes host counts and the engine allocates them, so
 * an overlap is impossible by construction. The planner is the opposite. Every CIDR in a
 * plan here is the user's own text, and two rows claiming the same addresses is something
 * a person can genuinely do while building one.
 *
 * That single difference dictates the whole shape of this module.
 *
 * ## Parse failure and plan-level failure are different things
 *
 * The VLSM draft has a hard line between "this cannot be read" and "this is an answer".
 * The planner needs three, because the Phase 8 exit criterion is explicit:
 *
 *   > a plan with an intentional overlap is _representable_ (the auditor must be able to
 *   > see it) but is flagged at the point of creation
 *
 * So:
 *
 *   1. `empty`         - nothing entered yet.
 *   2. `header-invalid`- the plan name or parent CIDR cannot be read. Nothing downstream
 *                        can be judged without a parent, so this is checked first.
 *   3. `rows-invalid`  - a specific field cannot be *parsed*: a CIDR that is not an
 *                        address, a host count that is not a number. The row is not a
 *                        subnet yet, so there is nothing to describe.
 *   4. `ready`         - every row parses. The plan exists. It may or may not carry
 *                        {@link PlanFinding}s.
 *
 * A finding is deliberately NOT an outcome. An overlap, a subnet outside its parent and a
 * duplicated VLAN ID are all *properties of a plan that exists*, and the security auditor
 * in Phase 11 has to be able to read them off a `NetworkPlan`. Refusing to produce a plan
 * because two of its rows overlap would make exactly the finding the auditor exists to
 * report impossible to create.
 *
 * This is the difference between a tool that validates and a tool that can show you your
 * mistake. It is also why there is no `planSubnetsSchema` call in here: that schema
 * *rejects* overlap, which is correct for "is this plan safe to save" and wrong for "what
 * did the user just build".
 *
 * ## Why the gateway is a three-state field and not a string
 *
 * "Gateway auto-fill = first usable host; explicitly clearable for a gateway-less subnet."
 *
 * A single `gateway: string` cannot express that. Blank means three different things -
 * "not filled in yet", "no gateway, on purpose" - and once the autofill runs, the second
 * state is indistinguishable from the first and gets refilled on the next keystroke. A user
 * who clears the gateway of a point-to-point link would watch it come back.
 *
 * So the row carries {@link GatewayMode}:
 *
 *   - `auto`   - blank, and the engine's first usable host will be shown for it.
 *   - `manual` - the user typed one, or edited the autofilled one. Never overwritten.
 *   - `none`   - the user cleared it. Respects "no gateway", permanently.
 *
 * Typing a gateway moves `auto` to `manual`. Clearing moves whatever it was to `none`.
 * Editing the row's CIDR never touches the mode, so a gateway the user chose survives a
 * block change - and is then reported as invalid by `gatewaySchema` against the *new*
 * subnet, which is the correct outcome: the address really is in the wrong place now.
 *
 * ## Nothing here reallocates
 *
 * No function in this module changes another row's CIDR. The planner's rows are
 * hand-authored, and a tool that silently rewrote one while the user edited another would
 * be lying about their plan. The one operation that *does* rewrite rows - repacking from
 * host requirements, and applying a profile - lives in `plan-changes.ts` and returns a diff
 * to show before anything is committed.
 */

import {
  calculateNetworkAddress,
  calculateSubnet,
  formatCidr,
  integerToIPv4,
  isWithin,
  parseCidr,
} from './ip-engine';
import {
  gatewaySchema,
  planDescriptionSchema,
  planNameSchema,
  subnetCidrSchema,
  vlanIdSchema,
} from './validation';

import type {
  Cidr,
  NetworkPlan,
  NetworkRole,
  PlannedSubnet,
  PlanProfile,
  SubnetInfo,
} from '../types/network';

/* ------------------------------------------------------------------ *
 * Row draft
 * ------------------------------------------------------------------ */

/**
 * How a row's gateway was arrived at.
 *
 * See the module header. The three states are not cosmetic: without `none`, "no gateway"
 * is indistinguishable from "not filled in" and the autofill overwrites the user's decision.
 */
export type GatewayMode = 'auto' | 'manual' | 'none';

/**
 * One row of a plan, exactly as typed.
 *
 * Every address field is a `string`, never a `Cidr`. A row under construction is
 * `192.168.1.` most of the time, and a draft that cannot hold a half-typed address is a
 * draft that loses the caret and the user's place.
 */
export interface SubnetRowDraft {
  readonly id: string;
  readonly name: string;
  readonly role: NetworkRole;
  /** Only meaningful when `role === 'CUSTOM'`. Never parsed when the role is anything else. */
  readonly customRoleLabel: string;
  /** Text. Blank means untagged, which is legitimate. */
  readonly vlan: string;
  /** Text, e.g. `192.168.1.0/24`. */
  readonly cidr: string;
  /** Text. Only read when `gatewayMode === 'manual'`. */
  readonly gateway: string;
  readonly gatewayMode: GatewayMode;
  /** Text. The host count the user is designing for. */
  readonly hosts: string;
}

/** The whole plan as typed. */
export interface PlanDraft {
  readonly name: string;
  readonly description: string;
  /** Text. Every subnet must fall inside this. */
  readonly parent: string;
  readonly profile: PlanProfile;
  readonly rows: readonly SubnetRowDraft[];
}

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

/**
 * A problem with a plan that still exists.
 *
 * Not an error and not an outcome: the row parses, the plan builds, and this is a true
 * statement about it that the screen should show and Phase 11's auditor should read.
 *
 * `rowIds` carries **every** row involved, not the first one found. An overlap has two
 * participants and a reader needs to know which; a three-way overlap has three. Attributing
 * a finding to one row and leaving the others unmentioned is how a user fixes half of a
 * problem and still has one.
 */
export interface PlanFinding {
  readonly kind: 'overlap' | 'outside-parent' | 'duplicate-vlan';
  readonly message: string;
  readonly rowIds: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Outcome
 * ------------------------------------------------------------------ */

/**
 * What the planner should do with this draft.
 *
 * Four states, and the fourth carries findings rather than replacing itself with a fifth.
 * See the module header for why that distinction is the exit criterion and not a style
 * choice.
 */
export type PlannerOutcome =
  | { readonly kind: 'empty' }
  | { readonly kind: 'header-invalid'; readonly field: 'name' | 'parent'; readonly message: string }
  | { readonly kind: 'rows-invalid'; readonly messages: ReadonlyMap<string, string> }
  | {
      readonly kind: 'ready';
      /** The plan as it would be saved. Exists even when `findings` is non-empty. */
      readonly plan: NetworkPlan;
      /** Empty when the plan is sound. Never blocking. */
      readonly findings: readonly PlanFinding[];
      /** Resolved per row, for the editor's read-only columns. */
      readonly details: ReadonlyMap<string, ResolvedRow>;
    };

/** Everything derived about one row, for display. Never fed back into the draft. */
export interface ResolvedRow {
  readonly rowId: string;
  /** `null` when the row's CIDR does not parse. A `rows-invalid` outcome never gets here. */
  readonly subnet: SubnetInfo;
  /** The effective gateway text: the autofilled first usable host, the typed one, or `null`. */
  readonly gateway: string | null;
  /** The VLAN ID, or `null` for untagged. */
  readonly vlanId: number | null;
  /** Parsed host count. */
  readonly requestedHosts: number;
}

/* ------------------------------------------------------------------ *
 * Ids
 * ------------------------------------------------------------------ */

/**
 * Monotonic row ids.
 *
 * Module-scoped and monotonic, like `vlsm-input.ts`'s `draft-N`, for the same reason:
 * tests assert uniqueness and stability, never an exact value, and a random id would make
 * a failing assertion unreproducible.
 */
let rowCounter = 0;

/** A fresh row id. */
export const newRowId = (): string => {
  rowCounter += 1;
  return `row-${rowCounter}`;
};

/* ------------------------------------------------------------------ *
 * Row construction
 * ------------------------------------------------------------------ */

/**
 * A blank row.
 *
 * `role` starts as `LAN` rather than `CUSTOM`: a blank row is not yet a custom-anything,
 * and starting on `CUSTOM` would show a label field the moment the row appears.
 * `gatewayMode` starts `auto` so a new row is usable the instant its CIDR parses.
 */
export const blankRow = (overrides?: Partial<SubnetRowDraft>): SubnetRowDraft => {
  const row: SubnetRowDraft = {
    id: newRowId(),
    name: '',
    role: 'LAN',
    customRoleLabel: '',
    vlan: '',
    cidr: '',
    gateway: '',
    gatewayMode: 'auto',
    hosts: '',
    ...overrides,
  };
  // A row cannot be built holding a gateway the mode will ignore. `applyPatchToRow` runs
  // this inference for edits, but a row constructed here with `gateway: '192.168.1.10'`
  // and the default `auto` would carry a value that `effectiveGateway` silently throws
  // away - a state reachable from a test helper or a future import path, and the failure
  // would be a gateway that vanishes with no message. An explicit `gatewayMode` in the
  // overrides still wins, exactly as it does on a patch.
  return overrides?.gateway !== undefined && overrides.gatewayMode === undefined
    ? applyPatchToRow(row, { gateway: overrides.gateway })
    : row;
};

/**
 * A blank draft: one empty row, so the screen opens with something to type into.
 *
 * Not zero rows. A planner that opens to an empty table and an "Add subnet" button is a
 * planner whose first two interactions are "add a row" and "type a name", where a table
 * with one row gets to the second interaction immediately.
 */
export const initialPlanDraft = (): PlanDraft => ({
  name: '',
  description: '',
  parent: '',
  profile: 'custom',
  rows: [blankRow()],
});

/* ------------------------------------------------------------------ *
 * Draft mutations - pure functions, never store actions
 * ------------------------------------------------------------------ */

/**
 * The reasoning for every mutation being here and not in the store: `moveRow` and
 * `removeRow` are where off-by-one and identity bugs live, and a pure function is something
 * `tests/planner-input.test.ts` reaches directly. Inside a Zustand action they would be
 * reachable only by rendering a screen, and R4 has declined a component-test runner.
 */

/** Replace a field. An unknown id returns the draft unchanged rather than throwing. */
export const updateRow = (
  draft: PlanDraft,
  id: string,
  patch: Partial<Omit<SubnetRowDraft, 'id'>>,
): PlanDraft => ({
  ...draft,
  rows: draft.rows.map((row) => (row.id === id ? applyPatchToRow(row, patch) : row)),
});

/**
 * Apply a patch, maintaining the invariants the patch can break.
 *
 * Two of them, both about the gateway mode:
 *
 *   - writing a `gateway` while `auto` means the user typed one, so the mode becomes
 *     `manual` and the autofill stops.
 *   - writing a blank `gateway` means the user cleared it, so the mode becomes `none`
 *     rather than falling back to `auto`. This is the whole reason `none` exists.
 *
 * An explicit `gatewayMode` in the same patch wins over the inference, so a caller that
 * means "set this to manual and leave the text alone" is not second-guessed.
 */
const applyPatchToRow = (
  row: SubnetRowDraft,
  patch: Partial<Omit<SubnetRowDraft, 'id'>>,
): SubnetRowDraft => {
  const next: SubnetRowDraft = { ...row, ...patch };
  if (patch.gatewayMode !== undefined) return next;

  if (patch.gateway !== undefined) {
    return {
      ...next,
      gatewayMode: patch.gateway.trim().length === 0 ? 'none' : 'manual',
    };
  }
  return next;
};

/** Append a row, optionally seeded. The seed's `id` is discarded; a new one is minted. */
export const addRow = (draft: PlanDraft, overrides?: Partial<SubnetRowDraft>): PlanDraft => {
  // A seeded row takes the id of the row after it, so the caller's template stays reusable.
  const { id: _ignored, ...seed } = overrides ?? {};
  return { ...draft, rows: [...draft.rows, blankRow(seed)] };
};

/** Remove a row. An unknown id returns the draft unchanged. */
export const removeRow = (draft: PlanDraft, id: string): PlanDraft => ({
  ...draft,
  rows: draft.rows.filter((row) => row.id !== id),
});

/**
 * Move a row one position. `by` is `-1` or `1`.
 *
 * A no-op at either end rather than a throw: the screen disables the buttons there, and a
 * function that throws when a caller cannot see the disabled state would make the
 * keyboard-navigation path - which is how a screen-reader user reorders - crash the screen.
 */
export const moveRow = (draft: PlanDraft, id: string, by: -1 | 1): PlanDraft => {
  const index = draft.rows.findIndex((row) => row.id === id);
  const target = index + by;
  if (index < 0 || target < 0 || target >= draft.rows.length) return draft;
  const rows = [...draft.rows];
  const [row] = rows.splice(index, 1);
  // The bounds check above proves both are defined, but TypeScript cannot see that through
  // arithmetic, and a non-null assertion here would be asserting rather than proving.
  if (row === undefined) return draft;
  rows.splice(target, 0, row);
  return { ...draft, rows };
};

/** Replace the header fields. */
export const updateHeader = (
  draft: PlanDraft,
  patch: Partial<Omit<PlanDraft, 'rows'>>,
): PlanDraft => ({ ...draft, ...patch });

/** Back to a blank draft. Used by "Start over". */
export const resetPlanDraft = (): PlanDraft => initialPlanDraft();

/** Set a row's gateway mode explicitly, for the "clear gateway" affordance. */
export const setGatewayMode = (
  draft: PlanDraft,
  id: string,
  mode: GatewayMode,
): PlanDraft => updateRow(draft, id, { gatewayMode: mode, ...(mode === 'none' ? { gateway: '' } : {}) });

/* ------------------------------------------------------------------ *
 * VLAN suggestion
 * ------------------------------------------------------------------ */

/**
 * The lowest unused VLAN ID, or `null` when there is none.
 *
 * 1-4094, per IEEE 802.1Q: 0 means priority/untagged and 4095 is reserved, so neither is
 * ever suggested. Scanning from 1 upward rather than picking `max + 1` is deliberate -
 * `max + 1` produces 4095 after a plan legitimately reaches 4094, and it leaves gaps in
 * the middle of a plan looking arbitrary.
 *
 * Untagged rows do not consume an ID. A blank VLAN is not "VLAN 0", it is "no VLAN", and
 * treating it as a claim on the ID space would make an untagged plan push the suggestion up
 * for no reason.
 *
 * Only *parseable* VLANs are considered taken. A row where the user has typed `12x` is
 * broken and already has a message on it; letting it hold a number hostage would hand the
 * next row a duplicate the user then has to untangle.
 */
export const nextFreeVlanId = (rows: readonly SubnetRowDraft[]): number | null => {
  const taken = new Set<number>();
  for (const row of rows) {
    const result = vlanIdSchema.safeParse(row.vlan);
    if (result.success) taken.add(result.data);
  }
  for (let candidate = 1; candidate <= 4094; candidate += 1) {
    if (!taken.has(candidate)) return candidate;
  }
  return null;
};

/** The VLAN IDs already claimed by parseable rows, for duplicate detection. */
const vlanOwners = (rows: readonly SubnetRowDraft[]): ReadonlyMap<number, string[]> => {
  const owners = new Map<number, string[]>();
  for (const row of rows) {
    const result = vlanIdSchema.safeParse(row.vlan);
    if (!result.success) continue;
    const existing = owners.get(result.data);
    if (existing === undefined) owners.set(result.data, [row.id]);
    else existing.push(row.id);
  }
  return owners;
};

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

/**
 * The draft, resolved into a plan - or the reason there is not one yet.
 *
 * Never throws. Every engine call is wrapped, because an engine throw reaching a screen is
 * a crash and the whole contract of the validation layer is that bad input produces a
 * message.
 *
 * Order matters and is not arbitrary:
 *
 *   1. nothing typed      -> `empty`
 *   2. header unreadable  -> `header-invalid`, because "is 10.0.0.5/24 valid" has no
 *                            answer without a parent, so a row error would be noise
 *   3. row unreadable     -> `rows-invalid`, one message per row
 *   4. otherwise          -> `ready`
 *
 * Header before rows, same as the VLSM draft, and for the same reason: a user who typed a
 * malformed parent CIDR needs to be told that first, because every subnetwork they pick
 * will be outside it.
 */
export const evaluatePlan = (draft: PlanDraft): PlannerOutcome => {
  if (isBlankDraft(draft)) return { kind: 'empty' };

  const name = planNameSchema.safeParse(draft.name);
  if (!name.success) {
    return { kind: 'header-invalid', field: 'name', message: firstIssue(name.error) };
  }

  const parent = parseParent(draft.parent);
  if (parent === null) {
    return { kind: 'header-invalid', field: 'parent', message: parseParentMessage(draft.parent) };
  }

  // Description last, and on its own: it is optional and non-structural, so it must not
  // stop a plan from building. It is validated here only so the saved value is trimmed to
  // the same 500 characters `NetworkPlan.description` promises.
  const description = planDescriptionSchema.safeParse(draft.description);
  const descriptionText = description.success ? description.data : '';

  const details = new Map<string, ResolvedRow>();
  const messages = new Map<string, string>();
  /** Rows whose CIDR parsed, in draft order. Only these take part in the plan checks. */
  const parsed: { row: SubnetRowDraft; subnet: SubnetInfo }[] = [];

  for (const row of draft.rows) {
    // Blank rows are skipped rather than reported - see `isBlankRow`. They are also left
    // out of the plan, so a draft with one typed subnet and three spare blank rows is a
    // one-subnet plan, not a four-subnet plan with three holes.
    if (isBlankRow(row)) continue;

    const message = rowMessage(row);
    if (message !== null) {
      messages.set(row.id, message);
      continue;
    }
    // `rowMessage` returning null means every one of these parsed. Re-reading them here is
    // not duplicated validation - it is the only way to turn the parsed text back into the
    // engine's values, and the schema output is not carried on the draft because the draft
    // holds strings, deliberately (see the module header).
    const cidr = parseCidr(row.cidr);
    const subnet = calculateSubnet(cidr.ip, cidr.prefix);
    const vlan = vlanIdSchema.safeParse(row.vlan);
    const hosts = Number(row.hosts.trim());

    details.set(row.id, {
      rowId: row.id,
      subnet,
      gateway: effectiveGateway(row, subnet),
      vlanId: vlan.success ? vlan.data : null,
      requestedHosts: hosts,
    });
    parsed.push({ row, subnet });
  }

  if (messages.size > 0) return { kind: 'rows-invalid', messages };

  const subnets: PlannedSubnet[] = parsed.map(({ row, subnet }, index) => {
    const resolved = details.get(row.id);
    const vlan = vlanIdSchema.safeParse(row.vlan);
    const gateway = resolved?.gateway ?? null;
    return {
      id: row.id,
      name: row.name.trim(),
      role: row.role,
      ...(row.role === 'CUSTOM' ? { customRoleLabel: row.customRoleLabel.trim() } : {}),
      ...(vlan.success ? { vlanId: vlan.data } : {}),
      cidr: formatCidr({ family: 'ipv4', ip: subnet.networkAddress, prefix: subnet.cidr.prefix }),
      ...(gateway === null ? {} : { gateway }),
      requestedHosts: Number(row.hosts.trim()),
      sortOrder: index,
    };
  });

  return {
    kind: 'ready',
    plan: {
      // `id`, `createdAt` and `updatedAt` are placeholders. A draft has no identity yet -
      // it becomes a document in Phase 9, which mints an id and stamps the times. Writing
      // a plausible-looking id here would be inventing a record that does not exist.
      id: 'draft',
      name: name.data,
      description: descriptionText,
      parentCidr: formatCidr(parent),
      profile: draft.profile,
      subnets,
      createdAt: 0,
      updatedAt: 0,
    },
    findings: planFindings(parsed, parent),
    details,
  };
};

/* ------------------------------------------------------------------ *
 * Evaluation helpers
 * ------------------------------------------------------------------ */

/** True when nothing at all has been typed. One non-blank character is enough to commit. */
const isBlankDraft = (draft: PlanDraft): boolean =>
  draft.name.trim().length === 0 &&
  draft.description.trim().length === 0 &&
  draft.parent.trim().length === 0 &&
  draft.rows.every(
    (row) =>
      row.name.trim().length === 0 &&
      row.cidr.trim().length === 0 &&
      row.hosts.trim().length === 0 &&
      row.vlan.trim().length === 0 &&
      row.gateway.trim().length === 0,
  );

/**
 * The parent CIDR, canonicalised, or `null`.
 *
 * `parseCidr` accepts `192.168.1.50/24` - an address inside a network - and is right to:
 * as a *reference* it is perfectly valid. "Put my subnets in the /24 that 192.168.1.50
 * lives in" is a reasonable thing to type, and rejecting it would be pedantic.
 *
 * But the parent is also a **definition**: it is what the plan is built inside, and it ends
 * up in an export as the block a router is configured with. Storing the string as typed
 * would put `192.168.1.50/24` in a switch configuration and in the persistence layer, where
 * every other CIDR in the plan is canonical. So the address is normalised here - not by
 * `assertNetworkBoundary`, which would *reject* a host address, but by the same
 * `calculateNetworkAddress` the packer uses, which is why a plan typed as `192.168.1.50/24`
 * and one typed as `192.168.1.0/24` produce byte-identical plans.
 *
 * A *subnet row* is held to the stricter rule: `subnetCidrSchema` rejects host bits there,
 * because a row states which subnet it is and a row naming an address inside one is a
 * different mistake from a parent that references one.
 */
const parseParent = (text: string): Cidr | null => {
  if (text.trim().length === 0) return null;
  try {
    const parsed = parseCidr(text);
    return {
      family: 'ipv4',
      ip: calculateNetworkAddress(parsed.ip, parsed.prefix),
      prefix: parsed.prefix,
    };
  } catch {
    return null;
  }
};

/** The message for an unreadable parent, without letting `parseCidr`'s throw escape. */
const parseParentMessage = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'Enter the parent block these subnets live in.';
  // A bare address is the most common near-miss and deserves a specific answer: "not a
  // valid CIDR block" tells a user nothing about the slash they left off.
  if (!trimmed.includes('/')) {
    return `Add a prefix length, for example ${trimmed}/24.`;
  }
  try {
    parseCidr(trimmed);
  } catch (error) {
    return error instanceof Error ? error.message : 'Enter a valid CIDR block.';
  }
  return 'Enter a valid CIDR block.';
};

/**
 * A row the user has not started.
 *
 * Blank means *every* field blank. A row with a name but no CIDR is a row in progress and
 * is reported; a row with nothing at all is a row that exists to be typed into.
 *
 * This is the same rule `vlsm-input.ts` applies to an untouched requirement, and for the
 * same reason: the planner opens with one blank row, so treating it as an error would
 * light up the table before the user had done anything - and the message would be "name
 * this subnet", which is not a complaint about anything they did.
 */
const isBlankRow = (row: SubnetRowDraft): boolean =>
  row.name.trim().length === 0 &&
  row.cidr.trim().length === 0 &&
  row.hosts.trim().length === 0 &&
  row.vlan.trim().length === 0 &&
  row.gateway.trim().length === 0 &&
  row.customRoleLabel.trim().length === 0;

/**
 * The first problem with one row, or `null`.
 *
 * One message per row, first failure wins. A row with a bad CIDR *and* a bad host count
 * should show the CIDR message: until the CIDR reads, the host count has nothing to be
 * measured against, and three messages on one row is a wall of text with no order.
 *
 * Only called on rows that are not blank, so the name check below never fires on a row
 * that simply has not been started.
 */
const rowMessage = (row: SubnetRowDraft): string | null => {
  const name = planNameSchema.safeParse(row.name);
  if (!name.success) return firstIssue(name.error);

  if (row.role === 'CUSTOM' && row.customRoleLabel.trim().length === 0) {
    return 'Name this custom role, so the table and the audit say what it is.';
  }

  const cidr = row.cidr.trim();
  if (cidr.length === 0) return 'Enter the subnet, for example 192.168.1.0/24.';

  const cidrResult = subnetCidrSchema.safeParse(cidr);
  if (!cidrResult.success) return firstIssue(cidrResult.error);

  const hosts = row.hosts.trim();
  if (hosts.length === 0) return 'Enter how many hosts this subnet is for.';
  if (!DIGITS_ONLY.test(hosts)) return 'Hosts must be a whole number.';
  const count = Number(hosts);
  if (!Number.isSafeInteger(count) || count < 1) return 'Hosts must be at least 1.';

  if (row.vlan.trim().length > 0) {
    const vlan = vlanIdSchema.safeParse(row.vlan);
    if (!vlan.success) return firstIssue(vlan.error);
  }

  if (row.gatewayMode === 'manual' && row.gateway.trim().length > 0) {
    const gateway = gatewaySchema(cidr).safeParse(row.gateway);
    if (!gateway.success) return firstIssue(gateway.error);
  }

  return null;
};

const DIGITS_ONLY = /^\d+$/;

/* ------------------------------------------------------------------ *
 * Gateway resolution
 * ------------------------------------------------------------------ */

/**
 * The gateway a row actually has, or `null` when it has none.
 *
 * `auto` reads the engine's `firstUsableHost` rather than `networkAddress + 1`, because
 * that is the only definition of the first usable address that is correct for every
 * prefix: on a `/31` it is the network address itself (RFC 3021 makes both addresses
 * usable) and on a `/32` it is the single address. A "skip the network address" shortcut
 * would produce a gateway outside the subnet on both, and the screen would show a valid
 * looking plan that cannot be configured.
 *
 * `none` returns `null` - the user's decision, and the reason `none` exists.
 */
const effectiveGateway = (row: SubnetRowDraft, subnet: SubnetInfo): string | null => {
  switch (row.gatewayMode) {
    case 'auto':
      return integerToIPv4(subnet.firstUsableHost);
    case 'manual':
      return row.gateway.trim();
    case 'none':
      return null;
  }
};

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

/**
 * Every true statement about this plan that a user would want to know.
 *
 * Three kinds, and no others yet. This is deliberately a short list. The Phase 11 auditor
 * is where the security rules live - flat guest networks, DMZ reachability, management
 * exposure - and inventing a plausible-looking fourth finding here would be a rule with no
 * citation and no severity, presented with the same weight as a genuine overlap.
 *
 * These three are structural: they are about the addresses themselves rather than about
 * what is *done* with them, which is why they can be decided without a security model.
 *
 * Two subnets overlap unless one contains the other, which is still an overlap. The test
 * is done on resolved network/broadcast addresses rather than on the typed text, so
 * `192.168.1.0/24` and a row that parses to the same block are caught even when they were
 * typed differently.
 */
const planFindings = (
  parsed: readonly { row: SubnetRowDraft; subnet: SubnetInfo }[],
  parent: Cidr,
): readonly PlanFinding[] => {
  const findings: PlanFinding[] = [];

  for (const { row, subnet } of parsed) {
    if (!isWithin({ family: 'ipv4', ip: subnet.networkAddress, prefix: subnet.cidr.prefix }, parent)) {
      findings.push({
        kind: 'outside-parent',
        message: `${subnetName(row)} (${formatSubnet(subnet)}) is outside the parent block ${formatCidr(parent)}.`,
        rowIds: [row.id],
      });
    }
  }

  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const a = parsed[i];
      const b = parsed[j];
      if (a === undefined || b === undefined) continue;
      if (!rangesOverlap(a.subnet, b.subnet)) continue;
      findings.push({
        kind: 'overlap',
        message: `${subnetName(a.row)} (${formatSubnet(a.subnet)}) overlaps ${subnetName(b.row)} (${formatSubnet(b.subnet)}).`,
        // Both rows, every time. A one-sided finding would leave a reader fixing half a
        // problem, and both rows are equally wrong.
        rowIds: [a.row.id, b.row.id],
      });
    }
  }

  for (const [vlan, owners] of vlanOwners(parsed.map((entry) => entry.row))) {
    if (owners.length < 2) continue;
    const names = parsed
      .filter((entry) => owners.includes(entry.row.id))
      .map((entry) => subnetName(entry.row));
    findings.push({
      kind: 'duplicate-vlan',
      message: `VLAN ${vlan} is claimed by ${names.join(' and ')}. One VLAN ID is one broadcast domain.`,
      rowIds: [...owners],
    });
  }

  return findings;
};

/**
 * Do two resolved subnets share an address?
 *
 * Integer comparison on the inclusive ranges, which is exact and needs no floating point
 * and no exponent: `aStart < bEnd && bStart < aEnd`. For a `/31` and a `/32` inside it,
 * the containment case still reports true, which is correct - two rows claiming the same
 * address are overlapping however one of them got there.
 */
const rangesOverlap = (a: SubnetInfo, b: SubnetInfo): boolean =>
  a.networkAddress < b.broadcastAddress && b.networkAddress < a.broadcastAddress;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const formatSubnet = (subnet: SubnetInfo): string =>
  formatCidr({ family: 'ipv4', ip: subnet.networkAddress, prefix: subnet.cidr.prefix });

const subnetName = (row: SubnetRowDraft): string => row.name.trim();

/** The first Zod issue's message, or a generic fallback. Never exposes Zod's own wording. */
const firstIssue = (error: { issues: readonly { message: string }[] }): string =>
  error.issues[0]?.message ?? 'That value is not valid.';
