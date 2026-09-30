/**
 * NetArchitect spacing system.
 *
 * A single step scale for consistent spacing throughout the application.
 * Named, not arbitrary, so spacing decisions are reviewable.
 */

export const spacing = {
  // Base unit
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',

  // Semantic spacing
  gutter: '16px',
  gutterLg: '24px',
  touch: '44px', // Minimum touch target (WCAG 2.5.5)
} as const;

export type SpacingToken = keyof typeof spacing;
