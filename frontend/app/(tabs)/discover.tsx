/**
 * Discover/Swipe Screen
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Animated,
  PanResponder,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useRouter } from 'expo-router';

interface Card {
  user: any;
  compatibility: any;
}

export default function DiscoverScreen() {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const position = new Animated.ValueXY();

  useEffect(() => {
    loadCards();
  }, []);

  const loadCards = async () => {
    setLoading(true);
    try {
      const response = await api.getDiscoveryCards(20);
      setCards(response.cards);
    } catch (error) {
      console.error('Load cards error:', error);
      Alert.alert('Error', 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  };

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (currentIndex >= cards.length) return;

    const card = cards[currentIndex];
    
    try {
      const response = await api.swipe(card.user.user_id, direction);
      
      if (response.matched) {
        Alert.alert(
          "🎉 It's a Match!",
          `You matched with ${card.user.profile.name}!\n\nCompatibility: ${response.compatibility.overall_score}%`,
          [
            { text: 'Keep Swiping', style: 'cancel' },
            { text: 'View Match', onPress: () => router.push('/(tabs)/matches') },
          ]
        );
      }
    } catch (error) {
      console.error('Swipe error:', error);
    }

    setCurrentIndex(currentIndex + 1);
    position.setValue({ x: 0, y: 0 });
  };

  const swipeLeft = () => {
    Animated.timing(position, {
      toValue: { x: -500, y: 0 },
      duration: 250,
      useNativeDriver: false,
    }).start(() => handleSwipe('left'));
  };

  const swipeRight = () => {
    Animated.timing(position, {
      toValue: { x: 500, y: 0 },
      duration: 250,
      useNativeDriver: false,
    }).start(() => handleSwipe('right'));
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gesture) => {
      position.setValue({ x: gesture.dx, y: gesture.dy });
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx > 120) {
        swipeRight();
      } else if (gesture.dx < -120) {
        swipeLeft();
      } else {
        Animated.spring(position, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start();
      }
    },
  });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6B46C1" />
        <Text style={styles.loadingText}>Finding potential cofounders...</Text>
      </View>
    );
  }

  if (currentIndex >= cards.length) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="checkmark-circle" size={80} color="#6B46C1" />
        <Text style={styles.emptyTitle}>No More Profiles</Text>
        <Text style={styles.emptyText}>Check back later for new cofounders!</Text>
        <TouchableOpacity style={styles.reloadButton} onPress={loadCards}>
          <Text style={styles.reloadButtonText}>Reload</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentCard = cards[currentIndex];
  const user = currentCard.user;
  const profile = user.profile;
  const compatibility = currentCard.compatibility;

  const rotate = position.x.interpolate({
    inputRange: [-200, 0, 200],
    outputRange: ['-20deg', '0deg', '20deg'],
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>CoFound</Text>
      </View>

      <View style={styles.cardContainer}>
        <Animated.View
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
          {...panResponder.panHandlers}
        >
          <ScrollView contentContainerStyle={styles.cardContent}>
            {profile.photos && profile.photos.length > 0 && (
              <Image
                source={{ uri: profile.photos[0] }}
                style={styles.profileImage}
              />
            )}

            <View style={styles.infoSection}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{profile.name}</Text>
                <Text style={styles.age}>{profile.age || ''}</Text>
              </View>
              
              <Text style={styles.location}>
                {profile.city}, {profile.country}
              </Text>

              <View style={styles.compatibilityBadge}>
                <Ionicons name="flash" size={16} color="#6B46C1" />
                <Text style={styles.compatibilityText}>
                  {Math.round(compatibility.overall_score)}% Compatible
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Ionicons name="briefcase" size={20} color="#666" />
                <Text style={styles.detailText}>
                  {profile.profession?.replace('_', ' ')}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Ionicons name="code-slash" size={20} color="#666" />
                <Text style={styles.detailText}>
                  {profile.skills?.slice(0, 3).join(', ')}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Ionicons name="time" size={20} color="#666" />
                <Text style={styles.detailText}>
                  {profile.availability?.replace('_', ' ')}
                </Text>
              </View>

              {profile.bio && (
                <View style={styles.bioSection}>
                  <Text style={styles.bioLabel}>About</Text>
                  <Text style={styles.bioText}>{profile.bio}</Text>
                </View>
              )}

              <View style={styles.compatibilitySection}>
                <Text style={styles.sectionTitle}>Why you match</Text>
                <Text style={styles.explanation}>{compatibility.explanation}</Text>
              </View>
            </View>
          </ScrollView>
        </Animated.View>
      </View>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity style={[styles.actionButton, styles.passButton]} onPress={swipeLeft}>
          <Ionicons name="close" size={32} color="#E53E3E" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.likeButton]} onPress={swipeRight}>
          <Ionicons name="heart" size={32} color="#48BB78" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  logo: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#6B46C1',
  },
  cardContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '90%',
    height: '85%',
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  cardContent: {
    flexGrow: 1,
  },
  profileImage: {
    width: '100%',
    height: 300,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  infoSection: {
    padding: 20,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  age: {
    fontSize: 24,
    color: '#666',
    marginLeft: 8,
  },
  location: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  compatibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  compatibilityText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B46C1',
    marginLeft: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  detailText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
    textTransform: 'capitalize',
  },
  bioSection: {
    marginTop: 20,
  },
  bioLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  bioText: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
  },
  compatibilitySection: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#F7FAFC',
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  explanation: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
  },
  buttonsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 20,
  },
  actionButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  passButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E53E3E',
  },
  likeButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#48BB78',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
  reloadButton: {
    marginTop: 24,
    backgroundColor: '#6B46C1',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  reloadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});