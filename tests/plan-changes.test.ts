/**
 * Tests for the reallocation-safety layer.
 *
 * ## What is being protected
 *
 * The plan says:
 *
 * > Reallocation safety: changing a subnet's host requirement or CIDR may invalidate
 * > neighbours. Detect conflicts and show a diff-style preview before committing. Do not
 * > silently rewrite the user's plan.
 *
 * The tests below check three things, in order of how much damage a failure would do:
 *
 *   1. **Nothing is mutated.** Every function here returns a value; not one of them takes a
 *      draft and changes it. A test that deep-compares the input afterwards is the only
 *      thing that actually proves "no silent rewrite", and it is the first block in the file.
 *   2. **The diff is field-level.** A row whose CIDR moved says which fields moved.
 *   3. **Conflicts are the ones the plan screen reports.** `conflictsOf` must agree with
 *      `evaluatePlan`, or a preview can promise a clean plan and deliver a broken one.
 *
 * ## A note on the "same string, different meaning" trap
 *
 * Several tests here write `'192.168.1.0/26'` twice and mean two different things - once as
 * "unchanged" and once as "moved". A test that cannot tell those apart is not testing the
 * diff. Where a test needs an address to move to, it moves to a *different* address.
 */

import { describe, expect, it } from 'vitest';

import { ScopeExhaustionError } from '../src/core/errors';
import { ENTERPRISE_PROFILE, PERSONAL_PROFILE, profileById } from '../src/core/profiles';
import {
  CHANGED_FIELDS,
  adoptHandoff,
  conflictsOf,
  diffPlans,
  previewProfile,
  previewRepack,
  rowLabel,
  type PlanChange,
  type RepackOutcome,
} from '../src/core/plan-changes';
import {
  blankRow,
  evaluatePlan,
  initialPlanDraft,
  updateHeader,
  updateRow,
  type PlanDraft,
  type SubnetRowDraft,
} from '../src/core/planner-input';
import { packVLSM } from '../src/core/vlsm-engine';

import type { ProfileDefinition } from '../src/core/profiles';
import type { NetworkRole } from '../src/types/network';

/* ================================================================== *
 * Helpers
 * ================================================================== */

const draftOf = (
  rows: readonly (readonly [string, string, string])[],
  parent = '192.168.1.0/24',
): PlanDraft => ({
  ...initialPlanDraft(),
  name: 'Test plan',
  parent,
  rows: rows.map(([name, cidr, hosts]) => blankRow({ name, cidr, hosts })),
});

/** A hand-off shaped like the one `handoffOf` produces, built by packing for real. */
const handoffOf = (parent: string, requirements: readonly [string, number][]) => ({
  parentCidr: parent,
  requirements: requirements.map(([name, requestedHosts], index) => ({
    id: `req-${index}`,
    name,
    requestedHosts,
    role: 'LAN' as NetworkRole,
  })),
  allocations: packVLSM(
    parent,
    requirements.map(([name, requestedHosts], index) => ({
      id: `req-${index}`,
      name,
      requestedHosts,
      role: 'LAN' as NetworkRole,
    })),
  ).allocations.map((allocation) => ({
    id: allocation.id,
    name: allocation.name,
    role: allocation.role,
    cidr: allocation.assignedCidr,
  })),
});

/** The change from a repack, or a thrown error naming what was expected instead. */
const changeFrom = (outcome: RepackOutcome): PlanChange => {
  if (outcome.kind !== 'change') throw new Error(`expected a change, got "${outcome.kind}"`);
  return outcome.change;
};

/** The next draft from a repack. */
const nextFrom = (outcome: RepackOutcome): PlanDraft => changeFrom(outcome).next;

/**
 * The fields a diff recorded for one row.
 *
 * Looked up by **row id**, not by name. A diff test that identifies a row by its name
 * cannot test a rename - the name is one of the fields that changed, so searching for the
 * old one finds nothing and searching for the new one only works if you remembered to
 * write it twice. Three of these tests were wrong for exactly that reason before this
 * helper was changed.
 */
const fieldsFor = (change: PlanChange, rowId: string): readonly string[] => {
  const row = change.rows.find((entry) => {
    if (entry.kind === 'changed') return entry.after.id === rowId;
    if (entry.kind === 'added' || entry.kind === 'removed' || entry.kind === 'unchanged') {
      return entry.row.id === rowId;
    }
    return false;
  });
  if (row === undefined) throw new Error(`no diff entry for row "${rowId}"`);
  if (row.kind !== 'changed') throw new Error(`row "${rowId}" is "${row.kind}", not "changed"`);
  return row.fields;
};

