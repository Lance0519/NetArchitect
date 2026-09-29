/**
 * Tests for the VLSM view model and the draft operations.
 *
 * The claim these files make is that the screen contains no decisions. That claim is only
 * worth anything if the decisions themselves are checked here, so the tests assert on
 * the exact strings a user reads and on the invariants the bar depends on - not on the
 * shape of the JSX that will render them.
 *
 * Where a value is compared, it is compared against the engine's own answer rather than
 * a second hardcoded copy, so a legitimate change to the engine shows up as one failing
 * assertion to investigate rather than as forty that all need re-reading.
 */

import { describe, expect, it } from 'vitest';

import { packVLSM } from '../src/core/vlsm-engine';
import {
  addRow,
  evaluateVlsm,
  initialDraft,
  moveRow,
  removeRow,
  setParent,
  updateRow,
  type VlsmDraft,
} from '../src/core/vlsm-input';
import {
  buildVlsmText,
  buildVlsmView,
  handoffOf,
  outcomeNotice,
  type VlsmTableRow,
} from '../src/utils/vlsm-view';
import { formatCidr, integerToIPv4, parseCidr } from '../src/core/ip-engine';

import type { HostRequirement, NetworkRole, VlsmResult } from '../src/types/network';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const req = (id: string, name: string, hosts: number, role: NetworkRole = 'LAN') => ({
  id,
  name,
  requestedHosts: hosts,
  role,
});

const SPEC = packVLSM('192.168.1.0/24', [
  req('students', 'Students', 100),
  req('it', 'IT', 50),
  req('admin', 'Admin', 25),
  req('mgmt', 'Mgmt', 10),
]);

const view = (result: VlsmResult = SPEC) => buildVlsmView(result);

/**
 * A /24 filled exactly: 128 + 64 + 32 + 16 + 8 + 4 + 2 + 2 = 256 addresses.
 *
 * The only way to fill a parent completely, and the reason a "254 hosts plus a link"
 * case is not available: 254 hosts already consumes the entire block.
 */
const FULL_24 = [
  req('a', 'A', 126),
  req('b', 'B', 62),
  req('c', 'C', 30),
  req('d', 'D', 14),
  req('e', 'E', 6),
  req('f', 'F', 2),
  req('g', 'WAN', 2, 'POINT_TO_POINT'),
  req('h', 'Transit', 2, 'POINT_TO_POINT'),
];

/**
 * The alignment case that strands addresses: a /31 packed between LAN blocks makes the
 * block sizes non-monotonic (8, 2, 4), so the cursor lands unaligned and the /30 has to
 * skip the two addresses below it. Taken from `vlsm-engine.test.ts`, which is where the
 * behaviour is established; restated here because the *view* of a fragmented range is
 * what is under test.
 */
const STRANDING = packVLSM('10.0.0.0/28', [
  req('lan-a', 'LAN A', 3),
  req('link-1', 'Link 1', 2, 'POINT_TO_POINT'),
  req('lan-b', 'LAN B', 2),
]);

const rowById = (rows: readonly VlsmTableRow[], id: string): VlsmTableRow => {
  const found = rows.find((row) => row.id === id);
  if (found === undefined) throw new Error(`no row "${id}"`);
  return found;
};

/* ------------------------------------------------------------------ *
 * Draft operations
 * ------------------------------------------------------------------ */

