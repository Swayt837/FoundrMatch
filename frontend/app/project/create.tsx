/**
 * Create Project Screen - Post a cofounder opportunity
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, X, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

const PROFESSIONS = [
  { value: 'developer', label: 'Developer' },
  { value: 'designer', label: 'Designer' },
  { value: 'marketer', label: 'Marketer' },
  { value: 'sales', label: 'Sales' },
  { value: 'product_manager', label: 'Product Manager' },
  { value: 'finance', label: 'Finance' },
  { value: 'content_creator', label: 'Content Creator' },
];

export default function ProjectCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [hoursPerWeek, setHoursPerWeek] = useState('20');
  const [equityPercentage, setEquityPercentage] = useState('10');
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const addSkill = () => {
    const s = skillInput.trim();
    if (s && !skills.includes(s)) {
      setSkills([...skills, s]);
      setSkillInput('');
      haptic();
    }
  };

  const removeSkill = (s: string) => {
    setSkills(skills.filter(sk => sk !== s));
    haptic();
  };

  const canSubmit = title && description && lookingFor && hoursPerWeek && equityPercentage;

  const submit = async () => {
    setError('');
    if (!canSubmit) {
      setError('Please fill in all required fields');
      return;
    }
    setSaving(true);
    try {
      haptic();
      await api.createProject({
        title,
        description,
        looking_for: lookingFor,
        hours_per_week: parseInt(hoursPerWeek),
        equity_percentage: parseFloat(equityPercentage),
        skills_needed: skills,
      });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.back();
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="project-create-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
            <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>NEW OPPORTUNITY</Text>
            <Text style={styles.title}>Post a project</Text>
          </View>
          <TouchableOpacity
            style={[styles.submitBtn, (!canSubmit || saving) && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={!canSubmit || saving}
            testID="project-create-submit"
          >
            {saving ? (
              <ActivityIndicator size="small" color={theme.colors.brandOn} />
            ) : (
              <Check size={16} color={theme.colors.brandOn} strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.field}>
            <Text style={styles.label}>Project title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. AI Sales Assistant"
              placeholderTextColor={theme.colors.textSecondary}
              value={title}
              onChangeText={setTitle}
              testID="project-title-input"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Description *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What's the vision? What are you building?"
              placeholderTextColor={theme.colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              testID="project-description-input"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Looking for *</Text>
            <View style={styles.chipsWrap}>
              {PROFESSIONS.map(p => (
                <TouchableOpacity
                  key={p.value}
                  style={[styles.chip, lookingFor === p.value && styles.chipSelected]}
                  onPress={() => { setLookingFor(p.value); haptic(); }}
                  testID={`project-looking-${p.value}`}
                >
                  <Text style={[styles.chipText, lookingFor === p.value && styles.chipTextSelected]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.flex]}>
              <Text style={styles.label}>Hours / week *</Text>
              <TextInput
                style={styles.input}
                placeholder="20"
                placeholderTextColor={theme.colors.textSecondary}
                value={hoursPerWeek}
                onChangeText={setHoursPerWeek}
                keyboardType="numeric"
                testID="project-hours-input"
              />
            </View>
            <View style={[styles.field, styles.flex]}>
              <Text style={styles.label}>Equity % *</Text>
              <TextInput
                style={styles.input}
                placeholder="10"
                placeholderTextColor={theme.colors.textSecondary}
                value={equityPercentage}
                onChangeText={setEquityPercentage}
                keyboardType="numeric"
                testID="project-equity-input"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Skills needed</Text>
            <View style={styles.skillRow}>
              <TextInput
                style={[styles.input, styles.flex]}
                placeholder="React, Growth, Design..."
                placeholderTextColor={theme.colors.textSecondary}
                value={skillInput}
                onChangeText={setSkillInput}
                onSubmitEditing={addSkill}
                returnKeyType="done"
                testID="project-skill-input"
              />
              <TouchableOpacity style={styles.addBtn} onPress={addSkill}>
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            {skills.length > 0 && (
              <View style={styles.tags}>
                {skills.map(s => (
                  <View key={s} style={styles.tag}>
                    <Text style={styles.tagText}>{s}</Text>
                    <TouchableOpacity onPress={() => removeSkill(s)}>
                      <X size={12} color={theme.colors.brandOn} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  headerBack: {
    width: 40, height: 40, justifyContent: 'center',
    marginLeft: -theme.spacing.sm,
  },
  eyebrow: { ...theme.typography.micro, color: theme.colors.brand, marginBottom: 2 },
  title: { ...theme.typography.title2, color: theme.colors.text },
  submitBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.goldGlow,
  },
  submitBtnDisabled: { opacity: 0.5 },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  field: { gap: theme.spacing.sm },
  label: {
    ...theme.typography.footnote,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  input: {
    ...theme.typography.body,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top', paddingTop: 14 },
  row: { flexDirection: 'row', gap: theme.spacing.md },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  chipSelected: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  chipText: { ...theme.typography.subhead, color: theme.colors.text },
  chipTextSelected: { color: theme.colors.brandOn, fontWeight: '500' },
  skillRow: { flexDirection: 'row', gap: theme.spacing.sm },
  addBtn: {
    backgroundColor: theme.colors.surfaceTertiary,
    paddingHorizontal: theme.spacing.lg,
    justifyContent: 'center',
    borderRadius: theme.radius.md,
  },
  addBtnText: { ...theme.typography.subhead, color: theme.colors.text, fontWeight: '500' },
  tags: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: theme.spacing.sm, marginTop: theme.spacing.sm,
  },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: theme.spacing.md, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  tagText: {
    ...theme.typography.footnote,
    color: theme.colors.brandOn,
    fontWeight: '500',
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
});
