/**
 * Divider - a hairline between related rows.
 *
 * A border rather than a filled `View`. On a light background a 1pt filled
 * rectangle reads as a gap; a border reads as a rule. The `inset` prop pulls the
 * line back to where the text starts, which is what a list inside a card needs -
 * a full-bleed rule inside a rounded card looks like a rendering artefact.
 */

import { View, type ViewProps } from 'react-native';

import { cn } from '@/utils/cn';

export interface DividerProps extends ViewProps {
  /** Start the rule after the given horizontal padding class, e.g. `pl-4`. */
  inset?: string;
  /** Stronger rule, for a separation between groups rather than rows. */
  strong?: boolean;
}

export function Divider({ inset, strong = false, className, ...rest }: DividerProps) {
  return (
    <View
      accessibilityRole="none"
      className={cn('h-px w-full', strong ? 'bg-line' : 'bg-line-subtle', inset, className)}
      {...rest}
    />
  );
}
