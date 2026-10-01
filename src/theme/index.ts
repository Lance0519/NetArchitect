/**
 * Theme barrel.
 *
 * Exists so screens import from one place: `import { useTheme, SeverityTag } from
 * '@/theme'`. A deep import into `severity` or `typography` from a route file is
 * a signal that something belongs in a component, and having a barrel makes that
 * visible.
 */

export {
  applyScheme,
  resolveScheme,
  useTheme,
  type ResolvedScheme,
  type Theme,
} from './useTheme';

export {
  SEVERITY_META,
  SEVERITY_ORDERED,
  severityMeta,
  type SeverityMeta,
} from './severity';

export { FONTS, hasResolvedMonoFont } from './typography';

/**
 * Only the `cssInterop` registration is exported, and deliberately so.
 *
 * This module used to also export `ICON_COLORS` - a hardcoded hex palette per
 * scheme per tone - plus `getIconColor`/`useIconColor`. Nothing called them and
 * they duplicated `global.css` in TypeScript, where `npm run verify:theme`
 * cannot see a divergence. Icons take their colour from `className`, which
 * resolves through `global.css`. See `icons.ts` for the full reasoning.
 */
export { interopIcon } from './icons';
