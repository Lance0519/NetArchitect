/**
 * IpResultCard - the subnet result.
 *
 * PRESENTATION ONLY. Every value, label, notice and tone decision arrives in the
 * {@link SubnetView} it is given; nothing here is computed. The screen passes a view
 * and this component draws it, which is why the "all 33 prefixes" exit criterion is
 * testable in `tests/subnet-view.test.ts` without rendering anything.
 *
 * ## Label left, value right, wrapping rather than truncating
 *
 * The obvious alternative - value under label - never overflows, and it costs
 * double the height for twelve rows. Label-left/value-right is the scannable choice
 * for comparing two results, and the reason it is safe here is that the value gets
 * `flex-1` and is allowed to wrap. A subnet mask is 15 characters; a usable range is
 * 27. At a 320 pt width with the label beside it, one of those two wraps and neither
 * is cut off. The label is `shrink-0` so a long value can never squeeze the name of
 * the thing it belongs to out of view.
 *
 * ## Every row is a copy button
 *
 * Tapping a row copies its value. That is the reason each row is a Pressable rather
 * than a View with a small copy icon on the right: a 20pt icon is below the platform
 * minimum target and is invisible to a screen reader unless labelled, and the value
 * itself is the natural target for a user who wants it.
 *
 * The accessible name is the label and the value together, so a screen reader reads
 * "Network address, 192.168.1.0" rather than two disconnected fragments. The hint
 * says what pressing does, because a button whose name is data does not otherwise
 * announce that it is actionable.
 */

import { Pressable, View } from 'react-native';
import { Copy, Info } from 'lucide-react-native';

import { AppText } from './AppText';
import { Badge, type BadgeTone } from './Badge';
import { Banner, type BannerTone } from './Banner';
import { Card } from './Card';
import { Divider } from './Divider';
import { cn } from '@/utils/cn';

import type { SubnetNotice, SubnetRow, SubnetView } from '@/utils/subnet-view';

export interface IpResultCardProps {
  readonly view: SubnetView;
  /** Called with the row's label and value when a row is tapped. */
  readonly onCopy: (label: string, value: string) => void;
}

/**
 * Map the model's semantic notice kind to a Banner tone.
 *
 * The model deliberately does not name a colour, because a model that named
 * `BannerTone` would be coupled to this component. The mapping lives here, in the one
 * place that knows both.
 */
const NOTICE_TONE: Record<SubnetNotice['kind'], BannerTone> = {
  info: 'info',
  warn: 'warn',
};

/**
 * Map an address space to a badge tone.
 *
 * The tone answers one question only: is this space routable on the public Internet,
 * or is it worth reading about? It does not encode which reserved block it is - the
 * label does that, and it does it precisely. Reusing a severity tone here would make
 * a shared-address-space block look like a security finding, which it is not.
 */
const addressSpaceTone = (view: SubnetView): BadgeTone =>
  view.addressSpace.isPublic ? 'neutral' : 'info';

/* ------------------------------------------------------------------ *
 * One row
 * ------------------------------------------------------------------ */

interface ResultRowProps {
  readonly row: SubnetRow;
  readonly onCopy: (label: string, value: string) => void;
  /** Hero rows get a larger value and a stronger tone. */
  readonly emphasis: boolean;
}

