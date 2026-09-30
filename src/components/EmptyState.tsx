/**
 * EmptyState - shown when a list or a screen has nothing to show.
 *
 * ## Why it is not a blank area
 *
 * An empty list is ambiguous. It means one of four things: nothing saved yet,
 * nothing matching the filter, still loading, or a bug. A blank screen reads as
 * the fourth one, so the user reloads, and if the cause is a filter they now
 * believe the app has lost their data.
 *
 * The fix is that `description` is required. The component cannot be used to
 * render a bare "No results", so every empty state in the app has to say *why* it
 * is empty and what to do about it. That requirement is the whole reason the
 * component is worth having - an optional description would be omitted exactly
 * where it is most needed.
 *
 * Loading is deliberately not an empty state. A spinner means "not yet"; an empty
 * state means "there is nothing", and showing the second while waiting for the
 * first tells a user their data is gone.
 */

import { type ReactNode } from 'react';
import { View } from 'react-native';
import { Inbox, type LucideIcon } from 'lucide-react-native';

import { AppText } from './AppText';
import { cn } from '@/utils/cn';

export interface EmptyStateProps {
  title: string;
  /** Why it is empty, and what to do about it. Required - see the note above. */
  description: string;
  /** Override the default icon. */
  icon?: LucideIcon | undefined;
  /** A call to action, usually a `Button`. */
  action?: ReactNode | undefined;
  className?: string | undefined;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  const Icon = icon ?? Inbox;

  return (
    <View
      // `accessibilityRole="summary"` groups the whole thing into one stop, so a
      // screen reader user hears the title and the explanation together instead
      // of walking three decorative nodes to reach the same information.
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${description}`}
      className={cn('items-center gap-2 px-gutter py-10', className)}
    >
      <View className="mb-1 h-12 w-12 items-center justify-center rounded-pill bg-surface-inset">
        <Icon size={22} strokeWidth={1.75} className="text-ink-faint" accessibilityElementsHidden />
      </View>

      <AppText variant="heading" center>
        {title}
      </AppText>
      <AppText variant="body" tone="muted" center className="max-w-read">
        {description}
      </AppText>

      {action === undefined ? null : <View className="mt-2">{action}</View>}
    </View>
  );
}
