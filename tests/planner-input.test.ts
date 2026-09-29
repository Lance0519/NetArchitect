/**
 * Tests for the planner draft rules.
 *
 * ## The property under test
 *
 * The Phase 8 exit criterion is:
 *
 * > a plan with an intentional overlap is _representable_ (the auditor must be able to see
 * > it) but is flagged at the point of creation
 *
 * So the suite's centre of gravity is that a plan which overlaps still produces a
 * `ready` outcome carrying a `NetworkPlan`, and that the plan's subnets are genuinely
 * present on it. An `evaluatePlan` that threw, or returned `rows-invalid`, or returned a
 * plan with the offending rows silently dropped would fail every test here - which is the
 * point. There are several tests below whose only job is to assert a plan *exists*.
 *
 * ## A note on the `!` in gateway assertions
 *
 * There is no non-null assertion in this file. Every lookup that could be absent is either
 * guarded or asserted through a helper that throws, because a test that reads
 * `result.plan.subnets[0]!.gateway` proves the shape compiles and not that the value is
 * right.
 */

import { describe, expect, it } from 'vitest';

import { calculateSubnet, integerToIPv4, parseCidr } from '../src/core/ip-engine';
import {
  addRow,
  blankRow,
  evaluatePlan,
  initialPlanDraft,
  moveRow,
  nextFreeVlanId,
  removeRow,
  resetPlanDraft,
  setGatewayMode,
  updateHeader,
  updateRow,
  type PlanDraft,
  type PlannerOutcome,
  type SubnetRowDraft,
} from '../src/core/planner-input';

import type { NetworkPlan, PlannedSubnet } from '../src/types/network';

/* ================================================================== *
 * Helpers
 * ================================================================== */

/**
 * A draft with a parent, a name and the given rows.
 *
 * `rows` are given as `[name, cidr, hosts]` triples plus an optional vlan and gateway, so a
 * test reads as the plan it describes rather than as six lines of object literals. Every
 * test in this file that needs a valid draft uses this, so a change to the required fields
 * shows up as every test failing at once instead of one obscure failure.
 */
const draftWith = (
  rows: readonly (readonly [string, string, string] | readonly [string, string, string, string])[],
  parent = '192.168.1.0/24',
  name = 'Test plan',
): PlanDraft => {
  const built = rows.map(([rowName, cidr, hosts, vlan]) =>
    blankRow({
      name: rowName,
      cidr,
      hosts,
      vlan: vlan ?? '',
      gatewayMode: vlan === undefined ? ('auto' as const) : ('auto' as const),
    }),
  );
  return { ...initialPlanDraft(), name, parent, rows: built };
};

/** The plan from a `ready` outcome, or a thrown error naming what was expected. */
const planOf = (outcome: PlannerOutcome): NetworkPlan => {
  if (outcome.kind !== 'ready') {
    throw new Error(`expected a ready outcome, got "${outcome.kind}"`);
  }
  return outcome.plan;
};

/** The findings from a `ready` outcome, or a thrown error. */
const findingsOf = (outcome: PlannerOutcome): readonly { kind: string; message: string; rowIds: readonly string[] }[] => {
  if (outcome.kind !== 'ready') {
    throw new Error(`expected a ready outcome, got "${outcome.kind}"`);
  }
  return outcome.findings;
};

/** The subnet at an index, or a thrown error. Index-based on purpose: order is the subject. */
const subnetAt = (plan: NetworkPlan, index: number): PlannedSubnet => {
  const subnet = plan.subnets[index];
  if (subnet === undefined) throw new Error(`no subnet at index ${index} (have ${plan.subnets.length})`);
  return subnet;
};

/** The resolved row detail for a draft row id. */
const detailOf = (outcome: PlannerOutcome, rowId: string) => {
  if (outcome.kind !== 'ready') throw new Error(`expected a ready outcome, got "${outcome.kind}"`);
  const detail = outcome.details.get(rowId);
  if (detail === undefined) throw new Error(`no detail for row "${rowId}"`);
  return detail;
};

/** How many findings of a kind a draft produces. */
const countFindings = (draft: PlanDraft, kind: string): number =>
  findingsOf(evaluatePlan(draft)).filter((finding) => finding.kind === kind).length;

/** Only the findings of one kind, for assertions that only care about that rule. */
const findingsByKind = (draft: PlanDraft, kind: string) =>
  findingsOf(evaluatePlan(draft)).filter((finding) => finding.kind === kind);

/* ================================================================== *
 * Blank drafts
 * ================================================================== */

