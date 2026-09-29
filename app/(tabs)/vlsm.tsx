/**
 * VLSM Allocator.
 *
 * Arrives in Phase 7. See the note in `calculator.tsx` for why the four tool tabs
 * ship as honest placeholders rather than half-built screens with sample output.
 *
 * The VLSM engine itself is already complete and tested, including the case that
 * distinguishes a real allocator from a naive one: an allocation that would be
 * legal if the subnets were laid out in order can become illegal once alignment is
 * taken into account, so subnets are aligned to their own size.
 */

import { View } from 'react-native';
import { CircleDashed } from 'lucide-react-native';

import { AppText, Card, EmptyState, Screen } from '@/components';

export default function VlsmScreen() {
  return (
    <Screen title="VLSM Allocator" subtitle="Fit variable-length subnets into a parent." scroll>
      <EmptyState
        icon={CircleDashed}
        title="Coming in Phase 7"
        description="Describe a parent block and a list of host requirements, and get back an allocation with no overlaps, the free space left over, and an explanation of any shortfall."
      />

      <View className="mt-2">
        <Card padding="lg">
          <View className="gap-2">
            <AppText variant="label" tone="muted">
              WHY THIS IS NOT JUST SORT-AND-CUT
            </AppText>
            <AppText variant="caption" tone="faint">
              Every subnet is aligned to its own size. A naive packer that simply fills
              addresses in order will, on enough requirements, emit a subnet that is not
              on its network boundary - which no router will accept. The engine detects the
              case where a requirement cannot be met and says so, rather than returning an
              allocation that looks complete but is not.
            </AppText>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
