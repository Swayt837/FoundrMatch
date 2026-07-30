/**
 * Settings — preferences, blocked users, account deletion.
 *
 * The profile screen has always shown a gear icon with no destination. This is
 * that destination, and it carries the two things app stores require: a visible
 * list of blocked users and a way to delete your account.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Image,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Bell, Eye, MapPin, ShieldOff, Sparkles, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

const PLACEHOLDER =
  'https://images.unsplash.com/photo-1642290687545-8ab7e6002472?crop=entropy&cs=srgb&fm=jpg&w=200&q=80';

interface Settings {
  notifications_enabled: boolean;
  distance_preference: number;
  show_age: boolean;
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut, refreshUser } = useAuth();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [premium, setPremium] = useState<any>(null);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [distanceDraft, setDistanceDraft] = useState('');

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const load = async () => {
    setLoading(true);
    try {
      const [settingsResponse, blockedResponse, premiumResponse] = await Promise.all([
        api.getSettings(),
        api.getBlockedUsers(),
        api.premiumMe().catch(() => null),
      ]);
      setSettings(settingsResponse);
      setDistanceDraft(String(settingsResponse.distance_preference ?? 100));
      setBlocked(blockedResponse.blocked || []);
      setPremium(premiumResponse);
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not load settings');
    } finally {
      setLoading(false);
    }
  };

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  /** Optimistic toggle: revert the switch if the request fails. */
  const patch = async (updates: Partial<Settings>) => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...updates });
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateSettings(updates);
      setSettings(saved);
      await refreshUser();
    } catch (e: any) {
      setSettings(previous);
      setError(e?.detail || e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const commitDistance = () => {
    const parsed = parseInt(distanceDraft, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      setDistanceDraft(String(settings?.distance_preference ?? 100));
      return;
    }
    if (parsed !== settings?.distance_preference) patch({ distance_preference: parsed });
  };

  const unblock = async (userId: string) => {
    haptic();
    try {
      await api.unblockUser(userId);
      setBlocked((prev) => prev.filter((b) => b.user?.user_id !== userId));
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not unblock');
    }
  };

  const confirmCancelSubscription = () => {
    const until = premium?.premium_expires_at
      ? new Date(premium.premium_expires_at).toLocaleDateString()
      : 'the end of your current period';
    const message = `Your subscription stops renewing. You keep Premium until ${until}.`;

    const run = async () => {
      try {
        await api.cancelSubscription();
        await load();
        await refreshUser();
      } catch (e: any) {
        setError(e?.detail || e?.message || 'Could not cancel the subscription');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Cancel your subscription?\n\n${message}`)) run();
      return;
    }
    Alert.alert('Cancel subscription', message, [
      { text: 'Keep Premium', style: 'cancel' },
      { text: 'Cancel renewal', style: 'destructive', onPress: run },
    ]);
  };

  const confirmDelete = () => {
    const message =
      'This permanently deletes your profile, matches, messages and deal rooms. This cannot be undone.';

    const run = async () => {
      try {
        await api.deleteAccount();
        await signOut();
        router.replace('/auth/welcome');
      } catch (e: any) {
        setError(e?.detail || e?.message || 'Could not delete account');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete your account?\n\n${message}`)) run();
      return;
    }
    Alert.alert('Delete account', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="settings-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} testID="settings-back">
          <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View>
          <Text style={styles.eyebrow}>PREFERENCES</Text>
          <Text style={styles.title}>Settings</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
          showsVerticalScrollIndicator={false}
        >
          {error && (
            <TouchableOpacity style={styles.errorBanner} onPress={() => setError(null)}>
              <Text style={styles.errorText}>{error}</Text>
            </TouchableOpacity>
          )}

          {/* Preferences */}
          <Text style={styles.sectionTitle}>Discovery</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLabel}>
                <Bell size={17} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.rowText}>Notifications</Text>
              </View>
              <Switch
                value={!!settings?.notifications_enabled}
                onValueChange={(value) => { haptic(); patch({ notifications_enabled: value }); }}
                trackColor={{ false: theme.colors.surfaceTertiary, true: theme.colors.brand }}
                thumbColor={theme.colors.text}
                disabled={saving}
                testID="settings-notifications"
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowLabel}>
                <Eye size={17} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.rowText}>Show my age</Text>
              </View>
              <Switch
                value={!!settings?.show_age}
                onValueChange={(value) => { haptic(); patch({ show_age: value }); }}
                trackColor={{ false: theme.colors.surfaceTertiary, true: theme.colors.brand }}
                thumbColor={theme.colors.text}
                disabled={saving}
                testID="settings-show-age"
              />
            </View>

            <View style={[styles.row, styles.rowLast]}>
              <View style={styles.rowLabel}>
                <MapPin size={17} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.rowText}>Max distance (km)</Text>
              </View>
              <TextInput
                style={styles.distanceInput}
                value={distanceDraft}
                onChangeText={setDistanceDraft}
                onBlur={commitDistance}
                onSubmitEditing={commitDistance}
                keyboardType="number-pad"
                maxLength={5}
                testID="settings-distance"
              />
            </View>
          </View>
          <Text style={styles.hint}>
            Distance is stored on your profile. Location-based filtering is not live yet.
          </Text>

          {/* Subscription — app stores require a visible way to manage a recurring
              purchase, and there was previously no subscription to manage. */}
          <Text style={styles.sectionTitle}>Subscription</Text>
          <View style={styles.card}>
            <View style={[styles.row, premium?.premium && styles.rowLast]}>
              <View style={styles.rowLabel}>
                <Sparkles size={17} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.rowText}>
                  {premium?.premium
                    ? premium.plan === 'lifetime'
                      ? 'Premium — lifetime'
                      : 'Premium — monthly'
                    : 'Free plan'}
                </Text>
              </View>
              {!premium?.premium && (
                <TouchableOpacity onPress={() => router.push('/premium')} testID="settings-upgrade">
                  <Text style={styles.unblockText}>Upgrade</Text>
                </TouchableOpacity>
              )}
            </View>

            {premium?.premium && premium.plan !== 'lifetime' && (
              <View style={[styles.row, styles.rowLast]}>
                <View style={styles.rowLabel}>
                  <Text style={styles.rowSubText}>
                    {premium.cancel_at_period_end
                      ? `Ends ${new Date(premium.premium_expires_at).toLocaleDateString()}`
                      : premium.premium_expires_at
                        ? `Renews ${new Date(premium.premium_expires_at).toLocaleDateString()}`
                        : 'Active'}
                  </Text>
                </View>
                {!premium.cancel_at_period_end && (
                  <TouchableOpacity
                    onPress={confirmCancelSubscription}
                    testID="settings-cancel-subscription"
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Blocked users */}
          <Text style={styles.sectionTitle}>Blocked founders</Text>
          {blocked.length === 0 ? (
            <View style={styles.card}>
              <View style={[styles.row, styles.rowLast]}>
                <Text style={styles.emptyText}>You haven&apos;t blocked anyone.</Text>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              {blocked.map((entry, index) => (
                <View
                  key={entry.user?.user_id || index}
                  style={[styles.row, index === blocked.length - 1 && styles.rowLast]}
                >
                  <View style={styles.rowLabel}>
                    <Image
                      source={{ uri: entry.user?.profile?.photos?.[0] || PLACEHOLDER }}
                      style={styles.blockedAvatar}
                    />
                    <Text style={styles.rowText} numberOfLines={1}>
                      {entry.user?.profile?.name || 'Founder'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => unblock(entry.user.user_id)}
                    testID={`settings-unblock-${entry.user?.user_id}`}
                  >
                    <Text style={styles.unblockText}>Unblock</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.hint}>
            Blocking removes the match and its conversation for both of you. Unblocking does
            not bring it back.
          </Text>

          {/* Danger zone */}
          <Text style={styles.sectionTitle}>Account</Text>
          <TouchableOpacity
            style={styles.dangerRow}
            onPress={confirmDelete}
            testID="settings-delete-account"
          >
            <Trash2 size={17} color={theme.colors.errorOn} strokeWidth={1.75} />
            <Text style={styles.dangerText}>Delete my account</Text>
          </TouchableOpacity>
          <View style={styles.dangerNote}>
            <ShieldOff size={13} color={theme.colors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.dangerNoteText}>
              Deletion is immediate and permanent.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  eyebrow: { ...theme.typography.micro, color: theme.colors.brand, marginBottom: 2 },
  title: { ...theme.typography.title1, color: theme.colors.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: theme.spacing.xl },
  sectionTitle: {
    ...theme.typography.micro,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, flex: 1 },
  rowText: { ...theme.typography.callout, color: theme.colors.text, flexShrink: 1 },
  distanceInput: {
    ...theme.typography.callout,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    minWidth: 72,
    textAlign: 'right',
  },
  hint: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
    lineHeight: 16,
  },
  emptyText: { ...theme.typography.subhead, color: theme.colors.textSecondary },
  blockedAvatar: { width: 32, height: 32, borderRadius: 16 },
  unblockText: { ...theme.typography.subhead, color: theme.colors.brand, fontWeight: '500' },
  cancelText: { ...theme.typography.subhead, color: theme.colors.errorOn, fontWeight: '500' },
  rowSubText: { ...theme.typography.footnote, color: theme.colors.textSecondary },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 16,
    borderRadius: theme.radius.md,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(253,164,175,0.35)',
  },
  dangerText: { ...theme.typography.callout, color: theme.colors.errorOn, fontWeight: '500' },
  dangerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: theme.spacing.sm,
  },
  dangerNoteText: { ...theme.typography.caption, color: theme.colors.textSecondary },
  errorBanner: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.sm,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: theme.colors.errorOn,
    marginBottom: theme.spacing.md,
  },
  errorText: { ...theme.typography.footnote, color: theme.colors.errorOn },
});
