/**
 * Login Screen - Premium dark aesthetic
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const showError = (msg: string) => {
    setError(msg);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleLogin = async () => {
    setError('');
    
    if (!email || !password) {
      showError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      await signIn(email, password);
      router.replace('/');
    } catch (err: any) {
      showError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="login-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            testID="login-back-button"
          >
            <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.eyebrow}>WELCOME BACK</Text>
            <Text style={styles.title}>Log in to{'\n'}CoFound</Text>
            <Text style={styles.subtitle}>
              Continue your journey with your next partner.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="sarah@company.com"
                placeholderTextColor={theme.colors.textSecondary}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="login-email-input"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={theme.colors.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                testID="login-password-input"
              />
            </View>

            {error ? (
              <View style={styles.errorContainer} testID="login-error">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
              testID="login-submit-button"
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.brandOn} />
              ) : (
                <Text style={styles.buttonText}>Log in</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
    marginLeft: -theme.spacing.md,
  },
  header: {
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.xxl,
  },
  eyebrow: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    marginBottom: theme.spacing.md,
  },
  title: {
    ...theme.typography.display,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  form: {
    gap: theme.spacing.lg,
  },
  inputGroup: {
    gap: theme.spacing.sm,
  },
  label: {
    ...theme.typography.footnote,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  input: {
    ...theme.typography.body,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
  },
  errorContainer: {
    backgroundColor: theme.colors.error,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  errorText: {
    ...theme.typography.subhead,
    color: theme.colors.errorOn,
  },
  button: {
    backgroundColor: theme.colors.brand,
    paddingVertical: 18,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    marginTop: theme.spacing.md,
    ...theme.shadow.goldGlow,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...theme.typography.headline,
    color: theme.colors.brandOn,
  },
});
