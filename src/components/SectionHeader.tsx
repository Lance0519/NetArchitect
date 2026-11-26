/**
 * SectionHeader - labels a group of related content with an accessible 44pt action trigger.
 */

import { Pressable, View } from 'react-native';

import { AppText } from './AppText';
import { cn } from '@/utils/cn';

export interface SectionHeaderProps {
  readonly title: string;
  readonly action?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly className?: string | undefined;
}

export function SectionHeader({ title, action, onAction, className }: SectionHeaderProps) {
  return (
    <View className={cn('flex-row items-center justify-between', className)}>
      <AppText variant="label" tone="faint">
        {title}
      </AppText>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onAction}
          className="min-h-touch justify-center px-1 active:opacity-70"
        >
          <AppText variant="caption" tone="accent">
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
