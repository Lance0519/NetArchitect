/**
 * Learning progress store & hook.
 *
 * Backed by a shared persisted Zustand store (AsyncStorage) so completing a
 * practice drill updates topic mastery immediately across `/learning`,
 * `/learning/[id]`, and `/learning/practice`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { QuestionType } from '@/core/question-generator';

export interface TopicProgress {
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: number;
}

type ProgressMap = Record<string, TopicProgress>;

const EMPTY_PROGRESS: TopicProgress = Object.freeze({ attempts: 0, correct: 0, accuracy: 0 });

/** Mapping from every learning topic id to its primary practice drill type. */
export const TOPIC_PRACTICE_TYPE: Readonly<Record<string, QuestionType>> = Object.freeze({
  'ipv4-addressing': 'classify-space',
  cidr: 'smallest-cidr',
  'subnet-masks': 'compute-mask',
  'wildcard-masks': 'compute-mask',
  'network-broadcast': 'subnet-from-ip',
  'usable-hosts': 'smallest-cidr',
  vlsm: 'vlsm-allocation',
  vlans: 'subnet-from-ip',
  segmentation: 'vlsm-allocation',
  'rfc1918-bogons': 'classify-space',
  'rfc3021-links': 'smallest-cidr',
});

/** Reverse lookup: which topic ids a given question type reinforces. */
export function topicsForQuestionType(type: QuestionType): readonly string[] {
  return Object.entries(TOPIC_PRACTICE_TYPE)
    .filter(([, qType]) => qType === type)
    .map(([topicId]) => topicId);
}

interface LearningProgressStore {
  readonly progress: ProgressMap;
  recordAttempt: (key: string, correct: boolean, relatedKeys?: readonly string[]) => void;
  resetProgress: () => void;
}

const incrementEntry = (prev: TopicProgress | undefined, correct: boolean): TopicProgress => {
  const attempts = (prev?.attempts ?? 0) + 1;
  const totalCorrect = (prev?.correct ?? 0) + (correct ? 1 : 0);
  return {
    attempts,
    correct: totalCorrect,
    accuracy: totalCorrect / attempts,
  };
};

export const useLearningProgressStore = create<LearningProgressStore>()(
  persist(
    (set) => ({
      progress: {},
      recordAttempt: (key, correct, relatedKeys = []) =>
        set((state) => {
          const next: ProgressMap = { ...state.progress };
          const uniqueKeys = new Set([key, ...relatedKeys]);
          for (const k of uniqueKeys) {
            if (!k) continue;
            next[k] = incrementEntry(next[k], correct);
          }
          return { progress: next };
        }),
      resetProgress: () => set({ progress: {} }),
    }),
    {
      name: 'netarchitect-learning-progress',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ progress: state.progress }),
    },
  ),
);

export function useLearningProgress() {
  const progress = useLearningProgressStore((s) => s.progress);
  const recordAttempt = useLearningProgressStore((s) => s.recordAttempt);
  const resetProgress = useLearningProgressStore((s) => s.resetProgress);

  const getProgress = (topicId: string): TopicProgress => progress[topicId] ?? EMPTY_PROGRESS;

  return { recordAttempt, getProgress, resetProgress };
}
