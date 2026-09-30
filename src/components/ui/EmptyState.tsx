/**
 * EmptyState - shown when a list or screen has nothing to show.
 *
 * The description is required. An empty state without explanation
 * reads as a bug, not an empty list.
 */

import { type ReactNode } from 'react';
import { View } from 'react-native';
import { Inbox, type LucideIcon } from 'lucide-react-native';

import { AppText } from '../AppText';
import { cn } from '@/utils/cn';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: LucideIcon | undefined;
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