describe('an untouched draft', () => {
  it('is empty, not an error', () => {
    expect(evaluatePlan(initialPlanDraft()).kind).toBe('empty');
  });

  it('opens with exactly one blank row, so there is something to type into', () => {
    // Zero rows would make the first two interactions "add a subnet" and "type a name",
    // where one row gets to the second immediately.
    const draft = initialPlanDraft();
    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]?.name).toBe('');
  });

  it('starts on LAN, not CUSTOM, so no custom-role label appears unasked', () => {
    // `CUSTOM` would show a label field the moment the screen opened, before the user had
    // asked for a custom role.
    expect(initialPlanDraft().rows[0]?.role).toBe('LAN');
  });

  it('starts with the gateway on auto, so a typed CIDR immediately has a gateway', () => {
    expect(initialPlanDraft().rows[0]?.gatewayMode).toBe('auto');
  });

  it('starts with no profile selected', () => {
    expect(initialPlanDraft().profile).toBe('custom');
  });

  it('is empty again after reset', () => {
    const dirty = updateHeader(initialPlanDraft(), { name: 'Something' });
    expect(evaluatePlan(dirty).kind).not.toBe('empty');
    expect(evaluatePlan(resetPlanDraft()).kind).toBe('empty');
  });

  it('stays empty while only untouched rows are present', () => {
    // A draft with one blank row and nothing typed must not light up the row editor with a
    // "name this subnet" message the moment the screen opens.
    const draft = { ...initialPlanDraft(), name: '', parent: '' };
    expect(evaluatePlan(draft).kind).toBe('empty');
  });

  it('is not empty once a single character is typed anywhere', () => {
    const draft = initialPlanDraft();
    const typed = updateRow(draft, draft.rows[0]!.id, { name: 'A' });
    expect(evaluatePlan(typed).kind).not.toBe('empty');
  });
});

/* ================================================================== *
 * Header validation
 * ================================================================== */

describe('the plan header', () => {
  it('reports a missing plan name against the name field, not the rows', () => {
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], '192.168.1.0/24', ''));
    expect(outcome.kind).toBe('header-invalid');
    if (outcome.kind !== 'header-invalid') throw new Error('expected header-invalid');
    expect(outcome.field).toBe('name');
  });

  it('reports a bad parent against the parent field', () => {
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], 'not-a-cidr'));
    expect(outcome.kind).toBe('header-invalid');
    if (outcome.kind !== 'header-invalid') throw new Error('expected header-invalid');
    expect(outcome.field).toBe('parent');
  });

  it('checks the parent before the rows, so every subnet is not reported as outside it', () => {
    // A user who typed a malformed parent would otherwise be shown a message per row
    // about subnets being outside a block that does not exist.
    const outcome = evaluatePlan(draftWith([['A', '10.0.0.0/25', '50']], 'garbage'));
    expect(outcome.kind).toBe('header-invalid');
  });

  it('checks the name before the parent, so an empty form names the first thing to fix', () => {
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], 'garbage', ''));
    if (outcome.kind !== 'header-invalid') throw new Error(`expected header-invalid, got ${outcome.kind}`);
    expect(outcome.field).toBe('name');
  });

  it('accepts a parent given as an address inside a network', () => {
    // "Put my subnets in the 192.168.1.0/24 that 192.168.1.50 lives in" is a reasonable
    // thing to type, and the engine normalises it.
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], '192.168.1.50/24'));
    expect(planOf(outcome).parentCidr).toBe('192.168.1.0/24');
  });

  it('accepts a parent given as a bare address, saying so specifically', () => {
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], '192.168.1.0'));
    if (outcome.kind !== 'header-invalid') throw new Error('expected header-invalid');
    // "Not a valid CIDR block" tells a user nothing about the slash they left off.
    expect(outcome.message).toContain('192.168.1.0/24');
  });

  it('accepts a prefix typed with a leading slash', () => {
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], '192.168.1.0/24'));
    expect(planOf(outcome).parentCidr).toBe('192.168.1.0/24');
  });

  it('rejects a plan name over 80 characters', () => {
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], '192.168.1.0/24', 'x'.repeat(81)));
    expect(outcome.kind).toBe('header-invalid');
  });

  it('accepts a plan name of exactly 80 characters', () => {
    // The boundary. A limit of 80 tested only with 81 does not prove 80 is allowed.
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], '192.168.1.0/24', 'x'.repeat(80)));
    expect(planOf(outcome).name).toHaveLength(80);
  });

  it('trims the plan name, so trailing spaces do not cost characters', () => {
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']], '192.168.1.0/24', '  Campus  '));
    expect(planOf(outcome).name).toBe('Campus');
  });

  it('accepts an empty description', () => {
    const outcome = evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']]));
    expect(planOf(outcome).description).toBe('');
  });

  it('accepts a 500-character description and rejects 501', () => {
    const base = draftWith([['A', '192.168.1.0/25', '50']]);
    expect(planOf(evaluatePlan(updateHeader(base, { description: 'x'.repeat(500) }))).description).toHaveLength(500);
    // The description is optional, so an over-long one is trimmed away rather than
    // becoming a fourth outcome: the plan still builds.
    expect(planOf(evaluatePlan(updateHeader(base, { description: 'x'.repeat(501) }))).description).toBe('');
  });

  it('trims the description', () => {
    const outcome = evaluatePlan(updateHeader(draftWith([['A', '192.168.1.0/25', '50']]), { description: '  hi  ' }));
    expect(planOf(outcome).description).toBe('hi');
  });
});

