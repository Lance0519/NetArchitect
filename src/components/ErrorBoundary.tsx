/**
 * Error Boundary.
 *
 * Wraps every screen so a render error shows a recoverable screen rather
 * than a white screen or crash.
 *
 * The error is logged to the console for debugging, but the user sees a
 * friendly message with a "Try Again" button that resets the boundary.
 */

import { Component, type ReactNode } from 'react';
import { View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';

import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { Screen } from './Screen';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  readonly error?: Error | null;
  readonly resetErrorBoundary?: () => void;
}) {
  return (
    <Screen title="Something went wrong" subtitle="">
      <Card padding="lg">
        <View className="gap-4">
          <View className="flex-row items-center gap-2">
            <AlertTriangle size={24} className="text-critical" />
            <AppText variant="subheading" tone="primary">
              An unexpected error occurred
            </AppText>
          </View>
          <AppText variant="body" tone="muted">
            {error?.message ||
              'The app encountered an error while rendering this screen. You can try again, or restart the app if the problem persists.'}
          </AppText>
          {resetErrorBoundary ? (
            <Button onPress={resetErrorBoundary}>Try Again</Button>
          ) : null}
        </View>
      </Card>
    </Screen>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error): void {
    console.error('ErrorBoundary caught:', error);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          resetErrorBoundary={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}
