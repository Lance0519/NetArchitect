/**
 * Teaches TypeScript that `className` is a valid prop on React Native elements.
 *
 * NAMING: this file must be called `nativewind-env.d.ts`. Naming it
 * `nativewind.d.ts` sits directly beside `node_modules/nativewind` in the
 * module resolution order, shadows the package's own declarations, and
 * produces a wall of errors about NativeWind's internals being missing. The
 * `-env` suffix is what keeps the two apart.
 *
 * This is a global augmentation, so it must be a `.d.ts` with no imports or
 * exports at the top level.
 */

/// <reference types="nativewind/types" />

/**
 * The stylesheet is imported for its side effects only.
 *
 * `app/_layout.tsx` does `import '../global.css'` with no binding, because that
 * import is what makes Metro compile the file at all. Without it the build
 * succeeds and every `className` silently does nothing - so the import is
 * mandatory, and it is deliberately the one line in the app that is not obviously
 * doing anything.
 *
 * TypeScript needs to be told a bare `.css` import is legal. NativeWind's own types
 * declare the `css` *function*, not CSS *modules*, so this wildcard covers the
 * side-effect import.
 */
declare module '*.css';

