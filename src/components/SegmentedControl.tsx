/**
 * SegmentedControl - a small set of mutually exclusive options.
 *
 * The tab-bar pattern: 2 to 4 short options, all visible, one selected. Where
 * `Select` hides the alternatives behind a tap, this shows them, which is the
 * right trade when the whole point is comparing the options.
 *
 * ## The selected state is drawn three ways
 *
 * Background tint, a heavier font weight, and the accent border. Not colour
 * alone, for the same reason severity is not colour alone: the two options here
 * are "Light" and "Dark", and a light/dark toggle distinguished only by hue is
 * the worst possible case of the problem, because the one thing a reader with a
 * colour vision deficiency cannot reliably do is judge brightness of a tint.
 */

import { Pressable, View } from 'react-native';

import { AppText } from './AppText';
import { cn } from '@/utils/cn';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string | undefined;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <View className={cn('gap-1.5', className)}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row gap-1 rounded-control border border-line bg-surface-inset p-1"
      >
        {options.map((option) => {
          const selected = option.value === value;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              className={cn(
                'min-h-touch flex-1 items-center justify-center rounded-[7px] px-2 py-1.5',
                selected ? 'border border-accent bg-accent-soft' : 'border border-transparent',
                !selected && 'active:bg-surface-raised',
              )}
            >
              <AppText
                variant="label"
                tone={selected ? 'accent' : 'muted'}
                // Weight, not colour, is the second channel. `font-semibold`
                // overrides the `label` variant's `font-medium`.
                // `cn` rather than a bare conditional, so the value passed on is
                // always a string. See src/types/props.ts.
                className={cn(selected && 'font-semibold')}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
