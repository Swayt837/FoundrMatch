/**
 * Deal Room - Premium collaboration space
 * Tabs: Overview / Tasks / Roadmap
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, Plus, Check, Target, ListChecks, Route,
  Sparkles, Zap, Milestone, TrendingUp,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

type TabKey = 'overview' | 'tasks' | 'roadmap';

export default function DealRoomScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [tab, setTab] = useState<TabKey>('overview');
  const [room, setRoom] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [vision, setVision] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [generatingRoadmap, setGeneratingRoadmap] = useState(false);

  useEffect(() => {
    if (matchId) loadRoom();
  }, [matchId]);

  const loadRoom = async () => {
    setLoading(true);
    try {
      const resp = await api.getDealRoomByMatch(matchId!);
      setRoom(resp.room);
      if (!resp.room) setShowCreate(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const createRoom = async () => {
    if (!projectName.trim() || !vision.trim()) return;
    setCreating(true);
    try {
      haptic();
      const newRoom = await api.createDealRoom(matchId!, projectName.trim(), vision.trim());
      setRoom(newRoom);
      setShowCreate(false);
      setProjectName('');
      setVision('');
    } catch (e: any) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const addTask = async () => {
    const title = newTaskTitle.trim();
    if (!title || !room) return;
    haptic();
    try {
      await api.addTask(room.room_id, title);
      setNewTaskTitle('');
      loadRoom();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleTask = async (taskId: string) => {
    if (!room) return;
    haptic();
    try {
      await api.toggleTask(room.room_id, taskId);
      loadRoom();
    } catch (e) {
      console.error(e);
    }
  };

  const generateRoadmap = async () => {
    if (!room) return;
    setGeneratingRoadmap(true);
    try {
      haptic();
      await api.generateRoadmap(room.room_id);
      loadRoom();
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingRoadmap(false);
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

  // Create modal (when no room exists)
  if (showCreate || !room) {
    return (
      <SafeAreaView style={styles.container} edges={['top']} testID="dealroom-create">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
              <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>DEAL ROOM</Text>
              <Text style={styles.title}>Start building</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.createContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.introText}>
              Your Deal Room is a private space to plan, track and ship your startup together.
            </Text>

            <View style={styles.fieldsGroup}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Project name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Founders CRM"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={projectName}
                  onChangeText={setProjectName}
                  testID="dealroom-project-name"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Vision</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="In one sentence, what are we building and why?"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={vision}
                  onChangeText={setVision}
                  multiline
                  numberOfLines={4}
                  testID="dealroom-vision"
                />
              </View>

              <TouchableOpacity
                style={[styles.ctaButton, (creating || !projectName || !vision) && styles.buttonDisabled]}
                onPress={createRoom}
                disabled={creating || !projectName || !vision}
                activeOpacity={0.85}
                testID="dealroom-create-submit"
              >
                {creating ? (
                  <ActivityIndicator color={theme.colors.brandOn} />
                ) : (
                  <>
                    <Sparkles size={16} color={theme.colors.brandOn} strokeWidth={2} />
                    <Text style={styles.ctaText}>Open Deal Room</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const tasks = room.tasks || [];
  const completedCount = tasks.filter((t: any) => t.completed).length;
  const roadmap = room.roadmap || {};

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="dealroom-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>DEAL ROOM</Text>
          <Text style={styles.title} numberOfLines={1}>{room.project_name}</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {[
          { key: 'overview', label: 'Overview', icon: Target },
          { key: 'tasks', label: 'Tasks', icon: ListChecks },
          { key: 'roadmap', label: 'Roadmap', icon: Route },
        ].map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => { setTab(t.key as TabKey); haptic(); }}
              testID={`dealroom-tab-${t.key}`}
            >
              <Icon size={14} color={active ? theme.colors.brand : theme.colors.textSecondary} strokeWidth={1.75} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'overview' && (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>VISION</Text>
              <Text style={styles.cardBody}>{room.vision}</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <ListChecks size={16} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.statValue}>{completedCount}/{tasks.length}</Text>
                <Text style={styles.statLabel}>Tasks done</Text>
              </View>
              <View style={styles.statCard}>
                <Milestone size={16} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.statValue}>{(roadmap.phases || []).length}</Text>
                <Text style={styles.statLabel}>Phases</Text>
              </View>
              <View style={styles.statCard}>
                <TrendingUp size={16} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.statValue}>{room.participants?.length || 2}</Text>
                <Text style={styles.statLabel}>Founders</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.aiCard}
              onPress={() => setTab('roadmap')}
              activeOpacity={0.85}
              testID="dealroom-ai-cta"
            >
              <View style={styles.aiIcon}>
                <Sparkles size={20} color={theme.colors.brandOn} strokeWidth={2} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.aiTitle}>Generate a 90-day roadmap</Text>
                <Text style={styles.aiDesc}>Let AI plan your first 3 months together.</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {tab === 'tasks' && (
          <View style={styles.section}>
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, styles.flex]}
                placeholder="Add a new task..."
                placeholderTextColor={theme.colors.textSecondary}
                value={newTaskTitle}
                onChangeText={setNewTaskTitle}
                onSubmitEditing={addTask}
                returnKeyType="done"
                testID="dealroom-new-task"
              />
              <TouchableOpacity
                style={styles.addBtn}
                onPress={addTask}
                testID="dealroom-add-task"
              >
                <Plus size={18} color={theme.colors.brandOn} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>

            {tasks.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No tasks yet. Add your first one above.</Text>
              </View>
            ) : (
              <View style={styles.tasksList}>
                {tasks.map((t: any) => (
                  <TouchableOpacity
                    key={t.task_id}
                    style={styles.taskRow}
                    onPress={() => toggleTask(t.task_id)}
                    activeOpacity={0.7}
                    testID={`dealroom-task-${t.task_id}`}
                  >
                    <View style={[styles.checkbox, t.completed && styles.checkboxDone]}>
                      {t.completed && <Check size={12} color={theme.colors.brandOn} strokeWidth={3} />}
                    </View>
                    <Text style={[styles.taskText, t.completed && styles.taskTextDone]}>
                      {t.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {tab === 'roadmap' && (
          <View style={styles.section}>
            {(!roadmap.phases || roadmap.phases.length === 0) ? (
              <View style={styles.emptyRoadmap}>
                <View style={styles.emptyIconWrap}>
                  <Route size={28} color={theme.colors.brand} strokeWidth={1.5} />
                </View>
                <Text style={styles.emptyRoadmapTitle}>No roadmap yet</Text>
                <Text style={styles.emptyRoadmapText}>
                  Let AI generate a 90-day roadmap tailored to your team&apos;s skills and vision.
                </Text>
                <TouchableOpacity
                  style={[styles.ctaButton, generatingRoadmap && styles.buttonDisabled]}
                  onPress={generateRoadmap}
                  disabled={generatingRoadmap}
                  activeOpacity={0.85}
                  testID="dealroom-generate-roadmap"
                >
                  {generatingRoadmap ? (
                    <ActivityIndicator color={theme.colors.brandOn} />
                  ) : (
                    <>
                      <Sparkles size={16} color={theme.colors.brandOn} strokeWidth={2} />
                      <Text style={styles.ctaText}>Generate roadmap</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                {roadmap.phases.map((phase: any, i: number) => (
                  <View key={i} style={styles.phaseCard}>
                    <View style={styles.phaseHeader}>
                      <View style={styles.phaseIndex}>
                        <Text style={styles.phaseIndexText}>{i + 1}</Text>
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.phaseName}>{phase.name}</Text>
                        <Text style={styles.phaseDuration}>{phase.duration_days} days</Text>
                      </View>
                    </View>
                    {phase.tasks?.map((t: string, j: number) => (
                      <View key={j} style={styles.phaseTask}>
                        <View style={styles.phaseTaskDot} />
                        <Text style={styles.phaseTaskText}>{t}</Text>
                      </View>
                    ))}
                    {phase.milestones && phase.milestones.length > 0 && (
                      <View style={styles.milestoneRow}>
                        <Milestone size={12} color={theme.colors.brand} strokeWidth={1.75} />
                        <Text style={styles.milestoneText}>{phase.milestones.join(' · ')}</Text>
                      </View>
                    )}
                  </View>
                ))}
                
                {roadmap.key_metrics && (
                  <View style={styles.card}>
                    <Text style={styles.cardLabel}>KEY METRICS</Text>
                    <View style={styles.chipsWrap}>
                      {roadmap.key_metrics.map((m: string, i: number) => (
                        <View key={i} style={styles.chipGold}>
                          <Text style={styles.chipGoldText}>{m}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.regenerateBtn, generatingRoadmap && styles.buttonDisabled]}
                  onPress={generateRoadmap}
                  disabled={generatingRoadmap}
                >
                  {generatingRoadmap ? (
                    <ActivityIndicator color={theme.colors.brand} size="small" />
                  ) : (
                    <>
                      <Sparkles size={14} color={theme.colors.brand} strokeWidth={1.75} />
                      <Text style={styles.regenerateText}>Regenerate</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
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
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  tabActive: { backgroundColor: theme.colors.brandTertiary, borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)' },
  tabText: { ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: '500' },
  tabTextActive: { color: theme.colors.brand, fontWeight: '600' },
  section: { padding: theme.spacing.lg, gap: theme.spacing.md },
  createContent: {
    padding: theme.spacing.xl,
    gap: theme.spacing.xl,
  },
  introText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    lineHeight: 24,
  },
  fieldsGroup: { gap: theme.spacing.lg },
  inputGroup: { gap: theme.spacing.sm },
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
  textArea: { minHeight: 100, textAlignVertical: 'top', paddingTop: 14 },
  ctaButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.brand,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    ...theme.shadow.goldGlow,
  },
  buttonDisabled: { opacity: 0.5 },
  ctaText: { ...theme.typography.headline, color: theme.colors.brandOn },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cardLabel: { ...theme.typography.micro, color: theme.colors.brand },
  cardBody: { ...theme.typography.body, color: theme.colors.text, lineHeight: 22 },
  statsRow: { flexDirection: 'row', gap: theme.spacing.sm },
  statCard: {
    flex: 1,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
  },
  statValue: { ...theme.typography.title3, color: theme.colors.text, marginTop: 4 },
  statLabel: { ...theme.typography.caption, color: theme.colors.textSecondary },
  aiCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  aiIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  aiTitle: { ...theme.typography.headline, color: theme.colors.brandOn, marginBottom: 2 },
  aiDesc: { ...theme.typography.footnote, color: 'rgba(9,9,11,0.75)' },
  addRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  addBtn: {
    width: 48, height: 48, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.goldGlow,
  },
  empty: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...theme.typography.subhead,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  tasksList: { gap: theme.spacing.sm },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: theme.colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  taskText: { ...theme.typography.callout, color: theme.colors.text, flex: 1 },
  taskTextDone: { color: theme.colors.textSecondary, textDecorationLine: 'line-through' },
  emptyRoadmap: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  emptyRoadmapTitle: { ...theme.typography.title3, color: theme.colors.text },
  emptyRoadmapText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: theme.spacing.md,
  },
  phaseCard: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  phaseIndex: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  phaseIndexText: { ...theme.typography.callout, color: theme.colors.brandOn, fontWeight: '700' },
  phaseName: { ...theme.typography.headline, color: theme.colors.text },
  phaseDuration: { ...theme.typography.caption, color: theme.colors.brand, marginTop: 2 },
  phaseTask: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingLeft: theme.spacing.sm,
  },
  phaseTaskDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: theme.colors.textSecondary,
    marginTop: 8,
  },
  phaseTaskText: {
    ...theme.typography.subhead,
    color: theme.colors.textTertiary,
    flex: 1,
    lineHeight: 20,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  milestoneText: {
    ...theme.typography.footnote,
    color: theme.colors.brand,
    fontWeight: '500',
    flex: 1,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  chipGold: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
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
  regenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
    marginTop: theme.spacing.md,
  },
  regenerateText: {
    ...theme.typography.subhead,
    color: theme.colors.brand,
    fontWeight: '500',
  },
});
