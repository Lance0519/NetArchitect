/**
 * Shared prop-type helpers.
 *
 * ## Why `Optional<T>` exists
 *
 * `tsconfig.json` enables `exactOptionalPropertyTypes`, which makes
 * `{ className?: string }` mean *"if the key is present, its value must be a
 * string"* - and `className: undefined` is therefore a type error. That is the
 * flag doing its job: it stops a caller writing an explicit `undefined` into a
 * field whose absence carries meaning, which matters enormously in this codebase
 * for optional domain values (an absent description versus an empty one, an
 * absent gateway versus a malformed one - see `src/core/validation.ts`).
 *
 * For **presentation props**, though, the distinction is meaningless. A caller
 * writing `className={maybeUndefined}` is not asserting anything; they are
 * forwarding a value they may not have. Rejecting that pushes every call site
 * into `condition ? 'x' : undefined`-shaped workarounds, which is worse code for
 * no safety gained.
 *
 * So those props are declared as `Optional<T>`, and the name carries the
 * justification. The rule this encodes:
 *
 *   - **Domain values** (a plan's description, a subnet's gateway) keep the strict
 *     optional type. Absent and undefined must stay distinguishable.
 *   - **Presentation props** (className, style, icon, footer) use `Optional<T>`.
 *
 * If you are adding a prop and are unsure which side of that line it is on: if
 * some code somewhere will branch on whether it is present, it is a domain value.
 */

export type Optional<T> = T | undefined;
