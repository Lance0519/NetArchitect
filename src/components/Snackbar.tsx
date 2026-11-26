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
import { Animated, Easing, PanResponder, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { create } from 'zustand';

import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { cn } from '@/utils/cn';
import { generateId } from '@/utils/id';

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
      accessibilityLiveRegion="polite"
      style={{
        transform: [{ translateY: translateY.current }],
      }}
      {...pan.panHandlers}
    >
      <Card
        tone="inset"
        padding="md"
        className={cn('flex-row items-center gap-3', 'w-full')}
      >
        <AppText variant="body" tone="primary" className="flex-1">
          {message}
        </AppText>

        {actionLabel && onAction ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              onAction();
              dismiss();
            }}
          >
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
 * Shared transient snackbar store so calls from any screen or modal sheet
 * render in the active `<SnackbarHost />`.
 */
export interface SnackbarItem {
  readonly id: string;
  readonly message: string;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly duration?: number | undefined;
}

interface SnackbarStore {
  readonly snackbars: readonly SnackbarItem[];
  readonly modalHostCount: number;
  showSnackbar: (
    message: string,
    actionLabel?: string,
    onAction?: () => void,
    duration?: number,
  ) => void;
  dismissSnackbar: (id: string) => void;
  registerModalHost: () => void;
  unregisterModalHost: () => void;
}

const useSnackbarStore = create<SnackbarStore>()((set) => ({
  snackbars: [],
  modalHostCount: 0,
  showSnackbar: (message, actionLabel, onAction, duration) => {
    const id = generateId();
    set((state) => ({
      snackbars: [
        ...state.snackbars.slice(-2),
        { id, message, actionLabel, onAction, duration },
      ],
    }));
  },
  dismissSnackbar: (id) =>
    set((state) => ({
      snackbars: state.snackbars.filter((item) => item.id !== id),
    })),
  registerModalHost: () => set((state) => ({ modalHostCount: state.modalHostCount + 1 })),
  unregisterModalHost: () =>
    set((state) => ({ modalHostCount: Math.max(0, state.modalHostCount - 1) })),
}));

/** Imperative helper to trigger a snackbar from anywhere. */
export const showSnackbar = (
  message: string,
  actionLabel?: string,
  onAction?: () => void,
  duration?: number,
): void => {
  useSnackbarStore.getState().showSnackbar(message, actionLabel, onAction, duration);
};

export function useSnackbar() {
  const snackbars = useSnackbarStore((s) => s.snackbars);
  const enqueue = useSnackbarStore((s) => s.showSnackbar);
  const dismissSnackbar = useSnackbarStore((s) => s.dismissSnackbar);

  return { snackbars, showSnackbar: enqueue, dismissSnackbar };
}

/**
 * Renders active snackbars pinned above the safe-area bottom inset.
 *
 * Mounted once in `app/_layout.tsx` and once inside visible `<Sheet />` modals
 * (`inModal`) so notifications remain visible above native Modal windows without
 * ever double-rendering.
 */
export function SnackbarHost({ inModal = false }: { readonly inModal?: boolean }) {
  const insets = useSafeAreaInsets();
  const snackbars = useSnackbarStore((s) => s.snackbars);
  const modalHostCount = useSnackbarStore((s) => s.modalHostCount);
  const dismissSnackbar = useSnackbarStore((s) => s.dismissSnackbar);
  const registerModalHost = useSnackbarStore((s) => s.registerModalHost);
  const unregisterModalHost = useSnackbarStore((s) => s.unregisterModalHost);

  useEffect(() => {
    if (!inModal) return;
    registerModalHost();
    return () => unregisterModalHost();
  }, [inModal, registerModalHost, unregisterModalHost]);

  if (!inModal && modalHostCount > 0) return null;
  if (snackbars.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-4 z-50 gap-2"
      style={{ bottom: Math.max(insets.bottom, 16) }}
    >
      {snackbars.map((item) => (
        <Snackbar
          key={item.id}
          message={item.message}
          actionLabel={item.actionLabel}
          onAction={item.onAction}
          duration={item.duration}
          onDismiss={() => dismissSnackbar(item.id)}
        />
      ))}
    </View>
  );
}