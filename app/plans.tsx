/**
 * Saved plans.
 *
 * Arrives with the persistence layer in Phase 9. The route has to exist now
 * because Home links to it, and a link to a missing route is a runtime crash in
 * the navigator, not a build error.
 *
 * No sample plans are shown. A list of realistic-looking entries -
 * "Branch Office, 12 subnets, audited" - would be indistinguishable from saved
 * data to anyone glancing at the screen, and would be particularly convincing
 * precisely because it looks like something the app produced.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft, Files } from 'lucide-react-native';

import { Button, EmptyState, IconButton, Screen } from '@/components';

export default function PlansScreen() {
  const router = useRouter();

  return (
    <Screen
      title="Saved plans"
      subtitle="Stored on this device only."
      scroll
      footer={
        <IconButton label="Go back" onPress={() => router.back()}>
          <ChevronLeft size={20} strokeWidth={2} className="text-ink-muted" />
        </IconButton>
      }
    >
      <EmptyState
        icon={Files}
        title="No plans yet"
        description="Plans you create in the Planner are saved here, on this device. Nothing is uploaded, and nothing is available on another device."
        action={<Button variant="secondary" onPress={() => router.push('/(tabs)/planner')}>
          Go to the Planner
        </Button>}
      />
    </Screen>
  );
}
