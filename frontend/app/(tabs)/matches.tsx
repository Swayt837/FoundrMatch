/**
 * Matches Screen - Superhuman-inspired list
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Zap, Heart, ChevronRight } from 'lucide-react-native';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

const PLACEHOLDER = 'https://images.unsplash.com/photo-1642290687545-8ab7e6002472?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHwyfHxwcmVtaXVtJTIwcG9ydHJhaXQlMjBibGFjayUyMGFuZCUyMHdoaXRlfGVufDB8fHx8MTc4NTMyNzI2MXww&ixlib=rb-4.1.0&q=85';

export default function MatchesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadMatches();
    }, [])
  );

  const loadMatches = async () => {
    setLoading(true);
    try {
      const response = await api.getMatches();
      setMatches(response.matches || []);
    } catch (error) {
      console.error('Load matches error:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMatches();
    setRefreshing(false);
  };

  const goToChat = (matchId: string) => {
    router.push(`/chat/${matchId}`);
  };

  const renderMatch = ({ item }: { item: any }) => {
    const user = item.user;
    const profile = user.profile;
    const compat = item.compatibility;
    const compatScore = Math.round(compat?.overall_score || 0);

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => goToChat(item.match_id)}
        activeOpacity={0.6}
        testID={`match-row-${item.match_id}`}
      >
        <Image
          source={{ uri: profile.photos?.[0] || PLACEHOLDER }}
          style={styles.avatar}
        />
        <View style={styles.rowContent}>
          <View style={styles.rowTop}>
            <Text style={styles.rowName} numberOfLines={1}>{profile.name}</Text>
            <View style={styles.compatBadge}>
              <Zap size={10} color={theme.colors.brand} strokeWidth={2} fill={theme.colors.brand} />
              <Text style={styles.compatText}>{compatScore}%</Text>
            </View>
          </View>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {profile.profession?.replace(/_/g, ' ')} · {profile.city}
          </Text>
          {compat?.explanation && (
            <Text style={styles.rowExplain} numberOfLines={1}>
              {compat.explanation}
            </Text>
          )}
        </View>
        <ChevronRight size={18} color={theme.colors.textSecondary} strokeWidth={1.5} />
      </TouchableOpacity>
    );
  };

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>YOUR CONNECTIONS</Text>
          <Text style={styles.title}>Matches</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="matches-screen">
      <View style={styles.header}>
        <Text style={styles.eyebrow}>YOUR CONNECTIONS</Text>
        <Text style={styles.title}>Matches</Text>
        <Text style={styles.subtitle}>{matches.length} {matches.length === 1 ? 'partner' : 'partners'}</Text>
      </View>

      {matches.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Heart size={32} color={theme.colors.brand} strokeWidth={1.5} />
          </View>
          <Text style={styles.emptyTitle}>No matches yet</Text>
          <Text style={styles.emptyText}>
            Start swiping in Discover to find your ideal cofounder.
          </Text>
          <TouchableOpacity
            style={styles.discoverButton}
            onPress={() => router.push('/(tabs)/discover')}
            testID="matches-discover-cta"
          >
            <Text style={styles.discoverButtonText}>Start discovering</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={matches}
          renderItem={renderMatch}
          keyExtractor={(item) => item.match_id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.brand}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  eyebrow: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    marginBottom: theme.spacing.xs,
  },
  title: {
    ...theme.typography.display,
    color: theme.colors.text,
  },
  subtitle: {
    ...theme.typography.subhead,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: theme.spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rowName: {
    ...theme.typography.headline,
    color: theme.colors.text,
    flex: 1,
  },
  compatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
  },
  compatText: {
    ...theme.typography.caption,
    color: theme.colors.brand,
    fontWeight: '600',
    fontSize: 11,
  },
  rowMeta: {
    ...theme.typography.footnote,
    color: theme.colors.textSecondary,
    textTransform: 'capitalize',
  },
  rowExplain: {
    ...theme.typography.caption,
    color: theme.colors.textTertiary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.divider,
    marginLeft: 52 + theme.spacing.md,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xl,
  },
  emptyTitle: {
    ...theme.typography.title2,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  emptyText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: theme.spacing.xl,
  },
  discoverButton: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  discoverButtonText: {
    ...theme.typography.callout,
    color: theme.colors.brandOn,
    fontWeight: '600',
  },
});