/* ================================================================== *
 * Row validation
 * ================================================================== */

describe('row validation', () => {
  const withRow = (patch: Partial<SubnetRowDraft>): PlannerOutcome => {
    const draft = draftWith([['A', '192.168.1.0/25', '50']]);
    const id = draft.rows[0]!.id;
    return evaluatePlan(updateRow(draft, id, patch));
  };

  it('reports an unparseable CIDR against that row', () => {
    const outcome = withRow({ cidr: '192.168.1' });
    if (outcome.kind !== 'rows-invalid') throw new Error(`expected rows-invalid, got ${outcome.kind}`);
    expect([...outcome.messages.values()].join(' ')).toContain('CIDR');
  });

  it('reports a subnet with host bits set, naming the network to use instead', () => {
    const outcome = withRow({ cidr: '192.168.1.50/25' });
    if (outcome.kind !== 'rows-invalid') throw new Error(`expected rows-invalid, got ${outcome.kind}`);
    const message = [...outcome.messages.values()].join(' ');
    expect(message).toContain('192.168.1.0/25');
  });

  it('reports a blank name on a row that has other content', () => {
    const outcome = withRow({ name: '' });
    if (outcome.kind !== 'rows-invalid') throw new Error(`expected rows-invalid, got ${outcome.kind}`);
    expect(outcome.messages.size).toBe(1);
  });

  it('does NOT report a wholly blank row, so the table is not lit up on open', () => {
    // The draft opens with one blank row. Marking it would show "name this subnet" before
    // the user had done anything at all.
    const draft = { ...draftWith([['A', '192.168.1.0/25', '50']]), rows: [blankRow()] };
    const outcome = evaluatePlan(draft);
    expect(outcome.kind).toBe('ready');
  });

  it('leaves a blank row out of the plan entirely, so spare rows are not empty subnets', () => {
    // Four rows, one typed. The plan has one subnet. A blank row carried through as an
    // empty PlannedSubnet would reach the exporter and the database as a subnet with no
    // name and no block.
    const draft = { ...draftWith([['A', '192.168.1.0/25', '50']]), rows: [blankRow(), blankRow()] };
    expect(planOf(evaluatePlan(draft)).subnets).toHaveLength(0);
  });

  it('reports a row that is blank except for a VLAN the user is mid-way through typing', () => {
    // One field filled is one field filled - this is a row in progress, not an untouched
    // one, and the vlan is the thing that needs saying.
    const draft = { ...draftWith([['A', '192.168.1.0/25', '50']]), rows: [blankRow({ vlan: '10' })] };
    const outcome = evaluatePlan(draft);
    if (outcome.kind !== 'rows-invalid') throw new Error(`expected rows-invalid, got ${outcome.kind}`);
    expect(outcome.messages.size).toBe(1);
  });

  it('gives one message per row, keyed by row id', () => {
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50'],
      ['B', 'bad', '10'],
    ]);
    const outcome = evaluatePlan(draft);
    if (outcome.kind !== 'rows-invalid') throw new Error(`expected rows-invalid, got ${outcome.kind}`);
    expect(outcome.messages.size).toBe(1);
    expect(outcome.messages.has(draft.rows[1]!.id)).toBe(true);
  });

  it('shows only the first problem on a row with two', () => {
    // A bad CIDR *and* a bad host count: the CIDR message wins, because until the CIDR
    // reads, the host count has nothing to be measured against.
    const outcome = withRow({ cidr: 'nonsense', hosts: 'lots' });
    if (outcome.kind !== 'rows-invalid') throw new Error(`expected rows-invalid, got ${outcome.kind}`);
    expect(outcome.messages.size).toBe(1);
  });

  it('rejects a non-numeric host count rather than coercing it', () => {
    const outcome = withRow({ hosts: '1e3' });
    if (outcome.kind !== 'rows-invalid') throw new Error(`expected rows-invalid, got ${outcome.kind}`);
    expect([...outcome.messages.values()].join(' ')).toMatch(/whole number/i);
  });

  it('rejects a host count of zero', () => {
    const outcome = withRow({ hosts: '0' });
    if (outcome.kind !== 'rows-invalid') throw new Error(`expected rows-invalid, got ${outcome.kind}`);
  });

  it('asks for a custom role label when the role is CUSTOM, and ignores it otherwise', () => {
    expect(withRow({ role: 'CUSTOM', customRoleLabel: '' }).kind).toBe('rows-invalid');
    expect(withRow({ role: 'LAN', customRoleLabel: '' }).kind).toBe('ready');
  });

  it('keeps the custom role label on the saved plan, and only then', () => {
    const custom = withRow({ role: 'CUSTOM', customRoleLabel: '  Loading Dock  ' });
    expect(subnetAt(planOf(custom), 0).customRoleLabel).toBe('Loading Dock');

    const plain = withRow({ role: 'LAN', customRoleLabel: 'ignored' });
    // Carried on a LAN row it would be a second, conflicting source of role truth.
    expect('customRoleLabel' in subnetAt(planOf(plain), 0)).toBe(false);
  });

  it('rejects a VLAN ID outside the IEEE 802.1Q range', () => {
    for (const vlan of ['0', '4095', '4096', '-1']) {
      expect(withRow({ vlan }).kind, vlan).toBe('rows-invalid');
    }
  });

  it('accepts VLAN 1 and VLAN 4094, the boundaries', () => {
    expect(withRow({ vlan: '1' }).kind).toBe('ready');
    expect(withRow({ vlan: '4094' }).kind).toBe('ready');
  });

  it('treats a blank VLAN as untagged rather than as an error', () => {
    const outcome = withRow({ vlan: '' });
    expect(subnetAt(planOf(outcome), 0).vlanId).toBeUndefined();
  });
});

