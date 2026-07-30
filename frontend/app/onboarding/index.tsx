/**
 * Premium Multi-step Onboarding
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, Check, Camera, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/contexts/AuthContext';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

const PROFESSIONS = [
  'Developer', 'Designer', 'Marketer', 'Sales', 'Product Manager',
  'Lawyer', 'Finance', 'Content Creator', 'Freelancer', 'Student'
];

const EXPERIENCE_LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'junior', label: 'Junior' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'senior', label: 'Senior' },
  { value: 'sold_company', label: 'Sold a company' },
  { value: 'raised_funds', label: 'Raised funds' },
  { value: 'multiple_startups', label: 'Multiple startups' },
];

const AVAILABILITY_OPTIONS = [
  { value: 'full_time', label: 'Full time' },
  { value: '10h_week', label: '10h / week' },
  { value: '20h_week', label: '20h / week' },
  { value: 'evenings', label: 'Evenings' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'immediate', label: 'Immediately available' },
];

const BUDGETS = ['Bootstrap only', '€1,000', '€5,000', '€20,000', '€50,000+'];

const OBJECTIVES = [
  'SaaS', 'Mobile app', 'Agency', 'Brand', 'Marketplace',
  'AI', 'Crypto', 'Fintech', 'Food', 'Health', 'Gaming'
];

const WORK_STYLES = [
  { value: 'remote', label: 'Remote' },
  { value: 'in_person', label: 'In-person' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'fast_paced', label: 'Fast paced' },
  { value: 'methodical', label: 'Methodical' },
  { value: 'evening_work', label: 'Night owl' },
  { value: 'early_work', label: 'Early bird' },
];

const VALUES = [
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'raise_funds', label: 'Raise funds' },
  { value: 'nomad', label: 'Nomad' },
  { value: 'family', label: 'Family first' },
  { value: 'fast_growth', label: 'Fast growth' },
  { value: 'profitability', label: 'Profitability' },
  { value: 'impact', label: 'Impact' },
];

const SKILLS_SUGGESTIONS = [
  'React', 'Node', 'Python', 'Swift', 'Flutter',
  'AI/ML', 'SEO', 'Google Ads', 'Meta Ads', 'TikTok',
  'Design', 'UI/UX', 'No-code', 'Sales', 'Finance'
];

const TOTAL_STEPS = 6;

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Location & Language
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [languageInput, setLanguageInput] = useState('');
  const [age, setAge] = useState('');
  
  // Step 2: Profession
  const [profession, setProfession] = useState('');
  
  // Step 3: Skills & Experience
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [experience, setExperience] = useState('');
  
  // Step 4: Availability & Budget
  const [availability, setAvailability] = useState('');
  const [budget, setBudget] = useState('');
  
  // Step 5: Objectives & Style
  const [objectives, setObjectives] = useState<string[]>([]);
  const [workStyle, setWorkStyle] = useState<string[]>([]);
  const [values, setValues] = useState<string[]>([]);
  
  // Step 6: Bio & Photos
  const [bio, setBio] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const haptic = (type: 'light' | 'medium' | 'success' = 'light') => {
    if (Platform.OS === 'web') return;
    if (type === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(
        type === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
      );
    }
  };

  const toggleArrayItem = (arr: string[], item: string, setter: (v: string[]) => void) => {
    haptic('light');
    if (arr.includes(item)) {
      setter(arr.filter(i => i !== item));
    } else {
      setter([...arr, item]);
    }
  };

  const addLanguage = () => {
    if (languageInput.trim() && !languages.includes(languageInput.trim())) {
      setLanguages([...languages, languageInput.trim()]);
      setLanguageInput('');
      haptic('light');
    }
  };

  const addSkill = (skill?: string) => {
    const s = skill || skillInput.trim();
    if (s && !skills.includes(s)) {
      setSkills([...skills, s]);
      setSkillInput('');
      haptic('light');
    }
  };

  const pickImage = async () => {
    if (photos.length >= 5) return;
    haptic('light');

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setPhotos([...photos, `data:image/jpeg;base64,${result.assets[0].base64}`]);
    }
  };

  const validateStep = (): string => {
    switch (step) {
      case 1:
        if (!country.trim()) return 'Please enter your country';
        if (!city.trim()) return 'Please enter your city';
        return '';
      case 2:
        if (!profession) return 'Please select your profession';
        return '';
      case 3:
        if (skills.length === 0) return 'Please add at least one skill';
        if (!experience) return 'Please select your experience level';
        return '';
      case 4:
        if (!availability) return 'Please select your availability';
        if (!budget) return 'Please select your budget';
        return '';
      case 5:
        if (objectives.length === 0) return 'Please select at least one objective';
        return '';
      case 6:
        return '';
    }
    return '';
  };

  const handleNext = () => {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      haptic('medium');
      return;
    }
    setError('');
    if (step < TOTAL_STEPS) {
      haptic('light');
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      haptic('light');
      setStep(step - 1);
      setError('');
    } else {
      router.back();
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    setError('');
    try {
      if (photos.length > 0) {
        await api.uploadPhotos(photos);
      }

      await api.completeOnboarding({
        country,
        city,
        languages,
        age: age ? parseInt(age) : null,
        profession: profession.toLowerCase().replace(/ /g, '_'),
        skills,
        experience,
        availability,
        budget,
        objectives,
        work_style: workStyle,
        values,
        bio,
      });

      haptic('success');
      await refreshUser();
      router.replace('/(tabs)/discover');
    } catch (err: any) {
      setError(err.message || 'Failed to complete onboarding');
      haptic('medium');
    } finally {
      setLoading(false);
    }
  };

  const progress = step / TOTAL_STEPS;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="onboarding-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Header with progress */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backButton}
            testID="onboarding-back-button"
          >
            <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.progressWrap}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>{step} / {TOTAL_STEPS}</Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 1 && (
            <View style={styles.stepContent} testID="onboarding-step-1">
              <Text style={styles.eyebrow}>STEP 1</Text>
              <Text style={styles.stepTitle}>Where are{'\n'}you based?</Text>
              <Text style={styles.stepSubtitle}>
                We&apos;ll match you with cofounders in your timezone and beyond.
              </Text>

              <View style={styles.fieldsGroup}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Country</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="France"
                    placeholderTextColor={theme.colors.textSecondary}
                    value={country}
                    onChangeText={setCountry}
                    testID="onboarding-country-input"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>City</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Paris"
                    placeholderTextColor={theme.colors.textSecondary}
                    value={city}
                    onChangeText={setCity}
                    testID="onboarding-city-input"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Age (optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="28"
                    placeholderTextColor={theme.colors.textSecondary}
                    value={age}
                    onChangeText={setAge}
                    keyboardType="numeric"
                    testID="onboarding-age-input"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Languages</Text>
                  <View style={styles.inlineInput}>
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      placeholder="English, French..."
                      placeholderTextColor={theme.colors.textSecondary}
                      value={languageInput}
                      onChangeText={setLanguageInput}
                      onSubmitEditing={addLanguage}
                      returnKeyType="done"
                      testID="onboarding-language-input"
                    />
                    <TouchableOpacity
                      style={styles.addButton}
                      onPress={addLanguage}
                    >
                      <Text style={styles.addButtonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                  {languages.length > 0 && (
                    <View style={styles.tagsRow}>
                      {languages.map(lang => (
                        <View key={lang} style={styles.tag}>
                          <Text style={styles.tagText}>{lang}</Text>
                          <TouchableOpacity onPress={() => setLanguages(languages.filter(l => l !== lang))}>
                            <X size={12} color={theme.colors.textSecondary} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          {step === 2 && (
            <View style={styles.stepContent} testID="onboarding-step-2">
              <Text style={styles.eyebrow}>STEP 2</Text>
              <Text style={styles.stepTitle}>What do you{'\n'}do best?</Text>
              <Text style={styles.stepSubtitle}>
                Select your primary role.
              </Text>

              <View style={styles.chipsGrid}>
                {PROFESSIONS.map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.chipLarge, profession === p && styles.chipLargeSelected]}
                    onPress={() => { setProfession(p); haptic('light'); }}
                    testID={`profession-${p.toLowerCase().replace(/ /g, '-')}`}
                  >
                    <Text style={[styles.chipLargeText, profession === p && styles.chipLargeTextSelected]}>
                      {p}
                    </Text>
                    {profession === p && <Check size={16} color={theme.colors.brandOn} strokeWidth={2.5} />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {step === 3 && (
            <View style={styles.stepContent} testID="onboarding-step-3">
              <Text style={styles.eyebrow}>STEP 3</Text>
              <Text style={styles.stepTitle}>Skills &{'\n'}experience</Text>
              <Text style={styles.stepSubtitle}>
                Add your top skills. This helps us find complementary partners.
              </Text>

              <View style={styles.fieldsGroup}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Add a skill</Text>
                  <View style={styles.inlineInput}>
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      placeholder="React, Python, Design..."
                      placeholderTextColor={theme.colors.textSecondary}
                      value={skillInput}
                      onChangeText={setSkillInput}
                      onSubmitEditing={() => addSkill()}
                      returnKeyType="done"
                      testID="onboarding-skill-input"
                    />
                    <TouchableOpacity
                      style={styles.addButton}
                      onPress={() => addSkill()}
                    >
                      <Text style={styles.addButtonText}>Add</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Suggestions</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipsRow}
                  >
                    {SKILLS_SUGGESTIONS.filter(s => !skills.includes(s)).map(s => (
                      <TouchableOpacity
                        key={s}
                        style={styles.chipSuggestion}
                        onPress={() => addSkill(s)}
                      >
                        <Text style={styles.chipSuggestionText}>+ {s}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {skills.length > 0 && (
                    <View style={styles.tagsRow}>
                      {skills.map(s => (
                        <View key={s} style={styles.tagFilled}>
                          <Text style={styles.tagFilledText}>{s}</Text>
                          <TouchableOpacity onPress={() => setSkills(skills.filter(sk => sk !== s))}>
                            <X size={12} color={theme.colors.brandOn} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Experience level</Text>
                  <View style={styles.chipsWrap}>
                    {EXPERIENCE_LEVELS.map(exp => (
                      <TouchableOpacity
                        key={exp.value}
                        style={[styles.chip, experience === exp.value && styles.chipSelected]}
                        onPress={() => { setExperience(exp.value); haptic('light'); }}
                      >
                        <Text style={[styles.chipText, experience === exp.value && styles.chipTextSelected]}>
                          {exp.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          )}

          {step === 4 && (
            <View style={styles.stepContent} testID="onboarding-step-4">
              <Text style={styles.eyebrow}>STEP 4</Text>
              <Text style={styles.stepTitle}>Availability{'\n'}& budget</Text>
              <Text style={styles.stepSubtitle}>
                How much time and capital can you commit?
              </Text>

              <View style={styles.fieldsGroup}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Availability</Text>
                  <View style={styles.chipsWrap}>
                    {AVAILABILITY_OPTIONS.map(opt => (
                      <TouchableOpacity
                        key={opt.value}
                        style={[styles.chip, availability === opt.value && styles.chipSelected]}
                        onPress={() => { setAvailability(opt.value); haptic('light'); }}
                      >
                        <Text style={[styles.chipText, availability === opt.value && styles.chipTextSelected]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Budget</Text>
                  <View style={styles.chipsWrap}>
                    {BUDGETS.map(b => (
                      <TouchableOpacity
                        key={b}
                        style={[styles.chip, budget === b && styles.chipSelected]}
                        onPress={() => { setBudget(b); haptic('light'); }}
                      >
                        <Text style={[styles.chipText, budget === b && styles.chipTextSelected]}>
                          {b}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          )}

          {step === 5 && (
            <View style={styles.stepContent} testID="onboarding-step-5">
              <Text style={styles.eyebrow}>STEP 5</Text>
              <Text style={styles.stepTitle}>Vision &{'\n'}values</Text>
              <Text style={styles.stepSubtitle}>
                Choose the objectives, style, and values that resonate.
              </Text>

              <View style={styles.fieldsGroup}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Objectives (select multiple)</Text>
                  <View style={styles.chipsWrap}>
                    {OBJECTIVES.map(o => (
                      <TouchableOpacity
                        key={o}
                        style={[styles.chip, objectives.includes(o) && styles.chipSelected]}
                        onPress={() => toggleArrayItem(objectives, o, setObjectives)}
                      >
                        <Text style={[styles.chipText, objectives.includes(o) && styles.chipTextSelected]}>
                          {o}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Work style</Text>
                  <View style={styles.chipsWrap}>
                    {WORK_STYLES.map(w => (
                      <TouchableOpacity
                        key={w.value}
                        style={[styles.chip, workStyle.includes(w.value) && styles.chipSelected]}
                        onPress={() => toggleArrayItem(workStyle, w.value, setWorkStyle)}
                      >
                        <Text style={[styles.chipText, workStyle.includes(w.value) && styles.chipTextSelected]}>
                          {w.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Values</Text>
                  <View style={styles.chipsWrap}>
                    {VALUES.map(v => (
                      <TouchableOpacity
                        key={v.value}
                        style={[styles.chip, values.includes(v.value) && styles.chipSelected]}
                        onPress={() => toggleArrayItem(values, v.value, setValues)}
                      >
                        <Text style={[styles.chipText, values.includes(v.value) && styles.chipTextSelected]}>
                          {v.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          )}

          {step === 6 && (
            <View style={styles.stepContent} testID="onboarding-step-6">
              <Text style={styles.eyebrow}>STEP 6</Text>
              <Text style={styles.stepTitle}>Bring your{'\n'}profile to life</Text>
              <Text style={styles.stepSubtitle}>
                Add photos and a short bio. This is what founders will see first.
              </Text>

              <View style={styles.fieldsGroup}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Photos (up to 5)</Text>
                  <View style={styles.photosGrid}>
                    {photos.map((photo, index) => (
                      <View key={index} style={styles.photoWrap}>
                        <Image source={{ uri: photo }} style={styles.photo} />
                        <TouchableOpacity
                          style={styles.photoRemove}
                          onPress={() => setPhotos(photos.filter((_, i) => i !== index))}
                        >
                          <X size={14} color={theme.colors.text} strokeWidth={2} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {photos.length < 5 && (
                      <TouchableOpacity
                        style={styles.photoAdd}
                        onPress={pickImage}
                        testID="onboarding-add-photo"
                      >
                        <Camera size={22} color={theme.colors.brand} strokeWidth={1.5} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Bio</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Tell founders what drives you..."
                    placeholderTextColor={theme.colors.textSecondary}
                    value={bio}
                    onChangeText={setBio}
                    multiline
                    numberOfLines={4}
                    testID="onboarding-bio-input"
                  />
                </View>
              </View>
            </View>
          )}

          {error ? (
            <View style={styles.errorContainer} testID="onboarding-error">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Sticky bottom CTA */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + theme.spacing.md }]}>
          <TouchableOpacity
            style={[styles.ctaButton, loading && styles.buttonDisabled]}
            onPress={handleNext}
            disabled={loading}
            activeOpacity={0.85}
            testID="onboarding-next-button"
          >
            {loading ? (
              <ActivityIndicator color={theme.colors.brandOn} />
            ) : (
              <>
                <Text style={styles.ctaText}>
                  {step === TOTAL_STEPS ? 'Complete profile' : 'Continue'}
                </Text>
                <ArrowRight size={18} color={theme.colors.brandOn} strokeWidth={2.5} />
              </>
            )}
          </TouchableOpacity>
        </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    marginLeft: -theme.spacing.md,
  },
  progressWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  progressBar: {
    flex: 1,
    height: 3,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.brand,
    borderRadius: 2,
  },
  progressText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
  stepContent: {
    gap: theme.spacing.xl,
  },
  eyebrow: {
    ...theme.typography.micro,
    color: theme.colors.brand,
  },
  stepTitle: {
    ...theme.typography.display,
    color: theme.colors.text,
  },
  stepSubtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    marginTop: -theme.spacing.md,
  },
  fieldsGroup: {
    gap: theme.spacing.xl,
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
  inputFlex: {
    flex: 1,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  inlineInput: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  addButton: {
    backgroundColor: theme.colors.surfaceTertiary,
    paddingHorizontal: theme.spacing.lg,
    justifyContent: 'center',
    borderRadius: theme.radius.md,
  },
  addButtonText: {
    ...theme.typography.subhead,
    color: theme.colors.text,
    fontWeight: '500',
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chipsRow: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  chip: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipSelected: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  chipText: {
    ...theme.typography.subhead,
    color: theme.colors.text,
  },
  chipTextSelected: {
    color: theme.colors.brandOn,
    fontWeight: '500',
  },
  chipLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: '48%',
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  chipLargeSelected: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  chipLargeText: {
    ...theme.typography.callout,
    color: theme.colors.text,
    fontWeight: '500',
  },
  chipLargeTextSelected: {
    color: theme.colors.brandOn,
  },
  chipSuggestion: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderStyle: 'dashed',
  },
  chipSuggestionText: {
    ...theme.typography.footnote,
    color: theme.colors.textSecondary,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tagText: {
    ...theme.typography.footnote,
    color: theme.colors.text,
  },
  tagFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  tagFilledText: {
    ...theme.typography.footnote,
    color: theme.colors.brandOn,
    fontWeight: '500',
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  photoWrap: {
    width: 100,
    height: 130,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    width: 100,
    height: 130,
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderColor: theme.colors.brand,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandTertiary,
  },
  errorContainer: {
    backgroundColor: theme.colors.error,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.lg,
  },
  errorText: {
    ...theme.typography.subhead,
    color: theme.colors.errorOn,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    backgroundColor: 'rgba(9,9,11,0.95)',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.brand,
    paddingVertical: 17,
    borderRadius: theme.radius.pill,
    ...theme.shadow.goldGlow,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    ...theme.typography.headline,
    color: theme.colors.brandOn,
  },
});
