/**
 * Topic Detail Screen - Learning Mode.
 *
 * Clean, structured detail view for networking concepts:
 * - Theory and breakdown sections
 * - Step-by-step worked example with engine-verified math
 * - Key architectural takeaways
 * - Direct shortcut to practice this specific topic
 */

import { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Lightbulb,
  Play,
} from 'lucide-react-native';

import { AppText, Badge, Button, Card, Divider, Screen } from '@/components';
import { TOPICS, type Topic } from '@/content/topics';
import { useLearningProgress } from '@/hooks/useLearningProgress';
import type { QuestionType } from '@/core/question-generator';

const TOPIC_PRACTICE_TYPE: Record<string, QuestionType> = {
  'ipv4-addressing': 'classify-space',
  'cidr': 'smallest-cidr',
  'subnet-masks': 'compute-mask',
  'wildcard-masks': 'compute-mask',
  'network-broadcast': 'subnet-from-ip',
  'usable-hosts': 'smallest-cidr',
  'vlsm': 'vlsm-allocation',
  'vlans': 'subnet-from-ip',
  'segmentation': 'vlsm-allocation',
  'rfc1918-bogons': 'classify-space',
  'rfc3021-links': 'smallest-cidr',
};

export default function TopicDetailScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ id: string }>();
  const topicId = searchParams.id ?? '';
  const progress = useLearningProgress();

  const currentIndex = useMemo(() => TOPICS.findIndex((t) => t.id === topicId), [topicId]);
  const topic: Topic | undefined = TOPICS[currentIndex];
  const nextTopic: Topic | undefined =
    currentIndex >= 0 && currentIndex < TOPICS.length - 1 ? TOPICS[currentIndex + 1] : undefined;

  const topicProgress = topic ? progress.getProgress(topic.id) : null;
  const isMastered = topicProgress && topicProgress.attempts > 0 && topicProgress.accuracy >= 0.8;
  const practiceType = topic ? TOPIC_PRACTICE_TYPE[topic.id] ?? 'smallest-cidr' : 'smallest-cidr';

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/learning');
    }
  };

  const handlePractice = () => {
    router.push({
      pathname: '/learning/practice',
      params: { type: practiceType },
    } as any);
  };

  if (!topic) {
    return (
      <Screen title="Topic Not Found" subtitle="" onBack={handleBack} scroll>
        <View className="gap-4">
          <Card padding="lg" className="items-center justify-center gap-2">
            <AppText variant="subheading" tone="primary">
              Topic does not exist
            </AppText>
            <AppText variant="caption" tone="muted">
              The topic you are looking for could not be found.
            </AppText>
            <Button variant="primary" size="sm" onPress={() => router.replace('/learning')}>
              All Topics
            </Button>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      title={topic.title}
      subtitle={topic.description}
      onBack={handleBack}
      scroll
    >
      <View className="gap-4">
        {/* Progress. Trailing-aligned now that the header owns the back button. */}
        <View className="flex-row items-center justify-end">
          {isMastered ? (
            <Badge tone="success">Mastered ✓</Badge>
          ) : topicProgress && topicProgress.attempts > 0 ? (
            <Badge tone="info">
              {`${Math.round(topicProgress.accuracy * 100)}% accuracy (${topicProgress.attempts} ${topicProgress.attempts === 1 ? 'quiz' : 'quizzes'})`}
            </Badge>
          ) : (
            <Badge tone="neutral">Not practiced yet</Badge>
          )}
        </View>

        {/* Content sections */}
        <View className="gap-3">
          {topic.sections.map((sec, idx) => (
            <Card key={idx} padding="md" className="gap-2">
              <AppText variant="subheading" tone="primary">
                {sec.heading}
              </AppText>
              <AppText variant="body" tone="muted" className="leading-relaxed">
                {sec.body}
              </AppText>
            </Card>
          ))}
        </View>

        {/* Worked Example */}
        <Card padding="lg" className="gap-3 border-accent/30 bg-surface-raised">
          <View className="flex-row items-center gap-2">
            <BookOpen size={18} strokeWidth={2.5} className="text-accent" />
            <AppText variant="label" tone="accent">
              WORKED EXAMPLE · {topic.workedExample.title.toUpperCase()}
            </AppText>
          </View>

          <View className="rounded-control border border-line-subtle bg-surface-inset p-3">
            <AppText variant="caption" tone="faint" className="mb-1 font-medium">
              PROBLEM STATEMENT
            </AppText>
            <AppText variant="body" tone="primary" className="font-medium">
              {topic.workedExample.problem}
            </AppText>
          </View>

          <View className="gap-2 pt-1">
            <AppText variant="label" tone="muted">
              SOLUTION BREAKDOWN
            </AppText>
            {topic.workedExample.steps.map((step, sIdx) => (
              <View key={sIdx} className="flex-row items-start gap-2.5">
                <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-pill bg-surface border border-line">
                  <AppText variant="caption" tone="muted" className="text-[11px] font-semibold">
                    {sIdx + 1}
                  </AppText>
                </View>
                <AppText variant="body" tone="primary" className="flex-1 text-sm leading-snug">
                  {step}
                </AppText>
              </View>
            ))}
          </View>

          <Divider />

          <View className="flex-row items-center justify-between rounded-control border border-line-subtle bg-surface px-3.5 py-2.5">
            <AppText variant="caption" tone="muted">
              VERIFIED ANSWER
            </AppText>
            <AppText mono variant="subheading" tone="success">
              {topic.workedExample.answer}
            </AppText>
          </View>
        </Card>

        {/* Takeaways */}
        <Card padding="md" className="gap-2.5">
          <View className="flex-row items-center gap-2">
            <Lightbulb size={18} strokeWidth={2.5} className="text-accent" />
            <AppText variant="label" tone="muted">
              KEY ARCHITECTURAL TAKEAWAYS
            </AppText>
          </View>
          <View className="gap-2">
            {topic.takeaways.map((takeaway, tIdx) => (
              <View key={tIdx} className="flex-row items-start gap-2">
                <CheckCircle2 size={16} strokeWidth={2} className="mt-0.5 text-success shrink-0" />
                <AppText variant="body" tone="primary" className="flex-1 text-sm leading-snug">
                  {takeaway}
                </AppText>
              </View>
            ))}
          </View>
        </Card>

        {/* Actions & Next */}
        <View className="gap-2 pt-2">
          <Button
            variant="primary"
            block
            icon={<Play size={16} strokeWidth={2} />}
            onPress={handlePractice}
          >
            Practice This Topic
          </Button>

          {nextTopic ? (
            <Button
              variant="secondary"
              block
              icon={<ChevronRight size={16} strokeWidth={2} />}
              onPress={() => router.push(`/learning/${nextTopic.id}` as any)}
            >
              {`Next: ${nextTopic.title}`}
            </Button>
          ) : (
            <Button
              variant="secondary"
              block
              icon={<HelpCircle size={16} strokeWidth={2} />}
              onPress={() => router.push('/learning/practice')}
            >
              All Practice Quizzes
            </Button>
          )}
        </View>
      </View>
    </Screen>
  );
}
