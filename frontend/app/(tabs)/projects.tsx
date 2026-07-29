/**
 * Projects Board - Post/browse cofounder opportunities
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Plus, Briefcase, Clock, TrendingUp, ChevronRight } from 'lucide-react-native';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

export default function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadProjects();
    }, [])
  );

  const loadProjects = async () => {
    setLoading(true);
    try {
      const response = await api.getProjects('open', 20);
      setProjects(response.projects || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProjects();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="projects-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>OPPORTUNITIES</Text>
          <Text style={styles.title}>Projects</Text>
        </View>
        <TouchableOpacity style={styles.fab} testID="projects-create-button">
          <Plus size={20} color={theme.colors.brandOn} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

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
              <Text style={styles.emptyTitle}>No open opportunities</Text>
              <Text style={styles.emptyText}>
                Be the first to post a cofounder opportunity. Great teams start here.
              </Text>
              <TouchableOpacity style={styles.postButton} testID="projects-post-empty">
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.xl,
  },
  eyebrow: { ...theme.typography.micro, color: theme.colors.brand, marginBottom: theme.spacing.xs },
  title: { ...theme.typography.display, color: theme.colors.text },
  fab: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.goldGlow,
  },
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
  emptyTitle: { ...theme.typography.title2, color: theme.colors.text, marginBottom: theme.spacing.sm },
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
});
