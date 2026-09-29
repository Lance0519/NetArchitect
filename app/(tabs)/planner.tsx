/**
 * Network Planner.
 *
 * Arrives in Phase 8, and depends on the local persistence layer arriving in
 * Phase 9 - a plan the user cannot save is a scratchpad, and the whole point of
 * this tab is producing a plan they keep.
 */

import { View } from 'react-native';
import { CircleDashed } from 'lucide-react-native';

import { Banner, EmptyState, Screen } from '@/components';
import { useUiStore } from '@/store/ui-store';

export default function PlannerScreen() {
  // Read, not written: the preference exists and is persisted, but nothing sets it
  // until the profile picker lands. Reading it here is how the screen knows which
  // profile a new plan would start from.
  const lastProfile = useUiStore((s) => s.lastProfile);

  return (
    <Screen title="Network Planner" subtitle="Build a plan from a site and its needs." scroll>
      <EmptyState
        icon={CircleDashed}
        title="Coming in Phase 8"
        description="Name the sites, say roughly how many hosts each has, and NetArchitect will size the subnets, assign them without overlap, and hand you a plan you can save and revise."
      />

      <View className="mt-2 gap-3">
        <Banner tone="info" title="Requires storage first">
          Plans are stored on this device in a local database. That layer is Phase 9, so
          nothing here can save yet.
        </Banner>

        <Banner tone="info" title="Last profile used">
          {`${lastProfile}. The picker that sets this arrives with the planner.`}
        </Banner>
      </View>
    </Screen>
  );
}