/* ================================================================== *
 * The gateway - the three-state field
 * ================================================================== */

describe('the gateway', () => {
  const gatewayDraft = (patch: Partial<SubnetRowDraft>): PlannerOutcome => {
    const draft = draftWith([['A', '192.168.1.0/25', '50']]);
    return evaluatePlan(updateRow(draft, draft.rows[0]!.id, patch));
  };

  it('auto-fills the first usable host when the mode is auto', () => {
    const outcome = gatewayDraft({});
    expect(subnetAt(planOf(outcome), 0).gateway).toBe('192.168.1.1');
  });

  it('derives the auto gateway from the engine, not by adding one to the network address', () => {
    // On a /31 the first usable host IS the network address (RFC 3021 makes both
    // addresses usable), and on a /32 it is the only address. A "+1" shortcut would produce
    // a gateway outside the subnet on both - a valid-looking plan that cannot be configured.
    const draft = draftWith([['Link', '192.168.1.0/31', '2']]);
    const outcome = evaluatePlan(draft);
    const subnet = subnetAt(planOf(outcome), 0);
    expect(subnet.gateway).toBe('192.168.1.0');
    expect(detailOf(outcome, draft.rows[0]!.id).subnet.isPointToPoint).toBe(true);
  });

  it('auto-fills a /32 host route with its single address', () => {
    const draft = draftWith([['Host', '192.168.1.7/32', '1']]);
    expect(subnetAt(planOf(evaluatePlan(draft)), 0).gateway).toBe('192.168.1.7');
  });

  it('keeps a typed gateway and stops auto-filling', () => {
    const draft = draftWith([['A', '192.168.1.0/25', '50']]);
    const id = draft.rows[0]!.id;
    const typed = updateRow(draft, id, { gateway: '192.168.1.10' });
    expect(typed.rows[0]!.gatewayMode).toBe('manual');
    expect(subnetAt(planOf(evaluatePlan(typed)), 0).gateway).toBe('192.168.1.10');
  });

  it('rejects a typed gateway outside its own subnet', () => {
    // The single most common structural mistake in a spreadsheet-turned plan.
    const outcome = gatewayDraft({ gateway: '10.0.0.1' });
    expect(outcome.kind).toBe('rows-invalid');
    if (outcome.kind !== 'rows-invalid') throw new Error('expected rows-invalid');
    expect([...outcome.messages.values()].join(' ')).toContain('192.168.1.0/25');
  });

  it('rejects a typed gateway on the network or broadcast address', () => {
    expect(gatewayDraft({ gateway: '192.168.1.0' }).kind).toBe('rows-invalid');
    expect(gatewayDraft({ gateway: '192.168.1.127' }).kind).toBe('rows-invalid');
  });

  it('omits the gateway entirely when the mode is none', () => {
    const draft = draftWith([['A', '192.168.1.0/25', '50']]);
    const id = draft.rows[0]!.id;
    const cleared = setGatewayMode(updateRow(draft, id, { gateway: '192.168.1.10' }), id, 'none');
    expect(cleared.rows[0]?.gatewayMode).toBe('none');
    expect('gateway' in subnetAt(planOf(evaluatePlan(cleared)), 0)).toBe(false);
  });

  it('keeps the mode at none across a CIDR change, instead of refilling', () => {
    // The whole reason `none` exists. Without it, clearing the gateway and then editing the
    // block would bring the gateway back, and a user who deliberately has no gateway on a
    // link would watch it reappear with no indication anything happened.
    const draft = draftWith([['A', '192.168.1.0/25', '50']]);
    const id = draft.rows[0]!.id;
    const cleared = setGatewayMode(draft, id, 'none');
    const moved = updateRow(cleared, id, { cidr: '192.168.1.128/25' });
    expect(moved.rows[0]?.gatewayMode).toBe('none');
    expect('gateway' in subnetAt(planOf(evaluatePlan(moved)), 0)).toBe(false);
  });

  it('keeps a manual gateway and reports it invalid when the block moves away from it', () => {
    // Not a reset to auto. The address is wrong now, and the honest report is that it is
    // wrong - not a silent replacement with a first-usable-host the user never asked for.
    const draft = draftWith([['A', '192.168.1.0/25', '50']]);
    const id = draft.rows[0]!.id;
    const typed = updateRow(draft, id, { gateway: '192.168.1.10' });
    const moved = updateRow(typed, id, { cidr: '192.168.1.128/25' });
    expect(moved.rows[0]?.gatewayMode).toBe('manual');
    expect(moved.rows[0]?.gateway).toBe('192.168.1.10');
    expect(evaluatePlan(moved).kind).toBe('rows-invalid');
  });

  it('does not read the gateway text at all when the mode is none', () => {
    // Otherwise a cleared field holding stale text would still be validated.
    const draft = draftWith([['A', '192.168.1.0/25', '50']]);
    const id = draft.rows[0]!.id;
    const cleared = updateRow(setGatewayMode(draft, id, 'none'), id, { gatewayMode: 'none' });
    expect(evaluatePlan(clear(cleared, id)).kind).toBe('ready');
  });
});

