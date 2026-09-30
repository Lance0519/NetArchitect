/**
 * Lucide icon integration with NativeWind and Theme System.
 *
 * ## The Problem
 * Third-party components like `lucide-react-native` do not natively understand
 * NativeWind's `className` prop on iOS/Android. Without `cssInterop`, an icon
 * like `<ChevronDown className="text-ink-muted" />` ignores the text color class
 * and renders with Lucide's default `color="currentColor"` (black `#000000`).
 * In Dark Mode, black icons on dark backgrounds become invisible.
 *
 * ## The Solution
 * 1. Register `cssInterop` on all Lucide icons so NativeWind maps `className="text-..."`
 *    directly to the icon's `color` prop across both Light and Dark themes.
 * 2. Provide `useIconColor(tone)` and `getIconColor(scheme, tone)` for cases where
 *    components need the resolved theme color value as an explicit string.
 */

import { cssInterop } from 'nativewind';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Calculator,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardCheck,
  Copy,
  Download,
  Edit2,
  GitFork,
  Inbox,
  Info,
  Layers,
  LayoutList,
  LayoutTemplate,
  Minimize2,
  Minus,
  Network,
  OctagonAlert,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  WifiOff,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react-native';

import { useTheme, type ResolvedScheme } from './useTheme';

export type IconTone =
  | 'primary'
  | 'muted'
  | 'faint'
  | 'accent'
  | 'critical'
  | 'high'
  | 'medium'
  | 'info'
  | 'success';

/**
 * Exact color hexes mapped to design tokens from `global.css` and `src/theme/colors.ts`.
 */
export const ICON_COLORS: Readonly<Record<ResolvedScheme, Readonly<Record<IconTone, string>>>> = Object.freeze({
  light: Object.freeze({
    primary: '#10131C',
    muted: '#586073',
    faint: '#6E7789',
    accent: '#1D4ED8',
    critical: '#BE1222',
    high: '#B34407',
    medium: '#8F5F06',
    info: '#1D4ED8',
    success: '#046C4E',
  }),
  dark: Object.freeze({
    primary: '#F0F2F7',
    muted: '#9EA6B6',
    faint: '#747C8D',
    accent: '#609CFF',
    critical: '#FF8A8A',
    high: '#FDBA74',
    medium: '#EAC25A',
    info: '#7DB3FF',
    success: '#54D6A8',
  }),
});

/**
 * Resolve an icon color for a given scheme and tone.
 */
export function getIconColor(scheme: ResolvedScheme, tone: IconTone = 'muted'): string {
  return ICON_COLORS[scheme][tone];
}

/**
 * React hook to retrieve the current theme-adapted color for a tone.
 */
export function useIconColor(tone: IconTone = 'muted'): string {
  const { scheme } = useTheme();
  return ICON_COLORS[scheme][tone];
}

/**
 * Tags a LucideIcon with NativeWind's `cssInterop` so `className="text-..."` sets `color`.
 */
export function interopIcon<T extends LucideIcon>(icon: T): T {
  cssInterop(icon as unknown as React.ComponentType<{ color?: string; opacity?: number }>, {
    className: {
      target: false,
      nativeStyleToProp: {
        color: true,
        opacity: true,
      },
    },
  });
  return icon;
}

// Pre-register all icons used throughout NetArchitect
const REGISTERED_ICONS: readonly LucideIcon[] = [
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Calculator,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardCheck,
  Copy,
  Download,
  Edit2,
  GitFork,
  Inbox,
  Info,
  Layers,
  LayoutList,
  LayoutTemplate,
  Minimize2,
  Minus,
  Network,
  OctagonAlert,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  WifiOff,
  X,
  XCircle,
];

for (const icon of REGISTERED_ICONS) {
  interopIcon(icon);
}
