/**
 * Utils barrel.
 */
export { cn } from './cn';
export {
  EM_DASH,
  GROUP_SEPARATOR,
  groupDigits,
  formatAddressCount,
  formatPercent,
  formatNetworkCidr,
  formatNetworkAddress,
  formatPrefixBadge,
  formatMaskDotted,
  formatWildcardDotted,
  formatVlan,
  formatAddressRange,
  pluralize,
  formatBits,
  truncateMiddle,
} from './formatting';
export { exportPlan, exportPlanText, importPlan, generateTextExport, EXPORT_VERSION } from './export';
export { buildPlanView, rowCardTone, rowNeedsAttention, unassignedFindings, vlanHintFor, type PlanRowView, type PlanSummary, type PlanNotice, type PlanView } from './planner-view';
export { calculateUtilization, roundPercent, calculateSubnet, parseCidr, formatCidr, integerToIPv4, cidrToMask, calculateWildcardMask } from '../core/ip-engine';
export { deriveFreeRanges, totalUsableHosts, packVLSM, assertNoOverlaps } from '../core/vlsm-engine';
export { type PlanFinding, type PlannerOutcome } from '../core/planner-input';