/**
 * Force a row back to `none` without going through `setGatewayMode`, whose own behaviour is
 * under test elsewhere. `updateRow` with an explicit `gatewayMode` skips the inference in
 * `applyPatchToRow`, so this leaves stale gateway text in place on purpose.
 */
const clear = (draft: PlanDraft, id: string): PlanDraft =>
  updateRow(draft, id, { gateway: 'not an address', gatewayMode: 'none' });

/* ================================================================== *
 * VLAN suggestions
 * ================================================================== */

describe('nextFreeVlanId', () => {
  it('suggests 1 on an empty plan', () => {
    expect(nextFreeVlanId([])).toBe(1);
  });

  it('skips a VLAN already taken', () => {
    const rows = [blankRow({ vlan: '1' }), blankRow({ vlan: '2' })];
    expect(nextFreeVlanId(rows)).toBe(3);
  });

  it('fills a gap rather than taking max + 1', () => {
    // `max + 1` leaves gaps looking arbitrary, and produces 4095 once a plan legitimately
    // reaches 4094 - a reserved value that would fail validation on the row it is put on.
    const rows = [blankRow({ vlan: '1' }), blankRow({ vlan: '10' })];
    expect(nextFreeVlanId(rows)).toBe(2);
  });

  it('does not let an untagged row consume an ID', () => {
    // A blank VLAN is "no VLAN", not "VLAN 0". Treating it as a claim would push the
    // suggestion up for no reason.
    const rows = [blankRow({ vlan: '' }), blankRow({ vlan: '' })];
    expect(nextFreeVlanId(rows)).toBe(1);
  });

  it('ignores a VLAN that does not parse, which is already reported on its row', () => {
    const rows = [blankRow({ vlan: '12x' })];
    expect(nextFreeVlanId(rows)).toBe(1);
  });

  it('never suggests 0 or 4095, the two reserved IDs', () => {
    // 0 means untagged/priority and 4095 is reserved (IEEE 802.1Q). A suggestion of either
    // would be rejected by the row's own validation, so the user would add a subnet, accept
    // the suggestion, and immediately get an error.
    const rows = Array.from({ length: 4093 }, (_, index) => blankRow({ vlan: String(index + 1) }));
    const suggested = nextFreeVlanId(rows);
    expect(suggested).toBe(4094);
    expect(suggested).not.toBe(0);
    expect(suggested).not.toBe(4095);
  });

  it('returns null when every ID in the range is taken', () => {
    // 4094 rows is absurd, but a function that cannot express "no ID left" will hand back
    // 4095, which is reserved, and the row it lands on will be rejected.
    const rows = Array.from({ length: 4094 }, (_, index) => blankRow({ vlan: String(index + 1) }));
    expect(nextFreeVlanId(rows)).toBeNull();
  });
});

