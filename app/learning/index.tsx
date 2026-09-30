/**
 * Learning Mode - Redesigned.
 *
 * A friendly, engaging interface for learning networking concepts.
 * Shows topics with progress indicators and practice questions.
 *
 * Design principles:
 * - Friendly but consistent with the main app
 * - Progress visualization
 * - Clear topic descriptions
 * - Engaging practice questions
 */

import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { ChevronRight, Play } from 'lucide-react-native';

import { AppText, Button, Card, ProgressBar, Screen } from '@/components';
import { TOPICS } from '@/content/topics';
import { useLearningProgress } from '@/hooks/useLearningProgress';

export default function LearningScreen() {
  const router = useRouter();
  const progress = useLearningProgress();

  return (
    <Screen title="Learn" subtitle="Master the math behind NetArchitect." scroll>
      <View className="gap-4">
        {/* Practice Quick CTA */}
        <Card padding="md" className="gap-2 border-accent/40 bg-surface-raised">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 gap-1 pr-3">
              <AppText variant="subheading" tone="accent">
                Interactive Practice Drills
              </AppText>
              <AppText variant="caption" tone="muted">
                Test your knowledge with randomized questions on CIDR, VLSM, masks, and boundaries.
              </AppText>
            </View>
            <Button
              variant="primary"
              size="sm"
              icon={<Play size={16} strokeWidth={2} />}
              onPress={() => router.push('/learning/practice')}
            >
              Start Drill
            </Button>
          </View>
        </Card>
        {TOPICS.map((topic) => {
          const topicProgress = progress.getProgress(topic.id);
          const isComplete = topicProgress.attempts > 0 && topicProgress.accuracy >= 0.8;

          return (
            <Card key={topic.id} padding="md">
              <Pressable
                onPress={() => router.push(`/learning/${topic.id}` as any)}
                className="flex-row items-start gap-3 active:bg-surface-raised"
              >
                <View className="flex-1 gap-1">
                  <View className="flex-row items-center gap-2">
                    <AppText variant="subheading" tone="primary">
                      {topic.title}
                    </AppText>
                    {isComplete ? (
                      <AppText variant="caption" tone="success">
                        ✓
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="caption" tone="muted">
                    {topic.description}
                  </AppText>
                  {topicProgress.attempts > 0 ? (
                    <View className="mt-1">
                      <ProgressBar
                        value={topicProgress.accuracy}
                        label={`${topicProgress.attempts} attempts · ${Math.round(topicProgress.accuracy * 100)}% accuracy`}
                      />
                    </View>
                  ) : null}
                </View>
                <ChevronRight size={20} className="text-ink-muted" />
              </Pressable>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
