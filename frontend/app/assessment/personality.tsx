/**
 * Founder personality assessment.
 *
 * Ten statements on a 1-5 agreement scale. The result is five trait values that
 * feed `personality_score` in the compatibility engine — which is why the screen
 * says so plainly at the top: the reason to spend two minutes here is that it
 * changes the matches, not that it produces a personality type.
 *
 * Answers are editable: `GET /api/assessment/personality` returns the previous
 * submission, so re-opening the screen resumes rather than restarts.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  usePersonalityAssessment,
  useSubmitPersonalityAssessment,
} from '@/src/api/queries';
import { theme } from '@/src/theme';

interface Question {
  id: string;
  trait: string;
  text: string;
}

interface Trait {
  key: string;
  label: string;
  low: string;
  high: string;
  value: number | null;
}

const SCALE_LABELS = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

export default function PersonalityAssessmentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isPending } = usePersonalityAssessment();
  const submitMutation = useSubmitPersonalityAssessment();

  const questions: Question[] = data?.questions ?? [];
  const savedTraits: Trait[] = submitMutation.data?.traits ?? data?.traits ?? [];

  // Local edits start from whatever was submitted before.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const answers = useMemo(
    () => ({ ...(data?.answers ?? {}), ...edits }),
    [data?.answers, edits]
  );

  const answeredCount = questions.filter((q) => answers[q.id]).length;
  const complete = questions.length > 0 && answeredCount === questions.length;

  const pick = (questionId: string, value: number) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEdits((prev) => ({ ...prev, [questionId]: value }));
    setError(null);
  };

  const submit = () => {
    setError(null);
    submitMutation.mutate(answers as Record<string, number>, {
      onSuccess: () => {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setEdits({});
      },
      onError: (e: any) => setError(e?.detail || e?.message || 'Could not save your answers'),
    });
  };

  if (isPending) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="assessment-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBack}
          testID="assessment-back"
        >
          <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>ASSESSMENT</Text>
          <Text style={styles.title}>Founder profile</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Ten statements, two minutes. Your answers sharpen the &quot;working chemistry&quot;
          part of every compatibility score — how you and a cofounder line up on risk,
          pace, structure and how directly you handle disagreement.
        </Text>

        {/* Previous result, so a returning user sees what this produced */}
        {savedTraits.length > 0 && (
          <View style={styles.traitsCard}>
            <Text style={styles.cardLabel}>YOUR TRAITS</Text>
            {savedTraits.map((trait) => (
              <View key={trait.key} style={styles.traitRow} testID={`trait-${trait.key}`}>
                <View style={styles.traitHeader}>
                  <Text style={styles.traitLabel}>{trait.label}</Text>
                  <Text style={styles.traitValue}>{Math.round(trait.value ?? 0)}</Text>
                </View>
                <View style={styles.traitTrack}>
                  <View style={[styles.traitFill, { width: `${trait.value ?? 0}%` }]} />
                </View>
                <View style={styles.traitEnds}>
                  <Text style={styles.traitEnd}>{trait.low}</Text>
                  <Text style={[styles.traitEnd, styles.traitEndRight]}>{trait.high}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.progress}>
          {answeredCount} of {questions.length} answered
        </Text>

        {questions.map((question, index) => (
          <View key={question.id} style={styles.questionCard}>
            <Text style={styles.questionIndex}>{index + 1}</Text>
            <Text style={styles.questionText}>{question.text}</Text>
            <View style={styles.scaleRow}>
              {[1, 2, 3, 4, 5].map((value) => {
                const selected = answers[question.id] === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[styles.scaleDot, selected && styles.scaleDotSelected]}
                    onPress={() => pick(question.id, value)}
                    accessibilityLabel={SCALE_LABELS[value - 1]}
                    testID={`answer-${question.id}-${value}`}
                  >
                    <Text style={[styles.scaleDotText, selected && styles.scaleDotTextSelected]}>
                      {value}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.scaleLegend}>
              <Text style={styles.scaleLegendText}>{SCALE_LABELS[0]}</Text>
              <Text style={styles.scaleLegendText}>{SCALE_LABELS[4]}</Text>
            </View>
          </View>
        ))}

        {error && (
          <TouchableOpacity style={styles.errorBanner} onPress={() => setError(null)}>
            <Text style={styles.errorText}>{error}</Text>
          </TouchableOpacity>
        )}

        {/* Partial submissions are accepted on purpose: the engine renormalises over
            the traits both founders answered, so four answers still help. */}
        <TouchableOpacity
          style={[styles.cta, (submitMutation.isPending || !answeredCount) && styles.ctaDisabled]}
          onPress={submit}
          disabled={submitMutation.isPending || !answeredCount}
          activeOpacity={0.85}
          testID="assessment-submit"
        >
          {submitMutation.isPending ? (
            <ActivityIndicator color={theme.colors.brandOn} />
          ) : (
            <>
              {submitMutation.isSuccess && !Object.keys(edits).length ? (
                <Check size={16} color={theme.colors.brandOn} strokeWidth={2.5} />
              ) : (
                <Sparkles size={16} color={theme.colors.brandOn} strokeWidth={2} />
              )}
              <Text style={styles.ctaText}>
                {submitMutation.isSuccess && !Object.keys(edits).length
                  ? 'Saved'
                  : complete
                    ? 'Save my answers'
                    : `Save ${answeredCount} answer${answeredCount === 1 ? '' : 's'}`}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  title: { ...theme.typography.title2, color: theme.colors.text },
  content: { paddingHorizontal: theme.spacing.xl, gap: theme.spacing.lg },
  intro: {
    ...theme.typography.subhead,
    color: theme.colors.textSecondary,
    lineHeight: 21,
  },
  progress: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  traitsCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  cardLabel: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    letterSpacing: 1,
  },
  traitRow: { gap: 6 },
  traitHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  traitLabel: { ...theme.typography.callout, color: theme.colors.text },
  traitValue: { ...theme.typography.callout, color: theme.colors.brand, fontWeight: '600' },
  traitTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surfaceTertiary,
    overflow: 'hidden',
  },
  traitFill: { height: 6, borderRadius: 3, backgroundColor: theme.colors.brand },
  traitEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  traitEnd: { ...theme.typography.caption, color: theme.colors.textSecondary, flex: 1 },
  traitEndRight: { textAlign: 'right' },
  questionCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  questionIndex: {
    ...theme.typography.micro,
    color: theme.colors.brand,
  },
  questionText: { ...theme.typography.body, color: theme.colors.text, lineHeight: 22 },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm },
  scaleDot: {
    flex: 1,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleDotSelected: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  scaleDotText: { ...theme.typography.callout, color: theme.colors.textSecondary },
  scaleDotTextSelected: { color: theme.colors.brandOn, fontWeight: '700' },
  scaleLegend: { flexDirection: 'row', justifyContent: 'space-between' },
  scaleLegendText: { ...theme.typography.caption, color: theme.colors.textSecondary },
  errorBanner: {
    backgroundColor: 'rgba(220,38,38,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.35)',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  errorText: { ...theme.typography.footnote, color: theme.colors.errorOn },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { ...theme.typography.headline, color: theme.colors.brandOn, fontWeight: '700' },
});
