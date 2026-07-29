/**
 * Index/Splash Screen - Routes based on auth state
 */
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#6B46C1" />
      </View>
    );
  }

  // Not logged in
  if (!user) {
    return <Redirect href="/auth/welcome" />;
  }

  // Logged in but onboarding not completed
  if (!user.onboarding_completed) {
    return <Redirect href="/onboarding" />;
  }

  // Fully authenticated
  return <Redirect href="/(tabs)/discover" />;
}
