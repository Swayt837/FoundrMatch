/**
 * Premium Paywall Screen — Lifetime + Monthly
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking as RNLinking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import {
  X,
  Sparkles,
  Zap,
  Eye,
  Infinity as InfinityIcon,
  Award,
  Brain,
  Check,
} from 'lucide-react-native';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

/** Mirrors the backend plan registry in premium.py. */
interface Plan {
  id: string;
  name: string;
  amount: number;
  currency: string;
  /** null for a one-time purchase, "month" for a subscription. */
  interval: string | null;
  available: boolean;
  unavailable_reason: string | null;
}

const BENEFITS = [
  {
    icon: InfinityIcon,
    title: 'Unlimited swipes',
    desc: 'Never hit a daily limit again — swipe as many founders as you like.',
  },
  {
    icon: Brain,
    title: 'Deep AI compatibility report',
    desc: 'Full breakdown across 6 dimensions with founder risk detection.',
  },
  {
    icon: Eye,
    title: 'Priority visibility',
    desc: 'Your profile is boosted to the top of Discover for other founders.',
  },
  {
    icon: Award,
    title: 'Premium badge',
    desc: 'A gold verified badge on your profile signals you\'re serious.',
  },
];

export default function PremiumScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<'lifetime' | 'monthly'>('lifetime');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plans come from the backend rather than being hardcoded here, so the paywall
  // can't advertise a plan the server isn't configured to sell — the monthly plan
  // needs a Stripe Price object to actually recur.
  const [plans, setPlans] = useState<Plan[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await api.getPremiumPlans();
        const available: Plan[] = (response.plans || []).filter((p: Plan) => p.available);
        setPlans(available);
        if (available.length && !available.some((p) => p.id === selectedPlan)) {
          setSelectedPlan(available[0].id as 'lifetime' | 'monthly');
        }
      } catch {
        setPlans([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planById = (id: string) => plans?.find((p) => p.id === id);
  const priceLabel = (plan?: Plan) => {
    if (!plan) return '';
    const symbol = plan.currency === 'eur' ? '€' : plan.currency === 'usd' ? '$' : '';
    const amount = Number.isInteger(plan.amount) ? plan.amount : plan.amount.toFixed(2);
    return `${symbol}${amount}`;
  };

  const haptic = (heavy = false) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(heavy ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const startCheckout = async () => {
    setLoading(true);
    setError(null);
    haptic(true);

    try {
      // Determine origin URL for redirect after Stripe
      let originUrl: string;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        originUrl = window.location.origin;
      } else {
        // Expo dev / prod build: use Linking.createURL for deep link scheme
        originUrl = Linking.createURL('').replace(/\/$/, '');
      }

      const { url, session_id } = await api.premiumCheckout(selectedPlan, originUrl);

      if (Platform.OS === 'web') {
        // Redirect current tab so Stripe returns to /premium/success
        window.location.assign(url);
      } else {
        // Open Stripe Checkout in in-app browser
        const successRedirect = `${originUrl}/premium/success?session_id=${session_id}`;
        const result = await WebBrowser.openAuthSessionAsync(url, successRedirect);

        if (result.type === 'success' && result.url) {
          // Extract session_id and route to success screen
          const parsed = Linking.parse(result.url);
          const sid = (parsed.queryParams?.session_id as string) || session_id;
          router.replace(`/premium/success?session_id=${sid}`);
        } else if (result.type === 'cancel' || result.type === 'dismiss') {
          setError('Checkout cancelled.');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to start checkout');
    } finally {
      setLoading(false);
    }
  };

  if (user?.premium) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.centered} edges={['top']}>
          <View style={styles.iconHero}>
            <Sparkles size={40} color={theme.colors.brand} strokeWidth={1.75} fill={theme.colors.brand} />
          </View>
          <Text style={styles.alreadyTitle}>You&apos;re Premium</Text>
          <Text style={styles.alreadyDesc}>
            You already have unlimited access. Enjoy building.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Continue</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="premium-screen">
      <LinearGradient
        colors={['rgba(212,175,55,0.15)', 'rgba(9,9,11,1)']}
        locations={[0, 0.5]}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Close */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.closeBtn}
            testID="premium-close"
          >
            <X size={22} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 200 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroWrap}>
            <View style={styles.iconHero}>
              <Sparkles size={40} color={theme.colors.brand} strokeWidth={1.75} fill={theme.colors.brand} />
            </View>
            <Text style={styles.eyebrow}>COFOUND PREMIUM</Text>
            <Text style={styles.title}>Build faster.{'\n'}Match smarter.</Text>
            <Text style={styles.subtitle}>
              Unlock the full CoFound engine — unlimited swipes, deep AI insights, and priority
              placement.
            </Text>
          </View>

          {/* Benefits list */}
          <View style={styles.benefits}>
            {BENEFITS.map((b, i) => (
              <View key={i} style={styles.benefitRow}>
                <View style={styles.benefitIcon}>
                  <b.icon size={16} color={theme.colors.brand} strokeWidth={2} />
                </View>
                <View style={styles.benefitTextWrap}>
                  <Text style={styles.benefitTitle}>{b.title}</Text>
                  <Text style={styles.benefitDesc}>{b.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Plan selector — rendered from the server's plan registry */}
          <Text style={styles.chooseTitle}>Choose your plan</Text>
          {plans === null ? (
            <ActivityIndicator color={theme.colors.brand} style={styles.plansLoading} />
          ) : plans.length === 0 ? (
            <Text style={styles.planDesc}>
              No plans are available right now. Please try again later.
            </Text>
          ) : (
            <View style={styles.plans}>
              {plans.map((plan) => (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.planCard, selectedPlan === plan.id && styles.planCardSelected]}
                  onPress={() => {
                    haptic();
                    setSelectedPlan(plan.id as 'lifetime' | 'monthly');
                  }}
                  activeOpacity={0.85}
                  testID={`premium-plan-${plan.id}`}
                >
                  <View style={styles.planTop}>
                    <View style={styles.planLabels}>
                      <Text style={styles.planName}>
                        {plan.interval ? 'Monthly' : 'Lifetime'}
                      </Text>
                      {!plan.interval && (
                        <View style={styles.bestValue}>
                          <Text style={styles.bestValueText}>BEST VALUE</Text>
                        </View>
                      )}
                    </View>
                    {selectedPlan === plan.id && (
                      <View style={styles.checkDot}>
                        <Check size={14} color={theme.colors.brandOn} strokeWidth={3} />
                      </View>
                    )}
                  </View>
                  <View style={styles.priceRow}>
                    <Text style={styles.priceAmount}>{priceLabel(plan)}</Text>
                    <Text style={styles.priceUnit}>
                      {plan.interval ? `/ ${plan.interval}` : 'once'}
                    </Text>
                  </View>
                  <Text style={styles.planDesc}>
                    {plan.interval
                      ? 'Renews automatically. Cancel anytime — you keep access until the end of the period you paid for.'
                      : 'Pay once. Own Premium forever. No renewals, no surprises.'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Sticky CTA */}
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 20 }]}>
          <TouchableOpacity
            style={[styles.cta, (loading || !plans?.length) && styles.ctaDisabled]}
            onPress={startCheckout}
            disabled={loading || !plans?.length}
            activeOpacity={0.9}
            testID="premium-checkout-btn"
          >
            {loading ? (
              <ActivityIndicator size="small" color={theme.colors.brandOn} />
            ) : (
              <>
                <Zap size={18} color={theme.colors.brandOn} strokeWidth={2.5} fill={theme.colors.brandOn} />
                <Text style={styles.ctaText}>
                  {(() => {
                    const plan = planById(selectedPlan);
                    if (!plan) return 'Unlock Premium';
                    return plan.interval
                      ? `Subscribe — ${priceLabel(plan)}/${plan.interval}`
                      : `Unlock Lifetime — ${priceLabel(plan)}`;
                  })()}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.legal}>
            Payment secured by Stripe. Test mode — no real charges.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  scroll: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.xxl,
  },

  heroWrap: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingTop: theme.spacing.xl,
  },
  iconHero: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
    ...theme.shadow.goldGlow,
  },
  eyebrow: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    fontSize: 12,
    letterSpacing: 2,
  },
  title: {
    ...theme.typography.displayLarge,
    color: theme.colors.text,
    textAlign: 'center',
    letterSpacing: -1,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 22,
  },

  alreadyTitle: { ...theme.typography.title1, color: theme.colors.text },
  alreadyDesc: { ...theme.typography.body, color: theme.colors.textSecondary, textAlign: 'center' },
  doneBtn: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xxl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  doneBtnText: { ...theme.typography.callout, color: theme.colors.brandOn, fontWeight: '600' },

  benefits: {
    gap: theme.spacing.lg,
  },
  benefitRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    alignItems: 'flex-start',
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.25)',
  },
  benefitTextWrap: { flex: 1, gap: 2 },
  benefitTitle: { ...theme.typography.headline, color: theme.colors.text },
  benefitDesc: { ...theme.typography.footnote, color: theme.colors.textSecondary, lineHeight: 18 },

  chooseTitle: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    letterSpacing: 1.6,
  },
  plans: {
    gap: theme.spacing.md,
  },
  plansLoading: {
    paddingVertical: theme.spacing.xl,
  },
  planCard: {
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  planCardSelected: {
    borderColor: theme.colors.brand,
    backgroundColor: theme.colors.brandTertiary,
  },
  planTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planLabels: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  planName: { ...theme.typography.title3, color: theme.colors.text },
  bestValue: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.brand,
  },
  bestValueText: {
    ...theme.typography.caption,
    color: theme.colors.brandOn,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.4,
  },
  checkDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  priceAmount: {
    ...theme.typography.display,
    color: theme.colors.text,
    fontSize: 36,
  },
  priceUnit: {
    ...theme.typography.callout,
    color: theme.colors.textSecondary,
  },
  planDesc: {
    ...theme.typography.footnote,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },

  errorBox: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.error,
    borderWidth: 1,
    borderColor: theme.colors.errorOn,
  },
  errorText: {
    ...theme.typography.subhead,
    color: theme.colors.errorOn,
  },

  ctaWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: theme.spacing.xl,
    backgroundColor: 'rgba(9,9,11,0.95)',
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    gap: theme.spacing.sm,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingVertical: 18,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: {
    ...theme.typography.headline,
    color: theme.colors.brandOn,
    fontWeight: '700',
  },
  legal: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});
