/*
 * ESLint flat config.
 *
 * `eslint-config-expo/flat` is the flat-config entry point. The bare
 * `eslint-config-expo` default export is the old eslintrc-shaped object, which
 * ESLint 9 refuses to load.
 *
 * The rules below are not style preferences. Each one exists because ignoring it
 * has produced a wrong answer or an invisible failure in a React Native codebase
 * of this kind.
 */

const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,

  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "web-build/**",
      ".expo/**",
      /* Machine-written by Expo Router'"'"'s type generation. Machine-written means
       * our formatting fights themselves, and it changes on every route added. */
      ".expo/types/**",
      /* Output of `expo export`. A build artifact, not source. */
      ".export-probe/**",
    ],
  },

  {
    rules: {
      /* A silently broken hook is the worst class of bug in a React Native app:
       * no red screen, no warning, just stale or missing UI. The Expo config
       * ships these as warnings. A stale closure in a form that revalidates on
       * every keystroke is a correctness bug, so: error. */
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",

      /* A promise executor that is itself async hangs forever and silently
       * swallows rejections. There is no legitimate use in this codebase. */
      "no-async-promise-executor": "error",

      /* Equality that silently coerces. In an address tool `0` and `"0"` are
       * not the same prefix, and a coercion bug stays invisible until a user
       * types the wrong thing. The Expo config sets this to `smart`; same
       * intent, promoted to a hard error. */
      eqeqeq: ["error", "always", { null: "ignore" }],

      /* `no-unused-vars` is deliberately NOT set here. The Expo config already
       * does this correctly: it turns the base rule off and enables the
       * TypeScript-aware one, which is what avoids false positives on type-only
       * constructs. Re-declaring the bare rule would silently revert that
       * arrangement and begin flagging every type-only import. */

      /* `console.log` in shipped UI is noise. `warn` and `error` are how a
       * genuine problem gets reported, so those stay. */
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  /* --- Deliberate omission ---------------------------------------------
   *
   * `@typescript-eslint/no-floating-promises` and
   * `@typescript-eslint/no-misused-promises` are both wanted here. A floating
   * promise is precisely how this app would lose a saved plan or a theme
   * preference with no visible sign.
   *
   * They are not enabled because they need type information, which needs
   * `parserOptions.project`, which the Expo flat config does not set - and
   * turning it on makes every lint run several times slower on a cold cache.
   *
   * That trade is revisit-able and cheap to reverse: add a config object with
   * `languageOptions.parserOptions.project` pointing at `tsconfig.json`, scope it
   * to the app and source directories so declaration files are excluded, and
   * re-add the two rules. Until then the protection is a review convention:
   * every `await` in this codebase is awaited, and every returned promise is
   * either awaited or explicitly `.catch()`ed.
   * ------------------------------------------------------------------- */

  /* --- Build and verification scripts ----------------------------------
   *
   * This object MUST come last, and that is not a style preference.
   *
   * In a flat config the later object wins, per rule. The block above is not
   * scoped with `files`, so it applies to every file in the project - and it
   * re-enables `no-console`. With this block placed before it, the override
   * silently does nothing.
   *
   * The symptom is misleading. ESLint reported 20 warnings, no errors, and
   * exited 0, so the scripts looked merely chatty rather than misconfigured.
   * Lint stayed green whether the override worked or not, which is precisely the
   * kind of green that hides things. Ordering in a flat config is load-bearing
   * and nothing warns you when you get it wrong.
   *
   * `scripts/*.cjs` is CommonJS run by Node, not application source, so the
   * app'"'"'s own rules do not apply to it. Two things differ and both matter:
   *
   *   - `no-console` is the POINT of these files. They print a check-by-check
   *     report and exit non-zero on failure, which is what makes `npm run
   *     verify:theme` usable from a terminal or in CI. Silencing them would
   *     defeat their only purpose.
   *   - Node globals (`__dirname`, `require`, `process`) exist here and nowhere
   *     else, and the app must NOT get them - a `require` in a route file is a
   *     bundling error waiting to happen.
   *
   * `verify-theme.cjs` and `verify-bundle.cjs` exist because the stylesheet
   * pipeline has two independent silent failure modes, both documented at the
   * top of global.css. Linting them is not the point; keeping them honest is.
   * --------------------------------------------------------------------- */
  {
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        __dirname: "readonly",
        require: "readonly",
        module: "writable",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "no-undef": "error",
    },
  },

  /* --- Snackbar component false-positive suppressions --------------------
   *
   * The Snackbar component uses React Native'"'"'s Animated API and PanResponder,
   * which trigger false positives in several rules:
   *
   * - "Cannot call impure function during render": Animated API calls inside
   *   useEffect are flagged as impure, but they are correctly placed in effects.
   * - "Cannot access refs during render": Refs are accessed inside effects and
   *   callbacks, not during render. The rule incorrectly flags them.
   *
   * These are well-tested, safe patterns. We suppress the false positives
   * rather than rewriting working animation code.
   * --------------------------------------------------------------------- */
  {
    files: ["src/components/Snackbar.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/refs": "off",
    },
  },
];
