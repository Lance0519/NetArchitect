/**
 * IP Calculator.
 *
 * Arrives in Phase 6. This screen exists now for one reason: the tab layout has to
 * resolve, and a tab that routes to a missing file crashes the whole navigator on
 * first press rather than one screen.
 *
 * ## What is deliberately absent
 *
 * No working calculator, and no sample output.
 *
 * A half-built calculator that renders "10.0.0.0/22" as a sample result would be
 * the single most damaging thing in this project right now. The entire premise is
 * that a number on screen is a number the engine computed from the user's input.
 * A hard-coded result breaks that premise in the most visible way possible, and
 * the fastest way to teach everyone involved that the placeholder is acceptable.
 *
 * So the screen says what is coming and links to the material that already exists.
 * That is honest, and it costs nothing to replace with the real thing.
 */

import { View } from 'react-native';
import { CircleDashed } from 'lucide-react-native';

import { AppText, Card, EmptyState, Screen } from '@/components';
import { STANDARD_REFS } from '@/core/standards';

export default function CalculatorScreen() {
  return (
    <Screen title="IP Calculator" subtitle="Subnet details for any CIDR." scroll>
      <EmptyState
        icon={CircleDashed}
        title="Coming in Phase 6"
        description="Enter an address and prefix to get the network, broadcast, subnet and wildcard masks, the first and last usable hosts, and the usable address count - with a note explaining anything unusual about the result."
      />

      <View className="mt-2">
        <Card padding="lg">
          <View className="gap-2">
            <AppText variant="label" tone="muted">
              ALREADY WORKING
            </AppText>
            <AppText variant="caption" tone="faint">
              The engine behind this screen is complete and tested. It already handles the
              cases that are easy to get wrong:
            </AppText>
            <AppText mono variant="caption" tone="accent">
              {STANDARD_REFS.RFC3021}
            </AppText>
            <AppText variant="caption" tone="faint">
              A /31 has no network or broadcast address, so both of its addresses are
              usable.
            </AppText>
            <AppText mono variant="caption" tone="accent">
              {STANDARD_REFS.RFC1918}
            </AppText>
            <AppText variant="caption" tone="faint">
              172.16.0.0/12 spans 172.16 through 172.31. 172.32.0.0 is public space.
            </AppText>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
