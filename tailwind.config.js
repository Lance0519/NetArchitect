/*
 * NetArchitect Tailwind configuration.
 *
 * Tailwind v3 on purpose. NativeWind 4.2.x is built against the v3 plugin and
 * token APIs; v5 is still an RC and its `@theme` block is not what this preset
 * consumes. Pinning the major version here is what keeps the upgrade a
 * deliberate decision instead of a surprise.
 *
 * Colours are deliberately NOT literals in this file. Each one points at a CSS
 * variable in global.css so that light and dark are a single variable swap and
 * every colour has exactly one definition. See global.css for contrast ratios.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Class-based dark mode. NativeWind applies the `dark` class to the root when
  // `colorScheme.set()` is called, which is what lets an explicit user choice
  // override the OS setting instead of fighting it.
  darkMode: 'class',

  // NativeWind's preset wires the CSS-in-JS interop. It must come first.
  presets: [require('nativewind/preset')],

  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],

  theme: {
    extend: {
      colors: {
        // Surfaces, back to front.
        canvas: 'rgb(var(--bg-canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--bg-surface) / <alpha-value>)',
          raised: 'rgb(var(--bg-raised) / <alpha-value>)',
          inset: 'rgb(var(--bg-inset) / <alpha-value>)',
        },

        // Lines.
        line: {
          DEFAULT: 'rgb(var(--border-default) / <alpha-value>)',
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
        },

        // Text. `ink` rather than `text` so a colour never collides with
        // Tailwind's own `text-*` size utilities at the call site.
        ink: {
          DEFAULT: 'rgb(var(--text-primary) / <alpha-value>)',
          muted: 'rgb(var(--text-secondary) / <alpha-value>)',
          faint: 'rgb(var(--text-tertiary) / <alpha-value>)',
        },

        accent: {
          DEFAULT: 'rgb(var(--accent-base) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          pressed: 'rgb(var(--accent-pressed) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          on: 'rgb(var(--on-accent) / <alpha-value>)',
        },

        // Severity. Named for the level, not the colour, so a palette change
        // cannot quietly redefine what "high" means.
        critical: 'rgb(var(--critical) / <alpha-value>)',
        high: 'rgb(var(--high) / <alpha-value>)',
        medium: 'rgb(var(--medium) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
      },

      fontSize: {
        /* An explicit type scale rather than the Tailwind default. A design
         * whose type sizes are `text-xl` and `text-base` cannot be reviewed: the
         * numbers in a mockup and the numbers in the code are different numbers.
         * Line heights are paired with their sizes because the pairing is the
         * decision - 28/34 and 28/28 are not interchangeable. */
        display: ['28px', { lineHeight: '34px' }],
        title: ['22px', { lineHeight: '28px' }],
        heading: ['17px', { lineHeight: '24px' }],
        subheading: ['15px', { lineHeight: '22px' }],
        body: ['15px', { lineHeight: '22px' }],
        'body-tight': ['15px', { lineHeight: '20px' }],
        label: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px' }],
      },

      spacing: {
        // A single step scale. Named, not arbitrary, so spacing decisions are
        // reviewable rather than sprinkled as magic numbers.
        touch: '44px', // minimum target size, per WCAG 2.5.5 and the platform HIG
        gutter: '16px',
        'gutter-lg': '24px',
      },

      maxWidth: {
        // Comfortable measure for prose. Past roughly this, a line of text is
        // long enough that the return sweep misses the start of the next line,
        // which is the actual reason columns get hard to read - not aesthetics.
        read: '680px',
        // Forms and tables get more room than prose, but still not the full width
        // of a landscape tablet, where an unconstrained field is a usability
        // problem rather than an efficient use of space.
        form: '560px',
      },

      borderRadius: {
        card: '12px',
        control: '10px',
        pill: '999px',
      },
    },
  },

  plugins: [],
};
