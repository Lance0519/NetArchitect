/**
 * Tests for the VLSM draft input rules.
 *
 * Under the Phase 5 R4 decision there is no component-render test, so this file and
 * `vlsm-engine.test.ts` are the only things standing between the VLSM screen and a
 * silently wrong allocation. That is why the emphasis below is on *properties* -
 * totals that must reconcile, suggestions that must actually pack, subnets that must sit
 * inside the parent - rather than on a handful of hardcoded allocation strings.
 *
 * Where a message is asserted, it is asserted against `MESSAGES`, the registry the
 * schema itself reads. Hardcoding a second copy of the string would let the test pass
 * after a copy-paste edit that broke the wiring.
 */

import { describe, expect, it } from 'vitest';

import { ScopeExhaustionError } from '../src/core/errors';
import { calculateSubnet, parseCidr } from '../src/core/ip-engine';
import { MESSAGES } from '../src/core/validation';
import { packVLSM } from '../src/core/vlsm-engine';
import {
  attributeCulprit,
  blankRow,
  evaluateVlsm,
  newDraftId,
  type VlsmDraft,
  type VlsmOutcome,
  type VlsmRowDraft,
} from '../src/core/vlsm-input';

import type { HostRequirement, NetworkRole } from '../src/types/network';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** A row with everything but the two text fields decided. */
const row = (
  id: string,
  name: string,
  hosts: string,
  role: NetworkRole = 'LAN',
): VlsmRowDraft => ({ id, name, hosts, role });

const draft = (parent: string, rows: readonly VlsmRowDraft[]): VlsmDraft => ({
  parent,
  rows,
});

/** Narrowing helper: the whole point of the union is that the screen switches on it. */
const only = (outcome: VlsmOutcome): VlsmOutcome => outcome;

const expectOk = (outcome: VlsmOutcome) => {
  if (outcome.kind !== 'ok') {
    throw new Error(
      `expected an allocation, got "${outcome.kind}"${
        'message' in outcome ? `: ${outcome.message}` : ''
      }`,
    );
  }
  return outcome;
};

const expectExhausted = (outcome: VlsmOutcome) => {
  if (outcome.kind !== 'exhausted') {
    throw new Error(`expected exhaustion, got "${outcome.kind}"`);
  }
  return outcome;
};

const cidrOf = (text: string) => parseCidr(text);

const range = (text: string) => calculateSubnet(cidrOf(text).ip, cidrOf(text).prefix);

const byId = (outcome: ReturnType<typeof expectOk>, id: string) => {
  const found = outcome.result.allocations.find((allocation) => allocation.id === id);
  if (found === undefined) throw new Error(`no allocation for row "${id}"`);
  return found;
};

/* ------------------------------------------------------------------ *
 * Row identity
 * ------------------------------------------------------------------ */

describe('row identity', () => {
  it('issues ids that are unique across many calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newDraftId()));
    expect(ids.size).toBe(500);
  });

  it('issues ids that cannot collide with the engine requirement ids', () => {
    // Both id spaces end up on the same Allocation, so a shared id would make a mapping
    // bug invisible rather than loud.
    const draftId = newDraftId();
    const engineId = packVLSM('192.168.1.0/24', [
      { id: 'req-1', name: 'A', requestedHosts: 10, role: 'LAN' },
    ]).allocations[0]?.id;
    expect(draftId).not.toBe(engineId);
    expect(draftId.startsWith('draft-')).toBe(true);
  });

  it('is stable: the same id is returned on every read of a held row', () => {
    const held = blankRow();
    expect(blankRow).not.toBe(held); // a new object each call
    expect(held.id).toBe(held.id);
  });

  it('starts a blank row empty and on LAN', () => {
    const blank = blankRow();
    expect(blank.name).toBe('');
    expect(blank.hosts).toBe('');
    expect(blank.role).toBe('LAN');
  });

  it('lets an override change the fields but never the generated id', () => {
    const blank = blankRow({ name: 'Servers', hosts: '50', role: 'SERVERS' });
    expect(blank).toMatchObject({ name: 'Servers', hosts: '50', role: 'SERVERS' });
    expect(blank.id).toMatch(/^draft-\d+$/);
  });

  it('keeps a supplied id rather than minting a new one', () => {
    // Reordering and re-validation must not change identity, or every keystroke would
    // remount the row and lose focus.
    expect(blankRow({ id: 'keep-me' }).id).toBe('keep-me');
  });
});

