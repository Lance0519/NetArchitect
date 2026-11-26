/**
 * Learning Mode - Practice - Redesigned.
 *
 * Engaging practice questions with immediate feedback.
 * Shows question, options, explanation, and progress.
 *
 * Design principles:
 * - Clear question presentation
 * - Immediate feedback with explanation
 * - Progress tracking
 * - Friendly, encouraging tone
 */

import { useState } from 'react';
import { View } from 'react-native';
import { CheckCircle, XCircle } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppText, Button, Card, ProgressBar, Screen } from '@/components';
import { generateQuestion, QUESTION_TYPES, type Question, type QuestionType } from '@/core/question-generator';
import { topicsForQuestionType, useLearningProgress } from '@/hooks/useLearningProgress';

const QUESTIONS_PER_SESSION = 10;

export default function PracticeScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ type?: string; topicId?: string }>();
  const initialType: QuestionType =
    searchParams.type && QUESTION_TYPES.includes(searchParams.type as QuestionType)
      ? (searchParams.type as QuestionType)
      : 'smallest-cidr';

  const [questionType, setQuestionType] = useState<QuestionType>(initialType);
  const [seedCounter, setSeedCounter] = useState(
    () => Math.floor((Date.now() % 90000) + Math.random() * 9000) + 1,
  );
  const [question, setQuestion] = useState<Question | null>(() =>
    generateQuestion(initialType, seedCounter),
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [questionNumber, setQuestionNumber] = useState(1);
  const { recordAttempt } = useLearningProgress();

  const handleGenerate = (typeToUse = questionType) => {
    const nextSeed = ((seedCounter * 1664525 + 1013904223) & 0x7fffffff) % 100000 || 1;
    setSeedCounter(nextSeed);
    const q = generateQuestion(typeToUse, nextSeed);
    setQuestion(q);
    setSelectedIndex(null);
    setShowExplanation(false);
    setQuestionNumber((n) => (n >= QUESTIONS_PER_SESSION ? 1 : n + 1));
  };

  const handleSelectType = (type: QuestionType) => {
    setQuestionType(type);
    handleGenerate(type);
  };

  const handleSubmit = () => {
    if (question === null || selectedIndex === null) return;
    setShowExplanation(true);
    const isCorrect = selectedIndex === question.correctIndex;
    // Update both the specific topic (if launched from Topic Detail) and every
    // curriculum topic reinforced by this drill type so progress bars stay live.
    const linkedTopics =
      searchParams.topicId && searchParams.topicId.length > 0
        ? [searchParams.topicId]
        : topicsForQuestionType(questionType);
    recordAttempt(questionType, isCorrect, linkedTopics);
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/learning');
    }
  };

  const handleNext = () => {
    handleGenerate();
  };

  return (
    <Screen
      title="Practice"
      subtitle="Test your understanding."
      onBack={handleBack}
      scroll
    >
      <View className="gap-4">
        {/* Progress */}
        <Card padding="md">
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <AppText variant="label" tone="muted">
                QUESTION {questionNumber}
              </AppText>
              <AppText variant="caption" tone="faint">
                {questionType.replace(/-/g, ' ').toUpperCase()}
              </AppText>
            </View>
            <ProgressBar
              value={Math.min(1, questionNumber / QUESTIONS_PER_SESSION)}
              label={`${questionNumber} / ${QUESTIONS_PER_SESSION}`}
            />
          </View>
        </Card>

        {/* Question Type Selector */}
        <Card padding="md">
          <View className="gap-3">
            <AppText variant="label" tone="muted">
              QUESTION TYPE
            </AppText>
            <View className="flex-row flex-wrap gap-2">
              {QUESTION_TYPES.map((type) => (
                <Button
                  key={type}
                  variant={questionType === type ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => handleSelectType(type)}
                >
                  {type.replace(/-/g, ' ').toUpperCase()}
                </Button>
              ))}
            </View>
            <Button onPress={() => handleGenerate()}>
              Generate New Question
            </Button>
          </View>
        </Card>

        {/* Question */}
        {question ? (
          <Card padding="lg">
            <View className="gap-4">
              <AppText variant="body" tone="primary">
                {question.prompt}
              </AppText>

              {/* Options */}
              <View className="gap-2">
                {question.options.map((option, index) => {
                  const isSelected = selectedIndex === index;
                  const isCorrect = index === question.correctIndex;
                  const showResult = showExplanation;

                  return (
                    <Button
                      key={index}
                      variant={
                        showResult
                          ? isCorrect
                            ? 'primary'
                            : isSelected
                              ? 'danger'
                              : 'secondary'
                          : isSelected
                            ? 'primary'
                            : 'secondary'
                      }
                      onPress={() => !showExplanation && setSelectedIndex(index)}
                      disabled={showExplanation}
                    >
                      {option}
                    </Button>
                  );
                })}
              </View>

              {/* Submit / Next */}
              {!showExplanation ? (
                <Button
                  onPress={handleSubmit}
                  disabled={selectedIndex === null}
                >
                  Submit
                </Button>
              ) : (
                <Button onPress={handleNext}>
                  Next Question
                </Button>
              )}

              {/* Explanation */}
              {showExplanation ? (
                <View className="gap-2 rounded-control bg-surface-inset p-3">
                  <View className="flex-row items-center gap-2">
                    {selectedIndex === question.correctIndex ? (
                      <CheckCircle size={20} className="text-success" />
                    ) : (
                      <XCircle size={20} className="text-critical" />
                    )}
                    <AppText
                      variant="label"
                      tone={selectedIndex === question.correctIndex ? 'success' : 'critical'}
                    >
                      {selectedIndex === question.correctIndex ? 'Correct!' : 'Incorrect'}
                    </AppText>
                  </View>
                  <AppText variant="body" tone="muted">
                    {question.explanation}
                  </AppText>
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
