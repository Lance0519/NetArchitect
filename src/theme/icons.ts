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
 * Register `cssInterop` on every Lucide icon used in the app, so NativeWind maps
 * `className="text-..."` straight onto the icon's `color` prop in both schemes.
 * Colour then comes from `className` and resolves through `global.css`, which is
 * the only definition of the palette.
 *
 * ## There is deliberately no `getIconColor`
 * This module used to also export `ICON_COLORS` - a hand-maintained table of hex
 * values per scheme per tone, plus `getIconColor`/`useIconColor` accessors. Nothing
 * called them, and they were a second copy of the palette in a language no gate
 * could check: `scripts/verify-theme.cjs` reads `global.css` and the compiled
 * stylesheet, so changing `--critical` there would have recoloured every text and
 * border while leaving these hexes behind, with nothing to report the divergence.
 *
 * The escape hatch, should an icon ever genuinely need a literal colour, is a
 * `className` the interop already handles - not a second palette.
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
