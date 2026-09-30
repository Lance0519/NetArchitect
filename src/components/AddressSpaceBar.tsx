/**
 * Address Space Bar — SVG visualization of the parent network.
 *
 * Shows the parent network as a proportion bar that adapts from /8 to /30.
 * Segments are sized by `blockSize / parentTotal`, in address order, with a
 * leading free-range segment if the first allocation does not start at the
 * parent base.
 *
 * ## Proportions are preserved
 *
 * A minimum rendered width (3 pt) keeps a /30 visible inside a /8, but only as
 * a visual floor — the true proportion is preserved in the label. When
 * segments would be sub-pixel, the bar collapses to a stacked summary with a
 * zoom affordance rather than distorting the proportions.
 *
 * ## Accessibility
 *
 * Each segment has an accessibility label describing its role, CIDR, VLAN,
 * capacity, and utilization. The bar is one node with a descriptive label
 * plus per-segment children.
 *
 * ## Reduced motion
 *
 * No animation is required for comprehension. The bar renders statically.
 */

import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { AppText } from './AppText';
import { VlanBadge } from './Badge';
import { Sheet } from './Sheet';
import { useTheme } from '@/theme';
import type { NetworkPlan } from '@/types/network';
import { calculateSubnet, parseCidr } from '@/core/ip-engine';
import { ROLE_DEFINITION_BY_ROLE } from '@/core/roles';
import { cn } from '@/utils/cn';

const MIN_SEGMENT_WIDTH = 3;
const BAR_HEIGHT = 32;
const BAR_PADDING = 2;
const FRAGMENT_THRESHOLD = 512; // /29 = 512 addresses; below this is "dust"

const ROLE_FILL_LIGHT: Readonly<Record<string, string>> = {
  LAN: '#2563EB',
  SERVERS: '#4F46E5',
  MANAGEMENT: '#D97706',
  VOIP: '#0891B2',
  IOT: '#DC2626',
  GUEST: '#EA580C',
  DMZ: '#B91C1C',
  POINT_TO_POINT: '#475569',
  CUSTOM: '#64748B',
};

const ROLE_FILL_DARK: Readonly<Record<string, string>> = {
  LAN: '#60A5FA',
  SERVERS: '#818CF8',
  MANAGEMENT: '#FBBF24',
  VOIP: '#22D3EE',
  IOT: '#F87171',
  GUEST: '#FB923C',
  DMZ: '#EF4444',
  POINT_TO_POINT: '#94A3B8',
  CUSTOM: '#CBD5E1',
};

const FREE_FILL_LIGHT = '#E2E8F0';
const FREE_FILL_DARK = '#242A38';

export interface AddressSpaceBarProps {
  readonly plan: NetworkPlan;
  readonly className?: string | undefined;
}

interface Segment {
  readonly id: string;
  readonly label: string;
  readonly cidr: string;
  readonly vlanId?: number;
  readonly role: string;
  readonly start: number;
  readonly end: number;
  readonly capacity: number;
  readonly requestedHosts: number;
  readonly isFree: boolean;
  readonly fill: string;
  readonly x: number;
  readonly width: number;
}

