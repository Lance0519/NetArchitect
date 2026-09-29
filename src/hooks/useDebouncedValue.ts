/**
 * `useDebouncedValue`.
 *
 * ## Why the delay is on the value and not on the input
 *
 * The VLSM screen re-evaluates a whole allocation on every change. Typing "100" into a
 * host count produces three drafts, and the middle one - "1", then "10" - packs a
 * different set of subnets from the final "100". The user would watch the table
 * rearrange itself three times.
 *
 * The fix is to keep the *text* immediate and the *consequences* delayed. The
 * `TextInput` is controlled by the draft, so the caret and the character appear at once;
 * only the evaluation waits. Debouncing the input instead would make typing feel laggy,
 * which is the worse of the two problems.
 *
 * ## The delay is a constant, not a prop
 *
 * `CidrInput` uses the same 200ms for the same reason. A caller that could tune it would
 * eventually tune it to zero, and at zero the table flickers through three allocations
 * per keystroke - which is the bug this exists to prevent. One shared constant, one
 * behaviour.
 *
 * ## Cleanup is the load-bearing part
 *
 * A pending timer that fires after unmount calls `setState` on a gone component. That is
 * a React warning and a real leak on a fast tab switch, and it is invisible in
 * development and reliable in production. Every effect here returns a cleanup that
 * cancels the pending timer, including the one that commits the final value on unmount.
 */

import { useEffect, useState } from 'react';

/** Matches the settle time in `CidrInput`, so both screens behave the same way. */
export const SETTLE_MS = 200;

/**
 * Return `value` after it has stopped changing for `settleMs`.
 *
 * On unmount the last value is not committed - the component is gone, so there is
 * nothing to render it into, and committing would be a `setState` on a dead component.
 * The timer is simply cancelled.
 */
export function useDebouncedValue<T>(value: T, settleMs: number = SETTLE_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, settleMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, settleMs]);

  return settled;
}
