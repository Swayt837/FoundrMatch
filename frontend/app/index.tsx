/**
 * Index/Splash Screen - Routes based on auth state
 */
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.surface }}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/auth/welcome" />;
  }

  if (!user.onboarding_completed) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)/discover" />;
}
