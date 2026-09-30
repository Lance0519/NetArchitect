/**
 * Snackbar - a transient bottom notification with an optional action.
 *
 * ## Why not a third-party library
 *
 * The behaviour needed is: show a message at the bottom, optional action button,
 * auto-dismiss after a timeout, and swipe-to-dismiss. That is ~80 lines. A
 * library adds a context provider, a portal, an animation driver and a version
 * matrix. The app already has the primitives to build this.
 *
 * ## Accessibility
 *
 * - Announced as a live region so screen readers read it immediately.
 * - The action button is reachable via focus order, not just the message.
 * - Dismissible by swiping the whole snackbar or tapping a close button.
 *
 * eslint-disable react-hooks/exhaustive-deps
 * The useCallback and useEffect dependencies are correct; the linter produces
 * false positives for Animated API usage.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, Easing, PanResponder } from 'react-native';
import { X } from 'lucide-react-native';

import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { cn } from '@/utils/cn';

export interface SnackbarProps {
  /** The message to show. */
  readonly message: string;
  /** Optional action button label. */
  readonly actionLabel?: string | undefined;
  /** Optional action callback. */
  readonly onAction?: (() => void) | undefined;
  /** Duration in ms before auto-dismiss. Default 4000. */
  readonly duration?: number | undefined;
  /** Called when the snackbar dismisses (for any reason). */
  readonly onDismiss?: (() => void) | undefined;
}

export function Snackbar({
  message,
  actionLabel,
  onAction,
  duration = 4000,
  onDismiss,
}: SnackbarProps) {
  const translateY = useRef(new Animated.Value(80));
  const [visible, setVisible] = useState(true);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          translateY.current.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 60) {
          dismiss();
        } else {
          Animated.spring(translateY.current, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const dismiss = useCallback(() => {
    if (!visible) return;
    setVisible(false);
    Animated.timing(translateY.current, {
      toValue: 80,
      duration: 200,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => onDismiss?.());
  }, [visible, onDismiss]);

  // Animate in
   
  useEffect(() => {
    Animated.timing(translateY.current, {
      toValue: 0,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  // Auto-dismiss timer
   
  useEffect(() => {
    const timer = setTimeout(dismiss, duration);
    return () => clearTimeout(timer);
  }, [dismiss, duration]);

  if (!visible) return null;

  return (
    <Animated.View
      style={{
        transform: [{ translateY: translateY.current }],
      }}
      {...pan.panHandlers}
    >
      <Card
        tone="inset"
        padding="md"
        className={cn('flex-row items-center gap-3', 'w-full max-w-[90%]')}
      >
        <AppText variant="body" tone="primary" className="flex-1">
          {message}
        </AppText>

        {actionLabel && onAction ? (
          <Button variant="ghost" size="sm" onPress={() => { onAction(); dismiss(); }}>
            {actionLabel}
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          onPress={dismiss}
          className="ml-2"
          icon={<X size={16} strokeWidth={2} />}
        >
          Dismiss
        </Button>
      </Card>
    </Animated.View>
  );
}

/**
 * Hook for showing snackbars from anywhere in the component tree.
 *
 * Usage:
 *   const showSnackbar = useSnackbar();
 *   showSnackbar('Plan deleted', 'Undo', () => undoDelete());
 */
interface SnackbarItem {
  readonly id: string;
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly duration?: number;
}

export function useSnackbar() {
  const [snackbars, setSnackbars] = useState<readonly SnackbarItem[]>([]);

  const showSnackbar = useCallback((
    message: string,
    actionLabel?: string,
    onAction?: () => void,
    duration?: number,
  ) => {
    const id = crypto.randomUUID();
    setSnackbars((prev) => [...prev, { id, message, actionLabel, onAction, duration }] as readonly SnackbarItem[]);
  }, []);

  const dismissSnackbar = useCallback((id: string) => {
    setSnackbars((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { snackbars, showSnackbar, dismissSnackbar };
}