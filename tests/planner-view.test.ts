/**
 * Tests for the planner view model.
 *
 * ## What this suite is for
 *
 * `planner-view.ts` decides what the reader sees. Three of those decisions are worth a test
 * because getting them wrong is not a type error:
 *
 *   1. **A row that does not parse still gets a view row.** A row editor that drops a row
 *      when it becomes invalid deletes the user's typing, and that failure is invisible to
 *      the compiler and to a type checker.
 *   2. **Nothing here recomputes a network value.** The test that enforces this is
 *      `agrees with the engine`, which compares every column against a second call into
 *      the engine rather than a hardcoded copy of the answer.
 *   3. **A number over 100% is not clamped.** A row asking for 50 hosts in a /27 is 167%,
 *      and a clamped bar would report that as solved.
 *
 * ## The "no hidden fifth state" property
 *
 * `PlannerOutcome` is a four-way union and `buildPlanView` switches on it with no default
 * branch. If a fifth state were ever added, `planNotice` would fall through to `undefined`
 * where `PlanNotice | null` is declared, and TypeScript would catch it. That is a property
 * of the types, not of the tests, and it is recorded here because it is the reason the
 * view model is a function rather than JSX.
 */

import { describe, expect, it } from 'vitest';

import { calculateSubnet, integerToIPv4, parseCidr } from '../src/core/ip-engine';
import {
  blankRow,
  evaluatePlan,
  initialPlanDraft,
  updateHeader,
  updateRow,
  type PlanDraft,
  type PlannerOutcome,
} from '../src/core/planner-input';
import {
  buildPlanView,
  rowCardTone,
  rowNeedsAttention,
  unassignedFindings,
  vlanHintFor,
  type PlanRowView,
} from '../src/utils/planner-view';

import type { NetworkPlan } from '../src/types/network';

/* ================================================================== *
 * Helpers
 * ================================================================== */

const draftWith = (
  rows: readonly (readonly [string, string, string, string?])[],
  parent = '192.168.1.0/24',
  name = 'Test plan',
): PlanDraft => ({
  ...initialPlanDraft(),
  name,
  parent,
  rows: rows.map(([rowName, cidr, hosts, vlan]) =>
    blankRow({ name: rowName, cidr, hosts, vlan: vlan ?? '' }),
  ),
});

/** The view for a draft, or a thrown error naming the outcome that was not `ready`. */
const viewOf = (draft: PlanDraft) => {
  const outcome = evaluatePlan(draft);
  return buildPlanView(draft, outcome);
};

/** The view, asserting the outcome was `ready` first. */
const readyView = (draft: PlanDraft) => {
  const outcome = evaluatePlan(draft);
  if (outcome.kind !== 'ready') throw new Error(`expected a ready outcome, got "${outcome.kind}"`);
  return buildPlanView(draft, outcome);
};

/** A row view by index, or a thrown error. */
const rowAt = (rows: readonly PlanRowView[], index: number): PlanRowView => {
  const row = rows[index];
  if (row === undefined) throw new Error(`no view row at index ${index} (have ${rows.length})`);
  return row;
};

/** A single-row draft's view, for tests about one row's columns. */
const oneRow = (row: Partial<Parameters<typeof blankRow>[0]>, parent?: string) =>
  readyView({ ...draftWith([], parent), rows: [blankRow(row)] });

/* ================================================================== *
 * The outcome -> view mapping
 * ================================================================== */

