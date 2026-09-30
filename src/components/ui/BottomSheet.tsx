/**
 * BottomSheet - modal bottom sheet.
 *
 * Used for advanced details, edit forms, export options, etc.
 * The panel respects the home indicator and keyboard.
 */

import { type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { AppText } from '../AppText';
import { IconButton } from './Button';
import { cn } from '@/utils/cn';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | undefined;
  footer?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  footer,
  children,
  className,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      transparent
      statusBarTranslucent
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
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
