/**
 * CidrInput - the calculator's address and prefix entry.
 *
 * ## It owns the text, the mode and the debounce. It owns no decision.
 *
 * Everything that decides *what the result is* is `evaluateCombined` or
 * `evaluateSplit` in `@/core/calculator-input` - pure functions, no React, 164 tests.
 * This component holds the keystrokes, waits for them to settle, calls one of those
 * functions, and draws whatever came back. The consequence is that the Phase 6 exit
 * criterion about all 33 prefixes is checkable in Vitest with no render mock, which is
 * what R4's decision to decline a component-test runner requires.
 *
 * ## Why a debounce
 *
 * The calculation is fast enough that debouncing is not about CPU. It is about the
 * error message. Someone typing `192.168.1.50/24` passes through `1`, `19`, `192`,
 * and at every one of those the input is incomplete, so every one of them produces a
 * failure. Without a settle delay the field flashes four different complaints in the
 * second it takes to type an address, and the last one - the only useful one - is the
 * hardest to read because it arrives while the keyboard is still up.
 *
 * 200 ms is a delay no one perceives as lag and long enough to swallow a burst of
 * keystrokes. It is not a spinner-worthy delay, so no loading state is shown; one
 * would be a flash of its own.
 *
 * ## The mode toggle is manual, and the text survives it
 *
 * A tablet has room for two fields, a phone does not, so the calculator offers both
 * layouts. It does NOT switch automatically on width, even though the width is right
 * there: a rotation would otherwise throw away half-typed input, which is the worst
 * thing a layout decision can do. Instead the choice is the user's, and both fields'
 * text is kept, so switching mid-entry loses nothing.
 *
 * Switching converts between the two forms rather than clearing, so a user who typed
 * `192.168.1.50/24` and switches to Separate is looking at `192.168.1.50` and `24` -
 * the same entry, decomposed - and switching back reassembles it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { Card } from './Card';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { TextField } from './TextField';
import {
  CALCULATOR_PLACEHOLDER,
  CALCULATOR_PLACEHOLDER_ADDRESS,
  CALCULATOR_PLACEHOLDER_PREFIX,
  composeSplit,
  decomposeCombined,
  evaluateCombined,
  evaluateSplit,
  type CalculatorMode,
  type CalculatorOutcome,
} from '@/core/calculator-input';

const MODES: readonly SegmentOption<CalculatorMode>[] = [
  { value: 'combined', label: 'Together' },
  { value: 'split', label: 'Separate' },
];

/** Settle delay. Long enough to swallow a burst, short enough to feel immediate. */
const SETTLE_MS = 200;

/**
 * Debounce a string. The one piece of unavoidable imperative state in this screen.
 *
 * Called once per field rather than once per form, so each field settles on its own.
 * A single debounce over a joined string would re-settle both fields whenever either
 * changed, and re-evaluating a result the user did not touch is how a result flickers
 * while someone is mid-word in the other box.
 */
const useSettled = (value: string, delay: number): string => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);
    // Clearing on every keystroke is what makes this a debounce rather than a
    // throttle. Without it a fast typist would get a result for every character.
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return settled;
};

export interface CidrInputProps {
  /** Called with the settled result, successful or not, whenever it changes. */
  readonly onOutcome: (outcome: CalculatorOutcome) => void;
  /** Optional external CIDR value (for quick-fill buttons) */
  readonly value?: string;
  readonly onChange?: (value: string) => void;
}

