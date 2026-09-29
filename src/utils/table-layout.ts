/**
 * The allocation table's column layout.
 *
 * PURE MODULE. No React, no React Native, no styling - just the numbers that decide how
 * wide each column is and when the table stops scrolling.
 *
 * ## Why these numbers are not in `SubnetTable.tsx`
 *
 * They are the one part of the table that can be checked without a device, and the check
 * is worth having: the scroll breakpoint is *derived* from the column widths, so a column
 * added without re-deriving it would silently produce a table that scrolls on a tablet
 * it could have shown as a grid, or clips on a phone it should have scrolled.
 *
 * R4 declined a component-test runner, which means anything left inside a `.tsx` is
 * effectively unverified. This is the part worth moving out.
 *
 * ## Fixed widths, not measured
 *
 * Each column has a fixed width so the columns line up down the whole table. Measuring
 * would be nicer on a wide screen and impossible on a narrow one, where a long subnet
 * name pushes the address columns off screen entirely. Fixed widths plus a horizontal
 * scroll is the arrangement that cannot break.
 *
 * ## Column keys are a closed set
 *
 * `COLUMN_KEYS` is a `const` tuple, and the component's accessor must be a total
 * `Record` over it. Adding a key without a way to read it is a compile error; leaving a
 * key with no column makes it an unused entry the compiler points at. A `switch` with a
 * `default: return ''` would have given neither.
 */

import type { VlsmTableRow } from './vlsm-view';

/** A dotted-quad address, or a grouped count. */
export const DATA_WIDTH = 96;

/** A CIDR with a prefix, e.g. `192.168.1.0/25`. */
export const CIDR_WIDTH = 132;

/** A percentage, much narrower than an address. */
export const PERCENT_WIDTH = 72;

/** The name column. Wide enough for "Management" plus an ellipsis, not much more. */
export const NAME_WIDTH = 160;

export const COLUMN_KEYS = [
  'cidr',
  'role',
  'network',
  'broadcast',
  'firstHost',
  'lastHost',
  'capacity',
  'requested',
  'wasted',
  'utilisation',
] as const;

export type ColumnKey = (typeof COLUMN_KEYS)[number];

export interface TableColumn {
  readonly key: ColumnKey;
  readonly label: string;
  readonly width: number;
  /** Header and cell alignment, held together so the two cannot disagree. */
  readonly align: 'left' | 'right';
}

/**
 * The data columns, in reading order.
 *
 * Identify the subnet, then its role, then what it covers, then how well it fits.
 * `Asked` sits next to `Capacity` rather than at the front, because the comparison that
 * actually matters is the pair.
 *
 * There is no VLAN column. The plan lists it as optional here, and it is omitted because
 * this screen has no VLAN input: a column of dashes teaches the reader nothing. VLANs
 * arrive with the hand-off to the Network Planner, which is the screen that collects them.
 * Recorded as a Phase 7 deviation in `PLAN.md`.
 */
/**
 * Frozen, so nothing can resize a column at runtime and leave the breakpoint describing a
 * layout that is no longer the one on screen. The freeze is shallow by design - a
 * `column.width = 40` would silently succeed and is not what this guards against.
 */
export const COLUMNS: readonly TableColumn[] = Object.freeze([
  { key: 'cidr', label: 'Subnet', width: CIDR_WIDTH, align: 'left' },
  { key: 'role', label: 'Role', width: DATA_WIDTH, align: 'left' },
  { key: 'network', label: 'Network', width: DATA_WIDTH, align: 'left' },
  { key: 'broadcast', label: 'Broadcast', width: DATA_WIDTH, align: 'left' },
  { key: 'firstHost', label: 'First host', width: DATA_WIDTH, align: 'left' },
  { key: 'lastHost', label: 'Last host', width: DATA_WIDTH, align: 'left' },
  { key: 'capacity', label: 'Capacity', width: DATA_WIDTH, align: 'right' },
  { key: 'requested', label: 'Asked', width: DATA_WIDTH, align: 'right' },
  { key: 'wasted', label: 'Wasted', width: DATA_WIDTH, align: 'right' },
  { key: 'utilisation', label: 'Used', width: PERCENT_WIDTH, align: 'right' },
] as TableColumn[]);

/** Total width of the scrolling columns. */
export const DATA_TOTAL = COLUMNS.reduce((sum, column) => sum + column.width, 0);

/**
 * Below this width the table scrolls sideways.
 *
 * Derived as `NAME_WIDTH + DATA_TOTAL` rather than typed as a round number, so the
 * breakpoint cannot disagree with the layout it chooses between.
 *
 * The derived value is 1132 points, which is wider than an iPad in either orientation
 * (768 portrait, 1024 landscape). That is a fact about ten columns of IPv4 data, not a
 * mistake, and it is recorded here because it changes what the grid branch in
 * `SubnetTable` actually does:
 *
 * - On every phone, and on a tablet in portrait, the table scrolls. This is the layout
 *   the widths above were designed for, and it is the one that matters.
 * - The grid is reached on a large tablet in landscape, on a desktop browser, and on web
 *   at a wide window. Real, but not the common case.
 *
 * Narrowing the columns to make a tablet reach the grid would mean either clipping an
 * address or dropping a column, and a half-readable table is worse than a scrolling one.
 * A shorter set of columns is the only way to buy the tablet layout, and that is a design
 * decision for the planner screen (Phase 8), which has a different, wider set of fields
 * to show and so can choose its own.
 */
export const SCROLL_BELOW = NAME_WIDTH + DATA_TOTAL;

/**
 * The one accessor that knows what each column shows.
 *
 * Total by construction, and each entry names its field explicitly, so `row.networkAdress`
 * is a compile error rather than a column that silently renders an empty string on a
 * screen full of addresses.
 */
export const COLUMN_ACCESSOR: Readonly<Record<ColumnKey, (row: VlsmTableRow) => string>> = {
  cidr: (row) => row.cidr,
  role: (row) => row.roleLabel,
  network: (row) => row.network,
  broadcast: (row) => row.broadcast,
  firstHost: (row) => row.firstHost,
  lastHost: (row) => row.lastHost,
  capacity: (row) => row.capacity,
  requested: (row) => row.requested,
  wasted: (row) => row.wasted,
  utilisation: (row) => row.utilisation,
};

/**
 * Which columns are set in the monospaced face.
 *
 * Addresses and counts are compared column-wise by eye - someone is checking that a /26
 * starts where the previous /25 ended - and that is a column of digits, which
 * proportional figures make unreadable.
 *
 * Percentages are digits too, but they are scanned for rather than compared down a
 * column, and the one figure the eye goes looking for should not look like an address.
 */
export const isMonospaced = (key: ColumnKey): boolean =>
  key !== 'cidr' && key !== 'role' && key !== 'utilisation';

/**
 * Which layout a window of this width gets.
 *
 * The comparison lives here, not in the component, so the inclusive/exclusive edge can be
 * tested. Written inline in a `.tsx` it is one character of difference between "grid" and
 * "scrolls" at exactly one width, and that width is the one no screenshot is taken at.
 *
 * At exactly `SCROLL_BELOW` the columns fit, so the grid is used. Below it they do not.
 */
export const usesGridLayout = (windowWidth: number): boolean => windowWidth >= SCROLL_BELOW;

/** Frozen, so a component cannot resize a column at runtime and desync the breakpoint. */
export const TABLE_LAYOUT = Object.freeze({
  scrollBelow: SCROLL_BELOW,
  nameWidth: NAME_WIDTH,
  dataTotal: DATA_TOTAL,
  columns: COLUMNS.map((column) => column.key),
});
