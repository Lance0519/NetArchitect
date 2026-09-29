/**
 * Learn the standards.
 *
 * The second route that is complete rather than a placeholder.
 *
 * The content is not written for this screen - it is the registry in
 * `src/core/standards.ts`, rendered. That matters for two reasons. First, it is
 * the same data the engine classifies with, so the learning screen cannot drift
 * out of step with the tool: if a citation changed in `standards.ts`, this screen
 * changes with it, and there is no second copy to forget to update. Second, the
 * address-space table is shown with the ranges it covers, which is the part people
 * actually get wrong - `172.16.0.0/12` spanning sixteen /16 blocks rather than one
 * is the single most common misreading of RFC 1918, and seeing the range printed
 * out settles it faster than any amount of prose.
 *
 * ## This screen computes nothing
 *
 * The ranges are printed from `RESERVED_BLOCKS`, which is engine-owned data. The
 * integers are converted for display by `formatting.ts` - the module that formats
 * and never computes. So the boundaries shown here are the boundaries the
 * classifier uses.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Card, Divider, IconButton, Screen } from '@/components';
import {
  ADDRESS_SPACE_TABLE,
  BROADCAST_DOMAIN,
  RESERVED_BLOCKS,
  STANDARD_REFS,
  VLAN,
} from '@/core/standards';
import { formatAddressRange } from '@/utils/formatting';

/** Kinds with no block, because they are the absence of one. */
const KINDLESS = new Set(['public']);

function AddressSpaceSection() {
  return (
    <View className="gap-3">
      {ADDRESS_SPACE_TABLE.map((entry) => {
        const blocks = RESERVED_BLOCKS[entry.kind as keyof typeof RESERVED_BLOCKS];

        return (
          <Card key={entry.kind} padding="lg">
            <View className="gap-2">
              <View className="gap-1">
                <AppText variant="subheading">{entry.label}</AppText>
                <AppText mono variant="caption" tone="accent">
                  {entry.citation}
                </AppText>
              </View>

              {blocks === undefined || KINDLESS.has(entry.kind) ? (
                <AppText variant="caption" tone="faint">
                  Everything else in the IPv4 space.
                </AppText>
              ) : (
                <View className="gap-1.5">
                  {blocks.map(([start, end]) => (
                    <AppText key={start} mono variant="caption" tone="muted">
                      {formatAddressRange(start, end)}
                    </AppText>
                  ))}
                </View>
              )}

              {entry.guidance === null ? null : (
                <AppText variant="caption" tone="muted">
                  {entry.guidance}
                </AppText>
              )}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function PointToPointSection() {
  return (
    <Card padding="lg">
      <View className="gap-2">
        <AppText variant="subheading">/31 on point-to-point links</AppText>
        <AppText mono variant="caption" tone="accent">
          {STANDARD_REFS.RFC3021}
        </AppText>
        <AppText variant="caption" tone="muted">
          A /31 has no network or broadcast address, so both of its addresses are usable.
          That is correct and intended on a link with exactly two endpoints, and it is why
          a /31 gives you two usable addresses rather than zero.
        </AppText>
        <Divider />
        <AppText variant="caption" tone="muted">
          The same reasoning does not apply to a /32, which is a single address - a host
          route, not a subnet. NetArchitect says which of the two you have rather than
          applying one rule to both.
        </AppText>
      </View>
    </Card>
  );
}

function SubnetZeroSection() {
  return (
    <Card padding="lg">
      <View className="gap-2">
        <AppText variant="subheading">Subnet-zero and all-ones subnets</AppText>
        <AppText mono variant="caption" tone="accent">
          {STANDARD_REFS.RFC7600}
        </AppText>
        <AppText variant="caption" tone="muted">
          Older material warns against using the all-zeroes and all-ones subnets of a
          prefix. That advice predates CIDR and the concern is obsolete: NetArchitect
          will allocate them, and will not warn you about them.
        </AppText>
      </View>
    </Card>
  );
}

function VlanSection() {
  return (
    <Card padding="lg">
      <View className="gap-2">
        <AppText variant="subheading">VLAN identifiers</AppText>
        <AppText mono variant="caption" tone="accent">
          {VLAN.CITATION}
        </AppText>
        <AppText variant="caption" tone="muted">
          {`Usable identifiers run from ${VLAN.MIN} to ${VLAN.MAX}. ${VLAN.RESERVED_IDS.join(
            ' and ',
          )} are reserved by the standard: 0 was the deprecated priority-tagged VID, and 4095
          is reserved.`}
        </AppText>
        <Divider />
        <AppText variant="caption" tone="muted">
          {`A broadcast domain is conventionally kept to /${BROADCAST_DOMAIN.MAX_PREFIX} or
          smaller. A routed access segment above that stops being an efficiency gain and
          becomes a broadcast and address-space problem.`}
        </AppText>
      </View>
    </Card>
  );
}

export default function LearningScreen() {
  const router = useRouter();

  return (
    <Screen
      title="Learn the standards"
      subtitle="The rules NetArchitect applies, and where each one comes from."
      scroll
      footer={
        <IconButton label="Go back" onPress={() => router.back()}>
          <ChevronLeft size={20} strokeWidth={2} className="text-ink-muted" />
        </IconButton>
      }
    >
      <View className="gap-6">
        <View className="gap-3">
          <AppText variant="heading">IPv4 address space</AppText>
          <AppText variant="body" tone="muted">
            Which parts of the address space are usable for which purpose, and the range
            each classification covers.
          </AppText>
          <AddressSpaceSection />
        </View>

        <View className="gap-3">
          <AppText variant="heading">Allocation rules</AppText>
          <PointToPointSection />
          <SubnetZeroSection />
          <VlanSection />
        </View>
      </View>
    </Screen>
  );
}