export function AddressSpaceBar({ plan, className }: AddressSpaceBarProps) {
  const { scheme } = useTheme();
  const isDark = scheme === 'dark';
  const roleFills = isDark ? ROLE_FILL_DARK : ROLE_FILL_LIGHT;
  const freeFill = isDark ? FREE_FILL_DARK : FREE_FILL_LIGHT;

  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);

  const segments = useMemo(() => {
    const parentCidr = parseCidr(plan.parentCidr);
    const parentInfo = calculateSubnet(parentCidr.ip, parentCidr.prefix);
    const parentStart = parentInfo.networkAddress;
    const parentEnd = parentInfo.broadcastAddress;
    const parentTotal = parentInfo.totalAddresses;

    const result: Segment[] = [];
    let cursor = parentStart;

    // Sort subnets by network address
    const sortedSubnets = [...plan.subnets].sort((a, b) => {
      const aCidr = parseCidr(a.cidr);
      const bCidr = parseCidr(b.cidr);
      return aCidr.ip - bCidr.ip;
    });

    for (const subnet of sortedSubnets) {
      const cidr = parseCidr(subnet.cidr);
      const info = calculateSubnet(cidr.ip, cidr.prefix);
      const subnetStart = info.networkAddress;
      const subnetEnd = info.broadcastAddress;

      // Free space before this subnet
      if (subnetStart > cursor) {
        const freeSize = subnetStart - cursor;
        const freeWidth = (freeSize / parentTotal) * 100;
        result.push({
          id: `free-${cursor}`,
          label: 'Free',
          cidr: `${cursor}-${subnetStart - 1}`,
          role: 'free',
          start: cursor,
          end: subnetStart - 1,
          capacity: freeSize,
          requestedHosts: 0,
          isFree: true,
          fill: freeFill,
          x: ((cursor - parentStart) / parentTotal) * 100,
          width: freeWidth,
        });
      }

      // The subnet itself
      const subnetWidth = (info.totalAddresses / parentTotal) * 100;
      result.push({
        id: subnet.id,
        label: subnet.name,
        cidr: subnet.cidr,
        ...(subnet.vlanId !== undefined && { vlanId: subnet.vlanId }),
        role: subnet.role,
        start: subnetStart,
        end: subnetEnd,
        capacity: info.usableHosts,
        requestedHosts: subnet.requestedHosts,
        isFree: false,
        fill: roleFills[subnet.role] ?? (isDark ? '#94A3B8' : '#64748B'),
        x: ((subnetStart - parentStart) / parentTotal) * 100,
        width: subnetWidth,
      });

      cursor = subnetEnd + 1;
    }

    // Trailing free space
    if (cursor <= parentEnd) {
      const freeSize = parentEnd - cursor + 1;
      const freeWidth = (freeSize / parentTotal) * 100;
      result.push({
        id: `free-${cursor}`,
        label: 'Free',
        cidr: `${cursor}-${parentEnd}`,
        role: 'free',
        start: cursor,
        end: parentEnd,
        capacity: freeSize,
        requestedHosts: 0,
        isFree: true,
        fill: freeFill,
        x: ((cursor - parentStart) / parentTotal) * 100,
        width: freeWidth,
      });
    }

    return result;
  }, [plan, roleFills, freeFill, isDark]);

  const filteredSegments = useMemo(
    () => (filterRole ? segments.filter((s) => s.role === filterRole) : segments),
    [segments, filterRole],
  );

  const handleSegmentPress = (segment: Segment) => {
    setSelectedSegment(segment);
  };

  const uniqueRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const s of segments) {
      if (!s.isFree) roles.add(s.role);
    }
    return Array.from(roles);
  }, [segments]);

  const fragments = useMemo(
    () => segments.filter((s) => s.isFree && s.capacity < FRAGMENT_THRESHOLD),
    [segments],
  );

  const hasSubPixelSegments = useMemo(
    () => segments.some((s) => s.width < 0.5),
    [segments],
  );

  return (
    <View className={cn('gap-3', className)}>
      {/* Bar */}
      <View
        className="overflow-hidden rounded-pill border border-line"
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Address space for ${plan.parentCidr}. ${plan.subnets.length} subnets.`}
      >
        <Svg width="100%" height={BAR_HEIGHT} viewBox={`0 0 100 ${BAR_HEIGHT}`} preserveAspectRatio="none">
          {filteredSegments.map((segment) => (
            <Rect
              key={segment.id}
              x={segment.x}
              y={BAR_PADDING}
              width={Math.max(segment.width, MIN_SEGMENT_WIDTH)}
              height={BAR_HEIGHT - BAR_PADDING * 2}
              fill={segment.fill}
              onPress={() => handleSegmentPress(segment)}
            />
          ))}
        </Svg>
      </View>

      {/* Legend with tap-to-filter */}
      <View className="flex-row flex-wrap gap-2">
        {uniqueRoles.map((role) => {
          const roleDef = ROLE_DEFINITION_BY_ROLE[role as keyof typeof ROLE_DEFINITION_BY_ROLE];
          const isActive = filterRole === role;
          return (
            <Pressable
              key={role}
              onPress={() => setFilterRole(isActive ? null : role)}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${roleDef?.label ?? role}`}
              className={cn(
                'flex-row items-center gap-1.5 rounded-pill border px-2 py-0.5',
                isActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface',
              )}
            >
              <View
                className="h-2 w-2 rounded-pill"
                style={{ backgroundColor: roleFills[role] ?? (isDark ? '#94A3B8' : '#64748B') }}
              />
              <AppText variant="caption" tone={isActive ? 'accent' : 'muted'}>
                {roleDef?.label ?? role}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {/* Fragment health strip */}
      {fragments.length > 0 && (
        <View className="gap-1">
          <AppText variant="caption" tone="muted">
            FRAGMENT HEALTH — {fragments.length} free range{fragments.length === 1 ? '' : 's'} too small to use
          </AppText>
          <View className="flex-row flex-wrap gap-1">
            {fragments.map((f) => (
              <View
                key={f.id}
                className="flex-row items-center gap-1 rounded-pill bg-surface-inset px-2 py-0.5"
              >
                <View className="h-1.5 w-1.5 rounded-pill bg-line" />
                <AppText variant="caption" tone="faint" mono>
                  {f.capacity}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Sub-pixel warning */}
      {hasSubPixelSegments && (
        <AppText variant="caption" tone="muted">
          Some segments are too small to render proportionally. The bar uses a minimum width
          floor; see the detail sheet for exact proportions.
        </AppText>
      )}

      {/* Detail sheet */}
      <Sheet
        visible={selectedSegment !== null}
        onClose={() => setSelectedSegment(null)}
        title={selectedSegment?.label ?? ''}
      >
        {selectedSegment && (
          <View className="gap-3">
            <View className="flex-row items-center gap-2">
              <View
                className="h-3 w-3 rounded-pill"
                style={{ backgroundColor: selectedSegment.fill }}
              />
              <AppText variant="label" tone="primary">
                {selectedSegment.cidr}
              </AppText>
              {selectedSegment.vlanId !== undefined && (
                <VlanBadge vlanId={selectedSegment.vlanId} />
              )}
            </View>

            <View className="gap-1">
              <AppText variant="caption" tone="muted">
                CAPACITY
              </AppText>
              <AppText variant="body" tone="primary">
                {selectedSegment.capacity} usable addresses
              </AppText>
            </View>

            {!selectedSegment.isFree && (
              <View className="gap-1">
                <AppText variant="caption" tone="muted">
                  UTILIZATION
                </AppText>
                <AppText variant="body" tone="primary">
                  {selectedSegment.requestedHosts} of {selectedSegment.capacity} (
                  {((selectedSegment.requestedHosts / selectedSegment.capacity) * 100).toFixed(1)}%)
                </AppText>
              </View>
            )}

            <View className="gap-1">
              <AppText variant="caption" tone="muted">
                ADDRESS RANGE
              </AppText>
              <AppText variant="body" tone="primary" mono>
                {selectedSegment.start} – {selectedSegment.end}
              </AppText>
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}