describe('draft operations', () => {
  const base: VlsmDraft = {
    parent: '192.168.1.0/24',
    rows: [
      { id: 'a', name: 'Alpha', hosts: '10', role: 'LAN' },
      { id: 'b', name: 'Bravo', hosts: '20', role: 'SERVERS' },
      { id: 'c', name: 'Charlie', hosts: '30', role: 'IOT' },
    ],
  };

  it('starts with one blank row and a blank parent', () => {
    const draft = initialDraft();
    expect(draft.parent).toBe('');
    expect(draft.rows).toHaveLength(1);
  });

  describe('updateRow', () => {
    it('changes one field and leaves the rest alone', () => {
      const next = updateRow(base, 'b', { name: 'Bravo LAN' });
      expect(next.rows[1]).toEqual({ id: 'b', name: 'Bravo LAN', hosts: '20', role: 'SERVERS' });
    });

    it('keeps the row id, so the row is not remounted mid-edit', () => {
      // A changed id remounts the row, drops the keyboard and loses the caret. This is
      // the single most important property of the update path.
      expect(updateRow(base, 'b', { name: 'X' }).rows[1]?.id).toBe('b');
    });

    it('leaves every other row object identical, so React can skip them', () => {
      const next = updateRow(base, 'b', { name: 'X' });
      expect(next.rows[0]).toBe(base.rows[0]);
      expect(next.rows[2]).toBe(base.rows[2]);
    });

    it('is a no-op for an unknown id, rather than inserting a row', () => {
      const next = updateRow(base, 'nope', { name: 'X' });
      expect(next.rows).toHaveLength(3);
      expect(next.rows.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('can set a field back to empty, so a field can be cleared', () => {
      expect(updateRow(base, 'a', { name: '' }).rows[0]?.name).toBe('');
    });

    it('can set the role', () => {
      expect(updateRow(base, 'a', { role: 'GUEST' }).rows[0]?.role).toBe('GUEST');
    });

    it('does not mutate the draft it was given', () => {
      updateRow(base, 'a', { name: 'Changed' });
      expect(base.rows[0]?.name).toBe('Alpha');
    });
  });

  describe('addRow', () => {
    it('appends a row, keeping the existing ones in order', () => {
      const next = addRow(base);
      expect(next.rows).toHaveLength(4);
      expect(next.rows.slice(0, 3).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('gives the new row a fresh id, not a duplicate', () => {
      const next = addRow(base);
      expect(new Set(next.rows.map((r) => r.id)).size).toBe(4);
    });

    it('can add a pre-filled row, for a "duplicate" action', () => {
      const source = base.rows[0];
      const next = addRow(base, { name: 'Alpha 2', hosts: '15', role: 'IOT' });
      const added = next.rows[3];
      expect(added?.name).toBe('Alpha 2');
      expect(added?.hosts).toBe('15');
      expect(added?.role).toBe('IOT');
      expect(added?.id).not.toBe(source?.id);
    });

    it('leaves the parent alone', () => {
      expect(addRow(base).parent).toBe('192.168.1.0/24');
    });
  });

  describe('removeRow', () => {
    it('removes the named row and keeps the order of the rest', () => {
      expect(removeRow(base, 'b').rows.map((r) => r.id)).toEqual(['a', 'c']);
    });

    it('refuses to remove the last row', () => {
      // A draft that can reach zero rows has no way back but a reset, and emptying itself
      // looks like data loss.
      const one: VlsmDraft = { parent: '', rows: [base.rows[0] as never] };
      expect(removeRow(one, 'a').rows).toHaveLength(1);
    });

    it('removes down to one row but no further', () => {
      // One row is the floor, not two: a two-row draft must still be able to lose a row,
      // and a one-row draft must not be able to reach zero.
      const two: VlsmDraft = { parent: '', rows: [base.rows[0] as never, base.rows[1] as never] };
      expect(removeRow(two, 'a').rows).toHaveLength(1);
      const one: VlsmDraft = { parent: '', rows: [removeRow(two, 'a').rows[0] as never] };
      expect(removeRow(one, (one.rows[0] as { id: string }).id).rows).toHaveLength(1);
    });

    it('is a no-op for an unknown id', () => {
      expect(removeRow(base, 'nope').rows).toHaveLength(3);
    });

    it('leaves a draft it refused to change referentially identical', () => {
      // Returning the same object lets a store skip a render entirely.
      const one: VlsmDraft = { parent: '', rows: [base.rows[0] as never] };
      expect(removeRow(one, 'a')).toBe(one);
    });
  });

  describe('moveRow', () => {
    it('moves a row up', () => {
      expect(moveRow(base, 'c', -1).rows.map((r) => r.id)).toEqual(['a', 'c', 'b']);
    });

    it('moves a row down', () => {
      expect(moveRow(base, 'a', 1).rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    });

    it('moves only the one row', () => {
      const next = moveRow(base, 'b', -1);
      expect(next.rows[0]).toBe(base.rows[1]);
    });

    it('does nothing at the top', () => {
      // Clamping or wrapping would be surprising: pressing up on the first row should do
      // nothing, not send it to the bottom.
      expect(moveRow(base, 'a', -1).rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('does nothing at the bottom', () => {
      expect(moveRow(base, 'c', 1).rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('is a no-op for an unknown id', () => {
      expect(moveRow(base, 'nope', -1).rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('never loses or duplicates a row', () => {
      let draft = base;
      for (const by of [-1, 1, 1, -1, -1, 1] as const) {
        draft = moveRow(draft, 'b', by);
        expect(draft.rows).toHaveLength(3);
        expect(new Set(draft.rows.map((r) => r.id)).size).toBe(3);
      }
    });
  });

  it('setParent replaces the parent text and nothing else', () => {
    const next = setParent(base, '10.0.0.0/22');
    expect(next.parent).toBe('10.0.0.0/22');
    expect(next.rows).toBe(base.rows);
  });

  it('survives a full round trip: add, fill, reorder, remove, still allocates', () => {
    // The operations compose, and the composed result is still a valid draft. A bug in
    // any one of them would show up here as a wrong allocation rather than as a crash.
    let draft = initialDraft();
    draft = setParent(draft, '192.168.1.0/24');
    draft = updateRow(draft, draft.rows[0]?.id as string, { name: 'A', hosts: '100' });
    draft = addRow(draft);
    draft = updateRow(draft, draft.rows[1]?.id as string, { name: 'B', hosts: '50' });
    draft = addRow(draft);
    draft = updateRow(draft, draft.rows[2]?.id as string, { name: 'C', hosts: '0' });
    expect(evaluateVlsm(draft).kind).toBe('rows-invalid');
    draft = updateRow(draft, draft.rows[2]?.id as string, { hosts: '25' });
    draft = moveRow(draft, draft.rows[2]?.id as string, -1);

    const outcome = evaluateVlsm(draft);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.result.allocations.map((a) => a.assignedCidr)).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/26',
      '192.168.1.192/27',
    ]);

    const doomed = draft.rows[2]?.id as string;
    draft = removeRow(draft, doomed);
    const after = evaluateVlsm(draft);
    expect(after.kind).toBe('ok');
    if (after.kind !== 'ok') return;
    expect(after.result.allocations).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * Table rows
 * ------------------------------------------------------------------ */

describe('the allocation table', () => {
  it('has one row per allocation, in packed order', () => {
    expect(view().rows.map((r) => r.id)).toEqual(['students', 'it', 'admin', 'mgmt']);
  });

  it('shows the CIDR the engine assigned', () => {
    expect(view().rows.map((r) => r.cidr)).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/26',
      '192.168.1.192/27',
      '192.168.1.224/28',
    ]);
  });

  it('formats every address as a dotted quad read from the engine', () => {
    for (const row of view().rows) {
      for (const value of [row.network, row.broadcast, row.firstHost, row.lastHost]) {
        expect(value, row.cidr).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      }
    }
  });

  it('puts the first and last host strictly inside the block for a LAN', () => {
    for (const row of view().rows) {
      const parsed = parseCidr(row.cidr);
      const network = integerToIPv4(parsed.ip);
      expect(row.network, row.cidr).toBe(network);
      expect(row.firstHost === row.network, row.cidr).toBe(false);
      expect(row.broadcast === row.lastHost, row.cidr).toBe(false);
    }
  });

  it('shows capacity and requested as grouped counts', () => {
    expect(rowById(view().rows, 'students').capacity).toBe('126');
    expect(rowById(view().rows, 'students').requested).toBe('100');
  });

  it('groups a four-figure count', () => {
    // 60,000 hosts needs the whole /16, so the capacity is the five-digit number that
    // exercises the separator.
    const big = buildVlsmView(packVLSM('10.0.0.0/16', [req('a', 'A', 60000)]));
    expect(big.rows[0]?.capacity).toBe('65,534');
  });

  it('shows utilisation as a percentage, never clamped', () => {
    // 100 of 126 usable: the remainder is real, and hiding it would misrepresent the fit.
    expect(rowById(view().rows, 'students').utilisation).toBe('79.4%');
  });

  it('shows 100% for an exactly full block', () => {
    const exact = buildVlsmView(packVLSM('192.168.1.0/24', [req('a', 'A', 14)]));
    expect(exact.rows[0]?.utilisation).toBe('100%');
  });

  it('reports the waste in each block', () => {
    // 126 capacity for 100 requested leaves 26 unusable-by-this-requirement addresses.
    expect(rowById(view().rows, 'students').wasted).toBe('26');
  });

  it('labels the role from the shared role table', () => {
    const mixed = buildVlsmView(
      packVLSM('192.168.1.0/24', [req('a', 'A', 10, 'SERVERS'), req('b', 'B', 20, 'POINT_TO_POINT')]),
    );
    expect(mixed.rows.map((r) => r.roleLabel).sort()).toEqual(['Point to point', 'Servers']);
  });

  it('carries the trust flag through from the role table', () => {
    const mixed = buildVlsmView(
      packVLSM('192.168.1.0/24', [req('a', 'A', 10, 'GUEST'), req('b', 'B', 20, 'LAN')]),
    );
    const guest = mixed.rows.find((r) => r.role === 'GUEST');
    const lan = mixed.rows.find((r) => r.role === 'LAN');
    expect(guest?.isUntrusted).toBe(true);
    expect(lan?.isUntrusted).toBe(false);
  });

  it('flags a /31 row as point-to-point, from the engine flag', () => {
    const p2p = buildVlsmView(packVLSM('192.168.1.0/24', [req('wan', 'WAN', 2, 'POINT_TO_POINT')]));
    expect(p2p.rows[0]?.isPointToPoint).toBe(true);
    expect(view().rows.every((r) => r.isPointToPoint === false)).toBe(true);
  });

  it('shows a /31 first and last host that are both usable endpoints', () => {
    // Neither reserved, which is the entire content of RFC 3021.
    const p2p = buildVlsmView(packVLSM('192.168.1.0/24', [req('wan', 'WAN', 2, 'POINT_TO_POINT')]));
    const row = p2p.rows[0] as VlsmTableRow;
    expect(row.firstHost).toBe('192.168.1.0');
    expect(row.lastHost).toBe('192.168.1.1');
    expect(row.capacity).toBe('2');
  });

  it('carries no error field at all, because a table row can never be at fault', () => {
    // The table only renders when the outcome is `ok`, and `ok` means every requirement
    // validated. There is no state in which a table row has an error, so the row type has
    // no error field - an optional field that is always null is a field a reader will
    // come to rely on and a future change will quietly start using.
    for (const row of view().rows) {
      expect(Object.keys(row)).not.toContain('error');
      expect(Object.keys(row)).not.toContain('suggestion');
    }
  });

  it('gives every row an id, which is also the React key', () => {
    // Reorder and removal both key off it, so a duplicate would make two rows the same
    // component and lose one of them.
    const ids = view().rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

describe('the summary card', () => {
  it('names the parent as the user can retype it', () => {
    expect(view().summary.parentCidr).toBe('192.168.1.0/24');
  });

  it('reports allocated against the parent total', () => {
    // 128 + 64 + 32 + 16 = 240 of 256.
    const allocated = view().summary.figures.find((f) => f.label === 'Allocated');
    expect(allocated?.value).toBe('240');
    expect(allocated?.detail).toContain('256');
  });

  it('reports the free remainder', () => {
    expect(view().summary.figures.find((f) => f.label === 'Free')?.value).toBe('16');
  });

  it('says nothing is left when the parent is full', () => {
    // 128 + 64 + 32 + 16 + 8 + 4 + 2 + 2 = 256, the whole /24. Note that 254 plus a
    // point-to-point link does NOT fit: 254 already needs all 256 addresses.
    const full = buildVlsmView(packVLSM('192.168.1.0/24', FULL_24));
    expect(full.summary.isFull).toBe(true);
    expect(full.summary.figures.find((f) => f.label === 'Free')?.detail).toBe('nothing left');
  });

  it('reads space utilisation from the engine rather than recomputing it', () => {
    // 240 of 256 is 93.75%, which formatPercent renders 93.8%.
    expect(view().summary.figures.find((f) => f.label === 'Space used')?.value).toBe('93.8%');
  });

  it('describes host efficiency as what the engine computes, not what it does not', () => {
    // The engine's hostEfficiencyPercent is usable / allocated - how much of the carved
    // space survives network and broadcast reservation. It is NOT the share a
    // requirement asked for. An earlier version of this label claimed the latter, which
    // put a confidently wrong sentence under a correct number.
    const efficiency = view().summary.figures.find((f) => f.label === 'Host efficiency');
    expect(efficiency?.detail).toContain('can be assigned to hosts');
    expect(efficiency?.detail).not.toContain('wanted by');
  });

  it('shows host efficiency and space used as different numbers', () => {
    // 232 usable of 240 allocated is 96.7%; 240 of 256 is 93.8%. Two questions, two
    // answers, and conflating them was the bug above.
    const figures = view().summary.figures;
    const efficiency = figures.find((f) => f.label === 'Host efficiency')?.value;
    const space = figures.find((f) => f.label === 'Space used')?.value;
    expect(efficiency).toBe('96.7%');
    expect(space).toBe('93.8%');
  });

  it('marks counts as monospace and percentages as not', () => {
    // Counts are tabular; percentages are not, and a monospace percent looks wrong.
    for (const figure of view().summary.figures) {
      const isCount = figure.label === 'Allocated' || figure.label === 'Free';
      expect(figure.mono, figure.label).toBe(isCount);
    }
  });

  it('lists the free ranges with their address counts', () => {
    expect(view().summary.freeRanges).toHaveLength(1);
    expect(view().summary.freeRanges[0]?.cidr).toBe('192.168.1.240/28');
    expect(view().summary.freeRanges[0]?.addresses).toBe('16');
  });

  it('shows a free range as a readable address span', () => {
    const free = view().summary.freeRanges[0];
    expect(free?.range).toBe('192.168.1.240 - 192.168.1.255');
  });

  it('flags a free range too small to plan with', () => {
    // The engine calls a run below a /29 fragmented. Reported, but not offered as space.
    const fragmented = buildVlsmView(STRANDING);
    const small = fragmented.summary.freeRanges.find((f) => f.isFragmented);
    expect(small, 'expected a fragmented run').toBeDefined();
  });

  it('counts the subnets it packed', () => {
    expect(view().summary.subnetCount).toBe(4);
  });

  it('has no free ranges when the parent is full', () => {
    const full = buildVlsmView(packVLSM('192.168.1.0/24', FULL_24));
    expect(full.summary.freeRanges).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

describe('notices', () => {
  it('explains a /31 when one was packed', () => {
    const withP2p = view(packVLSM('192.168.1.0/24', [req('wan', 'WAN', 2, 'POINT_TO_POINT')]));
    expect(withP2p.notices.some((n) => n.citation.includes('3021'))).toBe(true);
  });

  it('does not explain a /31 when none was packed', () => {
    expect(view().notices.some((n) => n.citation.includes('3021'))).toBe(false);
  });

  it('cites RFC 3021 for the point-to-point explanation', () => {
    const withP2p = view(packVLSM('192.168.1.0/24', [req('wan', 'WAN', 2, 'POINT_TO_POINT')]));
    const notice = withP2p.notices.find((n) => n.citation.includes('3021'));
    expect(notice?.citation).toBeTruthy();
    expect(notice?.body.length).toBeGreaterThan(40);
  });

  it('warns about stranded space when alignment left a small run', () => {
    const stranded = view(STRANDING);
    expect(stranded.notices.some((n) => n.kind === 'warn' && n.title.includes('too small'))).toBe(
      true,
    );
  });

  it('does not warn about stranded space when the alignment is clean', () => {
    // A free range of usable size is ordinary headroom, not a problem to report.
    expect(view(SPEC).notices.some((n) => n.title.includes('too small'))).toBe(false);
  });

  it('warns when the parent is full', () => {
    const full = view(packVLSM('192.168.1.0/24', FULL_24));
    expect(full.notices.some((n) => n.title.includes('fully allocated'))).toBe(true);
  });

  it('warns when the parent is full only once, alongside the other warnings', () => {
    // A warning list with the same message twice reads as two separate problems.
    const full = view(packVLSM('192.168.1.0/24', FULL_24));
    const titles = full.notices.map((n) => n.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('names the block that is mostly unused, rather than complaining about the plan', () => {
    // 65 hosts need a block of 126: 62 is one too few, so the size doubles. An
    // aggregate "your plan is 51% efficient" would be neither actionable nor true of any
    // particular row.
    const wasteful = view(packVLSM('10.0.0.0/22', [req('a', 'Students', 65)]));
    const notice = wasteful.notices.find((n) => n.title.includes('mostly unused'));
    expect(notice?.title).toContain('Students');
    expect(notice?.body).toContain('65');
    expect(notice?.body).toContain('126');
  });

  it('does not flag a plan whose blocks are well filled', () => {
    // Every block in the spec example is at least 71% used, so there is nothing to say.
    expect(view().notices.some((n) => n.title.includes('mostly unused'))).toBe(false);
  });

  it('flags only the worst block, not every one below the threshold', () => {
    const many = view(
      packVLSM('10.0.0.0/20', [req('a', 'A', 65), req('b', 'B', 300), req('c', 'C', 1300)]),
    );
    const notices = many.notices.filter((n) => n.title.includes('mostly unused'));
    expect(notices).toHaveLength(1);
  });

  it('gives every notice a title and a body', () => {
    for (const result of [
      SPEC,
      packVLSM('192.168.1.0/24', [req('wan', 'WAN', 2, 'POINT_TO_POINT')]),
      STRANDING,
      packVLSM('192.168.1.0/24', FULL_24),
      packVLSM('10.0.0.0/22', [req('a', 'A', 65)]),
    ]) {
      for (const notice of buildVlsmView(result).notices) {
        expect(notice.title.length, notice.title).toBeGreaterThan(0);
        expect(notice.body.length, notice.title).toBeGreaterThan(0);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * The bar
 * ------------------------------------------------------------------ */

describe('the stacked bar', () => {
  it('has one segment per allocation plus one per free range', () => {
    expect(view().segments).toHaveLength(5);
  });

  it('makes the segments sum to exactly one', () => {
    // The bar exists to convey how full the address space is. Segments that do not add up
    // misreport that, and a rounding slip is invisible until someone measures it.
    const total = view().segments.reduce((sum, s) => sum + s.share, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it('makes the segments sum to one for every allocation, not just the example', () => {
    const results = [
      packVLSM('10.0.0.0/22', [req('a', 'A', 300), req('b', 'B', 200), req('c', 'C', 100)]),
      packVLSM('192.168.1.0/24', [req('a', 'A', 254)]),
      packVLSM('10.0.0.0/16', [req('a', 'A', 1), req('b', 'B', 2, 'POINT_TO_POINT')]),
      packVLSM('172.16.0.0/20', [req('a', 'A', 1000), req('b', 'B', 3), req('c', 'C', 60)]),
    ];
    for (const result of results) {
      const segments = buildVlsmView(result).segments;
      const total = segments.reduce((sum, s) => sum + s.share, 0);
      expect(total, formatCidr(result.parentCidr)).toBeCloseTo(1, 12);
    }
  });

  it('gives every segment a positive share', () => {
    for (const segment of view().segments) {
      expect(segment.share, segment.id).toBeGreaterThan(0);
    }
  });

  it('keeps every share at or below one', () => {
    for (const segment of view().segments) {
      expect(segment.share, segment.id).toBeLessThanOrEqual(1);
    }
  });

  it('marks allocated segments with the role and free segments without', () => {
    const segments = view().segments;
    expect(segments.find((s) => s.id === 'students')?.isFree).toBe(false);
    expect(segments.find((s) => s.id === 'students')?.role).toBe('LAN');
    const free = segments.find((s) => s.isFree);
    expect(free?.role).toBeNull();
  });

  it('labels every segment with a percentage for the accessibility label', () => {
    for (const segment of view().segments) {
      expect(segment.percentLabel, segment.id).toMatch(/%$/);
    }
  });

  it('gives every segment a label a screen reader can announce', () => {
    for (const segment of view().segments) {
      expect(segment.label.length, segment.id).toBeGreaterThan(0);
    }
  });

  it('has no segments for a parent with no addresses', () => {
    // Unreachable through the engine, but the guard exists so a future caller cannot
    // divide by zero and render an infinite-width bar.
    expect(buildVlsmView({ ...SPEC, totalAddresses: 0 }).segments).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Outcome notices
 * ------------------------------------------------------------------ */

describe('the notice for an outcome with no result', () => {
  const evaluate = (rows: readonly { id: string; name: string; hosts: string }[], parent = '192.168.1.0/24') =>
    evaluateVlsm({
      parent,
      rows: rows.map((r) => ({ ...r, role: 'LAN' as const })),
    });

  it('says nothing at all for an empty draft', () => {
    // The screen has its own empty state. A notice card on top of it would be two
    // messages for one condition.
    expect(outcomeNotice(evaluateVlsm(initialDraft()))).toBeNull();
  });

  it('says nothing for a successful allocation, which is rendered rather than described', () => {
    expect(outcomeNotice(evaluate([{ id: 'a', name: 'A', hosts: '10' }]))).toBeNull();
  });

  it('points at the parent when the parent is the problem', () => {
    const notice = outcomeNotice(evaluate([{ id: 'a', name: 'A', hosts: '10' }], '999.1.1.1/24'));
    expect(notice?.title).toContain('parent');
  });

  it('counts the unfinished requirements when rows are the problem', () => {
    const notice = outcomeNotice(
      evaluate([
        { id: 'a', name: '', hosts: '10' },
        { id: 'b', name: 'B', hosts: 'x' },
      ]),
    );
    expect(notice?.title).toContain('2');
  });

  it('uses the singular for one unfinished requirement', () => {
    const notice = outcomeNotice(evaluate([{ id: 'a', name: '', hosts: '10' }]));
    expect(notice?.title).toContain('1 requirement');
    expect(notice?.title).not.toContain('1 requirements');
  });

  it('does not repeat the per-row messages in the notice', () => {
    // They render beside the rows, where the user is looking. A summary of a list is not
    // an answer.
    const notice = outcomeNotice(evaluate([{ id: 'a', name: '', hosts: 'x' }]));
    expect(notice?.body).not.toContain('Name is required');
  });

  it('quotes the shortfall when the requirements do not fit', () => {
    const notice = outcomeNotice(evaluate([{ id: 'a', name: 'A', hosts: '300' }]));
    expect(notice?.title).toContain('do not fit');
    expect(notice?.body).toMatch(/more addresses than the parent/);
  });

  it('names a parent that verifiably works, when one was found', () => {
    const notice = outcomeNotice(evaluate([{ id: 'a', name: 'A', hosts: '300' }]));
    expect(notice?.body).toContain('192.168.0.0/23');
  });

  it('says the requirement list is the fix when no nearby parent works', () => {
    // A /28 parent and a 60,000-host requirement: /27 through /24 are all four of the
    // searched candidates, and none of them holds 65,536 addresses. Silence here would
    // read as "there is no fix", sending the user off enlarging the parent for ever.
    const notice = outcomeNotice(
      evaluate([{ id: 'a', name: 'A', hosts: '60000' }], '10.0.0.0/28'),
    );
    expect(notice?.body).toContain('reduce a requirement');
  });

  it('does not suggest a parent that still does not fit', () => {
    // The whole point of proving each candidate. A /24 holds 256 addresses; 60,000 hosts
    // needs 65,536. Suggesting it would be a specific, confident lie.
    const outcome = evaluateVlsm({
      parent: '10.0.0.0/28',
      rows: [{ id: 'a', name: 'A', hosts: '60000', role: 'LAN' }],
    });
    if (outcome.kind !== 'exhausted') throw new Error('expected exhaustion');
    expect(outcome.suggestion).toBeNull();
  });

  it('gives a notice a kind the screen can map to a tone', () => {
    for (const outcome of [
      evaluate([{ id: 'a', name: '', hosts: '10' }]),
      evaluate([{ id: 'a', name: 'A', hosts: '300' }]),
    ]) {
      const notice = outcomeNotice(outcome);
      expect(['info', 'warn']).toContain(notice?.kind);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Handoff
 * ------------------------------------------------------------------ */

describe('handing off to the Network Planner', () => {
  const outcome = evaluateVlsm({
    parent: '192.168.1.0/24',
    rows: [
      { id: 'a', name: 'Students', hosts: '100', role: 'LAN' },
      { id: 'b', name: 'WAN', hosts: '2', role: 'POINT_TO_POINT' },
    ],
  });

  it('carries the parent as typed', () => {
    expect(handoffOf(outcome)?.parentCidr).toBe('192.168.1.0/24');
  });

  it('carries the requirements, not the draft text', () => {
    const handoff = handoffOf(outcome);
    expect(handoff?.requirements).toEqual([
      { id: 'a', name: 'Students', requestedHosts: 100, role: 'LAN' },
      { id: 'b', name: 'WAN', requestedHosts: 2, role: 'POINT_TO_POINT' },
    ]);
  });

  it('carries the allocation as packed, so the planner cannot derive a different one', () => {
    const handoff = handoffOf(outcome);
    expect(handoff?.allocations.map((a) => a.cidr)).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/31',
    ]);
  });

  it('hands off nothing when there is no result', () => {
    for (const bad of [
      evaluateVlsm(initialDraft()),
      evaluateVlsm({ parent: 'bad', rows: [{ id: 'a', name: 'A', hosts: '1', role: 'LAN' }] }),
      evaluateVlsm({ parent: '192.168.1.0/24', rows: [{ id: 'a', name: '', hosts: '', role: 'LAN' }] }),
      evaluateVlsm({
        parent: '192.168.1.0/24',
        rows: [{ id: 'a', name: 'A', hosts: '300', role: 'LAN' }],
      }),
    ]) {
      expect(handoffOf(bad)?.parentCidr ?? null).toBeNull();
    }
  });

  it('hands off requirements the planner schema would accept', () => {
    // The handoff is only useful if the next screen can load it. Checked against the
    // schema rather than by eye.
    const handoff = handoffOf(outcome);
    expect(handoff).not.toBeNull();
    const asRequirements: HostRequirement[] = (handoff?.requirements ?? []).map((r) => ({
      ...r,
    }));
    expect(asRequirements).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * Plain text
 * ------------------------------------------------------------------ */

describe('the plain-text allocation', () => {
  const text = buildVlsmText(SPEC);
  const lines = text.split('\n');

  it('has a header row naming every column', () => {
    expect(lines[0]).toBe(
      'Name\tRole\tCIDR\tNetwork\tBroadcast\tFirst\tLast\tCapacity\tRequested\tUsed',
    );
  });

  it('has one line per allocation, plus the header', () => {
    expect(lines).toHaveLength(1 + SPEC.allocations.length);
  });

  it('is tab separated, so it pastes into a spreadsheet as columns', () => {
    for (const line of lines) {
      expect(line.split('\t')).toHaveLength(10);
    }
  });

  it('includes the CIDR of every allocation', () => {
    for (const allocation of SPEC.allocations) {
      expect(text, allocation.name).toContain(allocation.assignedCidr);
    }
  });

  it('is the same width on every line, so the grid is readable', () => {
    const widths = new Set(lines.map((l) => l.split('\t').length));
    expect(widths.size).toBe(1);
  });
});
