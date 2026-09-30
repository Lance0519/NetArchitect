/**
 * Button - primary interactive element.
 *
 * Four variants: primary (accent), secondary (surface), ghost (transparent), danger (critical).
 * Three sizes: sm, md, lg. All meet the 44pt minimum touch target.
 *
 * Pressed state is driven by the platform's press state, not a timer.
 */

import { cloneElement, isValidElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../AppText';
import { useTheme } from '@/theme';
import { cn } from '@/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const CONTAINER: Record<ButtonVariant, string> = {
  primary: 'bg-accent border-accent',
  secondary: 'bg-surface border-line',
  ghost: 'bg-transparent border-transparent',
  danger: 'bg-critical border-critical',
};

const LABEL_TONE: Record<ButtonVariant, 'onAccent' | 'primary' | 'accent'> = {
  primary: 'onAccent',
  secondary: 'primary',
  ghost: 'accent',
  danger: 'onAccent',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 gap-1.5',
  md: 'px-4 py-2.5 gap-2',
  lg: 'px-gutter py-3.5 gap-2',
};

const LABEL_VARIANT: Record<ButtonSize, 'label' | 'subheading'> = {
  sm: 'label',
  md: 'subheading',
  lg: 'subheading',
};

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style' | 'className'> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  loading?: boolean | undefined;
  block?: boolean | undefined;
  icon?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

function isTextContent(node: ReactNode): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return true;
  }
  if (node === null || node === undefined || typeof node === 'boolean') {
    return true;
  }
  if (Array.isArray(node)) {
    return node.every(isTextContent);
  }
  return false;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  children,
  disabled,
  className,
  style,
  ...rest
}: ButtonProps) {
  const { scheme } = useTheme();
  const isDark = scheme === 'dark';

  const iconColor =
    variant === 'primary' || variant === 'danger'
      ? isDark
        ? '#080E1A'
        : '#FFFFFF'
      : variant === 'ghost'
        ? isDark
          ? '#609CFF'
          : '#1D4ED8'
        : isDark
          ? '#F0F2F7'
          : '#10131C';

  const renderedIcon =
    isValidElement(icon) && typeof icon.type !== 'string'
      ? cloneElement(icon as React.ReactElement<{ color?: string }>, {
          color: (icon as React.ReactElement<{ color?: string }>).props.color ?? iconColor,
        })
      : icon;

  const isDisabled = disabled === true || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={cn(
        'min-h-touch flex-row items-center justify-center rounded-control border',
        SIZE[size],
        block && 'w-full',
        CONTAINER[variant],
        !isDisabled && variant === 'primary' && 'active:bg-accent-pressed',
        !isDisabled && variant === 'secondary' && 'active:bg-surface-raised',
        !isDisabled && variant === 'ghost' && 'active:bg-surface-raised',
        !isDisabled && variant === 'danger' && 'active:opacity-80',
        isDisabled && 'opacity-50',
        className,
      )}
      style={style}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={iconColor}
        />
      ) : (
        renderedIcon
      )}
      {isTextContent(children) ? (
        <AppText
          variant={LABEL_VARIANT[size]}
          tone={LABEL_TONE[variant] as 'onAccent' | 'primary' | 'accent'}
          numberOfLines={1}
          className="flex-shrink"
        >
          {children}
        </AppText>
      ) : (
        children
      )}
    </Pressable>
  );
}

/**
 * IconButton - a square, icon-only button.
 *
 * The `label` prop is required for accessibility.
 */
export interface IconButtonProps
  extends Omit<PressableProps, 'children' | 'style' | 'className'> {
  label: string;
  children: ReactNode;
  tone?: 'default' | 'accent' | 'danger' | undefined;
  size?: 'md' | 'lg' | undefined;
  className?: string | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

const ICON_TONE = {
  default: 'bg-transparent',
  accent: 'bg-accent-soft',
  danger: 'bg-critical/10',
} as const;

export function IconButton({
  label,
  children,
  tone = 'default',
  size = 'md',
  disabled,
  className,
  style,
  ...rest
}: IconButtonProps) {
  const { scheme } = useTheme();
  const isDark = scheme === 'dark';

  const defaultIconColor =
    tone === 'danger'
      ? isDark
        ? '#FF8A8A'
        : '#BE1222'
      : tone === 'accent'
        ? isDark
          ? '#609CFF'
          : '#1D4ED8'
        : isDark
          ? '#9EA6B6'
          : '#586073';

  const renderedChild =
    isValidElement(children) && typeof children.type !== 'string'
      ? cloneElement(children as React.ReactElement<{ color?: string }>, {
          color: (children as React.ReactElement<{ color?: string }>).props.color ?? defaultIconColor,
        })
      : children;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      className={cn(
        'min-h-touch min-w-touch items-center justify-center rounded-control',
        ICON_TONE[tone],
        !disabled && 'active:opacity-60',
        disabled && 'opacity-40',
        className,
      )}
      style={size === 'lg' ? [{ padding: 10 }, style] : [{ padding: 8 }, style]}
      {...rest}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {renderedChild}
      </View>
    </Pressable>
  );
}
