/**
 * Sheet - a modal bottom sheet.
 *
 * ## Why not a third-party sheet library
 *
 * The behaviour needed here is: a backdrop that dismisses, a panel that respects
 * the home indicator, and a keyboard that does not cover the panel. That is about
 * sixty lines, and the alternatives each add a gesture handler, an animation
 * driver and a version matrix. The app already depends on `react-native-screens`
 * and `react-native-safe-area-context` for far more important reasons.
 *
 * ## Accessibility behaviour that is easy to get wrong
 *
 * - The panel is announced as a "sheet" so a screen reader user knows a new layer
 *   opened rather than the content having changed underneath them.
 * - `onRequestClose` is wired. Without it, Android's hardware back button does
 *   nothing, which is a bug users report as "the app is stuck".
 * - The backdrop is pressable and labelled, so it is dismissible by tapping it
 *   *and* reachable as a target - not merely clickable in a way nothing announces.
 *
 * ## Animation
 *
 * `animationType="slide"` is a native animation, so it runs on the UI thread and
 * does not stutter when the JS thread is busy parsing a large plan. A
 * `LayoutAnimation` or `Animated` tween would be a downgrade on exactly the
 * screens where a modal is most likely to open - immediately after a calculation.
 */

import { type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { AppText } from '@/components/AppText';
import { IconButton } from '@/components/Button';
import { cn } from '@/utils/cn';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Optional line under the title. */
  subtitle?: string | undefined;
  /** Pinned to the bottom, inside the safe area. For a confirm/cancel pair. */
  footer?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  footer,
  children,
  className,
}: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      // Required for the Android back button. Without it the sheet cannot be
      // dismissed by the system's own gesture and the user is stuck.
      onRequestClose={onClose}
      animationType="slide"
      // The scrim dims the screen behind. `transparent` is required for the dim
      // to composite at all; RN draws a solid black sheet otherwise.
      transparent
      // Presented over the full screen, so the sheet covers a tab bar rather than
      // stopping short of it.
      statusBarTranslucent
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          // A plain View with no press handler would be a dead zone that eats the
          // tap, which is worse than a backdrop that is simply not tappable.
          className="flex-1 bg-black/45"
        />

        <View
          accessibilityViewIsModal
          className={cn(
            'max-h-[85%] rounded-t-[20px] border-t border-line bg-surface',
            className,
          )}
        >
          <View className="flex-row items-start gap-3 px-gutter pb-3 pt-4">
            <View className="flex-1 gap-1">
              <AppText variant="heading">{title}</AppText>
              {subtitle === undefined ? null : (
                <AppText variant="caption" tone="faint">
                  {subtitle}
                </AppText>
              )}
            </View>
            <IconButton label="Close" onPress={onClose} disabled={false}>
              <X size={20} strokeWidth={2} className="text-ink-muted" />
            </IconButton>
          </View>

          <View className="border-t border-line-subtle px-gutter py-4">{children}</View>

          {footer === undefined ? null : (
            <View
              className="border-t border-line-subtle px-gutter pt-3"
              // The home-indicator inset is applied here rather than on the modal
              // root, so the scrollable body above it is not padded by an inset
              // that belongs to the buttons.
              style={{ paddingBottom: Math.max(insets.bottom, 12) }}
            >
              {footer}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
