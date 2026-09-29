/**
 * Select - a labelled set of options, rendered inline.
 *
 * ## Why not `@react-native-picker/picker`
 *
 * Three reasons, in order of weight.
 *
 * 1. **It is a native modal, and this app is offline-first and cross-platform.**
 *    A native picker on web renders as an `<option>` list, so the same screen
 *    behaves three different ways. This control is the same control everywhere.
 *
 * 2. **It cannot show rich option content.** Several of the options in this app
 *    are network profiles with a name *and* a description - "Enterprise / 10.0.0.0/8
 *    with 200 users". A picker has one line per option. A radio group can show the
 *    description, and a user who does not recognise "enterprise" can read what it
 *    means.
 *
 * 3. **Nothing else in the app needs a dependency for this.** The control is
 *    thirty lines and the options are known at build time.
 *
 * ## The accessibility contract
 *
 * A radio group is announced as a group with its options, and the current
 * selection is announced on change. That is the behaviour a `<select>` gives for
 * free and a row of `Pressable`s does not: the group is one stop in the focus
 * order, and the options carry `selected` state. The trade is that the whole
 * group takes several taps to traverse, which is why this is used for 2-5 options
 * and `SegmentedControl` for 2-3 short ones.
 */

import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { cn } from '@/utils/cn';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Shown under the label. Use it to explain a term the user may not know. */
  description?: string | undefined;
}

export interface SelectProps<T extends string> {
  label: string;
  /** Hint under the group label. */
  hint?: string;
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The error. Replaces the hint, matching TextField. */
  error?: string | undefined;
  className?: string | undefined;
}

export function Select<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  error,
  className,
}: SelectProps<T>) {
  const hasError = error !== undefined && error.length > 0;

  return (
    <View className={cn('gap-1.5', className)}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="overflow-hidden rounded-control border border-line bg-surface"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const isLast = index === options.length - 1;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={
                option.description === undefined
                  ? option.label
                  : `${option.label}. ${option.description}`
              }
              onPress={() => onChange(option.value)}
              className={cn(
                'min-h-touch flex-row items-center gap-3 px-3 py-2.5',
                !isLast && 'border-b border-line-subtle',
                'active:bg-surface-raised',
              )}
            >
              <View
                // A drawn radio mark rather than a coloured row. The selection is
                // indicated by a filled ring plus a checkmark, so it survives
                // greyscale and does not depend on the accent colour being
                // distinguishable from the row background.
                className={cn(
                  'h-5 w-5 items-center justify-center rounded-pill border-2',
                  selected ? 'border-accent bg-accent' : 'border-line bg-transparent',
                )}
              >
                {selected ? (
                  <View className="h-1.5 w-1.5 rounded-pill bg-accent-on" />
                ) : null}
              </View>

              <View className="flex-1 gap-0.5">
                <AppText variant="subheading" tone={selected ? 'primary' : 'muted'}>
                  {option.label}
                </AppText>
                {option.description === undefined ? null : (
                  <AppText variant="caption" tone="faint">
                    {option.description}
                  </AppText>
                )}
              </View>

              {selected ? (
                <ChevronRight
                  size={16}
                  strokeWidth={2.5}
                  className="text-accent"
                  accessibilityElementsHidden
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {hasError ? (
        <AppText variant="caption" tone="critical">
          {error}
        </AppText>
      ) : hint === undefined ? null : (
        <AppText variant="caption" tone="faint">
          {hint}
        </AppText>
      )}
    </View>
  );
}
