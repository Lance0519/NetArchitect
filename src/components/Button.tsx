/**
 * Button.
 *
 * ## Why this is not a Pressable with `className`
 *
 * A Pressable renders its own style, so its "pressed" state has to be applied by
 * the caller. In practice that means every call site writes its own pressed
 * handler, and the first one that forgets produces a button that gives no
 * feedback at all. Worse, a button with no press feedback is a button some users
 * will press twice, and on a "create plan" action that is a duplicate record.
 *
 * So pressed styling lives here, once, and is driven by the platform's own
 * press state rather than by a timer.
 *
 * ## The touch target
 *
 * Every size is at least `min-h-touch` (44pt). WCAG 2.5.5 and both platform
 * guidelines ask for 44pt, and a 32pt "compact" button is the single most common
 * accessibility regression in mobile UI. The visual box can be smaller than the
 * target; the target cannot.
 */

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText } from '@/components/AppText';
import { cn } from '@/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const CONTAINER = {
  primary: 'bg-accent border-accent',
  secondary: 'bg-surface border-line',
  ghost: 'bg-transparent border-transparent',
  danger: 'bg-critical border-critical',
} as const;

const LABEL_TONE = {
  primary: 'onAccent',
  secondary: 'primary',
  ghost: 'accent',
  danger: 'onAccent',
} as const;

const SIZE = {
  // Visual padding differs per size; the 44pt floor comes from `min-h-touch`
  // below and applies to all of them.
  sm: 'px-3 py-1.5 gap-1.5',
  md: 'px-4 py-2.5 gap-2',
  lg: 'px-gutter py-3.5 gap-2',
} as const;

const LABEL_VARIANT = {
  sm: 'label',
  md: 'subheading',
  lg: 'subheading',
} as const;

/**
 * `className` and `style` are re-declared rather than inherited: NativeWind types
 * them as present-or-nothing, which under `exactOptionalPropertyTypes` rejects an
 * explicit `undefined`. See src/types/props.ts.
 */
export interface ButtonProps extends Omit<PressableProps, 'children' | 'style' | 'className'> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** Show a spinner and block presses. */
  loading?: boolean | undefined;
  /** Stretch to the width of the parent. The default for form footers. */
  block?: boolean | undefined;
  /** Leading or trailing content - usually an icon. */
  icon?: ReactNode | undefined;
  children: string;
  className?: string | undefined;
  style?: StyleProp<ViewStyle> | undefined;
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
  // Loading implies disabled. A button that says "Saving…" and still accepts taps
  // will be tapped, and the second write is either a duplicate or an error the
  // user caused. It is up to the caller to stop the async work, not to render.
  const isDisabled = disabled === true || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      // `busy` above is what a screen reader announces instead of the label, so
      // the reason the button is inert is stated rather than implied.
      disabled={isDisabled}
      className={cn(
        'min-h-touch flex-row items-center justify-center rounded-control border',
        SIZE[size],
        block && 'w-full',
        CONTAINER[variant],
        // Pressed state. `pressed` rather than a timer, so it tracks the actual
        // finger and cancels if the finger slides off.
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
          color={variant === 'primary' || variant === 'danger' ? '#FFFFFF' : undefined}
        />
      ) : (
        icon
      )}
      <AppText
        variant={LABEL_VARIANT[size]}
        tone={LABEL_TONE[variant]}
        numberOfLines={1}
        // `flex-shrink` so a long label truncates rather than pushing the icon
        // out of the button.
        className="flex-shrink"
      >
        {children}
      </AppText>
    </Pressable>
  );
}

/**
 * IconButton - a square, icon-only button.
 *
 * The `label` prop is required and is not optional for a good reason. An
 * icon-only button with no accessibility label is announced as just "button", so
 * a screen reader user hears four identical controls. Making the label a required
 * prop means that mistake cannot be written.
 */
export interface IconButtonProps
  extends Omit<PressableProps, 'children' | 'style' | 'className'> {
  /** Spoken name. Required - see the note above. */
  label: string;
  /** The icon element. */
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      // Exactly 44x44. A 32x32 icon button is comfortable for a finger with
      // average aim and unreachable for anyone with a tremor, and this app is
      // used one-handed.
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
      {/* Marks the icon itself as decorative, since the Pressable above already
          carries the accessible name. Without this, VoiceOver reads the SVG's
          internal structure as well as the label. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </Pressable>
  );
}