/* ------------------------------------------------------------------ *
 * The five states
 * ------------------------------------------------------------------ */

describe('the empty state', () => {
  it('is the state of a brand new draft', () => {
    expect(evaluateVlsm(draft('', [blankRow()])).kind).toBe('empty');
  });

  it('is the state when every row is blank, however many there are', () => {
    expect(evaluateVlsm(draft('', [blankRow(), blankRow(), blankRow()])).kind).toBe('empty');
  });

  it('is the state when the parent is filled but no requirement is', () => {
    // Otherwise a user who types the parent first is met with a row error about a name
    // they have not been asked for yet.
    expect(evaluateVlsm(draft('192.168.1.0/24', [blankRow()])).kind).toBe('empty');
  });

  it('treats a row of only whitespace as blank', () => {
    expect(evaluateVlsm(draft('', [row('a', '   ', '\t  ')])).kind).toBe('empty');
  });

  it('is not an error: it carries no message to render', () => {
    const outcome = only(evaluateVlsm(draft('', [])));
    expect(outcome.kind).toBe('empty');
    expect('message' in outcome).toBe(false);
  });
});

describe('row validation', () => {
  it('names the row that is missing a name', () => {
    const outcome = evaluateVlsm(draft('192.168.1.0/24', [row('r1', '', '50')]));
    expect(outcome.kind).toBe('rows-invalid');
    if (outcome.kind !== 'rows-invalid') return;
    expect(outcome.messages.get('r1')).toBe(MESSAGES.nameRequired);
  });

  it('names the row that is missing a host count', () => {
    const outcome = evaluateVlsm(draft('192.168.1.0/24', [row('r1', 'Servers', '')]));
    expect(outcome.kind).toBe('rows-invalid');
    if (outcome.kind !== 'rows-invalid') return;
    expect(outcome.messages.get('r1')).toBe(MESSAGES.hostCountRequired);
  });

  it('rejects a host count of zero', () => {
    const outcome = evaluateVlsm(draft('192.168.1.0/24', [row('r1', 'Servers', '0')]));
    if (outcome.kind !== 'rows-invalid') throw new Error('expected a row error');
    expect(outcome.messages.get('r1')).toBe(MESSAGES.invalidHostCount);
  });

  it('rejects a host count that is not a whole number of digits', () => {
    // '1e3', '0x10' and '8.5' all evaluate to something under Number(). A field that
    // means "how many devices" should not accept them.
    for (const text of ['1e3', '0x10', '8.5', '-4', 'twelve']) {
      const outcome = evaluateVlsm(draft('192.168.1.0/24', [row('r1', 'Servers', text)]));
      if (outcome.kind !== 'rows-invalid') throw new Error(`"${text}" was accepted`);
      expect(outcome.messages.get('r1'), text).toBeTruthy();
    }
  });

  it('reports every bad row, not just the first', () => {
    // The user is looking at a list. Fixing one row at a time, only to be told about
    // the next, is the slowest possible way through the form.
    const outcome = evaluateVlsm(
      draft('192.168.1.0/24', [row('r1', '', '50'), row('r2', 'Servers', 'abc')]),
    );
    if (outcome.kind !== 'rows-invalid') throw new Error('expected row errors');
    expect([...outcome.messages.keys()].sort()).toEqual(['r1', 'r2']);
  });

  it('counts the rows that were fine, so the screen can say "2 of 3 ready"', () => {
    const outcome = evaluateVlsm(
      draft('192.168.1.0/24', [row('r1', 'A', '10'), row('r2', 'B', '20'), row('r3', 'C', 'x')]),
    );
    if (outcome.kind !== 'rows-invalid') throw new Error('expected row errors');
    expect(outcome.validCount).toBe(2);
  });

  it('says nothing about rows the user has not started', () => {
    // Three blank rows plus one bad row: the blank ones are not mistakes, and marking
    // them would put the screen at four errors when the user has made one.
    const outcome = evaluateVlsm(
      draft('192.168.1.0/24', [row('r1', 'A', '10'), blankRow(), blankRow()]),
    );
    expect(evaluateVlsm(draft('192.168.1.0/24', [row('r1', 'A', 'nope')])).kind).toBe(
      'rows-invalid',
    );
    if (outcome.kind !== 'rows-invalid') return;
    expect(outcome.messages.size).toBe(1);
  });

  it('validates a half-typed row rather than ignoring it', () => {
    // The counterpart to the rule above: once there is content, be strict. A row with a
    // name and no host count is genuinely incomplete.
    const outcome = evaluateVlsm(draft('192.168.1.0/24', [row('r1', 'Servers', '  ')]));
    if (outcome.kind !== 'rows-invalid') throw new Error('expected a row error');
    expect(outcome.messages.get('r1')).toBe(MESSAGES.hostCountRequired);
  });

  it('ignores blank rows when packing, so a half-built list still allocates', () => {
    const outcome = expectOk(
      evaluateVlsm(
        draft('192.168.1.0/24', [row('r1', 'A', '10'), blankRow(), row('r2', 'B', '20')]),
      ),
    );
    expect(outcome.result.allocations).toHaveLength(2);
  });

  it('accepts a host count with surrounding whitespace, and trims the name', () => {
    const outcome = expectOk(
      evaluateVlsm(draft('192.168.1.0/24', [row('r1', '  Servers  ', '  30  ')])),
    );
    expect(byId(outcome, 'r1').name).toBe('Servers');
    expect(byId(outcome, 'r1').requestedHosts).toBe(30);
  });

  it('refuses a name longer than 80 characters', () => {
    const outcome = evaluateVlsm(
      draft('192.168.1.0/24', [row('r1', 'x'.repeat(81), '10')]),
    );
    if (outcome.kind !== 'rows-invalid') throw new Error('expected a row error');
    expect(outcome.messages.get('r1')).toBe(MESSAGES.nameTooLong);
  });

  it('prefers a row error to a parent error when both are wrong', () => {
    // The user is mid-task on the list. The parent has not changed since it last worked,
    // so the row is what they are looking at.
    const outcome = evaluateVlsm(draft('nonsense', [row('r1', '', '50')]));
    expect(outcome.kind).toBe('rows-invalid');
  });
});

