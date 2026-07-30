/**
 * Projects Board - Post/browse cofounder opportunities (with filters)
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl, Modal, TextInput, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Plus, Briefcase, Clock, TrendingUp, ChevronRight,
  Filter, X, Check, MapPin,
} from 'lucide-react-native';
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

interface Filters {
  looking_for?: string;
  skill?: string;
  min_hours?: number;
  max_hours?: number;
  min_equity?: number;
  max_equity?: number;
  my_city_only?: boolean;
}

const EMPTY_FILTERS: Filters = {};

export default function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const activeFilterCount = useMemo(() => {
    return Object.entries(filters).filter(([_, v]) =>
      v !== undefined && v !== null && v !== '' && v !== false
    ).length;
  }, [filters]);

  useFocusEffect(
    useCallback(() => {
      loadProjects(filters);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters])
  );

  const loadProjects = async (f: Filters) => {
    setLoading(true);
    try {
      const response = await api.getProjectsFiltered({ status: 'open', limit: 20, ...f });
      setProjects(response.projects || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProjects(filters);
    setRefreshing(false);
  };

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="projects-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>OPPORTUNITIES</Text>
          <Text style={styles.title}>Projects</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => { haptic(); setShowFilters(true); }}
            activeOpacity={0.8}
            testID="projects-filter-btn"
          >
            <Filter size={16} color={theme.colors.text} strokeWidth={1.75} />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.fab}
            onPress={() => router.push('/project/create')}
            activeOpacity={0.85}
            testID="projects-create-button"
          >
            <Plus size={20} color={theme.colors.brandOn} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Active filter chips row */}
      {activeFilterCount > 0 && (
        <View style={styles.chipRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
            {filters.looking_for && (
              <ActiveChip
                label={`Role: ${filters.looking_for.replace(/_/g, ' ')}`}
                onRemove={() => setFilters(f => ({ ...f, looking_for: undefined }))}
              />
            )}
            {filters.skill && (
              <ActiveChip
                label={`Skill: ${filters.skill}`}
                onRemove={() => setFilters(f => ({ ...f, skill: undefined }))}
              />
            )}
            {(filters.min_hours || filters.max_hours) && (
              <ActiveChip
                label={`${filters.min_hours ?? 0}-${filters.max_hours ?? '∞'}h/wk`}
                onRemove={() => setFilters(f => ({ ...f, min_hours: undefined, max_hours: undefined }))}
              />
            )}
            {(filters.min_equity || filters.max_equity) && (
              <ActiveChip
                label={`${filters.min_equity ?? 0}-${filters.max_equity ?? 100}% equity`}
                onRemove={() => setFilters(f => ({ ...f, min_equity: undefined, max_equity: undefined }))}
              />
            )}
            {filters.my_city_only && (
              <ActiveChip
                label="My city only"
                onRemove={() => setFilters(f => ({ ...f, my_city_only: undefined }))}
              />
            )}
            <TouchableOpacity onPress={() => setFilters(EMPTY_FILTERS)} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>Clear all</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.brand} />
          }
          showsVerticalScrollIndicator={false}
        >
          {projects.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Briefcase size={32} color={theme.colors.brand} strokeWidth={1.5} />
              </View>
              <Text style={styles.emptyTitle}>
                {activeFilterCount > 0 ? 'No matches for your filters' : 'No open opportunities'}
              </Text>
              <Text style={styles.emptyText}>
                {activeFilterCount > 0
                  ? 'Try clearing some filters or post a project yourself.'
                  : 'Be the first to post a cofounder opportunity. Great teams start here.'}
              </Text>
              <TouchableOpacity
                style={styles.postButton}
                onPress={() => router.push('/project/create')}
                activeOpacity={0.85}
                testID="projects-post-empty"
              >
                <Plus size={16} color={theme.colors.brandOn} strokeWidth={2} />
                <Text style={styles.postButtonText}>Post an opportunity</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.list}>
              {projects.map((p) => (
                <TouchableOpacity
                  key={p.project_id}
                  style={styles.card}
                  activeOpacity={0.7}
                  testID={`project-${p.project_id}`}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.cardIcon}>
                      <Briefcase size={16} color={theme.colors.brand} strokeWidth={1.75} />
                    </View>
                    <View style={styles.cardHeaderText}>
                      <Text style={styles.cardTitle} numberOfLines={2}>{p.title}</Text>
                      <Text style={styles.cardLookingFor}>
                        Looking for {p.looking_for?.replace(/_/g, ' ')}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={theme.colors.textSecondary} strokeWidth={1.75} />
                  </View>
                  
                  <Text style={styles.cardDesc} numberOfLines={2}>{p.description}</Text>
                  
                  <View style={styles.cardMeta}>
                    <View style={styles.metaChip}>
                      <Clock size={12} color={theme.colors.textSecondary} strokeWidth={1.75} />
                      <Text style={styles.metaText}>{p.hours_per_week}h/week</Text>
                    </View>
                    <View style={styles.metaChip}>
                      <TrendingUp size={12} color={theme.colors.brand} strokeWidth={1.75} />
                      <Text style={styles.metaTextGold}>{p.equity_percentage}% equity</Text>
                    </View>
                  </View>

                  {p.skills_needed?.length > 0 && (
                    <View style={styles.tagsWrap}>
                      {p.skills_needed.slice(0, 4).map((s: string, i: number) => (
                        <View key={i} style={styles.tag}>
                          <Text style={styles.tagText}>{s}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <FilterModal
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onApply={(f) => { setFilters(f); setShowFilters(false); }}
      />
    </SafeAreaView>
  );
}

/* --------- Active filter chip --------- */
function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={styles.activeChip}>
      <Text style={styles.activeChipText}>{label}</Text>
      <TouchableOpacity onPress={onRemove}>
        <X size={12} color={theme.colors.brand} strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  );
}

/* --------- Filter modal --------- */
function FilterModal({
  visible,
  onClose,
  filters,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  filters: Filters;
  onApply: (f: Filters) => void;
}) {
  const insets = useSafeAreaInsets();
  const [local, setLocal] = useState<Filters>(filters);

  React.useEffect(() => {
    if (visible) setLocal(filters);
  }, [visible, filters]);

  const setField = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setLocal(prev => ({ ...prev, [k]: v }));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <TouchableOpacity onPress={onClose} testID="filter-close">
              <Text style={styles.sheetCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>Filters</Text>
            <TouchableOpacity onPress={() => setLocal(EMPTY_FILTERS)}>
              <Text style={styles.sheetReset}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
            {/* Profession */}
            <View style={styles.field}>
              <Text style={styles.label}>Looking for</Text>
              <View style={styles.chipsWrap}>
                {PROFESSIONS.map(p => (
                  <TouchableOpacity
                    key={p.value}
                    style={[styles.filterChip, local.looking_for === p.value && styles.filterChipSelected]}
                    onPress={() => setField('looking_for', local.looking_for === p.value ? undefined : p.value)}
                    testID={`filter-profession-${p.value}`}
                  >
                    <Text style={[styles.filterChipText, local.looking_for === p.value && styles.filterChipTextSelected]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Skill */}
            <View style={styles.field}>
              <Text style={styles.label}>Skill (single)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. React, Growth, Figma"
                placeholderTextColor={theme.colors.textSecondary}
                value={local.skill ?? ''}
                onChangeText={(t) => setField('skill', t || undefined)}
                testID="filter-skill-input"
              />
            </View>

            {/* Hours range */}
            <View style={styles.field}>
              <Text style={styles.label}>Hours / week</Text>
              <View style={styles.rangeRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="Min"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={local.min_hours != null ? String(local.min_hours) : ''}
                  onChangeText={(t) => setField('min_hours', t ? parseInt(t) : undefined)}
                  keyboardType="numeric"
                  testID="filter-min-hours"
                />
                <Text style={styles.rangeDash}>–</Text>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="Max"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={local.max_hours != null ? String(local.max_hours) : ''}
                  onChangeText={(t) => setField('max_hours', t ? parseInt(t) : undefined)}
                  keyboardType="numeric"
                  testID="filter-max-hours"
                />
              </View>
            </View>

            {/* Equity range */}
            <View style={styles.field}>
              <Text style={styles.label}>Equity %</Text>
              <View style={styles.rangeRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="Min"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={local.min_equity != null ? String(local.min_equity) : ''}
                  onChangeText={(t) => setField('min_equity', t ? parseFloat(t) : undefined)}
                  keyboardType="numeric"
                  testID="filter-min-equity"
                />
                <Text style={styles.rangeDash}>–</Text>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="Max"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={local.max_equity != null ? String(local.max_equity) : ''}
                  onChangeText={(t) => setField('max_equity', t ? parseFloat(t) : undefined)}
                  keyboardType="numeric"
                  testID="filter-max-equity"
                />
              </View>
            </View>

            {/* My city only */}
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => setField('my_city_only', !local.my_city_only)}
              activeOpacity={0.8}
              testID="filter-my-city-toggle"
            >
              <View style={styles.toggleLeft}>
                <MapPin size={16} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.toggleLabel}>My city only</Text>
              </View>
              <View style={[styles.toggleBox, local.my_city_only && styles.toggleBoxOn]}>
                {local.my_city_only && <Check size={14} color={theme.colors.brandOn} strokeWidth={3} />}
              </View>
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity
            style={styles.applyBtn}
            onPress={() => onApply(local)}
            activeOpacity={0.9}
            testID="filter-apply"
          >
            <Text style={styles.applyBtnText}>Apply filters</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.xl,
  },
  headerActions: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' },
  eyebrow: { ...theme.typography.micro, color: theme.colors.brand, marginBottom: theme.spacing.xs },
  title: { ...theme.typography.display, color: theme.colors.text },
  fab: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.goldGlow,
  },
  filterBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: { ...theme.typography.caption, color: theme.colors.brandOn, fontWeight: '700', fontSize: 10 },
  chipRow: {
    paddingBottom: theme.spacing.md,
  },
  chipRowContent: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
    flexDirection: 'row',
  },
  activeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
  },
  activeChipText: {
    ...theme.typography.caption, color: theme.colors.brand, fontWeight: '500',
    textTransform: 'capitalize',
  },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  clearBtnText: { ...theme.typography.caption, color: theme.colors.textSecondary },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingHorizontal: theme.spacing.xl },
  list: { gap: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md },
  cardIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  cardHeaderText: { flex: 1 },
  cardTitle: { ...theme.typography.headline, color: theme.colors.text, marginBottom: 2 },
  cardLookingFor: { ...theme.typography.caption, color: theme.colors.brand, textTransform: 'capitalize' },
  cardDesc: { ...theme.typography.subhead, color: theme.colors.textTertiary, lineHeight: 20 },
  cardMeta: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: theme.spacing.sm, paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  metaText: { ...theme.typography.caption, color: theme.colors.textSecondary },
  metaTextGold: { ...theme.typography.caption, color: theme.colors.brand, fontWeight: '500' },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: theme.spacing.xs },
  tag: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
  },
  tagText: { ...theme.typography.caption, color: theme.colors.text, fontSize: 11 },
  emptyState: {
    flex: 1, alignItems: 'center',
    paddingTop: theme.spacing.xxxl,
    paddingHorizontal: theme.spacing.xl,
  },
  emptyIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.spacing.xl,
  },
  emptyTitle: { ...theme.typography.title2, color: theme.colors.text, marginBottom: theme.spacing.sm, textAlign: 'center' },
  emptyText: {
    ...theme.typography.body, color: theme.colors.textSecondary,
    textAlign: 'center', maxWidth: 300, marginBottom: theme.spacing.xl,
  },
  postButton: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl, paddingVertical: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  postButtonText: { ...theme.typography.callout, color: theme.colors.brandOn, fontWeight: '600' },

  // Filter modal
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: '90%',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    alignSelf: 'center', marginBottom: theme.spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  sheetCancel: { ...theme.typography.callout, color: theme.colors.textSecondary },
  sheetTitle: { ...theme.typography.headline, color: theme.colors.text },
  sheetReset: { ...theme.typography.callout, color: theme.colors.brand, fontWeight: '500' },
  sheetBody: {
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.xl,
  },
  field: { gap: theme.spacing.sm },
  label: { ...theme.typography.footnote, color: theme.colors.textSecondary, fontWeight: '500' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  filterChipSelected: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  filterChipText: { ...theme.typography.subhead, color: theme.colors.text },
  filterChipTextSelected: { color: theme.colors.brandOn, fontWeight: '600' },
  input: {
    ...theme.typography.body,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
  },
  flex: { flex: 1 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  rangeDash: { color: theme.colors.textSecondary, ...theme.typography.callout },
  toggleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceTertiary,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  toggleLabel: { ...theme.typography.callout, color: theme.colors.text },
  toggleBox: {
    width: 24, height: 24, borderRadius: 6,
    backgroundColor: 'transparent',
    borderWidth: 1.5, borderColor: theme.colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleBoxOn: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  applyBtn: {
    marginTop: theme.spacing.md,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    ...theme.shadow.goldGlow,
  },
  applyBtnText: { ...theme.typography.headline, color: theme.colors.brandOn, fontWeight: '700' },
});
