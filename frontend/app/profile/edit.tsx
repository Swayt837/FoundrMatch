/**
 * Profile Edit Screen - Update name, bio, skills, photos
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Camera, X, Check, Plus, Play, ArrowUp, ArrowDown } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { storablePhoto } from '@/src/utils/photos';
import { pickAndUploadShowcase, type ShowcaseUpload } from '@/src/utils/showcase';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/contexts/AuthContext';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

export default function ProfileEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const p = user?.profile || {};

  const [name, setName] = useState(p.name || '');
  const [bio, setBio] = useState(p.bio || '');
  const [city, setCity] = useState(p.city || '');
  const [country, setCountry] = useState(p.country || '');
  const [skills, setSkills] = useState<string[]>(p.skills || []);
  const [skillInput, setSkillInput] = useState('');
  const [photos, setPhotos] = useState<string[]>(p.photos || []);
  const [showcase, setShowcase] = useState<ShowcaseUpload[]>(p.showcase || []);
  const [addingShowcase, setAddingShowcase] = useState(false);
  const [showcaseError, setShowcaseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const pickImage = async () => {
    if (photos.length >= 5) return;
    haptic();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 1,
    });
    if (result.canceled) return;

    // Uploads to object storage when it is available, and falls back to an
    // inline data URI when it is not â€” see src/utils/photos.ts.
    const stored = await storablePhoto(result.assets[0]);
    if (stored) setPhotos([...photos, stored]);
  };

  const addShowcase = async () => {
    setShowcaseError(null);
    setAddingShowcase(true);
    try {
      const item = await pickAndUploadShowcase();
      if (item) setShowcase([...showcase, item]);
    } catch (e: any) {
      setShowcaseError(e?.detail || e?.message || 'Could not add that item');
    } finally {
      setAddingShowcase(false);
    }
  };

  const setCaption = (index: number, caption: string) => {
    setShowcase(showcase.map((item, i) => (i === index ? { ...item, caption } : item)));
  };

  const moveShowcase = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= showcase.length) return;
    const next = [...showcase];
    [next[index], next[target]] = [next[target], next[index]];
    setShowcase(next);
    haptic();
  };

  const save = async () => {
    setSaving(true);
    try {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // Separate call: the showcase is replaced whole and, unlike skills, does
      // not feed the compatibility engine, so it does not go through the
      // profile update that invalidates every cached score.
      await api.updateShowcase(showcase);
      await api.updateProfile({
        name,
        bio,
        city,
        country,
        skills,
        photos,
      });
      await refreshUser();
      router.back();
    } catch (e: any) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="profile-edit">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
            <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit profile</Text>
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={save}
            disabled={saving}
            testID="profile-edit-save"
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
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>PHOTOS</Text>
            <View style={styles.photosGrid}>
              {photos.map((photo, i) => (
                <View key={i} style={styles.photoWrap}>
                  <Image source={{ uri: photo }} style={styles.photo} />
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={() => setPhotos(photos.filter((_, idx) => idx !== i))}
                    testID={`profile-remove-photo-${i}`}
                  >
                    <X size={14} color={theme.colors.text} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < 5 && (
                <TouchableOpacity
                  style={styles.photoAdd}
                  onPress={pickImage}
                  testID="profile-edit-add-photo"
                >
                  <Camera size={22} color={theme.colors.brand} strokeWidth={1.5} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.hint}>
              The first photo is what founders see on your card.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>WHAT YOU&apos;VE BUILT</Text>
            <Text style={styles.hint}>
              Screenshots, a traction chart, or a short video of the product
              working. This is what turns a profile into evidence.
            </Text>

            <View style={styles.showcaseList}>
              {showcase.map((item, i) => (
                <View key={item.url} style={styles.showcaseRow}>
                  <View>
                    <Image
                      source={{ uri: item.thumbnail_url || item.url }}
                      style={styles.showcaseThumb}
                    />
                    {item.kind === 'video' && (
                      <View style={styles.showcasePlay} pointerEvents="none">
                        <Play size={12} color={theme.colors.text} strokeWidth={2} fill={theme.colors.text} />
                      </View>
                    )}
                  </View>

                  <View style={styles.flex}>
                    <TextInput
                      style={styles.captionInput}
                      placeholder="Say what this is…"
                      placeholderTextColor={theme.colors.textSecondary}
                      value={item.caption}
                      maxLength={140}
                      onChangeText={(text) => setCaption(i, text)}
                      testID={`showcase-caption-${i}`}
                    />
                    <View style={styles.showcaseActions}>
                      {/* Order is content — the first item is seen first — so it
                          has to be changeable without deleting and re-uploading. */}
                      <TouchableOpacity
                        onPress={() => moveShowcase(i, -1)}
                        disabled={i === 0}
                        style={[styles.moveBtn, i === 0 && styles.moveBtnOff]}
                        testID={`showcase-up-${i}`}
                      >
                        <ArrowUp size={13} color={theme.colors.textSecondary} strokeWidth={2} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveShowcase(i, 1)}
                        disabled={i === showcase.length - 1}
                        style={[styles.moveBtn, i === showcase.length - 1 && styles.moveBtnOff]}
                        testID={`showcase-down-${i}`}
                      >
                        <ArrowDown size={13} color={theme.colors.textSecondary} strokeWidth={2} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setShowcase(showcase.filter((_, idx) => idx !== i))}
                        style={styles.moveBtn}
                        testID={`showcase-remove-${i}`}
                      >
                        <X size={13} color={theme.colors.errorOn} strokeWidth={2} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
            </View>

            {showcase.length < 8 && (
              <TouchableOpacity
                style={[styles.showcaseAdd, addingShowcase && styles.showcaseAddBusy]}
                onPress={addShowcase}
                disabled={addingShowcase}
                testID="showcase-add"
              >
                {addingShowcase ? (
                  <ActivityIndicator color={theme.colors.brand} />
                ) : (
                  <>
                    <Plus size={16} color={theme.colors.brand} strokeWidth={2.5} />
                    <Text style={styles.showcaseAddText}>Add image or video</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {showcaseError && <Text style={styles.showcaseError}>{showcaseError}</Text>}
          </View>

          <View style={styles.section}>
            <View style={styles.field}>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                style={styles.input}
                placeholder="Your name"
                placeholderTextColor={theme.colors.textSecondary}
                value={name}
                onChangeText={setName}
                testID="profile-edit-name"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Bio</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Tell founders what drives you..."
                placeholderTextColor={theme.colors.textSecondary}
                value={bio}
                onChangeText={setBio}
                multiline
                numberOfLines={4}
                testID="profile-edit-bio"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>City</Text>
              <TextInput
                style={styles.input}
                placeholder="Your city"
                placeholderTextColor={theme.colors.textSecondary}
                value={city}
                onChangeText={setCity}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Country</Text>
              <TextInput
                style={styles.input}
                placeholder="Your country"
                placeholderTextColor={theme.colors.textSecondary}
                value={country}
                onChangeText={setCountry}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Skills</Text>
              <View style={styles.skillInputRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="Add a skill..."
                  placeholderTextColor={theme.colors.textSecondary}
                  value={skillInput}
                  onChangeText={setSkillInput}
                  onSubmitEditing={addSkill}
                  returnKeyType="done"
                  testID="profile-edit-skill-input"
                />
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={addSkill}
                >
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
          </View>
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
  headerTitle: {
    flex: 1,
    ...theme.typography.headline,
    color: theme.colors.text,
  },
  saveBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.goldGlow,
  },
  saveBtnDisabled: { opacity: 0.5 },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xl,
  },
  section: { gap: theme.spacing.md },
  sectionLabel: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    marginBottom: theme.spacing.xs,
  },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  photoWrap: {
    width: 100, height: 130, borderRadius: theme.radius.md,
    overflow: 'hidden', position: 'relative',
  },
  photo: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 6, right: 6,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoAdd: {
    width: 100, height: 130, borderRadius: theme.radius.md,
    borderWidth: 2, borderColor: theme.colors.brand,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.brandTertiary,
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
  skillInputRow: { flexDirection: 'row', gap: theme.spacing.sm },
  addBtn: {
    backgroundColor: theme.colors.surfaceTertiary,
    paddingHorizontal: theme.spacing.lg,
    justifyContent: 'center',
    borderRadius: theme.radius.md,
  },
  addBtnText: { ...theme.typography.subhead, color: theme.colors.text, fontWeight: '500' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  tagText: {
    ...theme.typography.footnote,
    color: theme.colors.brandOn,
    fontWeight: '500',
  },
  hint: {
    ...theme.typography.caption, color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm, lineHeight: 17,
  },
  showcaseList: { gap: theme.spacing.sm, marginTop: theme.spacing.md },
  showcaseRow: {
    flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center',
    padding: theme.spacing.sm, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  showcaseThumb: { width: 64, height: 64, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceTertiary },
  showcasePlay: {
    position: 'absolute', top: 22, left: 22, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(9,9,11,0.6)',
  },
  captionInput: {
    ...theme.typography.subhead, color: theme.colors.text,
    paddingVertical: 6, paddingHorizontal: 0,
  },
  showcaseActions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: 4 },
  moveBtn: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border,
  },
  moveBtnOff: { opacity: 0.35 },
  showcaseAdd: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm,
    paddingVertical: 14, marginTop: theme.spacing.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderStyle: 'dashed',
    borderColor: theme.colors.border,
  },
  showcaseAddBusy: { opacity: 0.6 },
  showcaseAddText: { ...theme.typography.callout, color: theme.colors.brand, fontWeight: '600' },
  showcaseError: { ...theme.typography.caption, color: theme.colors.errorOn, marginTop: theme.spacing.sm },});
