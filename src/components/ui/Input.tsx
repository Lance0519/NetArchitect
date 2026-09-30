/**
 * Input - text field with label, error, and hint.
 *
 * The error message is rendered as text, not just color.
 * Error and hint are mutually exclusive.
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

import { AppText } from '../AppText';
import { useTheme } from '@/theme';
import { FONTS } from '@/theme/typography';
import { cn } from '@/utils/cn';

export interface TextFieldProps extends Omit<TextInputProps, 'className'> {
  label: string;
  error?: string | undefined;
  hint?: string;
  mono?: boolean;
  suffix?: ReactNode;
  id?: string;
  className?: string | undefined;
}

export const TextField = forwardRef<RNTextInput, TextFieldProps>(function TextField(
  { label, error, hint, mono = false, suffix, id, className, ...rest },
  ref,
) {
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
          accessibilityHint={hasError ? error : hint}
          aria-invalid={hasError}
          placeholderTextColor={rest.placeholderTextColor ?? defaultPlaceholderColor}
          className={cn(
            'flex-1 py-2.5 text-body text-ink',
            rest.multiline && 'py-2',
          )}
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

const styles = StyleSheet.create({
  mono: { fontFamily: FONTS.mono },
});
