/**
 * Onboarding Screen - Simplified version
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';
import { api } from '@/src/api/client';
import * as ImagePicker from 'expo-image-picker';

const PROFESSIONS = [
  'developer', 'designer', 'marketer', 'sales', 'product_manager',
  'lawyer', 'finance', 'content_creator', 'freelancer', 'student'
];

const EXPERIENCE_LEVELS = [
  'beginner', 'junior', 'confirmed', 'senior', 'sold_company', 'raised_funds'
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Form data
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [languages, setLanguages] = useState('');
  const [age, setAge] = useState('');
  const [profession, setProfession] = useState('');
  const [skills, setSkills] = useState('');
  const [experience, setExperience] = useState('');
  const [availability, setAvailability] = useState('full_time');
  const [budget, setBudget] = useState('bootstrap');
  const [objectives, setObjectives] = useState('');
  const [workStyle, setWorkStyle] = useState('remote,fast_paced');
  const [values, setValues] = useState('bootstrap,fast_growth');
  const [bio, setBio] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const pickImage = async () => {
    if (photos.length >= 5) {
      Alert.alert('Maximum photos', 'You can upload up to 5 photos');
      return;
    }

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

  const handleComplete = async () => {
    if (!country || !city || !profession || !skills || !experience) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      // Upload photos first
      if (photos.length > 0) {
        await api.uploadPhotos(photos);
      }

      // Complete onboarding
      await api.completeOnboarding({
        country,
        city,
        languages: languages.split(',').map(l => l.trim()).filter(Boolean),
        age: age ? parseInt(age) : null,
        profession,
        skills: skills.split(',').map(s => s.trim()).filter(Boolean),
        experience,
        availability,
        budget,
        objectives: objectives.split(',').map(o => o.trim()).filter(Boolean),
        work_style: workStyle.split(',').map(w => w.trim()).filter(Boolean),
        values: values.split(',').map(v => v.trim()).filter(Boolean),
        bio,
      });

      await refreshUser();
      router.replace('/(tabs)/discover');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Onboarding failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Complete Your Profile</Text>
            <Text style={styles.subtitle}>Help us find your perfect cofounder</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Basic Information</Text>
              
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Country *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="United States"
                  value={country}
                  onChangeText={setCountry}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>City *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="San Francisco"
                  value={city}
                  onChangeText={setCity}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Languages (comma separated)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="English, French"
                  value={languages}
                  onChangeText={setLanguages}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Age (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="30"
                  value={age}
                  onChangeText={setAge}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Professional Profile</Text>
              
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Profession *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsContainer}>
                  {PROFESSIONS.map((prof) => (
                    <TouchableOpacity
                      key={prof}
                      style={[styles.chip, profession === prof && styles.chipSelected]}
                      onPress={() => setProfession(prof)}
                    >
                      <Text style={[styles.chipText, profession === prof && styles.chipTextSelected]}>
                        {prof.replace('_', ' ')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Skills * (comma separated)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="React, Node.js, Python"
                  value={skills}
                  onChangeText={setSkills}
                  multiline
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Experience Level *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsContainer}>
                  {EXPERIENCE_LEVELS.map((exp) => (
                    <TouchableOpacity
                      key={exp}
                      style={[styles.chip, experience === exp && styles.chipSelected]}
                      onPress={() => setExperience(exp)}
                    >
                      <Text style={[styles.chipText, experience === exp && styles.chipTextSelected]}>
                        {exp.replace('_', ' ')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Objectives (comma separated)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Build a SaaS, Create a startup"
                  value={objectives}
                  onChangeText={setObjectives}
                  multiline
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Bio</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Tell us about yourself..."
                  value={bio}
                  onChangeText={setBio}
                  multiline
                  numberOfLines={4}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Photos (up to 5)</Text>
              <TouchableOpacity style={styles.photoButton} onPress={pickImage}>
                <Text style={styles.photoButtonText}>
                  Add Photo ({photos.length}/5)
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleComplete}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Completing...' : 'Complete Profile'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  form: {
    flex: 1,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: '#F7FAFC',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  chipsContainer: {
    flexDirection: 'row',
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  chipSelected: {
    backgroundColor: '#6B46C1',
    borderColor: '#6B46C1',
  },
  chipText: {
    fontSize: 14,
    color: '#666',
    textTransform: 'capitalize',
  },
  chipTextSelected: {
    color: '#fff',
  },
  photoButton: {
    borderWidth: 2,
    borderColor: '#6B46C1',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  photoButtonText: {
    color: '#6B46C1',
    fontSize: 16,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#6B46C1',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