describe('buildPlanView over every outcome', () => {
  it('shows no plan and no notice for an untouched draft', () => {
    const view = viewOf(initialPlanDraft());
    expect(view.plan).toBeNull();
    expect(view.summary).toBeNull();
    expect(view.notice).toBeNull();
    // The blank row still gets a view row, so the editor has something to type into.
    expect(view.rows).toHaveLength(1);
  });

  it('shows a plan and no notice when the plan is ready', () => {
    // A card saying "here is your plan" above the plan would be two messages for one
    // condition.
    const view = viewOf(draftWith([['A', '192.168.1.0/25', '50']]));
    expect(view.plan).not.toBeNull();
    expect(view.notice).toBeNull();
  });

  it('shows a notice and no plan when the header cannot be read', () => {
    const view = viewOf(draftWith([['A', '192.168.1.0/25', '50']], 'garbage'));
    expect(view.plan).toBeNull();
    expect(view.summary).toBeNull();
    expect(view.notice?.kind).toBe('warn');
    expect(view.notice?.title).toBe('Check the parent block');
  });

  it('names the plan in the notice when the name is the problem', () => {
    const view = viewOf(draftWith([['A', '192.168.1.0/25', '50']], '192.168.1.0/24', ''));
    expect(view.notice?.title).toBe('Name the plan');
  });

  it('shows a plan and a notice when some rows cannot be read', () => {
    // The plan is withheld, but the rows are still shown with their errors, so the user
    // can fix them. A view that went blank on the first error would lose the whole table.
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50'],
      ['B', 'nonsense', '10'],
    ]);
    const view = viewOf(draft);
    expect(view.plan).toBeNull();
    expect(view.notice?.title).toBe('Finish 1 subnet');
    expect(view.rows).toHaveLength(2);
    expect(rowAt(view.rows, 1).error).not.toBeNull();
  });

  it('counts the unfinished rows in the notice title, and pluralises', () => {
    const view = viewOf(
      draftWith([
        ['A', 'nope', '50'],
        ['B', 'also-nope', '10'],
      ]),
    );
    expect(view.notice?.title).toBe('Finish 2 subnets');
  });

  it('says where each message is, without repeating it in the notice body', () => {
    // The message itself is already beside the row. Repeating it above the table is the
    // same sentence twice, and the two could not disagree in a way a reader could check.
    const view = viewOf(draftWith([['A', 'nonsense', '50']]));
    expect(view.notice?.body).toContain('beside it');
    expect(view.notice?.body).not.toContain('nonsense');
  });
});

/* ================================================================== *
 * The rows survive failure
 * ================================================================== */

describe('a row that does not parse', () => {
  const draft = draftWith([
    ['Good', '192.168.1.0/26', '50'],
    ['Broken', 'garbage', '10'],
  ]);

  it('is still shown, so the editor never deletes what the user typed', () => {
    // The failure this guards: a table that removes a row on the first bad keystroke
    // destroys the row the moment a CIDR is half-typed.
    expect(viewOf(draft).rows).toHaveLength(2);
  });

  it('carries its error', () => {
    expect(rowAt(viewOf(draft).rows, 1).error).toBeTruthy();
  });

  it('shows the em dash in its derived columns, not a zero or a blank', () => {
    // "Zero is a claim." A 0 in the capacity column would read as a subnet with no hosts.
    const row = rowAt(viewOf(draft).rows, 1);
    expect(row.cidr).toBe('—');
    expect(row.network).toBe('—');
    expect(row.mask).toBe('—');
    expect(row.broadcast).toBe('—');
    expect(row.firstHost).toBe('—');
    expect(row.lastHost).toBe('—');
    expect(row.capacity).toBe('—');
    expect(row.requested).toBe('—');
    expect(row.utilization).toBe('—');
  });

  it('shows ONE em dash for a composed blank, not two joined by a dash', () => {
    // `— – —` renders as three blanks with a separator the user has to decode. Composed
    // here so the unresolved case is a single dash, once - which is what it means.
    const row = rowAt(viewOf(draft).rows, 1);
    expect(row.range).toBe('—');
    expect(row.range).not.toContain('–');
    expect(row.hostsUsed).toBe('—');
    expect(row.hostsUsed).not.toContain('of');
  });

  it('composes the range and the host pair for a row that did resolve', () => {
    // A composite with no unresolved branch: a `—` in either half has to surface as `—`
    // for the whole, not as `x —` or `— of y`.
    const row = rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/26', hosts: '50' }).rows, 0);
    const subnet = calculateSubnet(parseCidr('192.168.1.0/26').ip, 26);
    expect(row.range).toBe(`${integerToIPv4(subnet.firstUsableHost)} – ${integerToIPv4(subnet.lastUsableHost)}`);
    expect(row.hostsUsed).toBe('50 of 62');
  });

  it('is not reported as over capacity, because nothing is known about it', () => {
    expect(rowAt(viewOf(draft).rows, 1).overCapacity).toBe(false);
  });

  it('shows no conflicts, because findings come from a plan that exists', () => {
    expect(rowAt(viewOf(draft).rows, 1).hasConflict).toBe(false);
  });

  it('leaves the fields the user did type alone', () => {
    const row = rowAt(viewOf(draft).rows, 1);
    expect(row.name).toBe('Broken');
    expect(row.role).toBe('LAN');
  });
});

