/**
 * NetArchitect color system.
 *
 * Semantic color tokens for the professional network operations dashboard.
 * Dark mode is the primary visual experience; light mode is clean and readable.
 *
 * Color semantics:
 *   - Blue (accent): primary action, interactive elements
 *   - Cyan/Teal (network): network information, technical data
 *   - Green (success): valid, healthy states
 *   - Amber (medium): warnings, caution
 *   - Red (critical): critical issues, errors
 *   - Gray (neutral): inactive, secondary information
 *
 * Colors are defined as space-separated RGB channels for Tailwind compatibility.
 */

/** Light mode color tokens. */
export const lightColors = {
  // Surfaces
  canvas: '246 247 250',
  surface: '255 255 255',
  surfaceRaised: '240 242 247',
  surfaceInset: '234 237 244',

  // Borders
  borderSubtle: '228 232 240',
  borderDefault: '205 211 224',

  // Text
  textPrimary: '16 19 28',
  textSecondary: '88 96 115',
  textTertiary: '110 119 137',

  // Accent (professional blue)
  accent: '29 78 216',
  accentHover: '25 66 191',
  accentPressed: '21 57 165',
  accentSoft: '219 231 254',
  onAccent: '255 255 255',

  // Network (cyan/teal)
  network: '8 145 178',
  networkSoft: '207 250 254',

  // Severity
  critical: '190 18 34',
  high: '179 68 7',
  medium: '143 95 6',
  info: '29 78 216',
  success: '4 108 78',
} as const;

/** Dark mode color tokens (primary experience). */
export const darkColors = {
  // Surfaces - deep navy/charcoal
  canvas: '10 12 16',
  surface: '20 23 30',
  surfaceRaised: '28 32 41',
  surfaceInset: '35 40 50',

  // Borders
  borderSubtle: '38 43 54',
  borderDefault: '55 62 76',

  // Text
  textPrimary: '240 242 247',
  textSecondary: '158 166 182',
  textTertiary: '116 124 141',

  // Accent - lighter blue for dark mode
  accent: '96 156 255',
  accentHover: '126 178 255',
  accentPressed: '156 200 255',
  accentSoft: '27 42 72',
  onAccent: '8 14 26',

  // Network - brighter cyan for dark mode
  network: '34 211 238',
  networkSoft: '21 58 72',

  // Severity - lightened for dark mode
  critical: '255 138 138',
  high: '253 186 116',
  medium: '234 194 90',
  info: '125 179 255',
  success: '84 214 168',
} as const;

export type ColorToken = keyof typeof lightColors;
