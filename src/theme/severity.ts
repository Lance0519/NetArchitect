/**
 * Severity presentation.
 *
 * ## The accessibility rule this module exists to enforce
 *
 * WCAG 1.4.1 (Use of Color) says colour must not be the *only* visual means of
 * conveying information. That is not a hypothetical concern here. Roughly 1 in 12
 * men and 1 in 200 women have some form of colour vision deficiency, and the most
 * common confusion is red/green - which is exactly the axis a
 * critical-to-medium scale runs along. A design where critical and medium are both
 * "a warm colour, more saturated" is unreadable to them, and unreadable severity
 * is the failure mode with the worst consequences: a Critical finding gets
 * skimmed past as styling.
 *
 * So severity is carried by three independent channels at once:
 *
 *   1. **Colour** - the `--critical` / `--high` / `--medium` / `--info` tokens.
 *   2. **Shape** - a distinct icon per level, chosen so the silhouettes differ at
 *      16px, not just in hue.
 *   3. **Text** - a written label, always present wherever a severity is shown.
 *
 * Removing any one of the three must be a deliberate, argued change. The
 * `SeverityTag` component renders all three together so no screen can ship
 * colour-only severity by accident.
 *
 * ## Icon choice
 *
 * The silhouettes escalate in *visual weight* as severity rises, and each is a
 * different shape class rather than a differently-coloured version of one shape.
 * A circle, a triangle and an octagon stay distinguishable at 16px in greyscale,
 * in a screenshot printed in black and white, and to a reader with any form of
 * colour vision deficiency:
 *
 *   info     circle    - neutral, smallest footprint
 *   medium   triangle  - three points, the conventional "attention" shape
 *   high     triangle  - same shape as medium, so paired with the label
 *   critical octagon   - eight points, the most urgent silhouette available
 *
 * medium and high deliberately share a silhouette. Splitting four levels across
 * four arbitrary shapes produces distinctions that are not self-explanatory, and
 * the escalation that actually matters - "is this in the alarming half or the
 * advisory half" - is carried by circle-versus-octagon. The medium/high pair is
 * disambiguated by its written label, which is present unconditionally.
 */

import {
  CircleAlert,
  Info as InfoIcon,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';

import type { Severity } from '@/types/network';
import { SEVERITY_ORDER } from '@/types/network';

export interface SeverityMeta {
  /** Spelled-out level, always rendered as text. */
  readonly label: string;
  /** Fixed-width abbreviation for dense columns and table headers. */
  readonly short: string;
  /** Distinct silhouette. See the module note on shape. */
  readonly icon: LucideIcon;
  /** Text colour. Tailwind class, from the `critical`/`high`/`medium`/`info` tokens. */
  readonly textClass: string;
  /** Tinted background for badges and banners. */
  readonly surfaceClass: string;
  /** Border for cards and banners. */
  readonly borderClass: string;
  /**
   * A one-line statement of what this level means in this app.
   *
   * Rendered in the auditor's own explanation, so the vocabulary is defined
   * where it is used rather than assumed.
   */
  readonly meaning: string;
}

/**
 * Severity presentation, keyed by level.
 *
 * Frozen because a presentation table that a screen can mutate at runtime is a
 * presentation table that will eventually be mutated by a screen.
 */
export const SEVERITY_META: Readonly<Record<Severity, SeverityMeta>> = Object.freeze({
  critical: Object.freeze({
    label: 'Critical',
    short: 'CRIT',
    icon: OctagonAlert,
    textClass: 'text-critical',
    surfaceClass: 'bg-critical/10',
    borderClass: 'border-critical/40',
    meaning: 'Must be fixed before deployment. The design is unsafe as specified.',
  }),
  high: Object.freeze({
    label: 'High',
    short: 'HIGH',
    icon: TriangleAlert,
    textClass: 'text-high',
    surfaceClass: 'bg-high/10',
    borderClass: 'border-high/40',
    meaning: 'Should be fixed. The design is exposed to realistic compromise.',
  }),
  medium: Object.freeze({
    label: 'Medium',
    short: 'MED',
    icon: CircleAlert,
    textClass: 'text-medium',
    surfaceClass: 'bg-medium/10',
    borderClass: 'border-medium/40',
    meaning: 'Worth addressing. Unlikely to be exploited, but it is a real weakness.',
  }),
  info: Object.freeze({
    label: 'Info',
    short: 'INFO',
    icon: InfoIcon,
    textClass: 'text-info',
    surfaceClass: 'bg-info/10',
    borderClass: 'border-info/40',
    meaning: 'Context or good practice. No action required.',
  }),
});

/** Presentation metadata for a level. Total by construction. */
export const severityMeta = (severity: Severity): SeverityMeta => SEVERITY_META[severity];

/**
 * Every level, most severe first.
 *
 * The order is *derived* from `SEVERITY_ORDER` rather than written out again
 * here. A second hand-maintained list of the four levels is a second place for
 * the two to disagree, and a severity list that is out of order would put Info
 * findings above Critical ones in a summary.
 */
export const SEVERITY_ORDERED: readonly Severity[] = Object.freeze(
  (Object.keys(SEVERITY_ORDER) as Severity[]).sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b]),
);
