/**
 * Screen - the frame every route renders inside.
 *
 * ## What it owns so no screen has to
 *
 * **Safe areas.** The notch, the home indicator and the status bar each eat into
 * the viewport differently per device and per orientation. Handling it once here
 * means a screen can lay content out from y=0 without knowing which device it is
 * on.
 *
 * **The read-width cap.** On a landscape tablet, a text field stretched to 1200pt
 * is worse than useless: the caret ends up nowhere near the label. `maxWidth`
 * centres the content instead, so the layout is the same on a phone and a
 * 13-inch iPad.
 *
 * **The back button.** A header without one is a screen the user cannot leave on
 * a platform with no hardware back gesture. Owning it here means `canGoBack()`
 * decides, so tab roots show nothing and pushed screens are correct without
 * being asked. See the `back` prop for why this was not left to each screen.
 *
 * **The keyboard.** Forms are the majority of this app, and on iOS a focused
 * field at the bottom of a scrolling view is otherwise unreachable. The
 * `KeyboardAvoidingView` plus a bottom inset is what stops that.
 *
 * ## Why the bottom inset is added manually
 *
 * `react-native-safe-area-context`'s `useSafeAreaInsets` reports the *hardware*
 * inset. When a keyboard is up it is additionally translated by
 * `KeyboardAvoidingView`; adding the keyboard height to the inset as well would
 * double-count it and leave a gap. The inset here is for the home indicator, and
 * the keyboard is handled separately, by exactly one mechanism.
 */

import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type ViewProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRouter } from 'expo-router';
import { ChevronLeft, Settings } from 'lucide-react-native';
import { AppText } from './AppText';
import { IconButton } from './Button';
import { cn } from '@/utils/cn';

export interface ScreenProps extends Omit<ViewProps, 'children'> {
  /** Route title, rendered as the screen heading. Omit for a custom header. */
  title?: string;
  /** One line under the title. Keep it to context, not explanation. */
  subtitle?: string | undefined;
  /** Custom element in header top-left (e.g. app logo) */
  headerLeft?: ReactNode | undefined;
  /** Custom element in header top-right */
  headerRight?: ReactNode | undefined;
  /**
   * Show a back button. Default `true`.
   *
   * The button appears only when there is history to return to
   * (`router.canGoBack()`).
   *
   * **Tab roots must pass `back={false}`.** It is tempting to assume a tab root
   * has no history and needs no special-casing. That is false, and measurably so:
   * bottom tabs push each visited tab onto the stack on every platform, so after
   * Home -> Settings -> Tools the Tools tab has history and the chevron appears
   * there. It then leads somewhere unrelated to the tab bar sitting directly
   * beneath it, which is worse than having no chevron at all.
   *
   * This lives here rather than in each screen because the header is owned here.
   * When it was not owned here, four screens each hand-rolled a back control and
   * all four disagreed: one put it in the page footer, three used an inline text
   * link under the title, and the icon sizes and stroke weights did not match. A
   * new pushed screen would have had a fifth.
   */
  back?: boolean | undefined;
  /**
   * What the back button does. Defaults to `router.back()`.
   *
   * Supply this when leaving the screen has to be conditional - a not-found state
   * that should fall back to a `replace()` rather than pop, for instance.
   */
  onBack?: (() => void) | undefined;
  /** Show settings shortcut button in header. Default true when title is provided. */
  showSettings?: boolean;
  /**
   * Wrap content in a scroll view. Off by default.
   *
   * Off is the default on purpose: a screen that does not need to scroll should
   * not scroll, because a scroll container on a short screen introduces a
   * bounce and swallows taps near the edges. Turn it on when content can exceed
   * the viewport.
   */
  scroll?: boolean;
  /** Keep content clear of the keyboard. Default true; only the home screen opts out. */
  avoidKeyboard?: boolean;
  /** Width cap. `read` for prose, `form` for input screens, `full` to opt out. */
  width?: 'read' | 'form' | 'full';
  /**
   * Pinned to the bottom, outside the scroll area.
   *
   * For a primary action that must stay reachable - a Next button, a Save bar.
   * Content that scrolls under it would otherwise be unreachable.
   */
  footer?: ReactNode | undefined;
  children: ReactNode;
}

const WIDTH_CLASS = {
  read: 'max-w-read',
  form: 'max-w-form',
  full: 'max-w-none',
} as const;

export function Screen({
  title,
  subtitle,
  headerLeft,
  headerRight,
  back = true,
  onBack,
  showSettings = true,
  scroll = false,
  avoidKeyboard = true,
  width = 'read',
  footer,
  children,
  className,
  ...rest
}: ScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // A caller-supplied `headerLeft` wins. Otherwise the leading slot goes to the
  // back button, and only when there is somewhere to go back to.
  const leading =
    headerLeft !== undefined ? (
      headerLeft
    ) : back !== false && router.canGoBack() ? (
      <IconButton label="Go back" onPress={onBack ?? (() => router.back())}>
        <ChevronLeft size={22} strokeWidth={2} className="text-ink-muted" />
      </IconButton>
    ) : null;

  const header =
    title === undefined ? null : (
      <View className="mb-gutter-lg flex-row items-start justify-between">
        <View className="flex-1 flex-row items-center gap-3 pr-3">
          {leading}
          <View className="flex-1 gap-1">
            <AppText variant="title">{title}</AppText>
            {subtitle === undefined ? null : (
              <AppText tone="muted" variant="body">
                {subtitle}
              </AppText>
            )}
          </View>
        </View>
        {headerRight !== undefined ? (
          headerRight
        ) : showSettings && title !== 'Settings' ? (
          <IconButton
            label="Settings"
            onPress={() => router.push('/settings')}
            className="mt-1"
          >
            <Settings size={20} strokeWidth={2} className="text-ink-muted" />
          </IconButton>
        ) : null}
      </View>
    );

  const content = (
    <View className={cn('w-full self-center px-gutter', WIDTH_CLASS[width])}>
      {header}
      {children}
    </View>
  );

  const body = scroll ? (
    <ScrollView
      className="flex-1"
      // `keyboardShouldPersistTaps="handled"` is what makes tapping a button work
      // while a field is focused. The default, "never", requires two taps: one to
      // dismiss the keyboard and one to press the button. On a form whose whole
      // purpose is rapid entry, that is a genuinely infuriating default.
      keyboardShouldPersistTaps="handled"
      // Lets content pull past the bottom inset to reveal the last row. Without
      // this the final item in a list is unreachable on a device with a home
      // indicator.
      contentContainerClassName="pb-8"
      keyboardDismissMode="on-drag"
    >
      {content}
    </ScrollView>
  ) : (
    content
  );

  return (
    <SafeAreaView
      className="flex-1 bg-canvas"
      edges={['top', 'left', 'right']}
      // `rest` lands on the screen root, which is where a caller-supplied
      // `testID` or `accessibilityLabel` belongs. Applying it to the inner content
      // view instead would silently re-parent the accessibility node.
      {...rest}
    >
      {/* `padding` rather than `paddingBottom` on the keyboard behaviour: iOS
          translates the view, Android does not and needs the height. `height` is
          the behaviour that is correct on both, and the platform branch exists
          only because Android would otherwise ignore the input entirely. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {body}
        {footer === undefined ? null : (
          <View
            className="border-t border-line-subtle bg-surface px-gutter pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <View className={cn('w-full self-center', WIDTH_CLASS[width])}>{footer}</View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
