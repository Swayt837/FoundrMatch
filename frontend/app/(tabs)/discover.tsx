/**
 * Discover Screen - Cinematic swipe experience
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  ActivityIndicator,
  Image,
  useWindowDimensions,
  Platform,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { X, Heart, Zap, MapPin, Briefcase, Clock, Sparkles, Info, SlidersHorizontal, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/contexts/AuthContext';
import { api, ApiError } from '@/src/api/client';
import { useDiscoveryCards } from '@/src/api/queries';
import { theme } from '@/src/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = { width: 390, height: 844 };
const SWIPE_THRESHOLD = 120;

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1642290687545-8ab7e6002472?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHwyfHxwcmVtaXVtJTIwcG9ydHJhaXQlMjBibGFjayUyMGFuZCUyMHdoaXRlfGVufDB8fHx8MTc4NTMyNzI2MXww&ixlib=rb-4.1.0&q=85';

const PROFESSION_OPTIONS = [
  { value: 'developer', label: 'Developer' },
  { value: 'designer', label: 'Designer' },
  { value: 'marketer', label: 'Marketer' },
  { value: 'sales', label: 'Sales' },
  { value: 'product_manager', label: 'Product' },
  { value: 'finance', label: 'Finance' },
  { value: 'content_creator', label: 'Creator' },
];
const AVAILABILITY_OPTIONS = [
  { value: 'full_time', label: 'Full time' },
  { value: '10h_week', label: '10h/week' },
  { value: '20h_week', label: '20h/week' },
  { value: 'evenings', label: 'Evenings' },
  { value: 'weekends', label: 'Weekends' },
];

interface DiscoverFilters {
  profession?: string;
  availability?: string;
  city?: string;
}

interface Card {
  user: any;
  compatibility: any;
}

interface MatchModal {
  visible: boolean;
  user: any;
  compatibility: any;
  matchId: string;
}

export default function DiscoverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const CARD_WIDTH = Math.min(winWidth - 32, 400);
  const CARD_HEIGHT = Math.min(winHeight * 0.62, 560);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipeLimitError, setSwipeLimitError] = useState(false);
  const [swipeError, setSwipeError] = useState<string | null>(null);
  const [matchModal, setMatchModal] = useState<MatchModal>({ visible: false, user: null, compatibility: null, matchId: '' });
  const [filters, setFilters] = useState<DiscoverFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const position = useRef(new Animated.ValueXY()).current;

  const activeFilterCount = Object.values(filters).filter(v => v).length;

  // The deck is cached per filter set and never refetched in the background — a
  // reshuffle mid-swipe would move the card out from under the user's thumb.
  const { data, isPending, error: loadError, refetch } = useDiscoveryCards(
    { limit: 10, ...filters },
    !!user
  );
  const cards: Card[] = data?.cards ?? [];

  // A new deck (different filters, or an explicit refresh) starts at the first card.
  useEffect(() => {
    setCurrentIndex(0);
  }, [data]);

  const reloadCards = useCallback(() => {
    setCurrentIndex(0);
    refetch();
  }, [refetch]);

  const haptic = (type: 'light' | 'medium' | 'success' = 'light') => {
    if (Platform.OS === 'web') return;
    if (type === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(type === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const rewindCard = () => {
    Animated.spring(position, {
      toValue: { x: 0, y: 0 },
      friction: 8,
      useNativeDriver: false,
    }).start();
  };

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (currentIndex >= cards.length) return;

    const card = cards[currentIndex];
    haptic(direction === 'right' ? 'medium' : 'light');

    try {
      const response = await api.swipe(card.user.user_id, direction);

      if (response.matched) {
        haptic('success');
        setMatchModal({
          visible: true,
          user: card.user,
          compatibility: response.compatibility,
          matchId: response.match_id,
        });
      }
    } catch (error: any) {
      // Branch on the HTTP status carried by ApiError rather than matching the
      // detail text, which changes whenever the server message is reworded.
      if (error instanceof ApiError && error.isPaymentRequired) {
        setSwipeLimitError(true);
        rewindCard();
        return;
      }

      if (error instanceof ApiError && error.isRateLimited) {
        setSwipeError('You are going a bit fast — try again in a moment.');
        rewindCard();
        return;
      }

      // Anything else (already swiped, network failure) used to be swallowed and
      // the card advanced as though the swipe had been recorded.
      console.error('Swipe error:', error);
      setSwipeError(error?.detail || error?.message || 'Swipe failed. Please try again.');
      rewindCard();
      return;
    }

    setSwipeError(null);
    setCurrentIndex(prev => prev + 1);
    position.setValue({ x: 0, y: 0 });
  };

  const swipeLeft = () => {
    Animated.timing(position, {
      toValue: { x: -winWidth * 1.2, y: 0 },
      duration: 250,
      useNativeDriver: false,
    }).start(() => handleSwipe('left'));
  };

  const swipeRight = () => {
    Animated.timing(position, {
      toValue: { x: winWidth * 1.2, y: 0 },
      duration: 250,
      useNativeDriver: false,
    }).start(() => handleSwipe('right'));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy * 0.3 });
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) {
          swipeRight();
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          swipeLeft();
        } else {
          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            friction: 8,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const closeMatchModal = () => {
    setMatchModal({ visible: false, user: null, compatibility: null, matchId: '' });
  };

  const goToChat = () => {
    const matchId = matchModal.matchId;
    closeMatchModal();
    router.push(`/chat/${matchId}`);
  };

  const openProfileDetail = (userId: string) => {
    haptic('light');
    router.push(`/profile/${userId}`);
  };

  if (isPending) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.brand} />
          <Text style={styles.loadingText}>Curating profiles for you...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']} testID="discover-error">
        <View style={styles.header}>
          <Text style={styles.brandTitle}>Discover</Text>
        </View>
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Info size={32} color={theme.colors.brand} strokeWidth={1.5} />
          </View>
          <Text style={styles.emptyTitle}>Couldn&apos;t load profiles</Text>
          <Text style={styles.emptyText}>
            {(loadError as any)?.detail || 'Something went wrong. Give it another try.'}
          </Text>
          <TouchableOpacity style={styles.reloadButton} onPress={reloadCards} testID="discover-retry">
            <Text style={styles.reloadButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (currentIndex >= cards.length) {
    return (
      <SafeAreaView style={styles.container} edges={['top']} testID="discover-empty">
        <View style={styles.header}>
          <Text style={styles.brandTitle}>Discover</Text>
        </View>
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Sparkles size={32} color={theme.colors.brand} strokeWidth={1.5} />
          </View>
          <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
          <Text style={styles.emptyText}>
            No new founders right now. We&apos;ll notify you when we curate more matches for you.
          </Text>
          <TouchableOpacity style={styles.reloadButton} onPress={reloadCards} testID="discover-reload">
            <Text style={styles.reloadButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const currentCard = cards[currentIndex];
  const nextCard = cards[currentIndex + 1];
  const cardUser = currentCard.user;
  const profile = cardUser.profile;
  const compatibility = currentCard.compatibility;
  const photoUri = profile.photos?.[0] || PLACEHOLDER_IMAGE;

  const rotate = position.x.interpolate({
    inputRange: [-winWidth / 2, 0, winWidth / 2],
    outputRange: ['-15deg', '0deg', '15deg'],
  });

  const likeOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const passOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const nextCardScale = position.x.interpolate({
    inputRange: [-winWidth, 0, winWidth],
    outputRange: [1, 0.92, 1],
    extrapolate: 'clamp',
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="discover-screen">
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>SWIPE TO CONNECT</Text>
          <Text style={styles.brandTitle}>Discover</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => setShowFilters(true)}
            activeOpacity={0.8}
            testID="discover-filter-btn"
          >
            <SlidersHorizontal size={16} color={theme.colors.text} strokeWidth={1.75} />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.aiIndicator}>
            <Sparkles size={12} color={theme.colors.brand} strokeWidth={2} />
            <Text style={styles.aiText}>AI</Text>
          </View>
        </View>
      </View>

      {/* Card Stack */}
      <View style={styles.cardStack}>
        <View style={[styles.cardWrapper, { width: CARD_WIDTH, height: CARD_HEIGHT }]}>
          {/* Next card (behind) */}
          {nextCard && (
            <Animated.View
              style={[
                styles.card,
                styles.cardBehind,
                { transform: [{ scale: nextCardScale }] },
              ]}
            >
              <Image source={{ uri: nextCard.user.profile.photos?.[0] || PLACEHOLDER_IMAGE }} style={styles.cardImage} />
            </Animated.View>
          )}

          {/* Current card */}
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              styles.card,
              {
                transform: [
                  { translateX: position.x },
                  { translateY: position.y },
                  { rotate },
                ],
              },
            ]}
            testID="discover-card"
          >
          <Image source={{ uri: photoUri }} style={styles.cardImage} />
          
          {/* Gradient scrim */}
          <LinearGradient
            colors={['transparent', 'rgba(9,9,11,0.4)', 'rgba(9,9,11,0.95)']}
            locations={[0.3, 0.6, 1]}
            style={styles.gradient}
          />

          {/* Compatibility badge - top. The score is computed deterministically by
              the backend engine, so it's authoritative — no hedging label. */}
          <View style={styles.compatBadge}>
            <BlurView intensity={40} tint="dark" style={styles.compatBadgeBlur}>
              <View style={styles.compatBadgeInner}>
                <Zap size={12} color={theme.colors.brand} strokeWidth={2} fill={theme.colors.brand} />
                <Text style={styles.compatBadgeText}>
                  {Math.round(compatibility.overall_score)}% match
                </Text>
              </View>
            </BlurView>
          </View>

          {/* Premium badge — visible to other founders, which is the point of it */}
          {cardUser.premium && (
            <View style={styles.premiumCardBadge} testID="discover-premium-badge">
              <Sparkles size={11} color={theme.colors.brandOn} strokeWidth={2.5} fill={theme.colors.brandOn} />
              <Text style={styles.premiumCardBadgeText}>PREMIUM</Text>
            </View>
          )}

          {/* Swipe indicators */}
          <Animated.View style={[styles.likeOverlay, { opacity: likeOpacity }]}>
            <Text style={styles.overlayText}>LIKE</Text>
          </Animated.View>
          <Animated.View style={[styles.passOverlay, { opacity: passOpacity }]}>
            <Text style={styles.overlayTextPass}>PASS</Text>
          </Animated.View>

          {/* Card info bottom */}
          <View style={styles.cardInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.cardName}>{profile.name}</Text>
              {profile.age && <Text style={styles.cardAge}>{profile.age}</Text>}
            </View>

            <View style={styles.metaRow}>
              <MapPin size={12} color={theme.colors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.metaText}>{profile.city}, {profile.country}</Text>
            </View>

            <View style={styles.chipsRow}>
              <View style={styles.chipDark}>
                <Briefcase size={12} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.chipDarkText}>{profile.profession?.replace(/_/g, ' ')}</Text>
              </View>
              <View style={styles.chipDark}>
                <Clock size={12} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.chipDarkText}>{profile.availability?.replace(/_/g, ' ')}</Text>
              </View>
            </View>

            <View style={styles.skillsRow}>
              {profile.skills?.slice(0, 4).map((skill: string, i: number) => (
                <View key={i} style={styles.skillPill}>
                  <Text style={styles.skillPillText}>{skill}</Text>
                </View>
              ))}
            </View>

            {compatibility.explanation && (
              <View style={styles.compatExplain}>
                <Info size={12} color={theme.colors.brand} strokeWidth={1.75} />
                <Text style={styles.compatExplainText} numberOfLines={2}>
                  {compatibility.explanation}
                </Text>
              </View>
            )}
          </View>
        </Animated.View>

        {/* View profile floating button - overlaid above card */}
        <TouchableOpacity
          style={styles.viewProfileBtn}
          onPress={() => openProfileDetail(cardUser.user_id)}
          activeOpacity={0.85}
          testID="discover-view-profile"
        >
          <BlurView intensity={50} tint="dark" style={styles.viewProfileBlur}>
            <View style={styles.viewProfileInner}>
              <Info size={14} color={theme.colors.brand} strokeWidth={2} />
              <Text style={styles.viewProfileText}>View profile</Text>
            </View>
          </BlurView>
        </TouchableOpacity>
        </View>
      </View>

      {/* Action buttons */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 100, paddingTop: theme.spacing.lg }]}>
        <TouchableOpacity
          style={[styles.actionButton, styles.passButton]}
          onPress={swipeLeft}
          activeOpacity={0.8}
          testID="discover-pass-button"
        >
          <X size={26} color={theme.colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.likeButton]}
          onPress={swipeRight}
          activeOpacity={0.8}
          testID="discover-like-button"
        >
          <Heart size={26} color={theme.colors.brandOn} strokeWidth={2} fill={theme.colors.brandOn} />
        </TouchableOpacity>
      </View>

      {/* Match modal */}
      {matchModal.visible && matchModal.user && (
        <View style={styles.matchOverlay} testID="match-modal">
          <BlurView intensity={95} tint="dark" style={StyleSheet.absoluteFillObject} />
          <View style={styles.matchContent}>
            <Text style={styles.matchEyebrow}>IT&apos;S A MATCH</Text>
            <Text style={styles.matchTitle}>You & {matchModal.user.profile.name}</Text>
            <View style={styles.matchAvatars}>
              <Image
                source={{ uri: matchModal.user.profile.photos?.[0] || PLACEHOLDER_IMAGE }}
                style={styles.matchAvatar}
              />
            </View>
            <View style={styles.matchScore}>
              <Zap size={16} color={theme.colors.brand} strokeWidth={2} fill={theme.colors.brand} />
              <Text style={styles.matchScoreText}>
                {Math.round(matchModal.compatibility.overall_score)}% compatibility
              </Text>
            </View>
            <Text style={styles.matchDesc}>
              {matchModal.compatibility.explanation}
            </Text>
            <TouchableOpacity
              style={styles.matchCta}
              onPress={goToChat}
              activeOpacity={0.85}
              testID="match-chat-button"
            >
              <Text style={styles.matchCtaText}>Start conversation</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.matchSecondary}
              onPress={closeMatchModal}
              testID="match-keep-swiping"
            >
              <Text style={styles.matchSecondaryText}>Keep swiping</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Swipe failure feedback — previously only logged to the console */}
      {swipeError && (
        <TouchableOpacity
          style={styles.swipeErrorBanner}
          onPress={() => setSwipeError(null)}
          testID="discover-swipe-error"
        >
          <Text style={styles.swipeErrorText}>{swipeError}</Text>
        </TouchableOpacity>
      )}

      {/* Filter modal */}
      <DiscoverFilterModal
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onApply={(f) => { setFilters(f); setShowFilters(false); }}
      />

      {/* Swipe limit reached - premium paywall */}
      {swipeLimitError && (
        <View style={styles.matchOverlay} testID="swipe-limit-modal">
          <BlurView intensity={95} tint="dark" style={StyleSheet.absoluteFillObject} />
          <View style={styles.matchContent}>
            <View style={styles.limitIcon}>
              <Zap size={36} color={theme.colors.brand} strokeWidth={1.75} fill={theme.colors.brand} />
            </View>
            <Text style={styles.matchEyebrow}>DAILY LIMIT REACHED</Text>
            <Text style={styles.matchTitle}>Out of swipes</Text>
            <Text style={styles.matchDesc}>
              You&apos;ve hit today&apos;s free limit. Upgrade to Premium for unlimited swipes and priority visibility.
            </Text>
            <TouchableOpacity
              style={styles.matchCta}
              onPress={() => { setSwipeLimitError(false); router.push('/premium'); }}
              activeOpacity={0.85}
              testID="swipe-limit-upgrade"
            >
              <Text style={styles.matchCtaText}>Unlock Premium</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.matchSecondary}
              onPress={() => setSwipeLimitError(false)}
              testID="swipe-limit-close"
            >
              <Text style={styles.matchSecondaryText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ================== Discover Filter Modal ================== */
function DiscoverFilterModal({
  visible,
  onClose,
  filters,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  filters: DiscoverFilters;
  onApply: (f: DiscoverFilters) => void;
}) {
  const insets = useSafeAreaInsets();
  const [local, setLocal] = React.useState<DiscoverFilters>(filters);

  React.useEffect(() => {
    if (visible) setLocal(filters);
  }, [visible, filters]);

  if (!visible) return null;

  const setField = (k: keyof DiscoverFilters, v?: string) => {
    setLocal(prev => ({ ...prev, [k]: prev[k] === v ? undefined : v }));
  };

  return (
    <View style={filterStyles.backdrop} testID="discover-filter-modal">
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
      <View style={[filterStyles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={filterStyles.handle} />
        <View style={filterStyles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={filterStyles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={filterStyles.title}>Filters</Text>
          <TouchableOpacity onPress={() => setLocal({})}>
            <Text style={filterStyles.reset}>Reset</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={filterStyles.body} showsVerticalScrollIndicator={false}>
          <Text style={filterStyles.label}>Profession</Text>
          <View style={filterStyles.chips}>
            {PROFESSION_OPTIONS.map(p => (
              <TouchableOpacity
                key={p.value}
                style={[filterStyles.chip, local.profession === p.value && filterStyles.chipOn]}
                onPress={() => setField('profession', p.value)}
                testID={`discover-filter-profession-${p.value}`}
              >
                <Text style={[filterStyles.chipText, local.profession === p.value && filterStyles.chipTextOn]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={filterStyles.label}>Availability</Text>
          <View style={filterStyles.chips}>
            {AVAILABILITY_OPTIONS.map(a => (
              <TouchableOpacity
                key={a.value}
                style={[filterStyles.chip, local.availability === a.value && filterStyles.chipOn]}
                onPress={() => setField('availability', a.value)}
                testID={`discover-filter-availability-${a.value}`}
              >
                <Text style={[filterStyles.chipText, local.availability === a.value && filterStyles.chipTextOn]}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={filterStyles.label}>City</Text>
          <TextInput
            style={filterStyles.input}
            placeholder="e.g. New York, Paris, Tokyo"
            placeholderTextColor={theme.colors.textSecondary}
            value={local.city ?? ''}
            onChangeText={(t) => setLocal(prev => ({ ...prev, city: t || undefined }))}
            testID="discover-filter-city"
          />
        </ScrollView>

        <TouchableOpacity
          style={filterStyles.applyBtn}
          onPress={() => onApply(local)}
          activeOpacity={0.9}
          testID="discover-filter-apply"
        >
          <Text style={filterStyles.applyText}>Apply filters</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const filterStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 200,
  },
  sheet: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: '85%',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    alignSelf: 'center', marginBottom: theme.spacing.md,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  cancel: { ...theme.typography.callout, color: theme.colors.textSecondary },
  title: { ...theme.typography.headline, color: theme.colors.text },
  reset: { ...theme.typography.callout, color: theme.colors.brand, fontWeight: '500' },
  body: { paddingVertical: theme.spacing.xl, gap: theme.spacing.md },
  label: { ...theme.typography.footnote, color: theme.colors.textSecondary, fontWeight: '500', marginTop: theme.spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { ...theme.typography.subhead, color: theme.colors.text },
  chipTextOn: { color: theme.colors.brandOn, fontWeight: '600' },
  input: {
    ...theme.typography.body,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceTertiary,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
  },
  applyBtn: {
    marginTop: theme.spacing.md,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    ...theme.shadow.goldGlow,
  },
  applyText: { ...theme.typography.headline, color: theme.colors.brandOn, fontWeight: '700' },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...theme.typography.callout,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  eyebrow: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    marginBottom: 4,
  },
  brandTitle: {
    ...theme.typography.title1,
    color: theme.colors.text,
  },
  aiIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.2)',
  },
  aiText: {
    ...theme.typography.caption,
    color: theme.colors.brand,
    fontWeight: '500',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  filterBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute', top: -3, right: -3,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    ...theme.typography.caption, color: theme.colors.brandOn,
    fontWeight: '700', fontSize: 9,
  },
  limitIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
    marginBottom: theme.spacing.md,
  },
  cardStack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
  },
  cardWrapper: {
    position: 'relative',
    maxWidth: '100%',
  },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: theme.radius.xl,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceSecondary,
    flexDirection: 'column',
    ...theme.shadow.strong,
  },
  cardBehind: {
    opacity: 0.5,
  },
  cardImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  compatBadge: {
    position: 'absolute',
    top: theme.spacing.lg,
    right: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  premiumCardBadge: {
    position: 'absolute',
    top: theme.spacing.lg + 38,
    right: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
  },
  premiumCardBadgeText: {
    ...theme.typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: theme.colors.brandOn,
    letterSpacing: 0.5,
  },
  swipeErrorBanner: {
    position: 'absolute',
    left: theme.spacing.xl,
    right: theme.spacing.xl,
    bottom: 120,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: theme.colors.errorOn,
  },
  swipeErrorText: {
    ...theme.typography.footnote,
    color: theme.colors.errorOn,
    textAlign: 'center',
  },
  viewProfileBtn: {
    position: 'absolute',
    top: theme.spacing.lg,
    left: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    zIndex: 10,
    elevation: 10,
  },
  viewProfileBlur: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  viewProfileInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  viewProfileText: {
    ...theme.typography.caption,
    color: theme.colors.brand,
    fontWeight: '600',
  },
  compatBadgeBlur: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  compatBadgeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  compatBadgeText: {
    ...theme.typography.caption,
    color: theme.colors.brand,
    fontWeight: '600',
  },
  likeOverlay: {
    position: 'absolute',
    top: 60,
    left: 20,
    borderWidth: 3,
    borderColor: theme.colors.brand,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    transform: [{ rotate: '-15deg' }],
  },
  overlayText: {
    ...theme.typography.title2,
    color: theme.colors.brand,
    fontWeight: '700',
    letterSpacing: 2,
  },
  passOverlay: {
    position: 'absolute',
    top: 60,
    right: 20,
    borderWidth: 3,
    borderColor: theme.colors.errorOn,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    transform: [{ rotate: '15deg' }],
  },
  overlayTextPass: {
    ...theme.typography.title2,
    color: theme.colors.errorOn,
    fontWeight: '700',
    letterSpacing: 2,
  },
  cardInfo: {
    marginTop: 'auto',
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
    zIndex: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.spacing.sm,
  },
  cardName: {
    ...theme.typography.title1,
    color: theme.colors.text,
    fontSize: 26,
  },
  cardAge: {
    ...theme.typography.title3,
    color: theme.colors.textSecondary,
    fontWeight: '400',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    ...theme.typography.subhead,
    color: theme.colors.textSecondary,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  chipDark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  chipDarkText: {
    ...theme.typography.caption,
    color: theme.colors.text,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  skillsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  skillPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.brand,
  },
  skillPillText: {
    ...theme.typography.caption,
    color: theme.colors.brandOn,
    fontWeight: '600',
    fontSize: 11,
  },
  compatExplain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: theme.spacing.sm,
    padding: theme.spacing.sm,
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.2)',
  },
  compatExplainText: {
    ...theme.typography.footnote,
    color: theme.colors.text,
    flex: 1,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.xl,
    paddingTop: theme.spacing.md,
  },
  actionButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadow.medium,
  },
  passButton: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  likeButton: {
    backgroundColor: theme.colors.brand,
    ...theme.shadow.goldGlow,
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
  reloadButton: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
  },
  reloadButtonText: {
    ...theme.typography.callout,
    color: theme.colors.brandOn,
    fontWeight: '600',
  },
  matchOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  matchContent: {
    padding: theme.spacing.xxl,
    alignItems: 'center',
    maxWidth: '90%',
  },
  matchEyebrow: {
    ...theme.typography.micro,
    color: theme.colors.brand,
    letterSpacing: 3,
    marginBottom: theme.spacing.md,
  },
  matchTitle: {
    ...theme.typography.display,
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  matchAvatars: {
    marginBottom: theme.spacing.xl,
  },
  matchAvatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: theme.colors.brand,
  },
  matchScore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brandTertiary,
    marginBottom: theme.spacing.lg,
  },
  matchScoreText: {
    ...theme.typography.callout,
    color: theme.colors.brand,
    fontWeight: '600',
  },
  matchDesc: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.xxl,
    lineHeight: 24,
  },
  matchCta: {
    backgroundColor: theme.colors.brand,
    paddingHorizontal: theme.spacing.xxl,
    paddingVertical: 16,
    borderRadius: theme.radius.pill,
    minWidth: 250,
    alignItems: 'center',
    ...theme.shadow.goldGlow,
  },
  matchCtaText: {
    ...theme.typography.headline,
    color: theme.colors.brandOn,
  },
  matchSecondary: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
  },
  matchSecondaryText: {
    ...theme.typography.subhead,
    color: theme.colors.textSecondary,
  },
});