/* ================================================================== *
 * THE EXIT CRITERION - overlap must be representable and flagged
 * ================================================================== */

describe('an overlapping plan', () => {
  /** Two rows claiming overlapping space, inside the parent. */
  const overlapping = (): PlanDraft =>
    draftWith([
      ['A', '192.168.1.0/24', '50'],
      ['B', '192.168.1.128/25', '10'],
    ]);

  it('produces a plan - the auditor has to be able to read one', () => {
    // THE assertion. If this fails, the Phase 8 exit criterion is not met: an overlap that
    // cannot be represented cannot be reported by Phase 11's auditor.
    const outcome = evaluatePlan(overlapping());
    expect(outcome.kind).toBe('ready');
  });

  it('keeps BOTH offending subnets on the plan, rather than dropping one', () => {
    // Dropping the loser would make the conflict invisible to anything reading the plan.
    const plan = planOf(evaluatePlan(overlapping()));
    expect(plan.subnets).toHaveLength(2);
    expect(plan.subnets.map((subnet) => subnet.cidr)).toEqual(['192.168.1.0/24', '192.168.1.128/25']);
  });

  it('flags the overlap at the point of creation, not later', () => {
    const findings = findingsOf(evaluatePlan(overlapping()));
    expect(findings.some((finding) => finding.kind === 'overlap')).toBe(true);
  });

  it('names both subnets in the overlap message', () => {
    const overlap = findingsOf(evaluatePlan(overlapping())).find((f) => f.kind === 'overlap');
    expect(overlap?.message).toContain('A');
    expect(overlap?.message).toContain('B');
    expect(overlap?.message).toContain('192.168.1.0/24');
    expect(overlap?.message).toContain('192.168.1.128/25');
  });

  it('attributes the overlap to BOTH rows', () => {
    // A one-sided finding leaves a reader fixing half a problem and still having one.
    const draft = overlapping();
    const overlap = findingsOf(evaluatePlan(draft)).find((f) => f.kind === 'overlap');
    expect([...(overlap?.rowIds ?? [])].sort()).toEqual([draft.rows[0]!.id, draft.rows[1]!.id].sort());
  });

  it('detects an overlap where one block contains the other', () => {
    // Containment is still an overlap. A /24 and a /25 inside it claim every address the
    // /25 claims, twice over.
    const findings = findingsOf(
      evaluatePlan(
        draftWith([
          ['Outer', '192.168.1.0/24', '50'],
          ['Inner', '192.168.1.0/28', '5'],
        ]),
      ),
    );
    expect(findings.some((f) => f.kind === 'overlap')).toBe(true);
  });

  it('finds that two aligned CIDR blocks can only overlap by containment, never by straddling', () => {
    // Two /24s at .0 and .1 do NOT overlap - they abut. It is tempting to write a test
    // asserting they do, and the engine is right to disagree: CIDR blocks are aligned
    // power-of-two ranges, so any two of them are either disjoint or one contains the
    // other. There is no third case.
    //
    // Pinned because it is the property that makes the containment test above sufficient.
    // If a future change let two partially-overlapping blocks through - a non-canonical
    // address, a host address in one of them - this is what would catch it.
    const abutting = draftWith([
      ['A', '192.168.0.0/24', '100'],
      ['B', '192.168.1.0/24', '100'],
    ]);
    expect(findingsByKind(abutting, 'overlap')).toHaveLength(0);

    const contained = draftWith([
      ['A', '192.168.0.0/23', '100'],
      ['B', '192.168.1.0/25', '100'],
    ]);
    expect(findingsByKind(contained, 'overlap')).toHaveLength(1);
  });

  it('reports each overlapping pair once, however many rows take part', () => {
    // Three rows all containing one address: three pairs, three messages. Not one message
    // ("it overlaps") and not six.
    const draft = draftWith([
      ['A', '192.168.1.0/24', '50'],
      ['B', '192.168.1.0/25', '10'],
      ['C', '192.168.1.0/26', '5'],
    ]);
    expect(countFindings(draft, 'overlap')).toBe(3);
  });

  it('finds no overlap between adjacent, abutting blocks', () => {
    // The negative control. An overlap check that fires on every pair is worse than none.
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
      ['C', '192.168.1.128/26', '50'],
    ]);
    expect(findingsByKind(draft, 'overlap')).toHaveLength(0);
  });

  it('still resolves every derived column for an overlapping row', () => {
    // An overlap is a plan-level finding. The rows themselves are fine, so the read-only
    // columns must still be populated - a view model that blanks them would make the
    // overlap impossible to investigate.
    const draft = overlapping();
    const detail = detailOf(evaluatePlan(draft), draft.rows[1]!.id);
    expect(detail.subnet.usableHosts).toBe(126);
  });

  it('detects a duplicate VLAN even when the subnets do not overlap', () => {
    // VLAN reuse is a different mistake from address reuse, and both are worth reporting.
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50', '10'],
      ['B', '192.168.1.64/26', '50', '10'],
    ]);
    const duplicates = findingsByKind(draft, 'duplicate-vlan');
    expect(duplicates).toHaveLength(1);
    const duplicate = duplicates[0];
    expect(duplicate?.message).toContain('VLAN 10');
    expect(duplicate?.message).toContain('A');
    expect(duplicate?.message).toContain('B');
  });

  it('does not report a VLAN as duplicated when only one row has it', () => {
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50', '10'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    expect(findingsByKind(draft, 'duplicate-vlan')).toHaveLength(0);
  });

  it('flags a subnet outside the parent, and keeps it on the plan', () => {
    const draft = draftWith([['Away', '10.9.9.0/24', '50']]);
    const outcome = evaluatePlan(draft);
    expect(planOf(outcome).subnets).toHaveLength(1);
    expect(findingsOf(outcome).some((f) => f.kind === 'outside-parent')).toBe(true);
  });

  it('does not flag a subnet that touches the parent boundary as outside it', () => {
    // A subnet that starts on the parent's network address is inside it. An off-by-one
    // here would flag every correctly-packed plan.
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.192/26', '50'],
    ]);
    expect(findingsByKind(draft, 'outside-parent')).toHaveLength(0);
  });

  it('flags a subnet whose broadcast address escapes the parent, not just one that starts outside', () => {
    // The parent has to be mid-block for this case to exist. With a /24 parent, every /25
    // inside it either fits or starts outside - a subnet that begins inside a /24 always
    // ends inside it too, because aligned blocks cannot straddle. Against a /25 parent,
    // the /24 begins exactly on the parent's network address and runs 128 addresses past
    // its end, which a "does it start inside" check would wave through.
    const findings = findingsOf(
      evaluatePlan(draftWith([['Straddle', '192.168.1.0/24', '50']], '192.168.1.0/25')),
    );
    expect(findings.some((f) => f.kind === 'outside-parent')).toBe(true);
  });
});

