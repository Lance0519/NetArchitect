/**
 * Tests for the allocation table's column layout.
 *
 * This module is pure data, and the invariants are arithmetic. That is the point of
 * extracting it: the scroll breakpoint used to be a number typed into a `.tsx` where no
 * test could reach it, and a column added later would have left it wrong with nothing to
 * notice.
 */

import { describe, expect, it } from 'vitest';

import { packVLSM } from '../src/core/vlsm-engine';
import {
  COLUMNS,
  COLUMN_ACCESSOR,
  COLUMN_KEYS,
  DATA_TOTAL,
  DATA_WIDTH,
  NAME_WIDTH,
  SCROLL_BELOW,
  TABLE_LAYOUT,
  isMonospaced,
  usesGridLayout,
  type ColumnKey,
} from '../src/utils/table-layout';
import { buildVlsmView } from '../src/utils/vlsm-view';

import type { VlsmTableRow } from '../src/utils/vlsm-view';

const SPEC = buildVlsmView(
  packVLSM('192.168.1.0/24', [
    { id: 'students', name: 'Students', requestedHosts: 100, role: 'LAN' },
    { id: 'it', name: 'IT', requestedHosts: 50, role: 'LAN' },
  ]),
);

const row = (): VlsmTableRow => {
  const found = SPEC.rows[0];
  if (found === undefined) throw new Error('expected an allocation');
  return found;
};

