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
