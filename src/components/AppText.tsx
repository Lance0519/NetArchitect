/**
 * AppText - the only text primitive in the app.
 *
 * ## Why one component instead of `Text` with classNames
 *
 * Three reasons, in order of how much they cost when ignored.
 *
 * 1. **Addresses render in monospace, and nothing else does by accident.** A
 *    `Text` used directly will pick up whatever the ambient font is, so a CIDR
 *    rendered through it lines up with nothing. Routing every string through one
 *    component makes "is this an address?" a prop (`mono`) rather than a thing
 *    each screen has to remember.
 *
 * 2. **Size and colour cannot drift.** `variant` and `tone` are closed unions
 *    over a fixed scale. A screen cannot invent `text-[15.5px]` or a grey that is
 *    not in the palette, because the type does not allow it.
 *
 * 3. **Dynamic Type still works.** RN scales `allowFontScaling` from the platform
 *    setting. This component never sets `allowFontScaling={false}`, so it does
 *    not opt out of accessibility text sizing by accident - a habit that
 *    `Text` usage makes very easy to pick up.
 */

import { Text, type TextProps as RNTextProps, type StyleProp, type TextStyle } from 'react-native';

import { FONTS } from '@/theme/typography';
import { cn } from '@/utils/cn';

/** Type scale. Mirrors the `fontSize` extension in `tailwind.config.js`. */
export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'body-tight'
  | 'label'
  | 'caption';

/**
 * Semantic colour roles.
 *
 * Named for meaning, not for the colour they happen to be. `muted` survives a
 * palette change; `gray-500` does not. Severity tones are here so a finding's
 * level can be rendered as text in one call.
 */
export type TextTone =
  | 'primary'
  | 'muted'
  | 'faint'
  | 'accent'
  | 'onAccent'
  | 'success'
  | 'critical'
  | 'high'
  | 'medium'
  | 'info';

const TONE_CLASS: Readonly<Record<TextTone, string>> = Object.freeze({
  primary: 'text-ink',
  muted: 'text-ink-muted',
  faint: 'text-ink-faint',
  accent: 'text-accent',
  onAccent: 'text-accent-on',
  success: 'text-success',
  critical: 'text-critical',
  high: 'text-high',
  medium: 'text-medium',
  info: 'text-info',
});

const VARIANT_CLASS: Readonly<Record<TextVariant, string>> = Object.freeze({
  display: 'text-display font-bold',
  title: 'text-title font-semibold',
  heading: 'text-heading font-semibold',
  subheading: 'text-subheading font-semibold',
  body: 'text-body font-normal',
  'body-tight': 'text-body-tight font-normal',
  label: 'text-label font-medium',
  caption: 'text-caption font-normal',
});

export interface AppTextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /**
   * Render in the platform monospace face.
   *
   * Set this for anything that is an address, a mask, a prefix or an ID. The
   * `fontSize` used is chosen to match the surrounding variant rather than
   * ignoring the scale, so monospaced text sits on the same baseline grid as
   * proportional text.
   */
  mono?: boolean;
  /** Centre the text. */
  center?: boolean;
}

export function AppText({
  variant = 'body',
  tone = 'primary',
  mono = false,
  center = false,
  className,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      className={cn(VARIANT_CLASS[variant], TONE_CLASS[tone], center && 'text-center', className)}
      // The one thing Tailwind cannot express here, for the reason documented in
      // src/theme/typography.ts: a CSS font stack is not a React Native font.
      style={mono ? [styles.mono, style] : style}
      {...rest}
    />
  );
}

const styles = {
  mono: { fontFamily: FONTS.mono } as TextStyle,
} satisfies Record<string, StyleProp<TextStyle>>;