/* ================================================================== *
 * Row mutation
 * ================================================================== */

describe('row mutation', () => {
  const threeRows = (): PlanDraft =>
    draftWith([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
      ['C', '192.168.1.128/26', '50'],
    ]);

  it('mints a unique id per row', () => {
    const draft = addRow(addRow(initialPlanDraft()));
    expect(new Set(draft.rows.map((row) => row.id)).size).toBe(3);
  });

  it('gives a constructed row a gateway mode that agrees with its gateway text', () => {
    // Otherwise `blankRow({ gateway: '192.168.1.10' })` builds a row that carries an
    // address nothing will ever read - a value that vanishes with no message anywhere.
    expect(blankRow({ gateway: '192.168.1.10' }).gatewayMode).toBe('manual');
    expect(blankRow({ gateway: '' }).gatewayMode).toBe('none');
  });

  it('lets an explicit gateway mode in the seed win over the inferred one', () => {
    // A caller that means "this row has no gateway, and the empty text is a placeholder"
    // must not be second-guessed into `none` and back.
    const row = blankRow({ gateway: '192.168.1.10', gatewayMode: 'auto' });
    expect(row.gatewayMode).toBe('auto');
  });

  it('mints ids that are stable across reads, so React keys do not churn', () => {
    const draft = initialPlanDraft();
    expect(draft.rows[0]!.id).toBe(draft.rows[0]!.id);
  });

  it('appends a seeded row and discards the seed id', () => {
    // A reusable template row keeps its id, and two rows sharing one would make React
    // reconcile the wrong one.
    const seed = blankRow({ name: 'Servers', id: 'template' });
    const draft = addRow(initialPlanDraft(), seed);
    const last = draft.rows[draft.rows.length - 1];
    expect(last?.name).toBe('Servers');
    expect(last?.id).not.toBe('template');
  });

  it('removes only the named row', () => {
    const draft = threeRows();
    const gone = removeRow(draft, draft.rows[1]!.id);
    expect(gone.rows.map((row) => row.name)).toEqual(['A', 'C']);
  });

  it('ignores a remove for an unknown id rather than throwing', () => {
    const draft = threeRows();
    expect(removeRow(draft, 'nope').rows).toHaveLength(3);
  });

  it('ignores an update for an unknown id rather than throwing', () => {
    const draft = threeRows();
    expect(updateRow(draft, 'nope', { name: 'X' }).rows[0]?.name).toBe('A');
  });

  it('moves a row down', () => {
    const draft = threeRows();
    expect(moveRow(draft, draft.rows[0]!.id, 1).rows.map((row) => row.name)).toEqual([
      'B',
      'A',
      'C',
    ]);
  });

  it('moves a row up', () => {
    const draft = threeRows();
    expect(moveRow(draft, draft.rows[2]!.id, -1).rows.map((row) => row.name)).toEqual([
      'A',
      'C',
      'B',
    ]);
  });

  it('is a no-op at the top and the bottom, rather than throwing', () => {
    // The screen disables the buttons, but a keyboard or screen-reader user can reach the
    // action without seeing a disabled control. Throwing would crash the screen.
    const draft = threeRows();
    const top = draft.rows[0]!.id;
    const bottom = draft.rows[2]!.id;
    expect(moveRow(draft, top, -1).rows.map((row) => row.name)).toEqual(['A', 'B', 'C']);
    expect(moveRow(draft, bottom, 1).rows.map((row) => row.name)).toEqual(['A', 'B', 'C']);
  });

  it('never mutates the draft it was given', () => {
    const draft = threeRows();
    const before = JSON.stringify(draft);
    moveRow(draft, draft.rows[0]!.id, 1);
    removeRow(draft, draft.rows[0]!.id);
    updateRow(draft, draft.rows[0]!.id, { name: 'Changed' });
    addRow(draft);
    expect(JSON.stringify(draft)).toBe(before);
  });
});