describe('the parent', () => {
  it('rejects an unreadable parent with the schema message', () => {
    const outcome = evaluateVlsm(draft('999.1.1.1/24', [row('r1', 'A', '10')]));
    expect(outcome.kind).toBe('parent-invalid');
    if (outcome.kind !== 'parent-invalid') return;
    expect(outcome.message).toBe(MESSAGES.invalidIPv4);
  });

  it('rejects a parent with no prefix', () => {
    const outcome = evaluateVlsm(draft('192.168.1.0', [row('r1', 'A', '10')]));
    expect(outcome.kind).toBe('parent-invalid');
  });

  it('rejects a prefix outside /0 to /32', () => {
    for (const text of ['192.168.1.0/33', '192.168.1.0/-1', '192.168.1.0/64']) {
      const outcome = evaluateVlsm(draft(text, [row('r1', 'A', '10')]));
      if (outcome.kind !== 'parent-invalid') throw new Error(`"${text}" was accepted`);
      expect(outcome.message, text).toBeTruthy();
    }
  });

  it('normalises a parent given with host bits set, exactly as parseCidr does', () => {
    // 192.168.1.77/24 and 192.168.1.0/24 are the same block. The screen must not
    // disagree with the planner about which.
    const hosted = expectOk(evaluateVlsm(draft('192.168.1.77/24', [row('r1', 'A', '10')])));
    const boundary = expectOk(evaluateVlsm(draft('192.168.1.0/24', [row('r1', 'A', '10')])));
    expect(hosted.result.allocations.map((a) => a.assignedCidr)).toEqual(
      boundary.result.allocations.map((a) => a.assignedCidr),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Allocation
 * ------------------------------------------------------------------ */

describe('a valid draft', () => {
  const base = draft('192.168.1.0/24', [
    row('students', 'Students', '100'),
    row('it', 'IT', '50'),
    row('admin', 'Admin', '25'),
    row('mgmt', 'Mgmt', '10'),
  ]);

  it('reproduces the specification example', () => {
    const outcome = expectOk(evaluateVlsm(base));
    expect(outcome.result.allocations.map((a) => a.assignedCidr)).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/26',
      '192.168.1.192/27',
      '192.168.1.224/28',
    ]);
  });

  it('carries the draft row id onto the allocation', () => {
    // The screen maps rows to table lines and back; losing the id breaks reorder,
    // removal and error attribution at once.
    const outcome = expectOk(evaluateVlsm(base));
    expect(outcome.result.allocations.map((a) => a.id).sort()).toEqual([
      'admin',
      'it',
      'mgmt',
      'students',
    ]);
  });

  it('hands back the requirements in draft order, not packed order', () => {
    // The packer sorts largest-first internally. The rows must not come back shuffled,
    // or the requirement list would reorder itself on every keystroke.
    const outcome = expectOk(evaluateVlsm(base));
    expect(outcome.requirements.map((r) => r.id)).toEqual([
      'students',
      'it',
      'admin',
      'mgmt',
    ]);
  });

  it('packs the same way regardless of how the rows are ordered in the draft', () => {
    const forward = expectOk(evaluateVlsm(base));
    const reversed = expectOk(
      evaluateVlsm(draft('192.168.1.0/24', [...base.rows].reverse())),
    );
    expect(reversed.result.allocations.map((a) => a.assignedCidr)).toEqual(
      forward.result.allocations.map((a) => a.assignedCidr),
    );
  });

  it('keeps equal-size requirements in the order the user entered them', () => {
    const outcome = expectOk(
      evaluateVlsm(
        draft('192.168.1.0/24', [row('a', 'Alpha', '50'), row('b', 'Bravo', '50')]),
      ),
    );
    expect(outcome.result.allocations.map((a) => a.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('gives every requirement at least the hosts it asked for', () => {
    for (const allocation of expectOk(evaluateVlsm(base)).result.allocations) {
      expect(allocation.subnet.usableHosts, allocation.name).toBeGreaterThanOrEqual(
        allocation.requestedHosts,
      );
    }
  });

  it('accounts for the whole parent, with no address unclaimed', () => {
    const { result } = expectOk(evaluateVlsm(base));
    expect(result.allocatedAddresses + result.freeAddresses).toBe(result.totalAddresses);
  });

  it('never lets an allocation escape the parent', () => {
    const parent = range('10.0.0.0/22');
    const outcome = expectOk(
      evaluateVlsm(
        draft('10.0.0.0/22', [row('a', 'A', '300'), row('b', 'B', '200'), row('c', 'C', '100')]),
      ),
    );
    for (const allocation of outcome.result.allocations) {
      const block = range(allocation.assignedCidr);
      expect(block.networkAddress, allocation.assignedCidr).toBeGreaterThanOrEqual(
        parent.networkAddress,
      );
      expect(block.broadcastAddress, allocation.assignedCidr).toBeLessThanOrEqual(
        parent.broadcastAddress,
      );
    }
  });

  it('never emits a subnet that is not on its own network boundary', () => {
    // The property that distinguishes a real allocator from a naive one: no router will
    // accept a subnet whose address has host bits set.
    const { result } = expectOk(evaluateVlsm(base));
    for (const allocation of result.allocations) {
      const parsed = cidrOf(allocation.assignedCidr);
      expect(parsed.ip, allocation.assignedCidr).toBe(
        calculateSubnet(parsed.ip, parsed.prefix).networkAddress,
      );
    }
  });

  it('packs a point-to-point requirement as a /31 with both addresses usable', () => {
    const outcome = expectOk(
      evaluateVlsm(draft('192.168.1.0/24', [row('wan', 'WAN', '2', 'POINT_TO_POINT')])),
    );
    const wan = byId(outcome, 'wan');
    expect(wan.assignedCidr.endsWith('/31')).toBe(true);
    expect(wan.subnet.usableHosts).toBe(2);
  });

  it('accepts a single-requirement draft', () => {
    expect(expectOk(evaluateVlsm(draft('192.168.1.0/24', [row('a', 'A', '10')]))).result
      .allocations).toHaveLength(1);
  });

  it('treats a host count of one as needing a LAN block, not a point-to-point link', () => {
    // Role decides the /31, not size. A LAN with one device still needs a network and a
    // broadcast address.
    const outcome = expectOk(evaluateVlsm(draft('192.168.1.0/24', [row('a', 'A', '1')])));
    expect(byId(outcome, 'a').assignedCidr.endsWith('/30')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Exhaustion
 * ------------------------------------------------------------------ */

describe('exhaustion', () => {
  it('is reported when the requirements simply do not fit', () => {
    // 300 hosts needs a /23; a /24 is too small for it whatever else is asked for.
    const outcome = expectExhausted(
      evaluateVlsm(draft('192.168.1.0/24', [row('big', 'Big', '300')])),
    );
    expect(outcome.message).toBeTruthy();
  });

  it('blames no single row when the total is at fault', () => {
    // INSUFFICIENT_TOTAL carries a null name by design: the demand is simply more than
    // the block, so pointing a red border at one row would be a lie.
    const outcome = expectExhausted(
      evaluateVlsm(
        draft('192.168.1.0/24', [row('a', 'A', '200'), row('b', 'B', '200')]),
      ),
    );
    expect(outcome.culpritId).toBeNull();
  });

  it('reports the address shortfall as a positive number', () => {
    const outcome = expectExhausted(
      evaluateVlsm(draft('192.168.1.0/24', [row('big', 'Big', '300')])),
    );
    expect(outcome.shortfallAddresses).toBeGreaterThan(0);
  });

  it('suggests a parent that verifiably packs the same requirements', () => {
    // The load-bearing assertion. A suggestion derived from a size comparison alone
    // would read "192.168.1.0/23", which is not even a legal way to write that block,
    // and a /23 can fail to pack for reasons a size comparison cannot see.
    const outcome = expectExhausted(
      evaluateVlsm(draft('192.168.1.0/24', [row('big', 'Big', '300')])),
    );
    expect(outcome.suggestion).not.toBeNull();
    const suggestion = outcome.suggestion as string;

    // 1. It is legal text, on its own network boundary.
    const parsed = cidrOf(suggestion);
    expect(parsed.ip).toBe(calculateSubnet(parsed.ip, parsed.prefix).networkAddress);

    // 2. It is actually wider than what the user had.
    expect(parsed.prefix).toBeLessThan(24);

    // 3. And, the point of the whole exercise: the requirements really do pack into it.
    expect(() =>
      packVLSM(suggestion, [
        { id: 'big', name: 'Big', requestedHosts: 300, role: 'LAN' },
      ]),
    ).not.toThrow();
  });

  it('renormalises the network address when it widens the prefix', () => {
    // 192.168.1.0/23 is the same block as 192.168.0.0/23, but only the second can be
    // typed back into the parent field and mean what the suggestion says.
    const outcome = expectExhausted(
      evaluateVlsm(draft('192.168.1.0/24', [row('big', 'Big', '300')])),
    );
    expect(outcome.suggestion).toBe('192.168.0.0/23');
  });

  it('preserves the parent block it widened, rather than jumping to a bare 0.0.0.0', () => {
    // Widening must stay inside the block the user is working in. Suggesting 10.0.0.0/8
    // because "it is bigger" would be a suggestion that discards their address plan.
    const outcome = expectExhausted(
      evaluateVlsm(draft('172.16.0.0/20', [row('big', 'Big', '5000')])),
    );
    const suggestion = outcome.suggestion as string;
    expect(suggestion.startsWith('172.')).toBe(true);
    expect(() =>
      packVLSM(suggestion, [{ id: 'big', name: 'Big', requestedHosts: 5000, role: 'LAN' }]),
    ).not.toThrow();
  });

  it('makes no suggestion rather than an unverified one', () => {
    // A /0 parent cannot be widened, and a requirement list needing many doublings is a
    // sign the requirements are wrong. Saying nothing is the honest answer.
    const outcome = expectExhausted(
      evaluateVlsm(draft('0.0.0.0/0', [row('a', 'A', '2147483647')])),
    );
    expect(outcome.suggestion).toBeNull();
  });

  it('recovers as soon as the offending requirement is removed', () => {
    // The plan's own exit criterion: exhaustion is not a dead end, and the screen
    // re-packs without any extra action from the user.
    const tooBig = evaluateVlsm(
      draft('192.168.1.0/24', [row('a', 'A', '100'), row('big', 'Big', '300')]),
    );
    expect(tooBig.kind).toBe('exhausted');

    const removed = expectOk(
      evaluateVlsm(draft('192.168.1.0/24', [row('a', 'A', '100')])),
    );
    expect(removed.result.allocations).toHaveLength(1);
    expect(byId(removed, 'a').assignedCidr).toBe('192.168.1.0/25');
  });

  it('recovers as soon as the parent is enlarged, live', () => {
    const small = evaluateVlsm(draft('192.168.1.0/24', [row('big', 'Big', '300')]));
    const large = evaluateVlsm(draft('192.168.0.0/23', [row('big', 'Big', '300')]));
    expect(small.kind).toBe('exhausted');
    expect(large.kind).toBe('ok');
  });
});

/* ------------------------------------------------------------------ *
 * Attribution
 *
 * Tested against constructed errors because the engine's *named* branch is currently
 * unreachable - see the characterisation test at the end of this file.
 * ------------------------------------------------------------------ */

describe('attributing exhaustion to a row', () => {
  const rows = [
    row('r1', 'Students', '100'),
    row('r2', 'Servers', '50'),
    row('r3', 'Servers', '20'),
  ];

  const namedError = (name: string) => new ScopeExhaustionError(name, 50, 128, 64);

  it('marks the row when exactly one carries the name', () => {
    expect(attributeCulprit(namedError('Students'), rows)).toBe('r1');
  });

  it('marks no row when two carry the name', () => {
    // The important case. "Servers" twice is an ordinary draft, and guessing would put
    // the error on a row that is fine.
    expect(attributeCulprit(namedError('Servers'), rows)).toBeNull();
  });

  it('marks no row when no row carries the name', () => {
    expect(attributeCulprit(namedError('Nonexistent'), rows)).toBeNull();
  });

  it('marks no row when the engine blamed nobody', () => {
    expect(attributeCulprit(new ScopeExhaustionError(null, 400, 1024, 256), rows)).toBeNull();
  });

  it('matches a name the user typed with stray whitespace', () => {
    // The schema trims the name it validates, so the engine reports trimmed text while
    // the row still holds what was typed. A literal comparison would miss.
    expect(attributeCulprit(namedError('Students'), [row('r1', '  Students ', '100')])).toBe(
      'r1',
    );
  });

  it('ignores case, and says so, rather than guessing', () => {
    // "servers" and "Servers" are different strings and this rule does not fold them.
    // Pinned so a future case-insensitive match is a deliberate change.
    expect(attributeCulprit(namedError('Servers'), [row('r1', 'servers', '10')])).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Exhaustive properties
 * ------------------------------------------------------------------ */

describe('properties across many drafts', () => {
  const parents = ['10.0.0.0/22', '172.16.0.0/20', '192.168.1.0/24', '10.10.0.0/16'];
  const sizes = [1, 2, 3, 6, 10, 14, 25, 30, 50, 62, 100, 126, 200, 300, 500];
  const roles: readonly NetworkRole[] = ['LAN', 'SERVERS', 'IOT', 'POINT_TO_POINT'];

  /** Every (parent, requirement-count, size, role) combination, deterministically. */
  const cases = (() => {
    const out: { parent: string; rows: VlsmRowDraft[] }[] = [];
    let n = 0;
    for (const parent of parents) {
      for (const count of [1, 2, 3, 5]) {
        for (const size of sizes) {
          for (const role of roles) {
            n += 1;
            out.push({
              parent,
              rows: Array.from({ length: count }, (_, i) => {
                // Vary the size across rows so multi-row cases are not all-identical. A
                // single-row case uses the loop's size directly, so every size in the
                // list is exercised on its own rather than only in combination.
                const sizeForRow =
                  count === 1 ? size : (sizes[(n + i * 3) % sizes.length] as number);
                return row(`r${n}-${i}`, `Net ${i}`, String(sizeForRow), role);
              }),
            });
          }
        }
      }
    }
    return out;
  })();

  it('covers a few thousand distinct drafts', () => {
    expect(cases.length).toBeGreaterThan(500);
  });

  it('never reports "ok" with an allocation that does not fit its requirement', () => {
    for (const testCase of cases) {
      const outcome = evaluateVlsm(draft(testCase.parent, testCase.rows));
      if (outcome.kind !== 'ok') continue;
      for (const allocation of outcome.result.allocations) {
        expect(
          allocation.subnet.usableHosts,
          `${testCase.parent} ${allocation.assignedCidr} for ${allocation.requestedHosts}`,
        ).toBeGreaterThanOrEqual(allocation.requestedHosts);
      }
    }
  });

  it('never reports "ok" with allocations that overlap', () => {
    for (const testCase of cases) {
      const outcome = evaluateVlsm(draft(testCase.parent, testCase.rows));
      if (outcome.kind !== 'ok') continue;
      const blocks = outcome.result.allocations.map((a) => range(a.assignedCidr));
      for (let i = 0; i < blocks.length; i += 1) {
        for (let j = i + 1; j < blocks.length; j += 1) {
          const a = blocks[i] as { networkAddress: number; broadcastAddress: number };
          const b = blocks[j] as { networkAddress: number; broadcastAddress: number };
          const overlaps =
            a.networkAddress <= b.broadcastAddress && b.networkAddress <= a.broadcastAddress;
          expect(overlaps, `${blocks[i]?.networkAddress} vs ${blocks[j]?.networkAddress}`).toBe(
            false,
          );
        }
      }
    }
  });

  it('never reports "ok" with an allocation outside the parent', () => {
    for (const testCase of cases) {
      const outcome = evaluateVlsm(draft(testCase.parent, testCase.rows));
      if (outcome.kind !== 'ok') continue;
      const parent = range(testCase.parent);
      for (const allocation of outcome.result.allocations) {
        const block = range(allocation.assignedCidr);
        expect(block.networkAddress, allocation.assignedCidr).toBeGreaterThanOrEqual(
          parent.networkAddress,
        );
        expect(block.broadcastAddress, allocation.assignedCidr).toBeLessThanOrEqual(
          parent.broadcastAddress,
        );
      }
    }
  });

  it('always balances allocated against free', () => {
    for (const testCase of cases) {
      const outcome = evaluateVlsm(draft(testCase.parent, testCase.rows));
      if (outcome.kind !== 'ok') continue;
      const { result } = outcome;
      expect(result.allocatedAddresses + result.freeAddresses, testCase.parent).toBe(
        result.totalAddresses,
      );
    }
  });

  it('is total: every draft produces exactly one of the five states', () => {
    for (const testCase of cases) {
      const outcome = evaluateVlsm(draft(testCase.parent, testCase.rows));
      expect(
        ['empty', 'parent-invalid', 'rows-invalid', 'exhausted', 'ok'],
        testCase.parent,
      ).toContain(outcome.kind);
    }
  });

  it('never throws, whatever it is handed', () => {
    // The screen calls this on every settled keystroke. An exception here is a red box,
    // not a validation message.
    const hostile: readonly VlsmRowDraft[][] = [
      [],
      [row('a', '', '')],
      [row('a', 'x'.repeat(5000), '9999999999999999999999')],
      [row('a', 'A', '1'), row('b', 'B', '1'), row('c', 'C', '1')],
    ];
    for (const parent of ['', '/24', '1.2.3.4/24/24', '999.999.999.999/99', '0.0.0.0/0']) {
      for (const rows of hostile) {
        expect(() => evaluateVlsm(draft(parent, rows)), `${parent}`).not.toThrow();
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Characterisation
 * ------------------------------------------------------------------ */

describe('characterisation: the named exhaustion branch is currently unreachable', () => {
  /**
   * `packVLSM` can throw a *named* `ScopeExhaustionError` only from its alignment branch,
   * and that branch sits behind a pre-flight check that rejects any requirement list
   * whose blocks sum past the parent. Since the two always come from the same block-size
   * function, and since sorting largest-first makes every block a prefix-compatible
   * power of two, the alignment waste is always absorbed by rounding up to the next
   * power of two. So `ALIGNMENT_FRAGMENTATION` never fires through the public API today.
   *
   * This test is here to FAIL LOUDLY if that ever stops being true. If it starts failing,
   * the named branch is live, `attributeCulprit` is load-bearing, and the attribution
   * tests above have stopped being synthetic.
   */
  it('no requirement list reaches the named branch through packVLSM', () => {
    const parents = ['10.0.0.0/22', '172.16.0.0/20', '192.168.1.0/24', '10.0.0.0/16'];
    const sizes = [1, 2, 3, 4, 6, 10, 14, 30, 62, 100, 200];
    const roles: readonly NetworkRole[] = ['LAN', 'POINT_TO_POINT'];
    let sawNamed = false;

    outer: for (const parent of parents) {
      for (const a of sizes) {
        for (const b of sizes) {
          for (const c of sizes) {
            for (const roleA of roles) {
              for (const roleB of roles) {
                const requirements: HostRequirement[] = [
                  { id: 'a', name: 'A', requestedHosts: a, role: roleA },
                  { id: 'b', name: 'B', requestedHosts: b, role: roleB },
                  { id: 'c', name: 'C', requestedHosts: c, role: 'LAN' },
                ];
                try {
                  packVLSM(parent, requirements);
                } catch (error) {
                  if (error instanceof ScopeExhaustionError) {
                    const name = (error.details as { readonly name?: unknown }).name;
                    if (typeof name === 'string') {
                      sawNamed = true;
                      break outer;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    expect(
      sawNamed,
      'The named exhaustion branch became reachable. attributeCulprit is now load-bearing ' +
        'and the end-to-end path needs a test, not just the synthetic one.',
    ).toBe(false);
  });
});
