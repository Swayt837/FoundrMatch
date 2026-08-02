/**
 * Root Layout with Auth Provider
 */
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IncomingCallListener } from '@/src/components/IncomingCallListener';
import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';
import { usePushNotifications } from '@/src/hooks/use-push-notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { Asset } from 'expo-asset';
import { theme } from '@/src/theme';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // React Native has no window focus event, so refetch-on-focus is handled by
      // the screens that need it (via useFocusEffect + refetch) rather than here.
      refetchOnWindowFocus: false,
      // A 401 clears the session and routes to sign-in; retrying it just delays that.
      retry: (failureCount, error: any) => failureCount < 2 && error?.status !== 401,
      staleTime: 30_000,
    },
  },
});

const prewarmAssets = async () => {
  try {
    const iconAssets = [
      require('@/assets/images/icon.png'),
      require('@/assets/images/adaptive-icon.png'),
    ];
    await Asset.loadAsync(iconAssets);
  } catch (error) {
    console.warn('Asset prewarming failed:', error);
  }
};

/**
 * Lives inside AuthProvider so it can see who is signed in — a push token is
 * registered against an account, not a device.
 */
function PushRegistrar() {
  const { user } = useAuth();
  usePushNotifications(user?.user_id);
  return null;
}

export default function RootLayout() {
  useEffect(() => {
    async function prepare() {
      try {
        await prewarmAssets();
      } catch (e) {
        console.warn(e);
      } finally {
        await SplashScreen.hideAsync();
      }
    }
    prepare();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="light" backgroundColor={theme.colors.surface} />
            {/* Mounted once, above the navigator: the server rings a user's personal
                socket room, so a call must be answerable from any screen. */}
            <IncomingCallListener />
            <PushRegistrar />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="auth/welcome" />
              <Stack.Screen name="auth/login" />
              <Stack.Screen name="auth/register" />
              <Stack.Screen name="onboarding/index" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[matchId]" options={{ presentation: 'card' }} />
              <Stack.Screen name="deal-room/[matchId]" options={{ presentation: 'card' }} />
              <Stack.Screen name="call/[matchId]" options={{ presentation: 'fullScreenModal' }} />
              <Stack.Screen name="profile/edit" options={{ presentation: 'modal' }} />
              <Stack.Screen name="profile/[id]" options={{ presentation: 'card' }} />
              <Stack.Screen name="project/create" options={{ presentation: 'modal' }} />
              <Stack.Screen name="project/[id]" options={{ presentation: 'card' }} />
              <Stack.Screen name="settings/index" options={{ presentation: 'card' }} />
              <Stack.Screen name="assessment/personality" options={{ presentation: 'card' }} />
              <Stack.Screen name="premium/index" options={{ presentation: 'modal' }} />
              <Stack.Screen name="premium/success" options={{ presentation: 'card' }} />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
