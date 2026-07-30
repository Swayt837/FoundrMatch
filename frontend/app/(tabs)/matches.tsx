/**
 * Matches Screen - Superhuman-inspired list
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Zap, Heart, ChevronRight, Rocket, Info, Sparkles, UserMinus } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useMatches, useUnmatch } from '@/src/api/queries';
import { useSocketEvent } from '@/src/hooks/use-socket-event';
import { theme } from '@/src/theme';

const PLACEHOLDER = 'https://images.unsplash.com/photo-1642290687545-8ab7e6002472?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHwyfHxwcmVtaXVtJTIwcG9ydHJhaXQlMjBibGFjayUyMGFuZCUyMHdoaXRlfGVufDB8fHx8MTc4NTMyNzI2MXww&ixlib=rb-4.1.0&q=85';

export default function MatchesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // Cached-first: returning to this tab shows the previous list immediately and
  // refreshes behind it, instead of a full-screen spinner every time.
  const { data, isPending, isRefetching, refetch, error } = useMatches();
  const unmatchMutation = useUnmatch();

  const matches: any[] = data?.matches ?? [];
  const totalUnread = data?.total_unread ?? 0;

  // The list is refetched on focus because React Native has no window-focus event.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  // Keep the list live: a new message, match or unmatch arrives over the socket
  // rather than waiting for the user to pull to refresh.
  useSocketEvent('message_notification', () => refetch());
  useSocketEvent('new_match', () => refetch());
  useSocketEvent('match_removed', (payload: { match_id?: string }) => {
    if (!payload?.match_id) return;
    // Remove the row now; the server is already in that state.
    queryClient.setQueryData<any>(queryKeys.matches, (current: any) =>
      current
        ? {
            ...current,
            matches: current.matches.filter((m: any) => m.match_id !== payload.match_id),
          }
        : current
    );
  });

  const goToChat = (matchId: string) => {
    router.push(`/chat/${matchId}`);
  };

  const goToProfile = (userId: string) => {
    router.push(`/profile/${userId}`);
  };

  const confirmUnmatch = (item: any) => {
    const name = item.user?.profile?.name || 'this founder';
    const question = `Unmatch ${name}? This deletes the conversation and deal room for both of you.`;

    const run = () => {
      unmatchMutation.mutate(item.match_id, {
        onError: (e: any) => {
          const message = e?.detail || e?.message || 'Could not unmatch';
          if (Platform.OS === 'web') window.alert(message);
          else Alert.alert('Unmatch failed', message);
        },
      });
    };

    if (Platform.OS === 'web') {
      if (window.confirm(question)) run();
      return;
    }
    Alert.alert('Unmatch', question, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unmatch', style: 'destructive', onPress: run },
    ]);
  };

  const renderMatch = ({ item }: { item: any }) => {
    const user = item.user;
    const profile = user.profile;
    const compat = item.compatibility;
    const compatScore = Math.round(compat?.overall_score || 0);
    const unread = item.unread_count || 0;

    return (
      <View style={styles.rowContainer}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => goToChat(item.match_id)}
          activeOpacity={0.6}
          testID={`match-row-${item.match_id}`}
        >
          <TouchableOpacity
            onPress={() => goToProfile(user.user_id)}
            activeOpacity={0.7}
            testID={`match-avatar-${item.match_id}`}
          >
            <Image
              source={{ uri: profile.photos?.[0] || PLACEHOLDER }}
              style={styles.avatar}
            />
            {unread > 0 && (
              <View style={styles.unreadDot} testID={`match-unread-${item.match_id}`}>
                <Text style={styles.unreadDotText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.rowContent}>
            <View style={styles.rowTop}>
              <Text style={styles.rowName} numberOfLines={1}>{profile.name}</Text>
              {user.premium && (
                <View style={styles.premiumPill} testID={`match-premium-${item.match_id}`}>
                  <Sparkles size={9} color={theme.colors.brandOn} strokeWidth={2.5} fill={theme.colors.brandOn} />
                  <Text style={styles.premiumPillText}>PRO</Text>
                </View>
              )}
              <View style={styles.compatBadge}>
                <Zap size={10} color={theme.colors.brand} strokeWidth={2} fill={theme.colors.brand} />
                <Text style={styles.compatText}>{compatScore}%</Text>
              </View>
            </View>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {profile.profession?.replace(/_/g, ' ')} · {profile.city}
            </Text>
            {item.last_message ? (
              <Text
                style={[styles.rowExplain, unread > 0 && styles.rowExplainUnread]}
                numberOfLines={1}
              >
                {item.last_message.sender_id === user.user_id ? '' : 'You: '}
                {item.last_message.content}
              </Text>
            ) : compat?.explanation ? (
              <Text style={styles.rowExplain} numberOfLines={1}>
                {compat.explanation}
              </Text>
            ) : null}
          </View>
          <ChevronRight size={18} color={theme.colors.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        <View style={styles.matchActions}>
          <TouchableOpacity
            style={styles.matchActionBtn}
            onPress={() => goToProfile(user.user_id)}
            testID={`match-profile-${item.match_id}`}
          >
            <Info size={13} color={theme.colors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.matchActionText}>View profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dealRoomIconBtn}
            onPress={() => router.push(`/deal-room/${item.match_id}`)}
            testID={`match-dealroom-${item.match_id}`}
          >
            <Rocket size={14} color={theme.colors.brand} strokeWidth={1.75} />
            <Text style={styles.dealRoomIconText}>Deal Room</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.matchActionBtn}
            onPress={() => confirmUnmatch(item)}
            testID={`match-unmatch-${item.match_id}`}
          >
            <UserMinus size={13} color={theme.colors.errorOn} strokeWidth={1.75} />
            <Text style={[styles.matchActionText, { color: theme.colors.errorOn }]}>Unmatch</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (isPending) {
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

  // A failed first load used to fall through to "No matches yet", which reads as
  // "nobody liked you back" when the request simply failed.
  if (error && matches.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>YOUR CONNECTIONS</Text>
          <Text style={styles.title}>Matches</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Could not load your matches</Text>
          <Text style={styles.emptyText}>
            {(error as any)?.detail || 'Check your connection and try again.'}
          </Text>
          <TouchableOpacity style={styles.discoverButton} onPress={() => refetch()}>
            <Text style={styles.discoverButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="matches-screen">
      <View style={styles.header}>
        <Text style={styles.eyebrow}>YOUR CONNECTIONS</Text>
        <Text style={styles.title}>Matches</Text>
        <Text style={styles.subtitle}>
          {matches.length} {matches.length === 1 ? 'partner' : 'partners'}
          {totalUnread > 0 ? ` · ${totalUnread} unread` : ''}
        </Text>
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
              refreshing={isRefetching}
              onRefresh={refetch}
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
  rowContainer: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  dealRoomIconBtn: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
  },
  matchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps so a third action doesn't overflow on narrow screens
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginLeft: 52 + theme.spacing.md,
  },
  matchActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.surface,
  },
  unreadDotText: {
    ...theme.typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: theme.colors.brandOn,
  },
  premiumPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  premiumPillText: {
    ...theme.typography.caption,
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.brandOn,
    letterSpacing: 0.4,
  },
  rowExplainUnread: {
    color: theme.colors.text,
    fontWeight: '600',
  },
  matchActionText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  dealRoomIconText: {
    ...theme.typography.caption,
    color: theme.colors.brand,
    fontWeight: '600',
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
