/**
 * SectionHeader - labels a group of related content.
 *
 * Used for "TOOLS", "RECENT PLANS", "SUMMARY", etc.
 * Keeps typography consistent across all section headers.
 */

import { View } from 'react-native';

import { AppText } from '../AppText';
import { cn } from '@/utils/cn';

export interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}

export function SectionHeader({ title, action, onAction, className }: SectionHeaderProps) {
  return (
    <View className={cn('flex-row items-center justify-between', className)}>
      <AppText variant="label" tone="faint">
        {title}
      </AppText>
      {action && onAction ? (
        <AppText variant="caption" tone="accent" onPress={onAction}>
          {action}
        </AppText>
      ) : null}
    </View>
  );
}