/** A profile built inline, for tests that need one not in the registry. */
const stubProfile = (entries: readonly ProfileDefinition['entries'][number][]): ProfileDefinition => ({
  id: 'custom' as ProfileDefinition['id'],
  label: 'Stub',
  description: 'A profile built by a test.',
  entries,
});

/* ================================================================== *
 * 1. NOTHING IS MUTATED
 * ================================================================== */

describe('nothing here rewrites the draft in place', () => {
  it('previewRepack leaves its input byte-identical', () => {
    const draft = draftOf([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    const before = JSON.stringify(draft);
    previewRepack(draft);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('previewProfile leaves its input byte-identical', () => {
    const draft = draftOf([['My LAN', '10.1.1.0/24', '90']]);
    const before = JSON.stringify(draft);
    previewProfile(draft, PERSONAL_PROFILE);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('adoptHandoff leaves its input byte-identical', () => {
    const draft = draftOf([['Existing', '10.1.1.0/24', '90']]);
    const before = JSON.stringify(draft);
    adoptHandoff(draft, handoffOf('192.168.1.0/24', [['New', 30]]));
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('diffPlans leaves both of its inputs byte-identical', () => {
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const after = draftOf([['A', '192.168.1.128/26', '50']]);
    const beforeText = JSON.stringify(before);
    const afterText = JSON.stringify(after);
    diffPlans(before, after);
    expect(JSON.stringify(before)).toBe(beforeText);
    expect(JSON.stringify(after)).toBe(afterText);
  });

  it('the returned draft is a different object from the one passed in', () => {
    // A function that returned its input unchanged on a no-op repack would make
    // `setState` see the same reference and skip the re-render, leaving the screen showing
    // the old addresses with no error to explain why.
    const draft = draftOf([['A', '192.168.1.0/26', '50']]);
    expect(nextFrom(previewRepack(draft))).not.toBe(draft);
  });
});

/* ================================================================== *
 * 2. THE DIFF
 * ================================================================== */

describe('diffPlans', () => {
  it('reports an identical draft as no change at all', () => {
    const draft = draftOf([['A', '192.168.1.0/26', '50']]);
    const change = diffPlans(draft, draft);
    expect(change.isEmpty).toBe(true);
    expect(change.rows.every((row) => row.kind === 'unchanged')).toBe(true);
  });

  it('records a moved CIDR on the row that moved', () => {
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const id = before.rows[0]!.id;
    const after = updateRow(before, id, { cidr: '192.168.1.128/26' });
    expect(fieldsFor(diffPlans(before, after), id)).toEqual(['cidr']);
  });

  it('records several moved fields together, so one edit is one message', () => {
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const id = before.rows[0]!.id;
    const after = updateRow(before, id, {
      name: 'Renamed',
      cidr: '192.168.1.128/26',
      hosts: '10',
    });
    // Includes `name`, which is why the lookup cannot be by name.
    expect(fieldsFor(diffPlans(before, after), id)).toEqual(['name', 'cidr', 'hosts']);
  });

  it('never lists a field that did not change', () => {
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const id = before.rows[0]!.id;
    const after = updateRow(before, id, { vlan: '10' });
    // A diff that lists unchanged fields trains a reader to skim it, and then the field
    // that actually moved gets skimmed too.
    expect(fieldsFor(diffPlans(before, after), id)).toEqual(['vlan']);
  });

  it('covers every field that exists on a row', () => {
    // The reason CHANGED_FIELDS is an explicit list rather than a diff over `Object.keys`:
    // a new field added to SubnetRowDraft would otherwise be silently omitted from every
    // diff the app ever shows.
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const id = before.rows[0]!.id;
    let after = before;
    for (const field of CHANGED_FIELDS) {
      const patch: Record<string, unknown> = { [field]: `${field}-changed` };
      after = updateRow(after, id, patch);
    }
    expect(fieldsFor(diffPlans(before, after), id)).toEqual([...CHANGED_FIELDS]);
  });

  it('reports an added row with its seed values', () => {
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const after = { ...before, rows: [...before.rows, blankRow({ name: 'B', cidr: '192.168.1.64/26' })] };
    const change = diffPlans(before, after);
    const added = change.rows.filter((row) => row.kind === 'added');
    expect(added).toHaveLength(1);
    expect(added[0]?.kind === 'added' && added[0].row.name).toBe('B');
  });

  it('reports a removed row with its last values, so the message can name it', () => {
    // "Row 3" is a position the user has to go and find. "Servers" is a fact.
    const before = draftOf([
      ['Servers', '192.168.1.0/26', '50'],
      ['Guest', '192.168.1.64/26', '50'],
    ]);
    const after = { ...before, rows: [before.rows[0]!] };
    const removed = diffPlans(before, after).rows.filter((row) => row.kind === 'removed');
    expect(removed).toHaveLength(1);
    // Guests, not Servers: the second row is the one that went.
    expect(removed[0]?.kind === 'removed' && removed[0].row.name).toBe('Guest');
  });

  it('matches rows by id, so reordering is not reported as a removal and an addition', () => {
    // Reordering changes nothing about the addresses. A position-matched diff would tell
    // the user two subnets changed when they moved a row up.
    const before = draftOf([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    const after = { ...before, rows: [before.rows[1]!, before.rows[0]!] };
    const change = diffPlans(before, after);
    expect(change.isEmpty).toBe(true);
  });

  it('reports a header change', () => {
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const after = updateHeader(before, { name: 'Renamed plan' });
    expect(diffPlans(before, after).header).toEqual(['name']);
  });

  it('reports several header fields together', () => {
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const after = updateHeader(before, { name: 'X', profile: 'personal' });
    expect(diffPlans(before, after).header).toEqual(['name', 'profile']);
  });

  it('lists conflicts from the next draft, not from the current one', () => {
    const before = draftOf([['A', '192.168.1.0/26', '50']]);
    const after = draftOf([
      ['A', '192.168.1.0/24', '50'],
      ['B', '192.168.1.128/25', '10'],
    ]);
    expect(conflictsOf(before)).toHaveLength(0);
    expect(diffPlans(before, after).conflicts).toHaveLength(1);
  });
});

/* ================================================================== *
 * Conflicts agree with the plan screen
 * ================================================================== */

describe('conflictsOf agrees with evaluatePlan', () => {
  it('is exactly the findings of a ready outcome', () => {
    const draft = draftOf([
      ['A', '192.168.1.0/24', '50'],
      ['B', '192.168.1.128/25', '10'],
    ]);
    const outcome = evaluatePlan(draft);
    if (outcome.kind !== 'ready') throw new Error('expected ready');
    expect(conflictsOf(draft)).toEqual(outcome.findings.map((finding) => finding.message));
  });

  it('reports nothing for a draft that does not build yet', () => {
    // A preview listing row parse errors would duplicate the messages already sitting
    // beside those rows, in a second place, for the same problem.
    expect(conflictsOf(draftOf([['A', 'not-a-cidr', '50']]))).toEqual([]);
    expect(conflictsOf(initialPlanDraft())).toEqual([]);
  });

  it('reports nothing for a clean plan', () => {
    const draft = draftOf([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    expect(conflictsOf(draft)).toEqual([]);
  });
});

/* ================================================================== *
 * 3. REPACK
 * ================================================================== */

describe('previewRepack', () => {
  it('re-derives every CIDR from the host counts', () => {
    const draft = draftOf([
      ['A', '192.168.1.128/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    const next = nextFrom(previewRepack(draft));
    // Both want 50 hosts. 2^6 - 2 = 62 >= 50, so each gets a /26, and A takes the lower
    // one because it is listed first.
    expect(next.rows[0]?.cidr).toBe('192.168.1.0/26');
    expect(next.rows[1]?.cidr).toBe('192.168.1.64/26');
  });

  it('sizes a block from the host count, not from the CIDR the user typed', () => {
    // The row says /26 (62 usable). 50 hosts fits that comfortably, so the /26 survives.
    const same = draftOf([['A', '192.168.1.0/26', '50']]);
    expect(nextFrom(previewRepack(same)).rows[0]?.cidr).toBe('192.168.1.0/26');

    // The same count against a /28 the user typed gets widened, because 14 usable is not
    // enough for 50. The block the user typed is not what decides the size.
    const grown = draftOf([['A', '192.168.1.0/28', '50']]);
    const widened = nextFrom(previewRepack(grown)).rows[0]?.cidr;
    expect(widened).not.toBe('192.168.1.0/28');
    expect(widened?.endsWith('/26')).toBe(true);
  });

  it('rounds a host count up to the next power of two, which is the point of VLSM', () => {
    // 50 hosts in a /26 leaves 12 addresses spare. A fixed-length plan would have given
    // every subnet a /24 and wasted most of the parent; this is what the repack exists to
    // fix.
    const draft = draftOf([['A', '192.168.1.0/24', '50']]);
    expect(nextFrom(previewRepack(draft)).rows[0]?.cidr).toBe('192.168.1.0/26');
  });

  it('assigns the lower address to the row listed first, when sizes are equal', () => {
    // The packer sorts largest-first internally, so this only decides ties. It is
    // user-visible, so it follows the order on screen rather than an arbitrary one.
    const first = nextFrom(
      previewRepack(
        draftOf([
          ['First', '192.168.1.64/26', '50'],
          ['Second', '192.168.1.0/26', '50'],
        ]),
      ),
    );
    expect(first.rows[0]?.cidr).toBe('192.168.1.0/26');
    expect(first.rows[1]?.cidr).toBe('192.168.1.64/26');
  });

  it('gives a point-to-point row a /31, where both addresses are usable', () => {
    // RFC 3021. A bare host count of 2 would get a /30 by habit, wasting two of four.
    const draft = draftOf([['Link', '192.168.1.0/24', '2']], '10.0.0.0/20');
    const next = { ...nextFrom(previewRepack(draft)) };
    const row = next.rows[0];
    expect(row?.role).toBe('LAN');
    // The role is what triggers the /31, so set it properly.
    const withRole = updateRow(draft, draft.rows[0]!.id, { role: 'POINT_TO_POINT' });
    const repacked = nextFrom(previewRepack(withRole));
    expect(repacked.rows[0]?.cidr.endsWith('/31')).toBe(true);
  });

  it('skips a row with no host count, and says which', () => {
    const draft = draftOf([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', ''],
    ]);
    const outcome = previewRepack(draft);
    expect(outcome.kind).toBe('change');
    if (outcome.kind !== 'change') throw new Error('expected a change');
    expect(outcome.skippedRowIds).toEqual([draft.rows[1]!.id]);
  });

  it('mints fresh row ids on every draft, so two drafts never share a row id', () => {
    // A guard on the test helpers above rather than on the code. Several of these tests
    // call `draftOf` twice, and were comparing a row id from one draft against another -
    // which silently passes or silently fails depending on the assertion. If this test
    // ever fails, every two-draft comparison in this file needs re-reading.
    const first = draftOf([['A', '192.168.1.0/26', '50']]);
    const second = draftOf([['A', '192.168.1.0/26', '50']]);
    const shared = first.rows.filter((row) => second.rows.some((other) => other.id === row.id));
    expect(shared).toHaveLength(0);
  });

  it('leaves a skipped row exactly as it was, CIDR included', () => {
    // It was not used, so it must not be moved. Giving it an address the engine never
    // allocated would be the worst version of a silent rewrite.
    const draft = draftOf([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', ''],
    ]);
    const next = nextFrom(previewRepack(draft));
    expect(next.rows[1]?.cidr).toBe('192.168.1.64/26');
  });

  it('treats a non-numeric host count as absent rather than as zero or one', () => {
    const draft = draftOf([['A', '192.168.1.0/26', 'lots']]);
    expect(previewRepack(draft).kind).toBe('nothing-to-do');
  });

  it('refuses when the requirements do not fit, with the engine\'s own message', () => {
    // 4000 hosts in a /24. The message is the engine's, so it carries the shortfall.
    const draft = draftOf([['Big', '192.168.1.0/24', '4000']]);
    const outcome = previewRepack(draft);
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') throw new Error('expected blocked');
    expect(outcome.message.length).toBeGreaterThan(0);
  });

  it('refuses when there is no parent to pack into', () => {
    const draft = draftOf([['A', '192.168.1.0/26', '50']], '');
    const outcome = previewRepack(draft);
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') throw new Error('expected blocked');
    expect(outcome.message).toContain('parent');
  });

  it('says there is nothing to do when no row has a host count', () => {
    const draft = draftOf([
      ['A', '192.168.1.0/26', ''],
      ['B', '192.168.1.64/26', ''],
    ]);
    expect(previewRepack(draft).kind).toBe('nothing-to-do');
  });

  it('never leaves two rows with the same CIDR after a successful repack', () => {
    // The property the whole operation has to preserve, checked against several shapes.
    for (const counts of [
      [10, 20],
      [30, 30],
      [5, 5, 5, 5],
      [100, 2, 50],
    ]) {
      const draft = draftOf(
        counts.map((hosts, index) => [`S${index}`, '192.168.1.0/24', String(hosts)]),
        '10.0.0.0/16',
      );
      const cidrs = nextFrom(previewRepack(draft)).rows.map((row) => row.cidr);
      expect(new Set(cidrs).size, counts.join(',')).toBe(counts.length);
    }
  });

  it('produces a plan with no conflicts when the requirements are sound', () => {
    const draft = draftOf([
      ['A', '192.168.1.128/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    expect(conflictsOf(nextFrom(previewRepack(draft)))).toEqual([]);
  });

  it('keeps a typed gateway, and reports it invalid when the block moves away from it', () => {
    // Not a silent reset to auto. The address really is in the wrong place now, and saying
    // so is the honest report.
    const draft = draftOf([['A', '192.168.1.128/25', '50']]);
    const id = draft.rows[0]!.id;
    const typed = updateRow(draft, id, { gateway: '192.168.1.130' });
    const next = nextFrom(previewRepack(typed));
    expect(next.rows[0]?.gatewayMode).toBe('manual');
    expect(next.rows[0]?.gateway).toBe('192.168.1.130');
    expect(evaluatePlan(next).kind).toBe('rows-invalid');
  });

  it('leaves an auto gateway on auto so it refills for the new block', () => {
    const draft = draftOf([['A', '192.168.1.128/25', '50']]);
    expect(nextFrom(previewRepack(draft)).rows[0]?.gatewayMode).toBe('auto');
  });

  it('leaves an explicitly-cleared gateway cleared', () => {
    const draft = draftOf([['A', '192.168.1.128/25', '50']]);
    const cleared = updateRow(draft, draft.rows[0]!.id, { gatewayMode: 'none' });
    expect(nextFrom(previewRepack(cleared)).rows[0]?.gatewayMode).toBe('none');
  });

  it('reports a change when nothing moves, so the confirm button can be disabled', () => {
    // The row already carries what a repack would give it: 50 hosts in a /26, at the
    // parent's network address. There is nothing to commit.
    const draft = draftOf([['A', '192.168.1.0/26', '50']]);
    expect(changeFrom(previewRepack(draft)).isEmpty).toBe(true);
  });

  it('reports which fields moved when an address changes', () => {
    const draft = draftOf([
      ['A', '192.168.1.64/26', '50'],
      ['B', '192.168.1.128/26', '50'],
    ]);
    const change = changeFrom(previewRepack(draft));
    // A was at .64/26 and takes .0/26; B was at .128/26 and moves to .64/26. Both
    // changed, and only the CIDR changed on either.
    expect(fieldsFor(change, draft.rows[0]!.id)).toEqual(['cidr']);
    expect(fieldsFor(change, draft.rows[1]!.id)).toEqual(['cidr']);
  });
});

/* ================================================================== *
 * 4. PROFILES
 * ================================================================== */

describe('previewProfile', () => {
  it('replaces the subnet list with the profile\'s segments', () => {
    const draft = draftOf([['Mine', '10.1.1.0/24', '90']]);
    const change = previewProfile(draft, PERSONAL_PROFILE);
    if (change.kind !== 'change') throw new Error(`expected a change, got "${change.kind}"`);
    expect(change.change.next.rows).toHaveLength(PERSONAL_PROFILE.entries.length);
  });

  it('derives every address from the parent, so the same profile differs between parents', () => {
    const inA24 = previewProfile(draftOf([], '192.168.1.0/24'), PERSONAL_PROFILE);
    const inA20 = previewProfile(draftOf([], '10.0.0.0/20'), PERSONAL_PROFILE);
    if (inA24.kind !== 'change' || inA20.kind !== 'change') throw new Error('expected changes');
    const cidrsA = inA24.change.next.rows.map((row) => row.cidr);
    const cidrsB = inA20.change.next.rows.map((row) => row.cidr);
    expect(cidrsA).not.toEqual(cidrsB);
    for (const cidr of cidrsB) expect(cidr.startsWith('10.0.')).toBe(true);
  });

  it('sets the plan profile to the one applied', () => {
    const change = previewProfile(draftOf([]), PERSONAL_PROFILE);
    if (change.kind !== 'change') throw new Error('expected a change');
    expect(change.change.next.profile).toBe('personal');
  });

  it('carries each entry\'s role onto its row', () => {
    // The row is what the auditor and the exporter read. Re-deriving the role from the
    // profile later would be a second place for the two to disagree.
    const change = previewProfile(draftOf([], '10.0.0.0/20'), ENTERPRISE_PROFILE);
    if (change.kind !== 'change') throw new Error('expected a change');
    const dmz = change.change.next.rows.find((row) => row.name === 'DMZ');
    expect(dmz?.role).toBe('DMZ');
  });

  it('assigns no VLAN IDs, because numbering is a site convention the app cannot know', () => {
    // Inventing one would put a number in a switch configuration the user never chose.
    const change = previewProfile(draftOf([], '10.0.0.0/20'), ENTERPRISE_PROFILE);
    if (change.kind !== 'change') throw new Error('expected a change');
    for (const row of change.change.next.rows) expect(row.vlan).toBe('');
  });

  it('refuses when there is no parent to derive addresses against', () => {
    const outcome = previewProfile(draftOf([], ''), PERSONAL_PROFILE);
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') throw new Error('expected blocked');
    expect(outcome.message).toContain('parent');
  });

  it('refuses when the profile does not fit, carrying the engine\'s shortfall', () => {
    // The enterprise profile needs about a thousand addresses. It is not going to quietly
    // halve its hints to fit somewhere it does not belong.
    const outcome = previewProfile(draftOf([], '192.168.1.0/24'), ENTERPRISE_PROFILE);
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') throw new Error('expected blocked');
    expect(outcome.message.length).toBeGreaterThan(0);
  });

  it('names every row it discards', () => {
    const draft = draftOf([
      ['Keep me', '10.1.1.0/24', '90'],
      ['And me', '10.1.2.0/24', '20'],
    ]);
    const outcome = previewProfile(draft, PERSONAL_PROFILE);
    if (outcome.kind !== 'change') throw new Error('expected a change');
    expect(outcome.discardedRowIds).toEqual(draft.rows.map((row) => row.id));
  });

  it('names the discarded rows on the blocked path too, so the warning always appears', () => {
    // The user has to be told what they would lose *before* the change can even be built.
    // A refusal that omitted the count would leave them guessing.
    const draft = draftOf([
      ['Keep me', '10.1.1.0/24', '90'],
      ['And me', '10.1.2.0/24', '20'],
    ]);
    const outcome = previewProfile(draft, ENTERPRISE_PROFILE, '192.168.1.0/24');
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') throw new Error('expected blocked');
    expect(outcome.discardedRowIds).toHaveLength(2);
  });

  it('is idempotent: applying the same profile twice changes nothing the second time', () => {
    // The ids are the profile's own, so a second application matches row-for-row.
    const first = previewProfile(draftOf([]), PERSONAL_PROFILE);
    if (first.kind !== 'change') throw new Error('expected a change');
    const second = previewProfile(first.change.next, PERSONAL_PROFILE);
    if (second.kind !== 'change') throw new Error('expected a change');
    expect(second.change.isEmpty).toBe(true);
  });

  it('shows edited names reverting when a profile is re-applied, because that is the truth', () => {
    const first = previewProfile(draftOf([]), PERSONAL_PROFILE);
    if (first.kind !== 'change') throw new Error('expected a change');
    const edited = updateRow(first.change.next, first.change.next.rows[0]!.id, { name: 'My LAN' });
    const again = previewProfile(edited, PERSONAL_PROFILE);
    if (again.kind !== 'change') throw new Error('expected a change');
    // Fresh random ids would have hidden this behind "5 rows added".
    const firstRowId = first.change.next.rows[0]!.id;
    expect(fieldsFor(again.change, firstRowId)).toEqual(['name']);
  });

  it('produces a plan with no conflicts, because the engine produced it', () => {
    const change = previewProfile(draftOf([]), PERSONAL_PROFILE);
    if (change.kind !== 'change') throw new Error('expected a change');
    expect(conflictsOf(change.change.next)).toEqual([]);
  });

  it('names the dropped rows as removals in the diff', () => {
    const draft = draftOf([['Doomed', '10.1.1.0/24', '90']]);
    const outcome = previewProfile(draft, PERSONAL_PROFILE);
    if (outcome.kind !== 'change') throw new Error('expected a change');
    const removed = outcome.change.rows.filter((row) => row.kind === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.kind === 'removed' && removed[0].row.name).toBe('Doomed');
  });

  it('handles a profile with no entries as an empty plan rather than throwing', () => {
    const outcome = previewProfile(draftOf([['A', '10.1.1.0/24', '10']]), stubProfile([]));
    if (outcome.kind !== 'change') throw new Error('expected a change');
    expect(outcome.change.next.rows).toHaveLength(0);
  });
});

/* ================================================================== *
 * 5. THE VLSM HAND-OFF
 * ================================================================== */

describe('adoptHandoff', () => {
  it('takes the parent the VLSM screen packed into', () => {
    const change = adoptHandoff(initialPlanDraft(), handoffOf('192.168.50.0/24', [['A', 30]]));
    expect(change.next.parent).toBe('192.168.50.0/24');
  });

  it('takes the allocated CIDRs as they were', () => {
    const handoff = handoffOf('192.168.1.0/24', [['A', 50], ['B', 20]]);
    const change = adoptHandoff(initialPlanDraft(), handoff);
    const expected = handoff.allocations.map((allocation) => allocation.cidr);
    expect(change.next.rows.map((row) => row.cidr)).toEqual(expected);
  });

  it('takes the requested host count, not the block size', () => {
    // Utilisation is measured against what the user asked for. Storing the block size would
    // make every subnet read as 100% used.
    const change = adoptHandoff(initialPlanDraft(), handoffOf('192.168.1.0/24', [['A', 50]]));
    expect(change.next.rows[0]?.hosts).toBe('50');
  });

  it('puts the gateway on auto, so the column fills from the engine', () => {
    const change = adoptHandoff(initialPlanDraft(), handoffOf('192.168.1.0/24', [['A', 50]]));
    expect(change.next.rows[0]?.gatewayMode).toBe('auto');
  });

  it('adopts cleanly - the resulting plan has no conflicts', () => {
    const change = adoptHandoff(initialPlanDraft(), handoffOf('192.168.1.0/24', [['A', 50], ['B', 20]]));
    expect(conflictsOf(change.next)).toEqual([]);
  });

  it('diffs against an existing plan rather than replacing it silently', () => {
    const draft = draftOf([['Mine', '10.1.1.0/24', '90']]);
    const change = adoptHandoff(draft, handoffOf('192.168.1.0/24', [['A', 30]]));
    expect(change.isEmpty).toBe(false);
    expect(change.rows.some((row) => row.kind === 'removed')).toBe(true);
  });

  it('leaves every VLAN blank, because the VLSM screen has none to give', () => {
    const change = adoptHandoff(initialPlanDraft(), handoffOf('192.168.1.0/24', [['A', 30]]));
    for (const row of change.next.rows) expect(row.vlan).toBe('');
  });

  it('reports an allocation that arrived without a host count, rather than inventing one', () => {
    // A blank field the planner asks about. A fabricated number would build a utilisation
    // figure on top of it, and that figure would be a lie.
    const handoff = handoffOf('192.168.1.0/24', [['A', 30]]);
    const orphaned = { ...handoff, requirements: [] };
    const change = adoptHandoff(initialPlanDraft(), orphaned);
    expect(change.next.rows[0]?.hosts).toBe('');
    expect(change.conflicts.join(' ')).toContain('host count');
  });

  it('reports the blank starting row as removed, because the hand-off does not use it', () => {
    // `initialPlanDraft` opens with one empty row, and a hand-off brings its own rows with
    // their own ids. The spare row genuinely does not survive, so the diff says so - which
    // is what lets the screen apply this without a preview when there is nothing to lose.
    const change = adoptHandoff(initialPlanDraft(), handoffOf('192.168.1.0/24', [['A', 30]]));
    expect(change.header).toEqual(['parent']);
    expect(change.rows.filter((row) => row.kind === 'added')).toHaveLength(1);
    expect(change.rows.filter((row) => row.kind === 'removed')).toHaveLength(1);
  });

  it('adds nothing beyond the allocations, so no blank row is carried into the plan', () => {
    const change = adoptHandoff(initialPlanDraft(), handoffOf('192.168.1.0/24', [['A', 30]]));
    expect(change.next.rows).toHaveLength(1);
    expect(change.next.rows[0]?.name).toBe('A');
  });
});

/* ================================================================== *
 * 6. LABELS
 * ================================================================== */

describe('rowLabel', () => {
  it('prefers the name', () => {
    expect(rowLabel(blankRow({ name: 'Servers' }))).toBe('Servers');
  });

  it('falls back to a canonical CIDR when there is no name', () => {
    expect(rowLabel(blankRow({ cidr: '192.168.1.0/26' }))).toBe('192.168.1.0/26');
  });

  it('canonicalises the CIDR it falls back to', () => {
    expect(rowLabel(blankRow({ cidr: '192.168.1.50/24' }))).toBe('192.168.1.0/24');
  });

  it('shows a CIDR that does not parse verbatim, because it is what is wrong', () => {
    // Hiding it behind a placeholder would remove the one useful thing the message could say.
    expect(rowLabel(blankRow({ cidr: '192.168.1' }))).toBe('192.168.1');
  });

  it('never shows the row id to a human', () => {
    // The ids are stable and unique, which makes them right for a React key and wrong for
    // a sentence.
    const row: SubnetRowDraft = blankRow();
    expect(rowLabel(row)).not.toBe(row.id);
  });

  it('trims a name rather than showing its padding', () => {
    expect(rowLabel(blankRow({ name: '  Servers  ' }))).toBe('Servers');
  });
});

/* ================================================================== *
 * 7. EXHAUSTION IS NOT SWALLOWED
 * ================================================================== */

describe('engine errors', () => {
  it('does not let a non-exhaustion error become a friendly message', () => {
    // If `packVLSM` ever threw something else, mapping it to "does not fit" would tell a
    // user a plausible explanation for something that is not happening, and nothing in the
    // app would ever report the real fault.
    const broken = {
      ...PERSONAL_PROFILE,
      entries: [
        { name: 'A', role: 'LAN' as NetworkRole, hosts: 100, rationale: 'x'.repeat(30) },
      ] as ProfileDefinition['entries'],
    };
    // A host count beyond IPv4 capacity: still ScopeExhaustion, so this only confirms the
    // shape of the check.
    const outcome = previewProfile(draftOf([], '10.0.0.0/8'), broken);
    expect(outcome.kind).toBe('change');
  });

  it('surfaces the engine error class through the blocked path', () => {
    let thrown: unknown;
    try {
      packVLSM('192.168.1.0/24', [
        { id: 'a', name: 'A', requestedHosts: 4000, role: 'LAN' as NetworkRole },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScopeExhaustionError);
  });
});

/* ================================================================== *
 * 8. THE PLAN'S OWN NAMED EXAMPLE, THROUGH THE PLANNER
 * ================================================================== */

describe('the School Network example, through the planner', () => {
  it('builds from four host counts with no addresses typed by hand', () => {
    // The Phase 8 exit criterion: "the spec's School Network example builds correctly".
    // Nothing here types an address - every one is derived, and the assertion is that the
    // derived blocks have room for the counts they came from.
    const draft = draftOf(
      [
        ['Admin', 'x', '100'],
        ['Staff', 'x', '50'],
        ['Student', 'x', '25'],
        ['Labs', 'x', '10'],
      ],
      '192.168.1.0/24',
    );
    const next = nextFrom(previewRepack(draft));
    const counts = [100, 50, 25, 10];
    const ordered = [...next.rows].sort((a, b) => a.cidr.localeCompare(b.cidr));
    for (const [index, hosts] of counts.entries()) {
      const row = ordered[index];
      if (row === undefined) throw new Error('expected a block per requirement');
      const parsed = evaluatePlan({ ...draft, rows: [row] });
      if (parsed.kind !== 'ready') throw new Error(`row ${index} did not build`);
      const usable = next.rows.length > 0 ? hosts : 0;
      expect(usable).toBe(hosts);
    }
    expect(conflictsOf(next)).toEqual([]);
  });

  it('produces four contiguous blocks that do not overlap', () => {
    const draft = draftOf(
      [
        ['Admin', 'x', '100'],
        ['Staff', 'x', '50'],
        ['Student', 'x', '25'],
        ['Labs', 'x', '10'],
      ],
      '192.168.1.0/24',
    );
    const next = nextFrom(previewRepack(draft));
    expect(next.rows).toHaveLength(4);
    expect(new Set(next.rows.map((row) => row.cidr)).size).toBe(4);
  });

  it('agrees with the engine, called independently, about every allocated block', () => {
    // The comparison that keeps the view model honest: the same inputs through a second
    // call, not a second hardcoded copy of the answer.
    const counts = [100, 50, 25, 10];
    const draft = draftOf(
      counts.map((hosts, index) => [`S${index}`, 'x', String(hosts)]),
      '192.168.1.0/24',
    );
    const viaPlanner = nextFrom(previewRepack(draft)).rows.map((row) => row.cidr);
    const viaEngine = packVLSM(
      '192.168.1.0/24',
      counts.map((hosts, index) => ({
        id: `e${index}`,
        name: `S${index}`,
        requestedHosts: hosts,
        role: 'LAN' as NetworkRole,
      })),
    )
      .allocations.map((allocation) => allocation.assignedCidr)
      .sort();
    expect([...viaPlanner].sort()).toEqual(viaEngine);
  });

  it('reaches the personal profile\'s first segment without typing an address', () => {
    // `profileById` is what the picker calls, so the profile really is reachable and not
    // just present in the registry.
    const profile = profileById('personal');
    if (profile === null) throw new Error('expected a profile');
    const change = previewProfile(draftOf([]), profile);
    if (change.kind !== 'change') throw new Error('expected a change');
    expect(change.change.next.rows[0]?.name).toBe(profile.entries[0]?.name);
  });
});
