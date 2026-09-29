/**
 * Security Audit.
 *
 * Arrives in Phase 15. The auditor depends on saved plans, so it is the last of
 * the tool tabs by necessity rather than by scheduling convenience.
 *
 * The disclaimer is rendered from `SECURITY_DISCLAIMER` - the same frozen string
 * the auditor will use - rather than being reworded here. A disclaimer that
 * appears in slightly different words on different screens is a disclaimer
 * someone will eventually weaken one of the two times.
 */

import { View } from 'react-native';
import { CircleDashed } from 'lucide-react-native';

import { AppText, Banner, Card, EmptyState, Screen, SeverityTag } from '@/components';
import { SECURITY_DISCLAIMER } from '@/core/standards';

export default function AuditScreen() {
  return (
    <Screen title="Security Audit" subtitle="Static design review of a saved plan." scroll>
      <EmptyState
        icon={CircleDashed}
        title="Coming in Phase 15"
        description="Pick a saved plan and NetArchitect will review its design: oversized broadcast domains, flat segmentation, missing management separation, and address space used for the wrong purpose. Every finding cites the standard behind it."
      />

      <View className="mt-2 gap-3">
        <Card padding="lg">
          <View className="gap-3">
            <AppText variant="label" tone="muted">
              FINDING LEVELS
            </AppText>
            <View className="flex-row flex-wrap gap-2">
              {(['critical', 'high', 'medium', 'info'] as const).map((severity) => (
                <SeverityTag key={severity} severity={severity} size="sm" />
              ))}
            </View>
            <AppText variant="caption" tone="faint">
              Each level is shown as a word and a distinct shape as well as a colour, so
              the order survives greyscale, a colour vision deficiency, and a screenshot
              printed in black and white.
            </AppText>
          </View>
        </Card>

        <Banner tone="warn" title="What this does not do">
          {SECURITY_DISCLAIMER}
        </Banner>
      </View>
    </Screen>
  );
}
