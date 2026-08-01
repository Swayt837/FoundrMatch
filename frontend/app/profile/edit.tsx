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
import { ArrowLeft, Camera, X, Check } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { storablePhoto } from '@/src/utils/photos';
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
      quality: 0.5,
      base64: true,
    });
    if (result.canceled) return;

    // Uploads to object storage when it is available, and falls back to an
    // inline data URI when it is not — see src/utils/photos.ts.
    const stored = await storablePhoto(result.assets[0]);
    if (stored) setPhotos([...photos, stored]);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
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
});
