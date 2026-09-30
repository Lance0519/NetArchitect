/**
 * Card - surface container for grouped content.
 *
 * Deliberately not over-styled. A card is a background and a border.
 * The border does the grouping; elevation shadows would become noise
 * at the density this app displays cards.
 */

import { type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { cn } from '@/utils/cn';

export type CardTone = 'default' | 'inset' | 'accent' | 'critical' | 'high' | 'medium' | 'info';

const TONE_CLASS: Readonly<Record<CardTone, string>> = Object.freeze({
  default: 'bg-surface border-line',
  inset: 'bg-surface-inset border-line-subtle',
  accent: 'bg-accent-soft border-accent/30',
  critical: 'bg-surface border-critical/50',
  high: 'bg-surface border-high/50',
  medium: 'bg-surface border-medium/50',
  info: 'bg-surface border-info/50',
});

const PADDING_CLASS = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-gutter-lg',
} as const;

export interface CardProps extends ViewProps {
  tone?: CardTone;
  padding?: keyof typeof PADDING_CLASS;
  children: ReactNode;
}

export function Card({
  tone = 'default',
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <View
      className={cn(
        'rounded-card border',
        TONE_CLASS[tone],
        PADDING_CLASS[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </View>
  );
}
