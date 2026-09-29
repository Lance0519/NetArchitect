/**
 * IP Calculator.
 *
 * The screen's whole job is to hold one result and decide what to show for it. Every
 * number on this screen was computed by the engine from what the user typed, and
 * nothing here decides what a number should be.
 *
 * ## Where the logic went, and why
 *
 * Four modules, all pure, all tested with no render mock:
 *
 *   `@/core/calculator-input`  typed text -> a `SubnetInfo` or a message
 *   `@/utils/subnet-view`      a `SubnetInfo` -> rows, badges, notices, copy text
 *   `@/utils/subnet-view`      a result -> empty | invalid | ok, and the view
 *   `@/utils/formatting`       a number -> a string
 *
 * R4 declined a component-test runner, so the only way "all 33 prefixes produce
 * correct output" could be an exit criterion rather than a manual spot-check was for
 * the output to exist as a value Vitest can reach. This file is the thin remainder
 * that connects them, and it contains one `switch` and no arithmetic.
 *
 * ## The plan said React Hook Form and a Zod resolver; this does not
 *
 * A deliberate, recorded deviation. Both were meant to serve one field that
 * re-evaluates on every settled keystroke, and the requirement underneath them - no
 * reimplementation of validation, and a debounce so keystrokes do not recompute twice -
 * is met more directly by calling `evaluateCombined`, which delegates to the same
 * engine the Zod schemas in `validation.ts` delegate to.
 *
 * React Hook Form earns its place in Phase 7 and 8, where there are requirement rows
 * being added, removed and reordered, and where `useFieldArray` is the whole problem.
 * Wrapping one text field in it here would add a subscription and a resolver to manage
 * for no behaviour, and would make the calculator's validation path differ from every
 * other screen's. RHF is used when it is the right tool, not to satisfy a plan line.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CircleDashed, ClipboardCheck } from 'lucide-react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  CidrInput,
  EmptyState,
  IpResultCard,
  Screen,
} from '@/components';
import { evaluateCombined, type CalculatorOutcome } from '@/core/calculator-input';
import { classifyCalculatorOutcome } from '@/utils/subnet-view';

/** The state before anything is typed. Derived, not restated. */
const INITIAL_OUTCOME: CalculatorOutcome = evaluateCombined('');

/** How long the copy acknowledgement stays up. */
const ACKNOWLEDGE_MS = 2200;

export default function CalculatorScreen() {
  const [outcome, setOutcome] = useState<CalculatorOutcome>(INITIAL_OUTCOME);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  /**
   * Empty, invalid, or a built view - one total `switch` below.
   *
   * Computing this during render rather than in a `useState` fed by an effect means it
   * cannot be a frame stale. A second effect syncing it would be a bug waiting for a
   * render where it has not run yet.
   */
  const state = useMemo(() => classifyCalculatorOutcome(outcome), [outcome]);

  /**
   * The acknowledgement timer, cancelled on unmount.
   *
   * A pending `setTimeout` outliving the screen sets state on an unmounted component,
   * which React warns about and which is a real leak on a fast tab switch. The cleanup
   * is the whole reason this is a `useRef` rather than a local in the handler.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const acknowledge = useCallback((label: string) => {
    setCopiedLabel(label);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopiedLabel(null);
    }, ACKNOWLEDGE_MS);
  }, []);

  /**
   * Copy a single value, and say which one.
   *
   * Acknowledging *which* row was copied matters: with twelve rows on screen, a generic
   * "Copied" leaves the user unable to tell whether the tap registered at all.
   */
  const handleCopy = useCallback(
    (label: string, value: string) => {
      void Clipboard.setStringAsync(value);
      acknowledge(label);
    },
    [acknowledge],
  );

  const copyAll = useCallback(
    (view: { readonly copyText: string }) => {
      void Clipboard.setStringAsync(view.copyText);
      acknowledge('the whole result');
    },
    [acknowledge],
  );

  return (
    <Screen
      title="IP Calculator"
      subtitle="Every field for any IPv4 block, computed from what you type."
      width="form"
      scroll
    >
      <View className="gap-4">
        <CidrInput onOutcome={setOutcome} />

        {/* A total switch, so there is no branch where a state falls through the screen
            and the user sees an input and nothing else. */}
        {state.kind === 'empty' ? (
          <EmptyState
            icon={CircleDashed}
            title="Nothing to calculate yet"
            description="Type an address and a prefix above. You will get the network, broadcast, subnet and wildcard masks, the first and last usable hosts, and the usable address count - with a note explaining anything unusual about the result."
          />
        ) : null}

        {state.kind === 'invalid' ? (
          <Banner tone="error" title="That is not a subnet I can read">
            <AppText variant="caption">{state.message}</AppText>
          </Banner>
        ) : null}

        {state.kind === 'ok' ? (
          <>
            <IpResultCard view={state.view} onCopy={handleCopy} />

            <Card padding="lg">
              <View className="gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  block
                  icon={<ClipboardCheck size={16} strokeWidth={2} />}
                  onPress={() => {
                    copyAll(state.view);
                  }}
                >
                  Copy everything
                </Button>

                {/*
                  `polite`, and deliberately NOT `role="alert"`.

                  `Banner` uses both together, which is right for it: a banner is a
                  warning and should interrupt. This is a confirmation that the tap
                  worked, and marking it as an alert would have a screen reader announce
                  an emergency over a successful copy. `polite` alone waits for a
                  natural pause, which is what a confirmation wants.
                */}
                {copiedLabel === null ? null : (
                  <AppText
                    variant="caption"
                    tone="success"
                    accessibilityLiveRegion="polite"
                  >
                    Copied {copiedLabel} to the clipboard.
                  </AppText>
                )}
              </View>
            </Card>

            {/*
              The /31 and /32 explanations the plan asked for are built into the result
              card as notices, from the view model rather than from this screen. Stated
              here so nobody goes looking for them: a banner whose text lives in a
              component cannot be asserted on, and these are the two notices most likely
              to need a wording change.
            */}
            <AppText variant="caption" tone="faint">
              Computed on this device. NetArchitect never connects to a network.
            </AppText>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
