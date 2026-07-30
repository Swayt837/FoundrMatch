/**
 * Premium Success — polls session status until paid
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Sparkles, CheckCircle2, AlertCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

type PollState = 'polling' | 'paid' | 'failed' | 'expired' | 'timeout';

const MAX_ATTEMPTS = 15;
const POLL_INTERVAL = 2000; // 2s

export default function PremiumSuccessScreen() {
  const { session_id } = useLocalSearchParams<{ session_id?: string }>();
  const router = useRouter();
  const { refreshUser } = useAuth();

  const [state, setState] = useState<PollState>('polling');
  const [attempts, setAttempts] = useState(0);
  const [detail, setDetail] = useState<string>('');
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!session_id) {
      setState('failed');
      setDetail('Missing session id.');
      return;
    }
    poll(0);
    return () => {
      cancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session_id]);

  const poll = async (attempt: number) => {
    if (cancelRef.current) return;
    if (attempt >= MAX_ATTEMPTS) {
      setState('timeout');
      return;
    }
    setAttempts(attempt + 1);

    try {
      const res = await api.premiumStatus(session_id as string);
      if (res.payment_status === 'paid') {
        setState('paid');
        try {
          await refreshUser?.();
        } catch {}
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        return;
      }
      if (res.status === 'expired') {
        setState('expired');
        return;
      }
      setTimeout(() => poll(attempt + 1), POLL_INTERVAL);
    } catch (err: any) {
      setDetail(err?.message || 'Status check failed');
      setTimeout(() => poll(attempt + 1), POLL_INTERVAL);
    }
  };

  const goHome = () => {
    router.replace('/(tabs)/discover');
  };

  return (
    <View style={styles.container} testID="premium-success-screen">
      <LinearGradient
        colors={['rgba(212,175,55,0.15)', 'rgba(9,9,11,1)']}
        locations={[0, 0.5]}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.content}>
          {state === 'polling' && (
            <>
              <View style={styles.iconWrap}>
                <ActivityIndicator size="large" color={theme.colors.brand} />
              </View>
              <Text style={styles.title}>Confirming your payment</Text>
              <Text style={styles.subtitle}>
                Attempt {attempts} of {MAX_ATTEMPTS} — hang tight, this takes just a moment.
              </Text>
            </>
          )}

          {state === 'paid' && (
            <>
              <View style={[styles.iconWrap, styles.iconSuccess]}>
                <CheckCircle2 size={44} color={theme.colors.brand} strokeWidth={1.75} fill={theme.colors.brandTertiary} />
              </View>
              <View style={styles.premiumRibbon}>
                <Sparkles size={12} color={theme.colors.brandOn} strokeWidth={2.5} fill={theme.colors.brandOn} />
                <Text style={styles.ribbonText}>PREMIUM ACTIVE</Text>
              </View>
              <Text style={styles.title}>You&apos;re all set</Text>
              <Text style={styles.subtitle}>
                Enjoy unlimited swipes, deep AI insights, priority visibility, and your premium badge.
              </Text>
              <TouchableOpacity style={styles.cta} onPress={goHome} testID="premium-success-continue">
                <Text style={styles.ctaText}>Start discovering</Text>
              </TouchableOpacity>
            </>
          )}

          {(state === 'failed' || state === 'expired' || state === 'timeout') && (
            <>
              <View style={[styles.iconWrap, styles.iconError]}>
                <AlertCircle size={44} color={theme.colors.errorOn} strokeWidth={1.75} />
              </View>
              <Text style={styles.title}>
                {state === 'expired' ? 'Session expired' : state === 'timeout' ? 'Still processing' : 'Payment issue'}
              </Text>
              <Text style={styles.subtitle}>
                {state === 'timeout'
                  ? 'Your payment is still confirming. Check back in a minute — no worries, you won\'t be double-charged.'
                  : detail || 'We couldn\'t confirm your payment. Please try again.'}
              </Text>
              <TouchableOpacity style={styles.ctaSecondary} onPress={() => router.replace('/premium')}>
                <Text style={styles.ctaSecondaryText}>Back to Premium</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={goHome}>
                <Text style={styles.linkText}>Continue anyway</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xxl,
    gap: theme.spacing.lg,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
  },
  iconSuccess: {
    ...theme.shadow.goldGlow,
  },
  iconError: {
    backgroundColor: theme.colors.error,
    borderColor: theme.colors.errorOn,
  },
  premiumRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  ribbonText: {
    ...theme.typography.caption,
    color: theme.colors.brandOn,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  title: {
    ...theme.typography.display,
    color: theme.colors.text,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 22,
  },
  cta: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xxl,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  ctaText: {
    ...theme.typography.headline,
    color: theme.colors.brandOn,
    fontWeight: '700',
  },
  ctaSecondary: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xxl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  ctaSecondaryText: { ...theme.typography.callout, color: theme.colors.text, fontWeight: '600' },
  linkBtn: { padding: theme.spacing.md },
  linkText: { ...theme.typography.subhead, color: theme.colors.textSecondary },
});
