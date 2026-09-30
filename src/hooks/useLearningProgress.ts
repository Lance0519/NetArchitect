/**
 * Learning progress hook.
 *
 * Persists per-topic progress to AsyncStorage: attempts, correct answers,
 * and accuracy. Used by the learning screen to show progress indicators.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TopicProgress {
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: number;
}

const STORAGE_KEY = 'netarchitect-learning-progress';

type ProgressMap = Record<string, TopicProgress>;

/** Load progress from AsyncStorage. */
async function loadProgress(): Promise<ProgressMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    return JSON.parse(raw) as ProgressMap;
  } catch {
    return {};
  }
}

/** Save progress to AsyncStorage. */
async function saveProgress(progress: ProgressMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage full or unavailable — fail silently.
  }
}

export function useLearningProgress() {
  const [progress, setProgress] = useState<ProgressMap>({});

  useEffect(() => {
    loadProgress().then(setProgress);
  }, []);

  const recordAttempt = useCallback(async (topicId: string, correct: boolean) => {
    setProgress((prev) => {
      const current = prev[topicId] ?? { attempts: 0, correct: 0, accuracy: 0 };
      const next: ProgressMap = {
        ...prev,
        [topicId]: {
          attempts: current.attempts + 1,
          correct: current.correct + (correct ? 1 : 0),
          accuracy: (current.correct + (correct ? 1 : 0)) / (current.attempts + 1),
        },
      };
      saveProgress(next);
      return next;
    });
  }, []);

  const getProgress = useCallback(
    (topicId: string): TopicProgress =>
      progress[topicId] ?? { attempts: 0, correct: 0, accuracy: 0 },
    [progress],
  );

  return { recordAttempt, getProgress };
}
