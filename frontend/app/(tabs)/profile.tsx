/**
 * Profile Screen - Premium with hero, stats, badges
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Settings, LogOut, Award, TrendingUp, Briefcase,
  MapPin, Clock, Zap, Star, Shield, Sparkles, Edit3
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

const PLACEHOLDER = 'https://images.unsplash.com/photo-1642290687545-8ab7e6002472?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHwyfHxwcmVtaXVtJTIwcG9ydHJhaXQlMjBibGFjayUyMGFuZCUyMHdoaXRlfGVufDB8fHx8MTc4NTMyNzI2MXww&ixlib=rb-4.1.0&q=85';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleLogout = async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to log out?')) {
        await signOut();
        router.replace('/auth/welcome');
      }
    } else {
      await signOut();
      router.replace('/auth/welcome');
    }
  };

  if (!user) return null;

  const profile = user.profile || {};
  const gamification = user.gamification || { level: 1, projects_count: 0, startups_created: 0 };
  const verification = user.verification || {};
  const photoUri = profile.photos?.[0] || PLACEHOLDER;

  const verifiedCount = Object.values(verification).filter(Boolean).length;

  return (
    <SafeAreaView style={styles.container} edges={[]} testID="profile-screen">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Image source={{ uri: photoUri }} style={styles.heroImage} />
          <LinearGradient
            colors={['transparent', 'rgba(9,9,11,0.5)', 'rgba(9,9,11,1)']}
            locations={[0.2, 0.7, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          
          <View style={[styles.heroTop, { paddingTop: insets.top + theme.spacing.md }]}>
            <View style={styles.levelBadge}>
              <Star size={12} color={theme.colors.brand} strokeWidth={2} fill={theme.colors.brand} />
              <Text style={styles.levelText}>Level {gamification.level}</Text>
            </View>
            <TouchableOpacity style={styles.iconButton} testID="profile-settings">
              <Settings size={20} color={theme.colors.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          <View style={styles.heroContent}>
            <Text style={styles.heroName}>{profile.name}</Text>
            <Text style={styles.heroRole}>
              {profile.profession ? profile.profession.replace(/_/g, ' ') : 'Complete profile'}
            </Text>
            <View style={styles.heroMeta}>
              {profile.city && (
                <View style={styles.metaItem}>
                  <MapPin size={12} color={theme.colors.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.metaText}>{profile.city}</Text>
                </View>
              )}
              {profile.availability && (
                <View style={styles.metaItem}>
                  <Clock size={12} color={theme.colors.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.metaText}>{profile.availability.replace(/_/g, ' ')}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.section}>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <TrendingUp size={16} color={theme.colors.brand} strokeWidth={2} />
              <Text style={styles.statValue}>{gamification.level}</Text>
              <Text style={styles.statLabel}>Level</Text>
            </View>
            <View style={styles.statCard}>
              <Briefcase size={16} color={theme.colors.brand} strokeWidth={2} />
              <Text style={styles.statValue}>{gamification.projects_count}</Text>
              <Text style={styles.statLabel}>Projects</Text>
            </View>
            <View style={styles.statCard}>
              <Sparkles size={16} color={theme.colors.brand} strokeWidth={2} />
              <Text style={styles.statValue}>{gamification.startups_created}</Text>
              <Text style={styles.statLabel}>Startups</Text>
            </View>
          </View>
        </View>

        {/* Verification */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Verification</Text>
            <View style={styles.verifiedBadge}>
              <Shield size={11} color={theme.colors.brand} strokeWidth={2} />
              <Text style={styles.verifiedText}>{verifiedCount}/5</Text>
            </View>
          </View>
          <View style={styles.verificationList}>
            {[
              { key: 'email_verified', label: 'Email' },
              { key: 'linkedin_verified', label: 'LinkedIn' },
              { key: 'github_verified', label: 'GitHub' },
              { key: 'portfolio_verified', label: 'Portfolio' },
              { key: 'identity_verified', label: 'Identity' },
            ].map((v) => (
              <View key={v.key} style={styles.verificationRow}>
                <Text style={styles.verificationLabel}>{v.label}</Text>
                {(verification as any)[v.key] ? (
                  <View style={styles.verifiedIcon}>
                    <Shield size={12} color={theme.colors.brand} strokeWidth={2} fill={theme.colors.brand} />
                    <Text style={styles.verifiedIconText}>Verified</Text>
                  </View>
                ) : (
                  <TouchableOpacity>
                    <Text style={styles.verifyLink}>Verify</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        </View>

        {/* About */}
        {profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        )}

        {/* Skills */}
        {profile.skills?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.chipsWrap}>
              {profile.skills.map((skill: string, i: number) => (
                <View key={i} style={styles.chipDark}>
                  <Text style={styles.chipDarkText}>{skill}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Objectives */}
        {profile.objectives?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Objectives</Text>
            <View style={styles.chipsWrap}>
              {profile.objectives.map((obj: string, i: number) => (
                <View key={i} style={styles.chipGold}>
                  <Text style={styles.chipGoldText}>{obj}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Premium CTA */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.premiumCard} testID="profile-premium-cta">
            <View style={styles.premiumIcon}>
              <Sparkles size={22} color={theme.colors.brandOn} strokeWidth={2} />
            </View>
            <View style={styles.premiumContent}>
              <Text style={styles.premiumTitle}>Upgrade to Premium</Text>
              <Text style={styles.premiumDesc}>
                Unlimited swipes, AI profile coach, and priority matching.
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Actions */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => router.push('/profile/edit')}
            testID="profile-edit"
          >
            <Edit3 size={18} color={theme.colors.text} strokeWidth={1.75} />
            <Text style={styles.actionText}>Edit profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionRow} onPress={handleLogout} testID="profile-logout">
            <LogOut size={18} color={theme.colors.errorOn} strokeWidth={1.75} />
            <Text style={[styles.actionText, { color: theme.colors.errorOn }]}>Log out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  hero: {
    height: 380,
    position: 'relative',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
  },
  levelText: {
    ...theme.typography.caption,
    color: theme.colors.brand,
    fontWeight: '600',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroContent: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    left: theme.spacing.xl,
    right: theme.spacing.xl,
    gap: 4,
  },
  heroName: {
    ...theme.typography.display,
    color: theme.colors.text,
  },
  heroRole: {
    ...theme.typography.callout,
    color: theme.colors.brand,
    textTransform: 'capitalize',
    fontWeight: '500',
  },
  heroMeta: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
    marginTop: theme.spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    ...theme.typography.footnote,
    color: theme.colors.textSecondary,
    textTransform: 'capitalize',
  },
  section: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    ...theme.typography.headline,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  statCard: {
    flex: 1,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  statValue: {
    ...theme.typography.title1,
    color: theme.colors.text,
  },
  statLabel: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    marginBottom: theme.spacing.md,
  },
  verifiedText: {
    ...theme.typography.caption,
    color: theme.colors.brand,
    fontWeight: '600',
  },
  verificationList: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  verificationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  verificationLabel: {
    ...theme.typography.callout,
    color: theme.colors.text,
  },
  verifiedIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedIconText: {
    ...theme.typography.caption,
    color: theme.colors.brand,
    fontWeight: '500',
  },
  verifyLink: {
    ...theme.typography.subhead,
    color: theme.colors.brand,
    fontWeight: '500',
  },
  bioText: {
    ...theme.typography.body,
    color: theme.colors.textTertiary,
    lineHeight: 24,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chipDark: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipDarkText: {
    ...theme.typography.footnote,
    color: theme.colors.text,
  },
  chipGold: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
  },
  chipGoldText: {
    ...theme.typography.footnote,
    color: theme.colors.brand,
    fontWeight: '500',
  },
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  premiumIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumContent: {
    flex: 1,
  },
  premiumTitle: {
    ...theme.typography.headline,
    color: theme.colors.brandOn,
    marginBottom: 2,
  },
  premiumDesc: {
    ...theme.typography.footnote,
    color: 'rgba(9,9,11,0.75)',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  actionText: {
    ...theme.typography.body,
    color: theme.colors.text,
  },
});
