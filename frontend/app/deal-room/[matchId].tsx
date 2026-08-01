/**
 * Deal Room - Premium collaboration space
 * Tabs: Overview / Tasks / Roadmap / Documents / Decisions / Equity
 *
 * The last three complete the PRD's workspace. They are not three more note lists:
 *
 * - **Documents** are links or uploaded files. A deck living in Drive is better
 *   linked than copied — the copy goes stale — but the signed agreement belongs to
 *   the pair, not to one founder's Drive. Uploads open through a short-lived signed
 *   URL rather than a public address, because that is what they are.
 * - **Decisions** and **Equity** both require sign-off from both founders, which is
 *   the whole point: a decision log neither party agreed to proves nothing, and an
 *   equity split that does not add up to 100% is worse than no split at all. The
 *   server enforces both; this screen only surfaces the state.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, Plus, Check, Target, ListChecks, Route,
  Sparkles, Milestone, TrendingUp, FileText, Gavel, PieChart,
  ExternalLink,
  Upload,
  Download, Trash2, Clock3,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/src/api/client';
import { formatSize } from '@/src/utils/documents';
import { useDealRoom, useDealRoomActions } from '@/src/api/queries';
import { useAuth } from '@/src/contexts/AuthContext';
import { theme } from '@/src/theme';

type TabKey = 'overview' | 'tasks' | 'roadmap' | 'documents' | 'decisions' | 'equity';

const DOC_TYPES = [
  { value: 'pitch_deck', label: 'Deck' },
  { value: 'legal', label: 'Legal' },
  { value: 'financial', label: 'Finance' },
  { value: 'product', label: 'Product' },
  { value: 'other', label: 'Other' },
];

export default function DealRoomScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const myId = user?.user_id;

  const [tab, setTab] = useState<TabKey>('overview');
  const [projectName, setProjectName] = useState('');
  const [vision, setVision] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docType, setDocType] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [newObjective, setNewObjective] = useState('');
  const [newNote, setNewNote] = useState('');
  const [decisionTitle, setDecisionTitle] = useState('');
  const [decisionDetail, setDecisionDetail] = useState('');
  const [myShare, setMyShare] = useState<string | null>(null);
  const [vesting, setVesting] = useState<string | null>(null);
  const [cliff, setCliff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: room, isPending: loading, refetch } = useDealRoom(matchId);
  const actions = useDealRoomActions(matchId!, room?.room_id);

  // The other founder may act on the room while it is open.
  useFocusEffect(
    useCallback(() => {
      if (matchId) refetch();
    }, [matchId, refetch])
  );

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const fail = (fallback: string) => (e: any) =>
    setError(e?.detail || e?.message || fallback);

  const otherId: string | undefined = useMemo(
    () => (room?.participants || []).find((id: string) => id !== myId),
    [room?.participants, myId]
  );

  const nameOf = (userId?: string) => {
    if (!userId) return 'Cofounder';
    if (userId === myId) return 'You';
    return room?.participant_profiles?.[userId]?.name || 'Your cofounder';
  };

  // Equity state: the standing proposal from the server, plus any local edits.
  const equity = room?.equity_split || {};
  const equityProposed = !!equity.splits;
  const myEquityShare = myId ? equity.splits?.[myId] : undefined;
  const equityDraft = {
    mine: myShare ?? (myEquityShare != null ? String(myEquityShare) : '50'),
    vesting: vesting ?? String(equity.vesting_months ?? 48),
    cliff: cliff ?? String(equity.cliff_months ?? 12),
  };
  const iAcceptedEquity = !!myId && (equity.agreed_by || []).includes(myId);

  const createRoom = () => {
    if (!projectName.trim() || !vision.trim()) return;
    haptic();
    setError(null);
    actions.create.mutate(
      { projectName: projectName.trim(), vision: vision.trim() },
      {
        onSuccess: () => {
          setProjectName('');
          setVision('');
        },
        onError: (e: any) => {
          // Deal rooms are a Premium feature; a 402 is a paywall, not a failure.
          if (e instanceof ApiError && e.isPaymentRequired) {
            router.push('/premium');
            return;
          }
          fail('Could not open the deal room')(e);
        },
      }
    );
  };

  const addTask = () => {
    const title = newTaskTitle.trim();
    if (!title || !room) return;
    haptic();
    setError(null);
    actions.addTask.mutate(title, {
      onSuccess: () => setNewTaskTitle(''),
      onError: fail('Could not add the task'),
    });
  };

  const toggleTask = (taskId: string) => {
    if (!room) return;
    haptic();
    actions.toggleTask.mutate(taskId, { onError: fail('Could not update the task') });
  };

  const generateRoadmap = () => {
    if (!room) return;
    haptic();
    setError(null);
    actions.generateRoadmap.mutate(undefined, {
      onError: fail('Roadmap generation failed'),
    });
  };

  const addObjective = () => {
    const title = newObjective.trim();
    if (!title || !room) return;
    haptic();
    setError(null);
    actions.addObjective.mutate(
      { title },
      {
        onSuccess: () => setNewObjective(''),
        onError: fail('Could not add the objective'),
      }
    );
  };

  const addNote = () => {
    const content = newNote.trim();
    if (!content || !room) return;
    haptic();
    setError(null);
    actions.addNote.mutate(content, {
      onSuccess: () => setNewNote(''),
      onError: fail('Could not save the idea'),
    });
  };

  const addDocument = () => {
    const title = docTitle.trim();
    const url = docUrl.trim();
    if (!title || !url) return;
    haptic();
    setError(null);
    actions.addDocument.mutate(
      { title, url, doc_type: docType },
      {
        onSuccess: () => {
          setDocTitle('');
          setDocUrl('');
          setDocType('other');
        },
        onError: fail('Could not add the document'),
      }
    );
  };

  const uploadDocument = () => {
    if (!room) return;
    haptic();
    setError(null);
    setUploading(true);
    actions.uploadDocument.mutate(
      { title: docTitle, doc_type: docType },
      {
        onSuccess: (created: any) => {
          // null means the picker was dismissed — not worth clearing the form for.
          if (created) {
            setDocTitle('');
            setDocType('other');
          }
        },
        onError: (e: any) => setError(e?.message || 'Could not upload that file'),
        onSettled: () => setUploading(false),
      }
    );
  };

  /**
   * Links open directly; uploaded files are fetched through a short-lived signed
   * URL, because room documents deliberately have no public address.
   */
  const openDocument = async (doc: any) => {
    setError(null);

    if (doc.kind === 'file') {
      try {
        const { url } = await api.getDocumentDownloadUrl(room.room_id, doc.document_id);
        await Linking.openURL(url);
      } catch {
        setError('Could not open that document');
      }
      return;
    }

    // Never rendered as a raw anchor: the server only stores http(s) links, and
    // this keeps the same guarantee on the client.
    if (!/^https?:\/\//i.test(doc.url)) return;
    Linking.openURL(doc.url).catch(() => setError('Could not open that link'));
  };

  const addDecision = () => {
    const title = decisionTitle.trim();
    if (!title) return;
    haptic();
    setError(null);
    actions.addDecision.mutate(
      { title, detail: decisionDetail.trim() },
      {
        onSuccess: () => {
          setDecisionTitle('');
          setDecisionDetail('');
        },
        onError: fail('Could not record the decision'),
      }
    );
  };

  const proposeEquity = () => {
    if (!room || !myId || !otherId) return;
    const mine = parseFloat(equityDraft.mine);
    if (Number.isNaN(mine) || mine < 0 || mine > 100) {
      setError('Enter your share as a number between 0 and 100');
      return;
    }
    haptic();
    setError(null);
    actions.proposeEquity.mutate(
      {
        // The other share is derived rather than typed, so the total can never be
        // anything but 100 — the server rejects the alternative, and making the user
        // discover that by validation error would be poor design.
        splits: { [myId]: mine, [otherId]: Math.round((100 - mine) * 100) / 100 },
        vesting_months: parseInt(equityDraft.vesting, 10) || 0,
        cliff_months: parseInt(equityDraft.cliff, 10) || 0,
      },
      {
        onSuccess: () => {
          setMyShare(null);
          setVesting(null);
          setCliff(null);
        },
        onError: fail('Could not save the split'),
      }
    );
  };

  const acceptEquity = () => {
    haptic();
    setError(null);
    actions.acceptEquity.mutate(undefined, { onError: fail('Could not accept the split') });
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

  // Create view (when no room exists yet)
  if (!room) {
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
              Your Deal Room is a private space to plan, track and ship your startup
              together — tasks, an AI roadmap, shared documents, a decision log and your
              equity split.
            </Text>

            {error && (
              <TouchableOpacity style={styles.errorBanner} onPress={() => setError(null)}>
                <Text style={styles.errorBannerText}>{error}</Text>
              </TouchableOpacity>
            )}

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
                style={[
                  styles.ctaButton,
                  (actions.create.isPending || !projectName || !vision) && styles.buttonDisabled,
                ]}
                onPress={createRoom}
                disabled={actions.create.isPending || !projectName || !vision}
                activeOpacity={0.85}
                testID="dealroom-create-submit"
              >
                {actions.create.isPending ? (
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
  const documents = room.documents || [];
  const objectives = room.objectives || [];
  const notes = room.brainstorm_notes || [];
  const decisions = room.decisions || [];

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

      {/* Tabs — six of them, so the row scrolls rather than squeezing each label
          down to an unreadable width on a small phone. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        {[
          { key: 'overview', label: 'Overview', icon: Target },
          { key: 'tasks', label: 'Tasks', icon: ListChecks },
          { key: 'roadmap', label: 'Roadmap', icon: Route },
          { key: 'documents', label: 'Docs', icon: FileText },
          { key: 'decisions', label: 'Decisions', icon: Gavel },
          { key: 'equity', label: 'Equity', icon: PieChart },
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
      </ScrollView>

      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={() => setError(null)}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </TouchableOpacity>
      )}

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

            {/* Objectives: outcomes, where the Tasks tab holds actions. */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Objectives</Text>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="What does success look like?"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={newObjective}
                  onChangeText={setNewObjective}
                  onSubmitEditing={addObjective}
                  returnKeyType="done"
                  testID="dealroom-new-objective"
                />
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={addObjective}
                  disabled={!newObjective.trim() || actions.addObjective.isPending}
                  testID="dealroom-add-objective"
                >
                  <Plus size={18} color={theme.colors.brandOn} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            </View>

            {objectives.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  No objectives yet. Two or three is plenty — they are outcomes, not tasks.
                </Text>
              </View>
            ) : (
              <View style={styles.listGap}>
                {objectives.map((obj: any) => (
                  <View key={obj.objective_id} style={styles.rowCard}>
                    <TouchableOpacity
                      style={styles.rowMain}
                      onPress={() =>
                        actions.toggleObjective.mutate(obj.objective_id, {
                          onError: fail('Could not update the objective'),
                        })
                      }
                      activeOpacity={0.7}
                      testID={`dealroom-objective-${obj.objective_id}`}
                    >
                      <View style={[styles.checkbox, obj.achieved && styles.checkboxDone]}>
                        {obj.achieved && (
                          <Check size={12} color={theme.colors.brandOn} strokeWidth={3} />
                        )}
                      </View>
                      <View style={styles.flex}>
                        <Text style={[styles.rowTitle, obj.achieved && styles.taskTextDone]}>
                          {obj.title}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {nameOf(obj.created_by)}
                          {obj.target_date ? ` · by ${obj.target_date}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        actions.removeObjective.mutate(obj.objective_id, {
                          onError: fail('Could not remove the objective'),
                        })
                      }
                      style={styles.rowAction}
                      testID={`dealroom-objective-remove-${obj.objective_id}`}
                    >
                      <Trash2 size={14} color={theme.colors.errorOn} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Notes: no status, no owner, no agreement — on purpose. */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Ideas</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Anything worth remembering — no structure required."
                placeholderTextColor={theme.colors.textSecondary}
                value={newNote}
                onChangeText={setNewNote}
                multiline
                testID="dealroom-new-note"
              />
              <TouchableOpacity
                style={[
                  styles.ctaButton,
                  (!newNote.trim() || actions.addNote.isPending) && styles.buttonDisabled,
                ]}
                onPress={addNote}
                disabled={!newNote.trim() || actions.addNote.isPending}
                testID="dealroom-add-note"
              >
                {actions.addNote.isPending ? (
                  <ActivityIndicator color={theme.colors.brandOn} />
                ) : (
                  <>
                    <Plus size={16} color={theme.colors.brandOn} strokeWidth={2.5} />
                    <Text style={styles.ctaText}>Save idea</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {notes.length > 0 && (
              <View style={styles.listGap}>
                {notes.map((note: any) => (
                  <View key={note.note_id} style={styles.rowCard}>
                    <View style={styles.rowMain}>
                      <View style={styles.flex}>
                        <Text style={styles.cardBody}>{note.content}</Text>
                        <Text style={styles.rowMeta}>{nameOf(note.created_by)}</Text>
                      </View>
                    </View>
                    {note.created_by === myId && (
                      <TouchableOpacity
                        onPress={() =>
                          actions.removeNote.mutate(note.note_id, {
                            onError: fail('Could not remove the note'),
                          })
                        }
                        style={styles.rowAction}
                        testID={`dealroom-note-remove-${note.note_id}`}
                      >
                        <Trash2 size={14} color={theme.colors.errorOn} strokeWidth={1.75} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
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

        {tab === 'documents' && (
          <View style={styles.section}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Add a document</Text>
              <TextInput
                style={styles.input}
                placeholder="Title — e.g. Seed deck v3"
                placeholderTextColor={theme.colors.textSecondary}
                value={docTitle}
                onChangeText={setDocTitle}
                testID="dealroom-doc-title"
              />
              <TextInput
                style={styles.input}
                placeholder="https://..."
                placeholderTextColor={theme.colors.textSecondary}
                value={docUrl}
                onChangeText={setDocUrl}
                autoCapitalize="none"
                keyboardType="url"
                testID="dealroom-doc-url"
              />
              <View style={styles.chipsRow}>
                {DOC_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.value}
                    style={[styles.typeChip, docType === type.value && styles.typeChipOn]}
                    onPress={() => setDocType(type.value)}
                    testID={`dealroom-doc-type-${type.value}`}
                  >
                    <Text
                      style={[
                        styles.typeChipText,
                        docType === type.value && styles.typeChipTextOn,
                      ]}
                    >
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[
                  styles.ctaButton,
                  (actions.addDocument.isPending || !docTitle.trim() || !docUrl.trim()) &&
                    styles.buttonDisabled,
                ]}
                onPress={addDocument}
                disabled={actions.addDocument.isPending || !docTitle.trim() || !docUrl.trim()}
                testID="dealroom-add-doc"
              >
                {actions.addDocument.isPending ? (
                  <ActivityIndicator color={theme.colors.brandOn} />
                ) : (
                  <>
                    <Plus size={16} color={theme.colors.brandOn} strokeWidth={2.5} />
                    <Text style={styles.ctaText}>Add link</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryBtn, uploading && styles.buttonDisabled]}
                onPress={uploadDocument}
                disabled={uploading}
                testID="dealroom-upload-doc"
              >
                {uploading ? (
                  <ActivityIndicator color={theme.colors.brand} />
                ) : (
                  <>
                    <Upload size={16} color={theme.colors.brand} strokeWidth={2} />
                    <Text style={styles.secondaryBtnText}>Upload a file</Text>
                  </>
                )}
              </TouchableOpacity>

              <Text style={styles.hint}>
                Link what lives elsewhere; upload what belongs to the two of you —
                the signed agreement, not the deck.
              </Text>
            </View>

            {documents.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  No documents yet. Start with your deck or a one-pager.
                </Text>
              </View>
            ) : (
              <View style={styles.listGap}>
                {documents.map((doc: any) => (
                  <View key={doc.document_id} style={styles.rowCard}>
                    <TouchableOpacity
                      style={styles.rowMain}
                      onPress={() => openDocument(doc)}
                      activeOpacity={0.7}
                      testID={`dealroom-doc-${doc.document_id}`}
                    >
                      <FileText size={16} color={theme.colors.brand} strokeWidth={1.75} />
                      <View style={styles.flex}>
                        <Text style={styles.rowTitle}>{doc.title}</Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {doc.kind === 'file'
                            ? `${nameOf(doc.added_by)} · ${doc.filename}${
                                doc.size_bytes ? ` · ${formatSize(doc.size_bytes)}` : ''
                              }`
                            : `${nameOf(doc.added_by)} · ${doc.url}`}
                        </Text>
                      </View>
                      {doc.kind === 'file' ? (
                        <Download size={14} color={theme.colors.textSecondary} strokeWidth={1.75} />
                      ) : (
                        <ExternalLink size={14} color={theme.colors.textSecondary} strokeWidth={1.75} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        actions.removeDocument.mutate(doc.document_id, {
                          onError: fail('Could not remove the document'),
                        })
                      }
                      style={styles.rowAction}
                      testID={`dealroom-doc-remove-${doc.document_id}`}
                    >
                      <Trash2 size={14} color={theme.colors.errorOn} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {tab === 'decisions' && (
          <View style={styles.section}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Record a decision</Text>
              <TextInput
                style={styles.input}
                placeholder="What was decided?"
                placeholderTextColor={theme.colors.textSecondary}
                value={decisionTitle}
                onChangeText={setDecisionTitle}
                testID="dealroom-decision-title"
              />
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Why, and what it commits you both to (optional)"
                placeholderTextColor={theme.colors.textSecondary}
                value={decisionDetail}
                onChangeText={setDecisionDetail}
                multiline
                testID="dealroom-decision-detail"
              />
              <TouchableOpacity
                style={[
                  styles.ctaButton,
                  (actions.addDecision.isPending || !decisionTitle.trim()) && styles.buttonDisabled,
                ]}
                onPress={addDecision}
                disabled={actions.addDecision.isPending || !decisionTitle.trim()}
                testID="dealroom-add-decision"
              >
                {actions.addDecision.isPending ? (
                  <ActivityIndicator color={theme.colors.brandOn} />
                ) : (
                  <>
                    <Gavel size={15} color={theme.colors.brandOn} strokeWidth={2} />
                    <Text style={styles.ctaText}>Log decision</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.hint}>
                A decision stays pending until you both sign off on it.
              </Text>
            </View>

            {decisions.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  Nothing logged yet. Write down the first thing you agreed on.
                </Text>
              </View>
            ) : (
              <View style={styles.listGap}>
                {decisions
                  .slice()
                  .reverse()
                  .map((decision: any) => {
                    const agreed = decision.status === 'agreed';
                    const iAgreed = !!myId && (decision.agreed_by || []).includes(myId);
                    return (
                      <View
                        key={decision.decision_id}
                        style={styles.card}
                        testID={`dealroom-decision-${decision.decision_id}`}
                      >
                        <View style={styles.rowMain}>
                          <View style={styles.flex}>
                            <Text style={styles.rowTitle}>{decision.title}</Text>
                            <Text style={styles.rowMeta}>
                              Proposed by {nameOf(decision.created_by)}
                            </Text>
                          </View>
                          <View style={[styles.statusPill, agreed && styles.statusPillOn]}>
                            {agreed ? (
                              <Check size={11} color={theme.colors.brand} strokeWidth={3} />
                            ) : (
                              <Clock3 size={11} color={theme.colors.textSecondary} strokeWidth={2} />
                            )}
                            <Text style={[styles.statusText, agreed && styles.statusTextOn]}>
                              {agreed ? 'Agreed' : 'Pending'}
                            </Text>
                          </View>
                        </View>
                        {!!decision.detail && (
                          <Text style={styles.cardBody}>{decision.detail}</Text>
                        )}
                        {!iAgreed && (
                          <TouchableOpacity
                            style={styles.secondaryBtn}
                            onPress={() =>
                              actions.agreeToDecision.mutate(decision.decision_id, {
                                onError: fail('Could not sign off'),
                              })
                            }
                            testID={`dealroom-agree-${decision.decision_id}`}
                          >
                            <Check size={14} color={theme.colors.brand} strokeWidth={2.5} />
                            <Text style={styles.secondaryBtnText}>I agree</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
              </View>
            )}
          </View>
        )}

        {tab === 'equity' && (
          <View style={styles.section}>
            {equityProposed && (
              <View style={styles.card}>
                <View style={styles.rowMain}>
                  <Text style={styles.cardLabel}>CURRENT SPLIT</Text>
                  <View
                    style={[
                      styles.statusPill,
                      equity.status === 'agreed' && styles.statusPillOn,
                    ]}
                  >
                    {equity.status === 'agreed' ? (
                      <Check size={11} color={theme.colors.brand} strokeWidth={3} />
                    ) : (
                      <Clock3 size={11} color={theme.colors.textSecondary} strokeWidth={2} />
                    )}
                    <Text
                      style={[
                        styles.statusText,
                        equity.status === 'agreed' && styles.statusTextOn,
                      ]}
                    >
                      {equity.status === 'agreed' ? 'Agreed' : 'Awaiting agreement'}
                    </Text>
                  </View>
                </View>

                {Object.entries(equity.splits || {}).map(([userId, share]) => (
                  <View key={userId} style={styles.splitRow}>
                    <Text style={styles.splitName}>{nameOf(userId)}</Text>
                    <View style={styles.splitTrack}>
                      <View style={[styles.splitFill, { width: `${Number(share)}%` }]} />
                    </View>
                    <Text style={styles.splitValue}>{Number(share)}%</Text>
                  </View>
                ))}

                <Text style={styles.rowMeta}>
                  {equity.vesting_months
                    ? `Vesting over ${equity.vesting_months} months with a ${equity.cliff_months ?? 0}-month cliff.`
                    : 'No vesting — shares are held outright.'}
                </Text>
                <Text style={styles.rowMeta}>Proposed by {nameOf(equity.proposed_by)}</Text>

                {!iAcceptedEquity && (
                  <TouchableOpacity
                    style={[styles.secondaryBtn, actions.acceptEquity.isPending && styles.buttonDisabled]}
                    onPress={acceptEquity}
                    disabled={actions.acceptEquity.isPending}
                    testID="dealroom-accept-equity"
                  >
                    <Check size={14} color={theme.colors.brand} strokeWidth={2.5} />
                    <Text style={styles.secondaryBtnText}>Accept this split</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                {equityProposed ? 'Revise the split' : 'Propose a split'}
              </Text>
              <View style={styles.rangeRow}>
                <View style={styles.flex}>
                  <Text style={styles.fieldHint}>Your share (%)</Text>
                  <TextInput
                    style={styles.input}
                    value={equityDraft.mine}
                    onChangeText={setMyShare}
                    keyboardType="decimal-pad"
                    maxLength={6}
                    testID="dealroom-equity-mine"
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.fieldHint}>{nameOf(otherId)} (%)</Text>
                  <View style={[styles.input, styles.readonlyInput]}>
                    <Text style={styles.readonlyText}>
                      {(() => {
                        const mine = parseFloat(equityDraft.mine);
                        if (Number.isNaN(mine)) return '—';
                        return String(Math.round((100 - mine) * 100) / 100);
                      })()}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.rangeRow}>
                <View style={styles.flex}>
                  <Text style={styles.fieldHint}>Vesting (months)</Text>
                  <TextInput
                    style={styles.input}
                    value={equityDraft.vesting}
                    onChangeText={setVesting}
                    keyboardType="number-pad"
                    maxLength={3}
                    testID="dealroom-equity-vesting"
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.fieldHint}>Cliff (months)</Text>
                  <TextInput
                    style={styles.input}
                    value={equityDraft.cliff}
                    onChangeText={setCliff}
                    keyboardType="number-pad"
                    maxLength={3}
                    testID="dealroom-equity-cliff"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.ctaButton, actions.proposeEquity.isPending && styles.buttonDisabled]}
                onPress={proposeEquity}
                disabled={actions.proposeEquity.isPending}
                testID="dealroom-propose-equity"
              >
                {actions.proposeEquity.isPending ? (
                  <ActivityIndicator color={theme.colors.brandOn} />
                ) : (
                  <>
                    <PieChart size={15} color={theme.colors.brandOn} strokeWidth={2} />
                    <Text style={styles.ctaText}>
                      {equityProposed ? 'Propose revision' : 'Propose split'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.hint}>
                Revising the split withdraws any agreement already given, so you both
                confirm the numbers that end up on record.
              </Text>
            </View>
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
                  style={[styles.ctaButton, actions.generateRoadmap.isPending && styles.buttonDisabled]}
                  onPress={generateRoadmap}
                  disabled={actions.generateRoadmap.isPending}
                  activeOpacity={0.85}
                  testID="dealroom-generate-roadmap"
                >
                  {actions.generateRoadmap.isPending ? (
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
                  style={[styles.regenerateBtn, actions.generateRoadmap.isPending && styles.buttonDisabled]}
                  onPress={generateRoadmap}
                  disabled={actions.generateRoadmap.isPending}
                >
                  {actions.generateRoadmap.isPending ? (
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
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  tabsContent: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.md,
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
  errorBanner: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: 'rgba(220,38,38,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.35)',
  },
  errorBannerText: { ...theme.typography.footnote, color: theme.colors.errorOn },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary, lineHeight: 16 },
  fieldHint: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    marginBottom: 6,
  },
  listGap: { gap: theme.spacing.sm },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  typeChipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  typeChipText: { ...theme.typography.caption, color: theme.colors.textSecondary },
  typeChipTextOn: { color: theme.colors.brandOn, fontWeight: '600' },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingLeft: theme.spacing.md,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  rowAction: { padding: theme.spacing.md },
  rowTitle: { ...theme.typography.callout, color: theme.colors.text, marginBottom: 2 },
  rowMeta: { ...theme.typography.caption, color: theme.colors.textSecondary },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  statusPillOn: { backgroundColor: theme.colors.brandTertiary },
  statusText: { ...theme.typography.caption, color: theme.colors.textSecondary },
  statusTextOn: { color: theme.colors.brand, fontWeight: '600' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    paddingVertical: 12,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
    backgroundColor: theme.colors.brandTertiary,
  },
  secondaryBtnText: { ...theme.typography.subhead, color: theme.colors.brand, fontWeight: '600' },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  splitName: { ...theme.typography.subhead, color: theme.colors.text, width: 110 },
  splitTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.surfaceTertiary,
    overflow: 'hidden',
  },
  splitFill: { height: 8, borderRadius: 4, backgroundColor: theme.colors.brand },
  splitValue: {
    ...theme.typography.subhead,
    color: theme.colors.brand,
    fontWeight: '700',
    width: 56,
    textAlign: 'right',
  },
  rangeRow: { flexDirection: 'row', gap: theme.spacing.md },
  readonlyInput: { justifyContent: 'center', backgroundColor: theme.colors.surfaceTertiary },
  readonlyText: { ...theme.typography.body, color: theme.colors.textSecondary },
});
