/**
 * Profile Detail Screen - Full-screen premium profile view
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  MapPin,
  Briefcase,
  Clock,
  Sparkles,
  Zap,
  Globe,
  Target,
  Heart,
  Users,
  DollarSign,
  Award,
  Languages as LanguagesIcon,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

const PLACEHOLDER =
  'https://images.unsplash.com/photo-1642290687545-8ab7e6002472?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHwyfHxwcmVtaXVtJTIwcG9ydHJhaXQlMjBibGFjayUyMGFuZCUyMHdoaXRlfGVufDB8fHx8MTc4NTMyNzI2MXww&ixlib=rb-4.1.0&q=85';

export default function ProfileDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePhoto, setActivePhoto] = useState(0);

  useEffect(() => {
    if (id) load();
  }, [id]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getUserProfile(id as string);
      // Backend returns { user_id, email, profile: {name, bio, city, ...}, ... }
      // Flatten profile fields to top level for easier rendering
      const flat = data?.profile ? { user_id: data.user_id, ...data.profile } : data;
      setProfile(flat);
    } catch (err: any) {
      setError(err?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const headerBack = (
    <TouchableOpacity
      style={[styles.backButton, { top: insets.top + 12 }]}
      onPress={() => {
        haptic();
        router.back();
      }}
      activeOpacity={0.85}
      testID="profile-detail-back"
    >
      <BlurView intensity={40} tint="dark" style={styles.backBlur}>
        <View style={styles.backInner}>
          <ArrowLeft size={20} color={theme.colors.text} strokeWidth={1.75} />
        </View>
      </BlurView>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container} testID="profile-detail-loading">
        <SafeAreaView style={styles.centered} edges={['top']}>
          <ActivityIndicator size="large" color={theme.colors.brand} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </SafeAreaView>
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.container} testID="profile-detail-error">
        {headerBack}
        <SafeAreaView style={styles.centered} edges={['top']}>
          <Text style={styles.errorTitle}>Couldn't load profile</Text>
          <Text style={styles.errorText}>{error || 'Profile not found'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const photos: string[] = (profile.photos && profile.photos.length > 0)
    ? profile.photos
    : [PLACEHOLDER];
  const heroPhoto = photos[activePhoto] || PLACEHOLDER;
  const heroHeight = Math.min(width * 1.15, 520);

  const nextPhoto = () => {
    setActivePhoto((p) => (p + 1) % photos.length);
    haptic();
  };
  const prevPhoto = () => {
    setActivePhoto((p) => (p - 1 + photos.length) % photos.length);
    haptic();
  };

  return (
    <View style={styles.container} testID="profile-detail-screen">
      {headerBack}
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero image with taps to change photo */}
        <View style={[styles.hero, { height: heroHeight }]}>
          <Image source={{ uri: heroPhoto }} style={styles.heroImage} />
          <LinearGradient
            colors={['rgba(9,9,11,0.5)', 'transparent', 'rgba(9,9,11,0.5)', 'rgba(9,9,11,0.98)']}
            locations={[0, 0.25, 0.7, 1]}
            style={styles.heroGradient}
          />
          {photos.length > 1 && (
            <>
              <TouchableOpacity style={styles.tapAreaLeft} onPress={prevPhoto} />
              <TouchableOpacity style={styles.tapAreaRight} onPress={nextPhoto} />
              <View style={[styles.photoDots, { top: insets.top + 16 }]}>
                {photos.map((_, i) => (
                  <View
                    key={i}
                    style={[styles.photoDot, i === activePhoto && styles.photoDotActive]}
                  />
                ))}
              </View>
            </>
          )}

          {/* Hero content: name, age, location */}
          <View style={styles.heroContent}>
            <View style={styles.nameRow}>
              <Text style={styles.heroName} numberOfLines={2}>
                {profile.name}
              </Text>
              {profile.age && <Text style={styles.heroAge}>{profile.age}</Text>}
            </View>
            {(profile.city || profile.country) && (
              <View style={styles.heroMeta}>
                <MapPin size={13} color={theme.colors.textSecondary} strokeWidth={1.75} />
                <Text style={styles.heroMetaText}>
                  {[profile.city, profile.country].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}
            <View style={styles.heroChips}>
              {profile.profession && (
                <View style={styles.heroChip}>
                  <Briefcase size={12} color={theme.colors.brand} strokeWidth={1.75} />
                  <Text style={styles.heroChipText}>
                    {profile.profession.replace(/_/g, ' ')}
                  </Text>
                </View>
              )}
              {profile.availability && (
                <View style={styles.heroChip}>
                  <Clock size={12} color={theme.colors.brand} strokeWidth={1.75} />
                  <Text style={styles.heroChipText}>
                    {profile.availability.replace(/_/g, ' ')}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Body */}
        <View style={styles.body}>
          {/* Bio */}
          {profile.bio ? (
            <Section title="About" icon={<Sparkles size={14} color={theme.colors.brand} strokeWidth={2} />}>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </Section>
          ) : null}

          {/* Skills */}
          {profile.skills?.length > 0 && (
            <Section title="Skills" icon={<Zap size={14} color={theme.colors.brand} strokeWidth={2} />}>
              <View style={styles.pillWrap}>
                {profile.skills.map((s: string, i: number) => (
                  <View key={i} style={styles.pillGold}>
                    <Text style={styles.pillGoldText}>{s}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {/* Experience */}
          {profile.experience ? (
            <Section title="Experience" icon={<Award size={14} color={theme.colors.brand} strokeWidth={2} />}>
              <View style={styles.chipInline}>
                <Text style={styles.chipInlineText}>
                  {String(profile.experience).replace(/_/g, ' ')}
                </Text>
              </View>
            </Section>
          ) : null}

          {/* Objectives */}
          {profile.objectives?.length > 0 && (
            <Section title="Objectives" icon={<Target size={14} color={theme.colors.brand} strokeWidth={2} />}>
              <View style={styles.pillWrap}>
                {profile.objectives.map((o: string, i: number) => (
                  <View key={i} style={styles.pillDark}>
                    <Text style={styles.pillDarkText}>{o.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {/* Work Style */}
          {profile.work_style ? (
            <Section title="Work style" icon={<Users size={14} color={theme.colors.brand} strokeWidth={2} />}>
              <View style={styles.chipInline}>
                <Text style={styles.chipInlineText}>
                  {String(profile.work_style).replace(/_/g, ' ')}
                </Text>
              </View>
            </Section>
          ) : null}

          {/* Values */}
          {profile.values?.length > 0 && (
            <Section title="Values" icon={<Heart size={14} color={theme.colors.brand} strokeWidth={2} />}>
              <View style={styles.pillWrap}>
                {profile.values.map((v: string, i: number) => (
                  <View key={i} style={styles.pillDark}>
                    <Text style={styles.pillDarkText}>{v.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {/* Budget */}
          {profile.budget ? (
            <Section title="Budget" icon={<DollarSign size={14} color={theme.colors.brand} strokeWidth={2} />}>
              <View style={styles.chipInline}>
                <Text style={styles.chipInlineText}>
                  {String(profile.budget).replace(/_/g, ' ')}
                </Text>
              </View>
            </Section>
          ) : null}

          {/* Languages */}
          {profile.languages?.length > 0 && (
            <Section title="Languages" icon={<LanguagesIcon size={14} color={theme.colors.brand} strokeWidth={2} />}>
              <View style={styles.pillWrap}>
                {profile.languages.map((l: string, i: number) => (
                  <View key={i} style={styles.pillDark}>
                    <Text style={styles.pillDarkText}>{l}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {/* Verified footer stub */}
          <View style={styles.footer}>
            <Globe size={12} color={theme.colors.textSecondary} strokeWidth={1.5} />
            <Text style={styles.footerText}>Profile viewed via CoFound</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/* ----------- Section subcomponent ----------- */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  loadingText: { ...theme.typography.callout, color: theme.colors.textSecondary },
  errorTitle: { ...theme.typography.title2, color: theme.colors.text },
  errorText: { ...theme.typography.body, color: theme.colors.textSecondary, textAlign: 'center' },
  retryButton: {
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  retryText: { ...theme.typography.callout, color: theme.colors.brandOn, fontWeight: '600' },

  scrollContent: { flexGrow: 1 },

  backButton: {
    position: 'absolute',
    left: theme.spacing.lg,
    zIndex: 100,
    borderRadius: 22,
    overflow: 'hidden',
    ...theme.shadow.medium,
  },
  backBlur: { borderRadius: 22, overflow: 'hidden' },
  backInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },

  hero: {
    width: '100%',
    position: 'relative',
    justifyContent: 'flex-end',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroGradient: { ...StyleSheet.absoluteFillObject },
  tapAreaLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '35%',
  },
  tapAreaRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '35%',
  },
  photoDots: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
  },
  photoDot: {
    height: 3,
    flex: 1,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  photoDotActive: { backgroundColor: theme.colors.brand },

  heroContent: {
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
    zIndex: 2,
  },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm, flexWrap: 'wrap' },
  heroName: {
    ...theme.typography.display,
    color: theme.colors.text,
    letterSpacing: -0.5,
  },
  heroAge: {
    ...theme.typography.title2,
    color: theme.colors.textSecondary,
    fontWeight: '400',
  },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMetaText: { ...theme.typography.subhead, color: theme.colors.textSecondary },
  heroChips: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  heroChipText: {
    ...theme.typography.caption,
    color: theme.colors.text,
    fontWeight: '500',
    textTransform: 'capitalize',
  },

  body: {
    padding: theme.spacing.xl,
    gap: theme.spacing.xxl,
  },
  section: { gap: theme.spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    fontSize: 12,
    letterSpacing: 1.4,
  },
  sectionBody: {},

  bioText: {
    ...theme.typography.body,
    color: theme.colors.textTertiary,
    lineHeight: 24,
  },

  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  pillGold: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  pillGoldText: {
    ...theme.typography.footnote,
    color: theme.colors.brandOn,
    fontWeight: '600',
  },
  pillDark: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pillDarkText: {
    ...theme.typography.footnote,
    color: theme.colors.text,
    textTransform: 'capitalize',
  },
  chipInline: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipInlineText: {
    ...theme.typography.callout,
    color: theme.colors.text,
    textTransform: 'capitalize',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  footerText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
  },
});
