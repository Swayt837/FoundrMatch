/**
 * Welcome Screen - Cinematic entry point
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, StatusBar, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Mail, ArrowRight } from 'lucide-react-native';
import { googleSignInConfigured, useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signInWithGoogle } = useAuth();

  const handleGoogleSignIn = async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      await signInWithGoogle();
    } catch (error: any) {
      // A sign-in button that fails silently reads as a broken app. Say something.
      const message = error?.message || 'Google sign-in failed. Please try again.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Sign-in failed', message);
    }
  };

  const handleEmailSignUp = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push('/auth/register');
  };

  const handleLogin = () => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    router.push('/auth/login');
  };

  return (
    <View style={styles.container} testID="welcome-screen">
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.surface} />
      
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1637775297458-7443ffd545b2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAxODF8MHwxfHNlYXJjaHwyfHxhYnN0cmFjdCUyMGRhcmslMjBsdXh1cnklMjBnZW9tZXRyaWMlMjB0ZXh0dXJlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3ODUzMjcyNDh8MA&ixlib=rb-4.1.0&q=85' }}
        style={styles.backgroundImage}
        resizeMode="cover"
      >
        <LinearGradient
          colors={['rgba(9,9,11,0.4)', 'rgba(9,9,11,0.75)', 'rgba(9,9,11,0.95)']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        
        <View style={[styles.content, { paddingTop: insets.top + theme.spacing.xxl, paddingBottom: insets.bottom + theme.spacing.xl }]}>
          <View style={styles.headerSection}>
            <View style={styles.brandMark}>
              <View style={styles.brandDot} />
              <Text style={styles.brandName}>COFOUND</Text>
            </View>
          </View>

          <View style={styles.heroSection}>
            <Text style={styles.headline}>
              Meet the person{'\n'}you&apos;ll build{'\n'}your next{'\n'}
              <Text style={styles.headlineAccent}>company</Text> with.
            </Text>
            <Text style={styles.subheadline}>
              An AI-powered matching engine for founders, operators, and visionaries.
            </Text>
          </View>

          <View style={styles.actionsSection}>
            {/* Hidden entirely when no Google client ID is configured. A visible
                button that cannot work is worse than one fewer option — and App
                Store review exercises every sign-in path on the screen. */}
            {googleSignInConfigured && (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleGoogleSignIn}
                activeOpacity={0.85}
                testID="welcome-google-button"
              >
                <Text style={styles.primaryButtonText}>Continue with Google</Text>
                <ArrowRight size={18} color={theme.colors.brandOn} strokeWidth={2.5} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={googleSignInConfigured ? styles.secondaryButton : styles.primaryButton}
              onPress={handleEmailSignUp}
              activeOpacity={0.7}
              testID="welcome-email-button"
            >
              <Mail
                size={18}
                color={googleSignInConfigured ? theme.colors.text : theme.colors.brandOn}
                strokeWidth={1.75}
              />
              <Text
                style={
                  googleSignInConfigured
                    ? styles.secondaryButtonText
                    : styles.primaryButtonText
                }
              >
                Sign up with Email
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.loginLink}
              onPress={handleLogin}
              activeOpacity={0.6}
              testID="welcome-login-link"
            >
              <Text style={styles.loginText}>
                Already have an account? <Text style={styles.loginTextBold}>Log in</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  backgroundImage: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  headerSection: {
    alignItems: 'flex-start',
  },
  brandMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  brandDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.brand,
  },
  brandName: {
    ...theme.typography.micro,
    color: theme.colors.text,
    letterSpacing: 3,
  },
  heroSection: {
    marginTop: theme.spacing.xxl,
  },
  headline: {
    ...theme.typography.displayLarge,
    color: theme.colors.text,
    fontSize: 44,
    lineHeight: 50,
  },
  headlineAccent: {
    color: theme.colors.brand,
    fontStyle: 'italic',
    fontWeight: '400',
  },
  subheadline: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.lg,
    maxWidth: 320,
  },
  actionsSection: {
    gap: theme.spacing.md,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brand,
    paddingVertical: 18,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.radius.pill,
    gap: theme.spacing.sm,
    ...theme.shadow.goldGlow,
  },
  primaryButtonText: {
    ...theme.typography.headline,
    color: theme.colors.brandOn,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 17,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.radius.pill,
    gap: theme.spacing.sm,
  },
  secondaryButtonText: {
    ...theme.typography.headline,
    color: theme.colors.text,
  },
  loginLink: {
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  loginText: {
    ...theme.typography.subhead,
    color: theme.colors.textSecondary,
  },
  loginTextBold: {
    color: theme.colors.brand,
    fontWeight: '500',
  },
});
