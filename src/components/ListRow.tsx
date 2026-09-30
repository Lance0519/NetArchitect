/**
 * ListRow - one tappable row in a list.
 *
 * ## Why the whole row is the target, not the chevron
 *
 * A row that only responds when its chevron is tapped is the most common mobile
 * UI mistake, and it is usually invisible in a screenshot. It is also the single
 * largest accessibility problem in a list: the chevron becomes a tiny separate
 * control, and the row's text is not a control at all, so a screen reader user
 * hears a list of unlabelled text with occasional "button" somewhere off to the
 * right.
 *
 * Here the entire row is one Pressable with a label built from its own content,
 * and the chevron is marked decorative.
 *
 * ## The 44pt floor
 *
 * `min-h-touch`, even for a two-line row. A dense table of subnets would
 * otherwise be tappable at 32pt rows, which is below the platform minimum.
 */

import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { AppText } from './AppText';
import { cn } from '@/utils/cn';

export interface ListRowProps {
  title: string;
  /** Second line. Omit for a single-line row. */
  description?: string | undefined;
  /** Right-hand content: a badge, a count, a value. Not a control. */
  accessory?: ReactNode | undefined;
  /** Show the chevron. Turn off for rows that navigate nowhere. */
  navigates?: boolean;
  onPress?: () => void | undefined;
  className?: string | undefined;
}

export function ListRow({
  title,
  description,
  accessory,
  navigates = true,
  onPress,
  className,
}: ListRowProps) {
  const body = (
    <View
      className={cn(
        'min-h-touch flex-row items-center gap-3 px-4 py-3',
        onPress !== undefined && 'active:bg-surface-raised',
      )}
    >
      <View className="flex-1 gap-0.5">
        <AppText variant="subheading" numberOfLines={1}>
          {title}
        </AppText>
        {description === undefined ? null : (
          <AppText variant="caption" tone="faint" numberOfLines={2}>
            {description}
          </AppText>
        )}
      </View>

      {accessory === undefined ? null : <View className="shrink-0">{accessory}</View>}

      {navigates ? (
        <ChevronRight
          size={18}
          strokeWidth={2}
          className="shrink-0 text-ink-faint"
          aria-hidden
        />
      ) : null}
    </View>
  );

  if (onPress === undefined) {
    // `cn(...)` rather than `className` straight through. `cn` accepts `undefined`
    // and always returns a string, which sidesteps the `exactOptionalPropertyTypes`
    // rule that a raw RN prop cannot receive an explicit `undefined`. See
    // src/types/props.ts.
    return <View className={cn(className)}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      // The label is the row's own text, so the accessible name stays in sync
      // with what is on screen and cannot drift from it.
      accessibilityLabel={description === undefined ? title : `${title}. ${description}`}
      onPress={onPress}
      className={cn('min-h-touch', className)}
    >
      {body}
    </Pressable>
  );
}