function ResultRow({ row, onCopy, emphasis }: ResultRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      // Label and value in one name. Two separate nodes would be announced as
      // unrelated text, and the value alone ("255.255.255.0") does not say what it is.
      accessibilityLabel={`${row.label}, ${row.value}`}
      accessibilityHint="Copies this value to the clipboard"
      onPress={() => {
        onCopy(row.label, row.value);
      }}
      className={cn(
        'min-h-touch flex-row items-start gap-3 rounded-[6px] px-2 py-2',
        'active:bg-surface-raised',
      )}
    >
      <AppText
        variant={emphasis ? 'subheading' : 'body'}
        tone="muted"
        numberOfLines={2}
        className="shrink-0"
        style={{ maxWidth: '46%' }}
      >
        {row.label}
      </AppText>

      <View className="flex-1 items-end">
        <AppText
          mono={row.mono}
          variant={emphasis ? 'subheading' : 'body'}
          // `primary` is the strongest ink; the detail rows use it too, because a
          // value the user may want to copy should not be the faintest thing on the
          // card. The hero rows are distinguished by size and by their label's tone
          // instead, which survives greyscale and a screen reader.
          tone="primary"
          className="text-right"
        >
          {row.value}
        </AppText>
        {row.note === undefined ? null : (
          <AppText variant="caption" tone="faint" className="pt-0.5 text-right">
            {row.note}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

export function IpResultCard({ view, onCopy }: IpResultCardProps) {
  return (
    <View className="gap-3">
      {/* Notices come first. A /31 or a /32 is surprising, and a user who has just
          been told their input was a host rather than a block should not have to
          scroll past twelve rows to find out. */}
      {/*
        The body is a plain string, deliberately.

        `Banner` renders its own tone icon and wraps `children` in an `AppText`. So
        passing a `<View>` here - as an earlier version did, to place a second icon
        beside the body - nests a View inside a native `<Text>`, which is unsupported
        on Android. And it would have drawn two icons, the second in a `text-warn`
        class that does not exist, so it would have rendered uncoloured. Both failures
        are invisible to `tsc`, to ESLint and to a passing `expo export`, and both are
        only reachable on a device. Letting Banner own its icon is also simply correct:
        `warn` already maps to `text-high`, so the colour matches the border and title
        by construction instead of by my having guessed the token.
      */}
      {view.notices.map((notice) => (
        <Banner
          key={notice.title}
          tone={NOTICE_TONE[notice.kind]}
          title={`${notice.title} · ${notice.citation}`}
        >
          {notice.body}
        </Banner>
      ))}

      <Card padding="none">
        {/* Header: which block this is, and what kind of space it sits in. */}
        <View className="gap-2 px-4 pb-3 pt-4">
          <View className="flex-row flex-wrap items-center gap-2">
            <AppText mono variant="title">
              {view.networkCidr}
            </AppText>
            <Badge tone={addressSpaceTone(view)}>{view.addressSpace.label}</Badge>
          </View>

          {view.addressSpace.guidance === null ? null : (
            <View className="flex-row items-start gap-2">
              <Info
                size={14}
                strokeWidth={2}
                className="mt-0.5 shrink-0 text-ink-faint"
                accessibilityElementsHidden
              />
              <AppText variant="caption" tone="faint" className="flex-1">
                {view.addressSpace.guidance} ({view.addressSpace.citation})
              </AppText>
            </View>
          )}
        </View>

        <Divider />

        {/* Hero: the four values the plan puts first. */}
        <View className="px-2 py-1">
          {view.hero.map((row) => (
            <ResultRow key={row.label} row={row} onCopy={onCopy} emphasis />
          ))}
        </View>

        <Divider />

        {/* Everything else. */}
        <View className="px-2 py-1">
          {view.detail.map((row) => (
            <ResultRow key={row.label} row={row} onCopy={onCopy} emphasis={false} />
          ))}
        </View>
      </Card>

      {/*
        The whole result as text, for pasting into a ticket or a terminal.

        The icon is a SIBLING of the text, not a child. `AppText` renders a native
        `<Text>`, and a react-native-svg element is a View: nesting one inside Text is
        unsupported on Android and unreliable on iOS, and it fails at runtime rather
        than at build time. A bundler exiting 0 says nothing about this, which is
        exactly why the layout is a row of siblings from the start rather than
        something to discover on a device.
      */}
      <View className="flex-row items-center gap-1.5">
        <Copy
          size={13}
          strokeWidth={2}
          className="shrink-0 text-ink-faint"
          accessibilityElementsHidden
        />
        <AppText variant="caption" tone="faint" className="flex-1">
          Tap any row to copy its value.
        </AppText>
      </View>
    </View>
  );
}
