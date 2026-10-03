/**
 * TextField.
 *
 * ## Forwarding the ref is not optional
 *
 * React Hook Form's `register()` returns the props for an input and needs the ref
 * to attach its focus handler. A `TextField` that does not forward its ref
 * therefore works perfectly in a demo and silently fails to focus in a form -
 * the field registers, the value tracks, and the caret simply never appears.
 *
 * So the ref is forwarded, and the component is wrapped in `forwardRef`. This is
 * the single most common reason a custom input drops out of RHF.
 *
 * ## The error message is not a colour
 *
 * The message is rendered as text, in a tone that is also signalled by an icon
 * and by the field's border. A form with a red border and no words is unusable
 * for a screen reader user, useless in greyscale, and ambiguous for anyone with a
 * red/green deficiency - which is roughly 8% of men. The message is the
 * accessible part; the colour is the decoration.
 *
 * ## Error and hint are mutually exclusive
 *
 * When there is an error, the hint is replaced rather than shown alongside it.
 * Two messages under one field is a layout that has to pick an order, and the
 * order a user reads in is not the order the eye scans in. One message, always
 * the most important one.
 */

import { forwardRef, useId, type ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextInput as RNTextInput,
} from 'react-native';
import { CircleAlert } from 'lucide-react-native';

import { AppText } from './AppText';
import { useTheme } from '@/theme';
import { FONTS } from '@/theme/typography';
import { cn } from '@/utils/cn';

export interface TextFieldProps extends Omit<TextInputProps, 'className'> {
  /** Visible label. Required unless `accessibilityLabel` is given. */
  label: string;
  /** The error. When present, replaces the hint and marks the field invalid. */
  error?: string | undefined;
  /** Guidance shown when there is no error. */
  hint?: string;
  /** Render the value in monospace. Set for anything that is an address. */
  mono?: boolean;
  /** Optional adornment after the field, e.g. a `/24` prefix or a unit. */
  suffix?: ReactNode;
  /** Override the generated element id. Only needed to wire up `nativeID`. */
  id?: string;
  className?: string | undefined;
}

export const TextField = forwardRef<RNTextInput, TextFieldProps>(function TextField(
  { label, error, hint, mono = false, suffix, id, className, ...rest },
  ref,
) {
  // `useId` rather than a slug built from the label. A slug collides the moment
  // two fields on one screen share a label - which happens constantly in this app,
  // since a VLSM screen has several "Host count" fields - and a duplicated id
  // makes the label point at the wrong input for every assistive technology that
  // resolves it.
  const { scheme } = useTheme();
  const defaultPlaceholderColor = scheme === 'dark' ? '#94A3B8' : '#64748B';
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId}`;
  const hasError = error !== undefined && error.length > 0;

  return (
    <View className={cn('gap-1.5', className)}>
      <AppText nativeID={`${inputId}-label`} variant="label" tone="muted">
        {label}
      </AppText>

      <View
        className={cn(
          'min-h-touch flex-row items-center rounded-control border bg-surface px-3',
          hasError ? 'border-critical' : 'border-line',
        )}
      >
        <TextInput
          ref={ref}
          nativeID={inputId}
          accessibilityLabel={label}
          // Pairs the field with the message and announces it on change, which is
          // what makes a validation message usable rather than merely visible.
          accessibilityHint={hasError ? error : hint}
          aria-invalid={hasError}
          placeholderTextColor={rest.placeholderTextColor ?? defaultPlaceholderColor}
          // `min-h-touch` is on the input, not only on the wrapper above. The
          // wrapper's padding is not part of the tap target - the input is what
          // the finger has to hit - so a floor on the wrapper alone left the real
          // target at 37pt. And `min-h-touch` rather than more padding, because
          // this is a bespoke token that tailwind-merge does not group, so it
          // survives a caller's `py-*` override, and CSS min-height beats padding
          // regardless.
          className={cn(
            'min-h-touch flex-1 py-2.5 text-body text-ink',
            // A multiline field must be able to grow; `flex-1` on a fixed-height
            // row would clip it.
            rest.multiline && 'py-2',
          )}
          // The one thing Tailwind cannot express here, for the reason documented
          // in src/theme/typography.ts: a CSS font stack is not a React Native
          // font name. A `font-mono` utility would compile to `ui-monospace`,
          // which iOS does not have, and the address would render proportional
          // with nothing to indicate it had.
          style={mono ? [styles.mono, rest.style] : rest.style}
          {...rest}
        />
        {suffix}
      </View>

      {hasError ? (
        <View className="flex-row items-start gap-1.5">
          <CircleAlert
            size={14}
            strokeWidth={2.5}
            className="mt-0.5 text-critical"
            accessibilityElementsHidden
          />
          <AppText variant="caption" tone="critical" className="flex-1">
            {error}
          </AppText>
        </View>
      ) : hint === undefined ? null : (
        <AppText variant="caption" tone="faint">
          {hint}
        </AppText>
      )}
    </View>
  );
});

/**
 * The platform monospace face, for `mono` fields.
 *
 * Built here rather than imported from AppText because a TextInput is not a Text
 * and cannot share the primitive's styles object. The resolution of the font name
 * is shared via FONTS, so there is still exactly one place that knows what
 * "monospace" means on this platform - see src/theme/typography.ts.
 */
const styles = StyleSheet.create({
  mono: { fontFamily: FONTS.mono },
});
