/**
 * Chat Screen - iMessage-inspired premium chat
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Send, Phone, Video, Sparkles } from 'lucide-react-native';
import { useAuth } from '@/src/contexts/AuthContext';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

const PLACEHOLDER = 'https://images.unsplash.com/photo-1642290687545-8ab7e6002472?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHwyfHxwcmVtaXVtJTIwcG9ydHJhaXQlMjBibGFjayUyMGFuZCUyMHdoaXRlfGVufDB8fHx8MTc4NTMyNzI2MXww&ixlib=rb-4.1.0&q=85';

export default function ChatScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [matchUser, setMatchUser] = useState<any>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (matchId) {
      loadChat();
      loadMatchUser();
    }
  }, [matchId]);

  const loadMatchUser = async () => {
    try {
      const matchesResp = await api.getMatches();
      const match = matchesResp.matches.find((m: any) => m.match_id === matchId);
      if (match) setMatchUser(match.user);
    } catch (e) {
      console.error(e);
    }
  };

  const loadChat = async () => {
    try {
      const response = await api.getMessages(matchId!);
      setMessages(response.messages || []);
    } catch (error) {
      console.error('Load chat error:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setSending(true);

    const optimistic = {
      message_id: `temp_${Date.now()}`,
      sender_id: user?.user_id,
      content,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      await api.sendMessage(matchId!, content);
      loadChat();
    } catch (error) {
      console.error('Send error:', error);
    } finally {
      setSending(false);
    }
  };

  const isMe = (senderId: string) => senderId === user?.user_id;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="chat-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} testID="chat-back">
          <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Image
            source={{ uri: matchUser?.profile?.photos?.[0] || PLACEHOLDER }}
            style={styles.headerAvatar}
          />
          <View>
            <Text style={styles.headerName}>{matchUser?.profile?.name || 'Chat'}</Text>
            <Text style={styles.headerStatus}>Active now</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton}>
            <Phone size={18} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton}>
            <Video size={18} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.colors.brand} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.messagesScroll}
            contentContainerStyle={styles.messagesContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 && (
              <View style={styles.emptyChat}>
                <View style={styles.emptyIconWrap}>
                  <Sparkles size={24} color={theme.colors.brand} strokeWidth={1.5} />
                </View>
                <Text style={styles.emptyText}>Start the conversation</Text>
                <Text style={styles.emptyHint}>
                  Break the ice by sharing what excites you about building together.
                </Text>
              </View>
            )}
            {messages.map((msg, i) => {
              const mine = isMe(msg.sender_id);
              return (
                <View
                  key={msg.message_id || i}
                  style={[styles.messageRow, mine && styles.messageRowMine]}
                >
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                      {msg.content}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, theme.spacing.md) }]}>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder="Message..."
              placeholderTextColor={theme.colors.textSecondary}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={2000}
              testID="chat-input"
            />
            <TouchableOpacity
              style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
              onPress={sendMessage}
              disabled={!input.trim() || sending}
              testID="chat-send"
            >
              {sending ? (
                <ActivityIndicator size="small" color={theme.colors.brandOn} />
              ) : (
                <Send size={16} color={theme.colors.brandOn} strokeWidth={2} />
              )}
            </TouchableOpacity>
          </View>
        </View>
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
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    gap: theme.spacing.md,
  },
  headerBack: { width: 40, height: 40, justifyContent: 'center', marginLeft: -theme.spacing.sm },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  headerAvatar: { width: 40, height: 40, borderRadius: 20 },
  headerName: { ...theme.typography.headline, color: theme.colors.text },
  headerStatus: { ...theme.typography.caption, color: theme.colors.brand, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: theme.spacing.sm },
  iconButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesScroll: { flex: 1 },
  messagesContent: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg, gap: theme.spacing.xs },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.xxxl },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.spacing.lg,
  },
  emptyText: { ...theme.typography.title3, color: theme.colors.text, marginBottom: theme.spacing.xs },
  emptyHint: { ...theme.typography.subhead, color: theme.colors.textSecondary, textAlign: 'center', maxWidth: 280 },
  messageRow: { flexDirection: 'row', marginVertical: 2 },
  messageRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: theme.spacing.md, paddingVertical: 10, borderRadius: 20 },
  bubbleTheirs: { backgroundColor: theme.colors.surfaceSecondary, borderBottomLeftRadius: 6 },
  bubbleMine: { backgroundColor: theme.colors.brand, borderBottomRightRadius: 6 },
  bubbleText: { ...theme.typography.body, color: theme.colors.text },
  bubbleTextMine: { color: theme.colors.brandOn },
  inputBar: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1, borderTopColor: theme.colors.divider,
  },
  inputWrap: {
    flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 24, paddingLeft: theme.spacing.lg, paddingRight: 4, paddingVertical: 4,
  },
  input: { flex: 1, ...theme.typography.body, color: theme.colors.text, maxHeight: 100, paddingVertical: 10 },
  sendButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
});
