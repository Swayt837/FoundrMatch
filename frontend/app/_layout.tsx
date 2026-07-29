/**
 * Root Layout with Auth Provider
 */
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { AuthProvider } from '@/src/contexts/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { Asset } from 'expo-asset';

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// Create a client
const queryClient = new QueryClient();

// Prewarm icon assets (fix for Expo Go Android)
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="auth/welcome" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/register" />
          <Stack.Screen name="onboarding/index" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