/* ================================================================== *
 * The resolved plan
 * ================================================================== */

describe('the resolved plan', () => {
  it('numbers subnets by their position in the draft', () => {
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    const plan = planOf(evaluatePlan(draft));
    expect(plan.subnets.map((subnet) => subnet.sortOrder)).toEqual([0, 1]);
  });

  it('carries the profile through', () => {
    const draft = updateHeader(draftWith([['A', '192.168.1.0/26', '50']]), { profile: 'personal' });
    expect(planOf(evaluatePlan(draft)).profile).toBe('personal');
  });

  it('records no creation time, because a draft has no identity yet', () => {
    // Phase 9 mints the id and stamps the times. A plausible-looking timestamp here would be
    // inventing a record that does not exist.
    const plan = planOf(evaluatePlan(draftWith([['A', '192.168.1.0/26', '50']])));
    expect(plan.createdAt).toBe(0);
    expect(plan.id).toBe('draft');
  });

  it('carries the requested host count as typed, not as the block size', () => {
    // Utilisation is measured against what the user asked for, so storing the block size
    // would make every subnet read as 100% used.
    const plan = planOf(evaluatePlan(draftWith([['A', '192.168.1.0/25', '50']])));
    expect(subnetAt(plan, 0).requestedHosts).toBe(50);
  });

  it('stores each CIDR in canonical network form', () => {
    // A row cannot be typed non-canonically (the boundary rule rejects it), so this is
    // belt-and-braces - but it is the property the export and the persistence layer assume.
    const plan = planOf(evaluatePlan(draftWith([['A', '192.168.1.0/26', '50']])));
    expect(subnetAt(plan, 0).cidr).toBe('192.168.1.0/26');
  });

  it('resolves a row detail per row, keyed by row id', () => {
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    const outcome = evaluatePlan(draft);
    for (const row of draft.rows) {
      expect(outcome.kind === 'ready' && outcome.details.has(row.id)).toBe(true);
    }
  });

  it('agrees with the engine about every resolved subnet', () => {
    // The property this whole project rests on: the view model never re-derives an
    // address. Compared against a second call into the engine rather than a hardcoded
    // copy, so it keeps working if the engine is ever corrected.
    const draft = draftWith([['A', '192.168.1.0/25', '50'], ['B', '192.168.1.128/26', '20']]);
    const outcome = evaluatePlan(draft);
    for (const subnet of planOf(outcome).subnets) {
      const engineSubnet = calculateSubnet(parseCidr(subnet.cidr).ip, parseCidr(subnet.cidr).prefix);
      const detail = detailOf(outcome, subnet.id);
      expect(detail.subnet.networkAddress).toBe(engineSubnet.networkAddress);
      expect(detail.subnet.broadcastAddress).toBe(engineSubnet.broadcastAddress);
      expect(detail.gateway).toBe(integerToIPv4(engineSubnet.firstUsableHost));
    }
  });
});
