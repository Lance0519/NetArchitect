/**
 * Component barrel.
 *
 * Route files import from here. Two reasons that is enforced by convention rather
 * than by lint:
 *
 *  1. A route that deep-imports `AppText` from `@/components/AppText` tells the
 *     next reader nothing. A route that imports `AppText` from `@/components` reads
 *     as a screen composed of primitives, which is what it is.
 *
 *  2. The barrel is where a primitive gets *added to the vocabulary*. A new
 *     primitive that is only ever imported by one screen is not a primitive yet;
 *     it is that screen's business logic that happens to be a file.
 *
 * The flip side - barrel imports defeat tree-shaking - does not apply here. Metro
 * and Hermes do not tree-shake, so every screen already bundles everything under
 * `src/`, and a barrel changes nothing about that. (If that ever changes, the
 * fix is per-route bundles, not a return to deep imports.)
 */

export { AddressSpaceBar, type AddressSpaceBarProps } from './AddressSpaceBar';
export { AppText, type AppTextProps, type TextTone, type TextVariant } from './AppText';
export { Badge, CidrBadge, SeverityTag, VlanBadge, type BadgeProps, type BadgeTone } from './Badge';
export { Banner, type BannerProps, type BannerTone } from './Banner';
export { Button, IconButton, type ButtonProps, type ButtonSize, type ButtonVariant, type IconButtonProps } from './Button';
export { Card, type CardProps, type CardTone } from './Card';
export { ChangePreview, type ChangePreviewProps } from './ChangePreview';
export { CidrInput, type CidrInputProps } from './CidrInput';
export { Divider, type DividerProps } from './Divider';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { ErrorBoundary, ErrorFallback } from './ErrorBoundary';
export { ExportSheet, type ExportSheetProps } from './ExportSheet';
export { IpResultCard, type IpResultCardProps } from './IpResultCard';
export { ListRow, type ListRowProps } from './ListRow';
export { PlanFindingList, type PlanFindingListProps } from './PlanFindingList';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { Screen, type ScreenProps } from './Screen';
export { SecurityIssueCard, type SecurityIssueCardProps } from './SecurityIssueCard';
export { SegmentedControl, type SegmentedControlProps, type SegmentOption } from './SegmentedControl';
export { Select, type SelectOption, type SelectProps } from './Select';
export { Sheet, type SheetProps } from './Sheet';
export { Snackbar, type SnackbarProps, useSnackbar } from './Snackbar';
export { StatusIndicator, type StatusIndicatorProps } from './ui/StatusIndicator';
export { SubnetBar, type SubnetBarProps } from './SubnetBar';
export { SubnetEditor, type SubnetEditorProps } from './SubnetEditor';
export { SubnetTable, type SubnetTableProps } from './SubnetTable';
export { TextField, type TextFieldProps } from './TextField';
export { VlsmRequirementList, type VlsmRequirementListProps } from './VlsmRequirementList';