export function CidrInput({ onOutcome, value, onChange }: CidrInputProps) {
  const [mode, setMode] = useState<CalculatorMode>('combined');
  const [combined, setCombined] = useState(value ?? '');
  const [address, setAddress] = useState('');
  const [prefix, setPrefix] = useState('');
  const [isTouched, setIsTouched] = useState(Boolean(value && value.trim().length > 0));

  const [prevValue, setPrevValue] = useState(value);
  if (value !== undefined && value !== prevValue) {
    setPrevValue(value);
    setCombined(value);
    setIsTouched(true);
    if (mode === 'split') {
      const parts = decomposeCombined(value);
      if (parts !== null) {
        setAddress(parts.address);
        setPrefix(parts.prefix);
      }
    }
  }

  const settledCombined = useSettled(combined, SETTLE_MS);
  const settledAddress = useSettled(address, SETTLE_MS);
  const settledPrefix = useSettled(prefix, SETTLE_MS);

  // `useMemo` keyed on the settled values. Nothing re-runs on a keystroke, and nothing
  // runs twice for one value - which is the "never recompute twice" the plan asks for.
  const outcome = useMemo(
    () =>
      mode === 'combined'
        ? evaluateCombined(settledCombined)
        : evaluateSplit(settledAddress, settledPrefix),
    [mode, settledCombined, settledAddress, settledPrefix],
  );

  const onOutcomeRef = useRef(onOutcome);
  useEffect(() => {
    onOutcomeRef.current = onOutcome;
  });
  useEffect(() => {
    onOutcomeRef.current(outcome);
  }, [outcome]);

  const errorFor = (field: 'address' | 'prefix' | 'input'): string | undefined => {
    if (!isTouched) return undefined;
    if (mode === 'combined' && combined.trim() === '') return undefined;
    if (mode === 'split' && address.trim() === '' && prefix.trim() === '') return undefined;
    return !outcome.ok && outcome.field === field ? outcome.message : undefined;
  };

  const handleCombinedChange = (text: string) => {
    setIsTouched(true);
    setCombined(text);
    onChange?.(text);
  };

  const handleAddressChange = (text: string) => {
    setIsTouched(true);
    setAddress(text);
  };

  const handlePrefixChange = (text: string) => {
    setIsTouched(true);
    setPrefix(text);
  };

  return (
    <Card padding="lg">
      <View className="gap-3">
        <SegmentedControl
          label="Input layout"
          options={MODES}
          value={mode}
          onChange={(next) => {
            if (next === mode) return;
            if (next === 'split') {
              const parts = decomposeCombined(combined);
              // Unparseable current text stays where it is rather than being cleared,
              // so switching back and forth is never destructive.
              if (parts !== null) {
                setAddress(parts.address);
                setPrefix(parts.prefix);
              }
            } else {
              setCombined(composeSplit(address, prefix));
            }
            setMode(next);
          }}
        />

        {mode === 'combined' ? (
          <TextField
            id="calculator-cidr"
            label="Address and prefix"
            placeholder={CALCULATOR_PLACEHOLDER}
            value={combined}
            onChangeText={handleCombinedChange}
            // Not `numeric`: a numeric keypad on iOS has no `/` and no `.`, and an
            // address needs both. This is the field where the platform's idea of a
            // number keyboard is actively wrong.
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            inputMode="text"
            returnKeyType="done"
            error={errorFor('input')}
            hint="Format: 192.168.1.0/24 or enter mask separately"
            mono
          />
        ) : (
          <View className="gap-3">
            <TextField
              id="calculator-address"
              label="Address"
              placeholder={CALCULATOR_PLACEHOLDER_ADDRESS}
              value={address}
              onChangeText={handleAddressChange}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              inputMode="text"
              returnKeyType="next"
              error={errorFor('address')}
              mono
            />
            <TextField
              id="calculator-prefix"
              label="Prefix"
              placeholder={CALCULATOR_PLACEHOLDER_PREFIX}
              value={prefix}
              onChangeText={handlePrefixChange}
              // Numeric here, because this field genuinely is a number. The leading
              // slash is still accepted even though the keypad cannot produce one,
              // which matters for a paste.
              inputMode="numeric"
              returnKeyType="done"
              error={errorFor('prefix')}
              hint="0 to 32. A leading slash is fine."
            />
          </View>
        )}
      </View>
    </Card>
  );
}
