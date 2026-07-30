/**
 * Project detail — read a cofounder opportunity and apply to it.
 *
 * Project cards were previously not tappable and the `applicants` array on every
 * project document was never written to, so there was no way to answer a posting.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, Briefcase, Clock, TrendingUp, Users, Check, Send, Lock,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

const PLACEHOLDER =
  'https://images.unsplash.com/photo-1642290687545-8ab7e6002472?crop=entropy&cs=srgb&fm=jpg&w=200&q=80';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [project, setProject] = useState<any>(null);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (id) load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProject(id!);
      setProject(data);
      // Only the owner is allowed to see who applied.
      if (data.is_owner) {
        const response = await api.getProjectApplicants(id!);
        setApplicants(response.applicants || []);
      }
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not load this opportunity');
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (applying) return;
    setApplying(true);
    setError(null);
    try {
      await api.applyToProject(id!, message.trim());
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setMessage('');
      await load();
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not send your application');
    } finally {
      setApplying(false);
    }
  };

  const toggleStatus = async () => {
    const next = project.status === 'open' ? 'closed' : 'open';
    try {
      await api.setProjectStatus(id!, next);
      setProject({ ...project, status: next });
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not update status');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (!project) {
    return (
      <SafeAreaView style={styles.container} edges={['top']} testID="project-detail-screen">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
            <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error || 'Opportunity not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const owner = project.owner;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="project-detail-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} testID="project-back">
          <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <Text style={styles.eyebrow}>OPPORTUNITY</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleRow}>
            <View style={styles.iconWrap}>
              <Briefcase size={18} color={theme.colors.brand} strokeWidth={1.75} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.title}>{project.title}</Text>
              <Text style={styles.lookingFor}>
                Looking for {project.looking_for?.replace(/_/g, ' ')}
              </Text>
            </View>
          </View>

          {project.status !== 'open' && (
            <View style={styles.closedBanner}>
              <Lock size={12} color={theme.colors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.closedText}>This opportunity is closed</Text>
            </View>
          )}

          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Clock size={12} color={theme.colors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.metaText}>{project.hours_per_week}h/week</Text>
            </View>
            <View style={styles.metaChip}>
              <TrendingUp size={12} color={theme.colors.brand} strokeWidth={1.75} />
              <Text style={styles.metaTextGold}>{project.equity_percentage}% equity</Text>
            </View>
            <View style={styles.metaChip}>
              <Users size={12} color={theme.colors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.metaText}>
                {project.applicants_count} applicant{project.applicants_count === 1 ? '' : 's'}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.description}>{project.description}</Text>

          {project.skills_needed?.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Skills needed</Text>
              <View style={styles.tagsWrap}>
                {project.skills_needed.map((skill: string, i: number) => (
                  <View key={i} style={styles.tag}>
                    <Text style={styles.tagText}>{skill}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {owner && !project.is_owner && (
            <>
              <Text style={styles.sectionTitle}>Posted by</Text>
              <TouchableOpacity
                style={styles.ownerRow}
                onPress={() => router.push(`/profile/${owner.user_id}`)}
                testID="project-owner"
              >
                <Image
                  source={{ uri: owner.profile?.photos?.[0] || PLACEHOLDER }}
                  style={styles.ownerAvatar}
                />
                <View style={styles.flex}>
                  <Text style={styles.ownerName}>{owner.profile?.name}</Text>
                  <Text style={styles.ownerMeta}>
                    {owner.profile?.profession?.replace(/_/g, ' ')}
                    {owner.profile?.city ? ` · ${owner.profile.city}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            </>
          )}

          {error && (
            <TouchableOpacity style={styles.errorBanner} onPress={() => setError(null)}>
              <Text style={styles.errorText}>{error}</Text>
            </TouchableOpacity>
          )}

          {/* Owner view: manage the posting */}
          {project.is_owner ? (
            <>
              <Text style={styles.sectionTitle}>Applicants</Text>
              {applicants.length === 0 ? (
                <Text style={styles.emptyText}>No applications yet.</Text>
              ) : (
                <View style={styles.applicantList}>
                  {applicants.map((applicant) => (
                    <TouchableOpacity
                      key={applicant.user_id}
                      style={styles.applicantRow}
                      onPress={() => router.push(`/profile/${applicant.user_id}`)}
                      testID={`project-applicant-${applicant.user_id}`}
                    >
                      <Image
                        source={{ uri: applicant.user?.profile?.photos?.[0] || PLACEHOLDER }}
                        style={styles.ownerAvatar}
                      />
                      <View style={styles.flex}>
                        <Text style={styles.ownerName}>{applicant.user?.profile?.name}</Text>
                        {applicant.message ? (
                          <Text style={styles.applicantMessage} numberOfLines={3}>
                            {applicant.message}
                          </Text>
                        ) : (
                          <Text style={styles.ownerMeta}>
                            {applicant.user?.profile?.profession?.replace(/_/g, ' ')}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={toggleStatus}
                testID="project-toggle-status"
              >
                <Text style={styles.secondaryButtonText}>
                  {project.status === 'open' ? 'Close this opportunity' : 'Reopen this opportunity'}
                </Text>
              </TouchableOpacity>
            </>
          ) : project.has_applied ? (
            <View style={styles.appliedBanner} testID="project-applied">
              <Check size={16} color={theme.colors.brand} strokeWidth={2.5} />
              <Text style={styles.appliedText}>Application sent</Text>
            </View>
          ) : project.status === 'open' ? (
            <>
              <Text style={styles.sectionTitle}>Your pitch</Text>
              <TextInput
                style={styles.messageInput}
                placeholder="Why are you the right cofounder for this?"
                placeholderTextColor={theme.colors.textSecondary}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={2000}
                testID="project-apply-message"
              />
              <TouchableOpacity
                style={[styles.primaryButton, applying && styles.primaryButtonDisabled]}
                onPress={apply}
                disabled={applying}
                activeOpacity={0.85}
                testID="project-apply-button"
              >
                {applying ? (
                  <ActivityIndicator size="small" color={theme.colors.brandOn} />
                ) : (
                  <>
                    <Send size={15} color={theme.colors.brandOn} strokeWidth={2} />
                    <Text style={styles.primaryButtonText}>Apply</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
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
  eyebrow: { ...theme.typography.micro, color: theme.colors.brand },
  content: { paddingHorizontal: theme.spacing.xl },
  titleRow: { flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...theme.typography.title2, color: theme.colors.text },
  lookingFor: {
    ...theme.typography.subhead,
    color: theme.colors.brand,
    textTransform: 'capitalize',
    marginTop: 2,
  },
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  closedText: { ...theme.typography.footnote, color: theme.colors.textSecondary },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  metaText: { ...theme.typography.caption, color: theme.colors.textSecondary },
  metaTextGold: { ...theme.typography.caption, color: theme.colors.brand, fontWeight: '500' },
  sectionTitle: {
    ...theme.typography.micro,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
  },
  description: { ...theme.typography.body, color: theme.colors.textTertiary, lineHeight: 24 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tagText: { ...theme.typography.footnote, color: theme.colors.text },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  ownerAvatar: { width: 44, height: 44, borderRadius: 22 },
  ownerName: { ...theme.typography.callout, color: theme.colors.text, fontWeight: '500' },
  ownerMeta: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    textTransform: 'capitalize',
    marginTop: 2,
  },
  applicantList: { gap: theme.spacing.sm },
  applicantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  applicantMessage: {
    ...theme.typography.footnote,
    color: theme.colors.textTertiary,
    marginTop: 4,
    lineHeight: 18,
  },
  emptyText: { ...theme.typography.subhead, color: theme.colors.textSecondary },
  messageInput: {
    ...theme.typography.body,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
    paddingVertical: 15,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { ...theme.typography.callout, color: theme.colors.brandOn, fontWeight: '600' },
  secondaryButton: {
    alignItems: 'center',
    marginTop: theme.spacing.xl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryButtonText: { ...theme.typography.callout, color: theme.colors.text },
  appliedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
  },
  appliedText: { ...theme.typography.callout, color: theme.colors.brand, fontWeight: '500' },
  errorBanner: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: theme.radius.sm,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: theme.colors.errorOn,
  },
  errorText: { ...theme.typography.footnote, color: theme.colors.errorOn },
});
