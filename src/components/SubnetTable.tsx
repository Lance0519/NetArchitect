/**
 * The allocation table.
 *
 * Ten columns of IPv4 data, which does not fit on a phone. This component's whole job is
 * to make that legible rather than clipped.
 *
 * ## Two layouts, and which one you will actually see
 *
 * On a narrow window the table is a horizontal `ScrollView` with the name column pinned
 * outside the scroll area, so the reader always knows which row a set of addresses belongs
 * to. On a wide window it renders as a plain grid and the scroll disappears.
 *
 * The switch is on `useWindowDimensions`, not on a platform check, so a narrow desktop
 * window scrolls and a wide one does not.
 *
 * Ten columns of IPv4 data plus a name column needs 1132 points, which is wider than an
 * iPad in either orientation. So the scrolling layout is the one every phone and every
 * tablet gets; the grid appears on a desktop browser or a very wide window. The decision
 * is derived from the column widths rather than typed, so a future change to the columns
 * moves the breakpoint with them. `@/utils/table-layout` records this.
 *
 * ## The pinned column is a sibling, not `position: sticky`
 *
 * React Native has no `position: sticky` on Android, and the two platforms disagree about
 * what a sticky child inside a horizontal `ScrollView` does. So the name column is
 * rendered as a separate column to the left of the scroll view. It is more markup and it
 * behaves identically on both platforms.
 *
 * ## One cell renderer, two layouts
 *
 * `DataCells` and `NameCell` are the only things that know what a cell contains. The two
 * layouts differ in how they *arrange* them, not in what they show - so a column added in
 * one place appears in both, and the two cannot drift apart.
 *
 * The numbers are in `@/utils/table-layout`, not here, so the breakpoint can be checked
 * against the column widths without rendering anything. See that module for why.
 *
 * ## Every address is monospaced
 *
 * Addresses are compared column-wise by eye. The name column is not monospaced, because
 * names are prose.
 *
 * ## Trust is a word, not a colour
 *
 * An untrusted row is labelled "untrusted" as well as being toned. A row's trust cannot be
 * inferred from its addresses, and a colour alone leaves it invisible to a screen reader
 * and to anyone in greyscale.
 *
 * ## No error is rendered here
 *
 * The table only exists when every requirement validated, so there is nothing to report.
 * Errors appear on the requirement list above, which is on screen at the same time and is
 * where the user is looking when they can still do something about one.
 */

import { ScrollView, View, useWindowDimensions } from 'react-native';

import { AppText } from './AppText';
import { CidrBadge } from './Badge';
import { cn } from '@/utils/cn';
import {
  COLUMNS,
  COLUMN_ACCESSOR,
  DATA_TOTAL,
  NAME_WIDTH,
  isMonospaced,
  usesGridLayout,
} from '@/utils/table-layout';

import type { ColumnKey } from '@/utils/table-layout';
import type { VlsmTableRow } from '@/utils/vlsm-view';

/* ------------------------------------------------------------------ *
 * Cells
 * ------------------------------------------------------------------ */

/**
 * Read one cell.
 *
 * A lookup into the total `COLUMN_ACCESSOR` rather than a `switch`. A switch needs a
 * `default`, and a `default` that returns `''` is a column that renders blank on a screen
 * full of addresses with nothing to say so.
 */
const cellValue = (row: VlsmTableRow, key: ColumnKey): string => COLUMN_ACCESSOR[key](row);

const DataCells = ({ row }: { row: VlsmTableRow }) => (
  <>
    {COLUMNS.map((column) => (
      <View
        key={column.key}
        style={{ width: column.width }}
        className={cn('justify-center px-2 py-2.5', column.align === 'right' && 'items-end')}
      >
        {column.key === 'cidr' ? (
          <CidrBadge value={row.cidr} />
        ) : (
          <AppText
            variant="body"
            tone={column.key === 'utilisation' ? 'muted' : 'primary'}
            mono={isMonospaced(column.key)}
            numberOfLines={1}
          >
            {cellValue(row, column.key)}
          </AppText>
        )}
      </View>
    ))}
  </>
);

/**
 * The pinned name cell.
 *
 * `untrusted` is written out in words as well as being toned, because a row's trust
 * cannot be inferred from its addresses and stating it in colour alone would leave it
 * invisible to a screen reader and to anyone in greyscale.
 */
const NameCell = ({ row }: { row: VlsmTableRow }) => (
  <View style={{ width: NAME_WIDTH }} className="justify-center px-2 py-2.5">
    <View className="flex-row items-center gap-1.5">
      <AppText variant="body" tone="primary" numberOfLines={1} className="flex-1">
        {row.name}
      </AppText>
      {row.isUntrusted ? (
        <AppText variant="caption" tone="medium" numberOfLines={1}>
          untrusted
        </AppText>
      ) : null}
    </View>
  </View>
);

const NameHeader = () => (
  <View style={{ width: NAME_WIDTH }} className="justify-center px-2 py-2">
    <AppText variant="label" tone="faint" numberOfLines={1}>
      Name
    </AppText>
  </View>
);

const DataHeaders = () => (
  <>
    {COLUMNS.map((column) => (
      <View
        key={column.key}
        style={{ width: column.width }}
        className={cn('justify-center px-2 py-2', column.align === 'right' && 'items-end')}
      >
        <AppText variant="label" tone="faint" numberOfLines={1}>
          {column.label}
        </AppText>
      </View>
    ))}
  </>
);

/** Alternating background, so a wide row can be followed across ten columns. */
const stripe = (index: number): string => (index % 2 === 1 ? 'bg-surface-inset' : '');

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface SubnetTableProps {
  readonly rows: readonly VlsmTableRow[];
  readonly className?: string | undefined;
}

export function SubnetTable({ rows, className }: SubnetTableProps) {
  const { width } = useWindowDimensions();
  const scrolls = !usesGridLayout(width);

  if (!scrolls) {
    return (
      <View className={cn('overflow-hidden rounded-card border border-line', className)}>
        <View className="flex-row border-b border-line">
          <NameHeader />
          <DataHeaders />
        </View>
        {rows.map((row, index) => (
          <View key={row.id} className={cn('flex-row border-b border-line', stripe(index))}>
            <NameCell row={row} />
            <DataCells row={row} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View className={cn('overflow-hidden rounded-card border border-line', className)}>
      <View className="flex-row">
        {/*
          The horizontal scroll wraps the data columns only. The name column sits outside
          it, so scrolling right never hides which row you are reading - the one thing a
          horizontally scrolling table must not do.
        */}
        <View className="border-r border-line">
          <View className="border-b border-line">
            <NameHeader />
          </View>
          {rows.map((row, index) => (
            <View key={row.id} className={cn('border-b border-line', stripe(index))}>
              <NameCell row={row} />
            </View>
          ))}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          // Named as a scrollable region: a screen reader that cannot see the off-screen
          // columns needs to know they exist.
          accessibilityLabel={`Allocation table, ${rows.length} subnets, scroll right for addresses`}
          className="flex-1"
        >
          <View style={{ width: DATA_TOTAL }}>
            <View className="flex-row border-b border-line">
              <DataHeaders />
            </View>
            {rows.map((row, index) => (
              <View
                key={row.id}
                className={cn('flex-row border-b border-line', stripe(index))}
              >
                <DataCells row={row} />
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