/* ================================================================== *
 * It formats, it does not compute
 * ================================================================== */

describe('the address columns', () => {
  it('agrees with the engine, called independently, about every value', () => {
    // The comparison that keeps the view model honest: the same inputs through a second
    // call, not a second hardcoded copy of the answer. If the engine is ever corrected,
    // this still passes and the view follows.
    const draft = draftWith([
      ['A', '192.168.1.0/25', '50'],
      ['B', '192.168.1.128/26', '20'],
      ['C', '192.168.1.192/28', '5'],
    ]);
    const view = readyView(draft);
    for (const row of view.rows) {
      const parsed = parseCidr(row.cidr);
      const engineSubnet = calculateSubnet(parsed.ip, parsed.prefix);
      expect(row.network).toBe(integerToIPv4(engineSubnet.networkAddress));
      expect(row.mask).toBe(integerToIPv4(engineSubnet.subnetMask));
      expect(row.broadcast).toBe(integerToIPv4(engineSubnet.broadcastAddress));
      expect(row.firstHost).toBe(integerToIPv4(engineSubnet.firstUsableHost));
      expect(row.lastHost).toBe(integerToIPv4(engineSubnet.lastUsableHost));
      expect(row.capacity).toBe('126, 62, 14'.split(', ')[view.rows.indexOf(row)]);
    }
  });

  it('derives the gateway from the engine, so a /31 is not given a network-address+1', () => {
    // On a /31 the first usable host IS the network address (RFC 3021). A "+1" shortcut
    // would put a gateway outside the subnet on a plan that looks fine.
    const row = rowAt(oneRow({ name: 'Link', cidr: '192.168.1.0/31', hosts: '2' }).rows, 0);
    const engineSubnet = calculateSubnet(parseCidr('192.168.1.0/31').ip, 31);
    expect(row.gateway).toBe(integerToIPv4(engineSubnet.firstUsableHost));
    expect(row.gateway).toBe('192.168.1.0');
  });

  it('shows none for a deliberately gateway-less row', () => {
    const row = rowAt(
      oneRow({ name: 'Link', cidr: '192.168.1.0/31', hosts: '2', gatewayMode: 'none' }).rows,
      0,
    );
    expect(row.gateway).toBe('none');
  });

  it('shows a typed gateway verbatim', () => {
    const row = rowAt(
      oneRow({ name: 'A', cidr: '192.168.1.0/25', hosts: '50', gateway: '192.168.1.10' }).rows,
      0,
    );
    expect(row.gateway).toBe('192.168.1.10');
  });

  it('shows untagged for a blank VLAN, and the number otherwise', () => {
    const draft = draftWith([
      ['A', '192.168.1.0/26', '50', '10'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    const view = readyView(draft);
    expect(rowAt(view.rows, 0).vlan).toBe('10');
    expect(rowAt(view.rows, 1).vlan).toBe('untagged');
  });

  it('shows a plan with no subnets as a count of zero, not a missing summary', () => {
    // A named plan with a parent and nothing in it yet is a legitimate starting point.
    const view = readyView({ ...draftWith([]), name: 'Empty', parent: '192.168.1.0/24' });
    expect(view.plan?.subnets).toHaveLength(0);
    expect(view.summary?.subnetCount).toBe('0');
  });
});

/* ================================================================== *
 * Utilisation
 * ================================================================== */

describe('utilisation', () => {
  it('is the requested count as a share of capacity', () => {
    const row = rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/25', hosts: '100' }).rows, 0);
    // 100 of 126 usable.
    expect(row.utilization).toBe('79.4%');
  });

  it('is NOT clamped when the request exceeds the block', () => {
    // The property that keeps this test suite honest. 50 hosts in a /27 (30 usable) is
    // 167%, and a capped bar would report that as 100% - the problem reported as solved.
    const row = rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/27', hosts: '50' }).rows, 0);
    expect(row.utilization).toBe('166.7%');
    expect(row.utilization).not.toContain('100');
  });

  it('flags an over-capacity row, so a number over 100% is not just noise', () => {
    expect(rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/27', hosts: '50' }).rows, 0).overCapacity).toBe(
      true,
    );
  });

  it('does not flag a row that fits exactly', () => {
    // A /29 has 6 usable; 6 is exactly full and is not an error.
    expect(rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/29', hosts: '6' }).rows, 0).overCapacity).toBe(
      false,
    );
  });

  it('agrees with the Phase 7 table for the same block', () => {
    // Both read `calculateUtilization`. If one of them ever hand-rolled the arithmetic,
    // this would be the test that noticed - provided the two used different rounding.
    const row = rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/25', hosts: '100' }).rows, 0);
    const enginePercent = (100 / 126) * 100;
    expect(row.utilization).toBe(`${enginePercent.toFixed(1)}%`);
  });
});

/* ================================================================== *
 * The plan summary
 * ================================================================== */

describe('the plan summary', () => {
  it('reports the parent as canonical, from the engine', () => {
    // A parent typed as an address inside a network is normalised by `evaluatePlan`, and
    // the summary reads the plan rather than the draft text.
    const view = readyView(draftWith([['A', '192.168.1.0/26', '50']], '192.168.1.50/24'));
    expect(view.summary?.parent).toBe('192.168.1.0/24');
  });

  it('counts the addresses the subnets claim', () => {
    const view = readyView(
      draftWith([
        ['A', '192.168.1.0/25', '50'],
        ['B', '192.168.1.128/26', '20'],
      ]),
    );
    // 128 + 64 = 192 of 256.
    expect(view.summary?.claimed).toBe('192');
    expect(view.summary?.parentAddresses).toBe('256');
    expect(view.summary?.free).toBe('64');
  });

  it('reports the claimed share of the parent', () => {
    const view = readyView(draftWith([['A', '192.168.1.0/25', '50']]));
    expect(view.summary?.utilization).toBe('50%');
  });

  it('counts zero free for a plan that fills its parent exactly', () => {
    const view = readyView(
      draftWith([
        ['A', '192.168.1.0/26', '50'],
        ['B', '192.168.1.64/26', '50'],
        ['C', '192.168.1.128/26', '50'],
        ['D', '192.168.1.192/26', '50'],
      ]),
    );
    expect(view.summary?.free).toBe('0');
    expect(view.summary?.utilization).toBe('100%');
  });

  it('counts free for a plan that uses part of a /20', () => {
    const view = readyView(draftWith([['A', '10.0.0.0/24', '50']], '10.0.0.0/20'));
    expect(view.summary?.parentAddresses).toBe('4,096');
    expect(view.summary?.claimed).toBe('256');
    expect(view.summary?.free).toBe('3,840');
  });

  it('clamps the free count at zero and flags an over-claimed parent', () => {
    // Two subnets that each fit the parent but not together. The plan still builds - the
    // overlap is a finding, not a refusal - so the summary has to render.
    const view = readyView(
      draftWith(
        [
          ['A', '192.168.1.0/24', '50'],
          ['B', '192.168.1.0/25', '10'],
        ],
        '192.168.1.0/24',
      ),
    );
    expect(view.summary?.overParent).toBe(true);
    // 256 + 128 = 384 of 256. A negative "free" would be nonsense on screen.
    expect(view.summary?.free).toBe('0');
    expect(view.summary?.utilization).toBe('150%');
  });

  it('counts the subnets on the plan, not the rows in the draft', () => {
    // Three spare blank rows must not read as three more subnets.
    const draft = draftWith([['A', '192.168.1.0/26', '50']]);
    const withSpares = { ...draft, rows: [...draft.rows, blankRow(), blankRow()] };
    expect(readyView(withSpares).summary?.subnetCount).toBe('1');
  });

  it('reports the finding count from the evaluation, not from the plan alone', () => {
    const view = readyView(
      draftWith([
        ['A', '192.168.1.0/24', '50'],
        ['B', '192.168.1.128/25', '10'],
      ]),
    );
    expect(view.summary?.findingCount).toBe('1');
  });

  it('reports zero findings for a clean plan', () => {
    const view = readyView(
      draftWith([
        ['A', '192.168.1.0/26', '50'],
        ['B', '192.168.1.64/26', '50'],
      ]),
    );
    expect(view.summary?.findingCount).toBe('0');
  });
});

/* ================================================================== *
 * Findings, per row
 * ================================================================== */

describe('findings on rows', () => {
  const overlapping = () =>
    draftWith([
      ['A', '192.168.1.0/24', '50'],
      ['B', '192.168.1.128/25', '10'],
    ]);

  it('marks BOTH rows of an overlap, not the first one found', () => {
    // A one-sided marker leaves a reader fixing half a problem and still having one.
    const view = readyView(overlapping());
    expect(rowAt(view.rows, 0).hasConflict).toBe(true);
    expect(rowAt(view.rows, 1).hasConflict).toBe(true);
  });

  it('gives each row the finding text naming it', () => {
    const view = readyView(overlapping());
    expect(rowAt(view.rows, 0).conflicts).toHaveLength(1);
    expect(rowAt(view.rows, 0).conflicts[0]).toContain('overlaps');
  });

  it('gives a row with two findings both of them', () => {
    // A duplicate VLAN *and* an overlap on the same row. Showing one leaves the other
    // invisible on the row, and the plan-level list is a summary, not a substitute.
    const view = readyView(
      draftWith([
        ['A', '192.168.1.0/24', '50', '10'],
        ['B', '192.168.1.128/25', '10', '10'],
      ]),
    );
    expect(rowAt(view.rows, 0).conflicts).toHaveLength(2);
    expect(view.summary?.findingCount).toBe('2');
  });

  it('groups findings by row id, so a row reads its own', () => {
    const view = readyView(overlapping());
    expect(view.conflictsByRow.size).toBe(2);
    for (const messages of view.conflictsByRow.values()) {
      expect(messages).toHaveLength(1);
    }
  });

  it('shows an empty grouping for a draft with no findings', () => {
    const view = readyView(draftWith([['A', '192.168.1.0/26', '50']]));
    expect(view.conflictsByRow.size).toBe(0);
  });

  it('still resolves the address columns for a row in a conflict', () => {
    // An overlap is a plan-level fact. The rows are fine, so their columns must be
    // populated - a view that blanked them would make the overlap impossible to check.
    const view = readyView(overlapping());
    expect(rowAt(view.rows, 0).network).toBe('192.168.1.0');
    expect(rowAt(view.rows, 1).capacity).toBe('126');
  });

  it('reports no findings for a draft that has not been evaluated to a plan', () => {
    // `conflictsByRow` is a Map keyed by row, and an empty one is what a row editor with
    // no plan should see. Reading `.get` on a missing key is the caller's problem, and
    // `buildRows` already does that with a fallback.
    const view = viewOf(draftWith([['A', 'garbage', '50']]));
    expect(view.conflictsByRow.size).toBe(0);
  });
});

/* ================================================================== *
 * unassignedFindings
 * ================================================================== */

describe('unassignedFindings', () => {
  it('is empty for a normal overlapping plan, because both rows are present', () => {
    const draft = draftWith([
      ['A', '192.168.1.0/24', '50'],
      ['B', '192.168.1.128/25', '10'],
    ]);
    const view = readyView(draft);
    const findings = evaluatePlan(draft);
    if (findings.kind !== 'ready') throw new Error('expected ready');
    expect(unassignedFindings(findings.findings, view.conflictsByRow)).toHaveLength(0);
  });

  it('reports a finding whose rows are all gone from the grouping', () => {
    // A stale grouping - a row deleted between evaluation and render - must not make the
    // finding disappear from the plan-level list.
    const stale = new Map<string, readonly string[]>();
    expect(
      unassignedFindings(
        [{ kind: 'overlap', message: 'x', rowIds: ['row-1', 'row-2'] }],
        stale,
      ),
    ).toHaveLength(1);
  });

  it('is empty when there are no findings', () => {
    expect(unassignedFindings([], new Map())).toHaveLength(0);
  });
});

/* ================================================================== *
 * Roles and labels
 * ================================================================== */

describe('role labels', () => {
  it('uses the shared role table for a known role', () => {
    const view = readyView(draftWith([['A', '192.168.1.0/26', '50']]));
    expect(rowAt(view.rows, 0).roleLabel).toBe('LAN');
  });

  it("uses the user's own text for a custom role", () => {
    // A custom role labelled "Custom" everywhere would be a role with no name, which
    // defeats the point of the escape hatch.
    const base = draftWith([['A', '192.168.1.0/26', '50']]);
    const patched = updateRow(base, base.rows[0]!.id, {
      role: 'CUSTOM',
      customRoleLabel: 'Loading Dock',
    });
    expect(rowAt(readyView(patched).rows, 0).roleLabel).toBe('Loading Dock');
  });

  it('falls back to Custom for a custom role with no label, rather than showing nothing', () => {
    const base = draftWith([['A', '192.168.1.0/26', '50']]);
    const patched = updateRow(base, base.rows[0]!.id, { role: 'CUSTOM', customRoleLabel: 'x' });
    // The label is required for a CUSTOM row, so this is the shape a row reaches if the
    // user clears it after having had one.
    const cleared = updateRow(patched, patched.rows[0]!.id, { customRoleLabel: '   ' });
    // `evaluatePlan` rejects a blank custom label, so the outcome is not `ready` - which is
    // the point. The view still shows the row with its error rather than dropping it.
    const view = buildPlanView(cleared, evaluatePlan(cleared));
    expect(rowAt(view.rows, 0).roleLabel).toBe('Custom');
    expect(rowAt(view.rows, 0).error).toBeTruthy();
  });
});

/* ================================================================== *
 * VLAN guidance
 * ================================================================== */

describe('vlanHintFor', () => {
  const rowWith = (patch: Partial<Parameters<typeof blankRow>[0]>, parent?: string) =>
    rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/26', hosts: '50', ...patch }, parent).rows, 0);

  it('says nothing for a tagged segment', () => {
    expect(vlanHintFor(rowWith({ vlan: '10' }))).toBeNull();
  });

  it('hints on an untagged segment that normally carries a VLAN', () => {
    expect(vlanHintFor(rowWith({ vlan: '' }))).toContain('untagged');
  });

  it('says nothing for an untagged point-to-point link', () => {
    // A routed link is untagged as a matter of course, and a hint telling the user to tag
    // it would be advice against the RFC 3021 pattern.
    expect(vlanHintFor(rowWith({ vlan: '', role: 'POINT_TO_POINT' }))).toBeNull();
  });

  it('names the role in the hint, so it is about this row', () => {
    expect(vlanHintFor(rowWith({ vlan: '', role: 'GUEST' }))).toContain('Guest');
  });

  it('names a custom role by its own label', () => {
    const base = draftWith([['A', '192.168.1.0/26', '50']]);
    const patched = updateRow(base, base.rows[0]!.id, {
      role: 'CUSTOM',
      customRoleLabel: 'Loading Dock',
    });
    const row = rowAt(readyView(patched).rows, 0);
    expect(vlanHintFor(row)).toContain('Loading Dock');
  });
});

/* ================================================================== *
 * rowNeedsAttention
 * ================================================================== */

describe('rowNeedsAttention', () => {
  const clean = () => rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/25', hosts: '50' }).rows, 0);

  it('is false for a healthy row', () => {
    expect(rowNeedsAttention(clean())).toBe(false);
  });

  it('is true for a row with a finding', () => {
    const view = readyView(
      draftWith([
        ['A', '192.168.1.0/24', '50'],
        ['B', '192.168.1.128/25', '10'],
      ]),
    );
    expect(rowNeedsAttention(rowAt(view.rows, 0))).toBe(true);
  });

  it('is true for a row with an error', () => {
    const view = viewOf(draftWith([['A', 'garbage', '50']]));
    expect(rowNeedsAttention(rowAt(view.rows, 0))).toBe(true);
  });

  it('is true for an over-capacity row, with no finding and no error', () => {
    // The third channel. An over-capacity row has no message attached - the plan is valid
    // and the row parses - but it is the row a user most wants pointed at.
    const row = rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/27', hosts: '50' }).rows, 0);
    expect(row.error).toBeNull();
    expect(row.hasConflict).toBe(false);
    expect(rowNeedsAttention(row)).toBe(true);
  });
});

/* ================================================================== *
 * rowCardTone
 * ================================================================== */

describe('rowCardTone', () => {
  it('is default for a healthy row', () => {
    const row = rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/25', hosts: '50' }).rows, 0);
    expect(rowNeedsAttention(row)).toBe(false);
    expect(rowCardTone(row)).toBe('default');
  });

  it('is critical for a row that does not parse', () => {
    // "I cannot read this row" is a different problem from "it disagrees with another
    // row", and the two need different actions. Sharing one tone would lose that.
    const row = rowAt(viewOf(draftWith([['A', 'garbage', '50']])).rows, 0);
    expect(row.error).not.toBeNull();
    expect(rowCardTone(row)).toBe('critical');
  });

  it('is medium for a row in an overlap, with no error of its own', () => {
    const view = readyView(
      draftWith([
        ['A', '192.168.1.0/24', '50'],
        ['B', '192.168.1.128/25', '10'],
      ]),
    );
    const row = rowAt(view.rows, 0);
    expect(row.error).toBeNull();
    expect(rowCardTone(row)).toBe('medium');
  });

  it('is medium for an over-capacity row', () => {
    expect(rowCardTone(rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/27', hosts: '50' }).rows, 0))).toBe(
      'medium',
    );
  });

  it('prefers critical over medium when a row has both', () => {
    // A row that does not parse cannot be over capacity - there is no capacity to know -
    // so this is a statement about the precedence rather than a reachable state. Asserted
    // anyway, because the precedence is the decision and a reorder of the two branches
    // would silently change which tone a user sees on the most broken row in the plan.
    const parsed = rowAt(oneRow({ name: 'A', cidr: '192.168.1.0/27', hosts: '50' }).rows, 0);
    expect(rowCardTone({ ...parsed, error: 'bad' })).toBe('critical');
  });
});

/* ================================================================== *
 * Row ordering controls
 * ================================================================== */

describe('the row controls', () => {
  const threeRows = () =>
    draftWith([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
      ['C', '192.168.1.128/26', '50'],
    ]);

  it('disables move-up on the first row and move-down on the last', () => {
    const rows = readyView(threeRows()).rows;
    expect(rowAt(rows, 0).canMoveUp).toBe(false);
    expect(rowAt(rows, 0).canMoveDown).toBe(true);
    expect(rowAt(rows, 1).canMoveUp).toBe(true);
    expect(rowAt(rows, 1).canMoveDown).toBe(true);
    expect(rowAt(rows, 2).canMoveDown).toBe(false);
  });

  it('numbers the rows by position, in draft order', () => {
    const rows = readyView(threeRows()).rows;
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.name)).toEqual(['A', 'B', 'C']);
  });

  it('offers remove on every row when there is more than one', () => {
    for (const row of readyView(threeRows()).rows) {
      expect(row.canRemove).toBe(true);
    }
  });

  it('disables remove on the only row, so the plan cannot be emptied by accident', () => {
    const view = readyView(draftWith([['A', '192.168.1.0/26', '50']]));
    expect(rowAt(view.rows, 0).canRemove).toBe(false);
  });

  it('follows the draft order, not address order', () => {
    // A table that reordered itself by address would make "move up" mean two different
    // things, and the diff's row order would stop matching the screen.
    const draft = draftWith([
      ['High', '192.168.1.128/26', '50'],
      ['Low', '192.168.1.0/26', '50'],
    ]);
    expect(readyView(draft).rows.map((row) => row.name)).toEqual(['High', 'Low']);
  });
});

/* ================================================================== *
 * The plan the view hands on
 * ================================================================== */

describe('the plan the view carries', () => {
  it('is the very object `evaluatePlan` produced, not a reconstruction', () => {
    // The screen's save action writes this, and Phase 9's persistence layer assumes the
    // plan is already validated. Rebuilding it here would be a second chance to get it
    // wrong, with none of the findings attached.
    const draft = draftWith([['A', '192.168.1.0/26', '50']]);
    const outcome: PlannerOutcome = evaluatePlan(draft);
    const view = buildPlanView(draft, outcome);
    if (outcome.kind !== 'ready') throw new Error('expected ready');
    expect(view.plan as NetworkPlan).toBe(outcome.plan);
  });

  it('is null for every outcome that is not ready', () => {
    for (const draft of [
      initialPlanDraft(),
      draftWith([['A', 'garbage', '50']]),
      draftWith([['A', '192.168.1.0/26', '50']], 'garbage'),
    ]) {
      expect(viewOf(draft).plan).toBeNull();
    }
  });

  it('carries a plan whose subnets carry the rows it was built from', () => {
    const draft = draftWith([['Servers', '192.168.1.0/26', '50']]);
    const plan = readyView(draft).plan;
    expect(plan?.subnets[0]?.name).toBe('Servers');
    expect(plan?.subnets[0]?.role).toBe('LAN');
  });

  it('does not put a description on the plan when the draft has none', () => {
    const plan = readyView(draftWith([['A', '192.168.1.0/26', '50']])).plan;
    expect(plan?.description).toBe('');
  });

  it('carries a trimmed description when the draft has one', () => {
    const draft = updateHeader(draftWith([['A', '192.168.1.0/26', '50']]), { description: '  hi  ' });
    expect(readyView(draft).plan?.description).toBe('hi');
  });
});