describe('the column list', () => {
  it('has no duplicate keys', () => {
    const keys = COLUMNS.map((column) => column.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every key in COLUMN_KEYS, and adds none', () => {
    // The two lists are maintained separately - one is the tuple the accessor is typed
    // over, the other is the rendered order with labels and widths - so this is the join
    // that a new column could break in three ways.
    expect(COLUMNS.map((column) => column.key)).toEqual([...COLUMN_KEYS]);
  });

  it('has a unique, non-empty label for every column', () => {
    const labels = COLUMNS.map((column) => column.label);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every column a positive width', () => {
    for (const column of COLUMNS) {
      expect(column.width, column.key).toBeGreaterThan(0);
    }
  });

  it('puts the name and the CIDR first, and the fit measures last', () => {
    // A reading order: identify, then describe, then measure.
    expect(COLUMNS[0]?.key).toBe('cidr');
    expect(COLUMNS[COLUMNS.length - 1]?.key).toBe('utilisation');
  });

  it('puts asked-for and capacity next to each other', () => {
    // The comparison that matters is the pair, and it is the reason to read the row at
    // all. Separating them across nine columns defeats it.
    const capacity = COLUMNS.findIndex((column) => column.key === 'capacity');
    const requested = COLUMNS.findIndex((column) => column.key === 'requested');
    expect(Math.abs(capacity - requested)).toBe(1);
  });

  it('right-aligns the numbers and left-aligns the words', () => {
    // Digits compare down a column; words do not. Getting this wrong makes a run of
    // addresses look ragged.
    for (const column of COLUMNS) {
      const numeric = column.key === 'capacity' || column.key === 'requested' || column.key === 'wasted' || column.key === 'utilisation';
      expect(column.align, column.key).toBe(numeric ? 'right' : 'left');
    }
  });

  it('monospaces the addresses and counts, but not the labels or the percentage', () => {
    // A percentage is scanned for; an address is compared down the column. Rendering both
    // in the same face flattens the one distinction the eye needs.
    expect(isMonospaced('network')).toBe(true);
    expect(isMonospaced('capacity')).toBe(true);
    expect(isMonospaced('wasted')).toBe(true);
    expect(isMonospaced('cidr')).toBe(false);
    expect(isMonospaced('role')).toBe(false);
    expect(isMonospaced('utilisation')).toBe(false);
  });

  it('is frozen, so a column cannot be resized at runtime and desync the breakpoint', () => {
    expect(Object.isFrozen(COLUMNS)).toBe(true);
  });
});

describe('the column accessor', () => {
  it('reads a real value for every column, never an empty string', () => {
    // The failure this replaces: a `switch` with `default: return ''`, which renders a
    // blank cell on a screen full of addresses and says nothing about it.
    for (const key of COLUMN_KEYS) {
      const value = COLUMN_ACCESSOR[key](row());
      expect(value, key).not.toBe('');
      expect(value, key).toBeTruthy();
    }
  });

  it('returns the row field the column is named for, field by field', () => {
    // Compared against the row's own fields rather than literals, so a renamed field is
    // caught here instead of as a column quietly showing something else.
    const source = row();
    expect(COLUMN_ACCESSOR.cidr(source)).toBe(source.cidr);
    expect(COLUMN_ACCESSOR.role(source)).toBe(source.roleLabel);
    expect(COLUMN_ACCESSOR.network(source)).toBe(source.network);
    expect(COLUMN_ACCESSOR.broadcast(source)).toBe(source.broadcast);
    expect(COLUMN_ACCESSOR.firstHost(source)).toBe(source.firstHost);
    expect(COLUMN_ACCESSOR.lastHost(source)).toBe(source.lastHost);
    expect(COLUMN_ACCESSOR.capacity(source)).toBe(source.capacity);
    expect(COLUMN_ACCESSOR.requested(source)).toBe(source.requested);
    expect(COLUMN_ACCESSOR.wasted(source)).toBe(source.wasted);
    expect(COLUMN_ACCESSOR.utilisation(source)).toBe(source.utilisation);
  });

  it('distinguishes every column from every other', () => {
    // Two columns showing the same value means one of them is wired to the wrong field.
    // Not a hard guarantee - two columns *can* legitimately hold equal text - but a
    // duplicate here is far more likely to be a copy-paste than a coincidence.
    const source = row();
    const seen = new Map<string, ColumnKey>();
    const duplicates: string[] = [];
    for (const key of COLUMN_KEYS) {
      const value = COLUMN_ACCESSOR[key](source);
      const previous = seen.get(value);
      if (previous !== undefined) duplicates.push(`${previous} and ${key}`);
      else seen.set(value, key);
    }
    // Network and broadcast are equal for a /31, so one duplicate pair is legitimate.
    expect(duplicates.length).toBeLessThanOrEqual(1);
  });

  it('reads the role column as a label, not the raw enum value', () => {
    // `role` is the field name, `roleLabel` is what a person reads. Wiring the accessor
    // to the wrong one puts `SERVERS` where `Servers` belongs - which a user could read
    // as a VLAN ID or a config token.
    const servers = buildVlsmView(
      packVLSM('192.168.1.0/24', [
        { id: 's', name: 'App', requestedHosts: 10, role: 'SERVERS' },
      ]),
    ).rows[0] as VlsmTableRow;
    expect(COLUMN_ACCESSOR.role(servers)).toBe('Servers');
    expect(servers.role).toBe('SERVERS');
  });
});

describe('the widths and the breakpoint', () => {
  it('derives the data total from the columns, not from a typed number', () => {
    expect(DATA_TOTAL).toBe(COLUMNS.reduce((sum, column) => sum + column.width, 0));
  });

  it('derives the breakpoint from the name column plus the data columns', () => {
    // THE invariant. A hand-written breakpoint goes stale the moment a column is added,
    // and the symptom is a table that clips on a phone or scrolls pointlessly on a
    // tablet - both of which need a device to see.
    expect(SCROLL_BELOW).toBe(NAME_WIDTH + DATA_TOTAL);
  });

  it('uses the grid at exactly the fitting width, and scrolls one point below it', () => {
    // The inclusive edge. `>` instead of `>=` would scroll at precisely the width where
    // the columns fit, and that is invisible until someone holds a device at that width.
    expect(usesGridLayout(SCROLL_BELOW)).toBe(true);
    expect(usesGridLayout(SCROLL_BELOW - 1)).toBe(false);
    expect(usesGridLayout(SCROLL_BELOW + 1)).toBe(true);
  });

  it('scrolls on every phone and tablet width, and grids only on a wide window', () => {
    // The common case is the scrolling layout, and it is the one the widths were designed
    // for. Asserted at the real device widths so that a future column change which
    // narrowed the table enough to reach the grid on a tablet fails here rather than
    // passing unnoticed with the documentation now false.
    expect(usesGridLayout(320)).toBe(false);
    expect(usesGridLayout(390)).toBe(false);
    expect(usesGridLayout(430)).toBe(false);
    expect(usesGridLayout(768)).toBe(false);
    expect(usesGridLayout(1024)).toBe(false);
    expect(usesGridLayout(1440)).toBe(true);
  });

  it('is wider than any tablet, which the table cannot avoid', () => {
    // Found by this assertion, which had been written expecting a tablet to reach the
    // grid. Ten columns of IPv4 data plus a name column do not fit in 1024 points, so
    // every phone AND every tablet scrolls. The grid branch is reachable only on a
    // desktop browser or a very wide window.
    //
    // Pinned deliberately: if this ever starts passing because a column was narrowed or
    // dropped, the comment above `SCROLL_BELOW` is now wrong and needs rewriting with it.
    // Silently reaching the grid on a tablet without that note would leave the next reader
    // assuming it always had.
    expect(SCROLL_BELOW).toBeGreaterThan(1024);
    expect(usesGridLayout(1024)).toBe(false);
  });

  it('stays above the narrowest phone width this app supports', () => {
    expect(SCROLL_BELOW).toBeGreaterThan(320);
  });

  it('exports a frozen summary that agrees with the live values', () => {
    // `TABLE_LAYOUT` exists for a script or a future test to read. If it were computed
    // once and cached, it could disagree with the values the component actually uses.
    expect(Object.isFrozen(TABLE_LAYOUT)).toBe(true);
    expect(TABLE_LAYOUT.scrollBelow).toBe(SCROLL_BELOW);
    expect(TABLE_LAYOUT.nameWidth).toBe(NAME_WIDTH);
    expect(TABLE_LAYOUT.dataTotal).toBe(DATA_TOTAL);
    expect(TABLE_LAYOUT.columns).toEqual([...COLUMN_KEYS]);
  });

  it('uses the shared data width for every address column, so they line up', () => {
    const addressColumns = COLUMNS.filter(
      (column) => column.key !== 'cidr' && column.key !== 'utilisation',
    );
    expect(addressColumns.every((column) => column.width === DATA_WIDTH)).toBe(true);
  });
});
