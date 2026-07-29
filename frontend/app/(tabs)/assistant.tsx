/**
 * AI Assistant Chat - Powered by Claude
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send, Sparkles, Lightbulb, Rocket, Target, TrendingUp } from 'lucide-react-native';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

const PROMPTS = [
  { icon: Lightbulb, label: 'Give me 5 SaaS ideas for a solo developer' },
  { icon: Rocket, label: 'Help me validate my product idea' },
  { icon: Target, label: 'What niche should I target?' },
  { icon: TrendingUp, label: 'How do I find product-market fit?' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;

    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const response = await api.copilotChat(content, history);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: response.response || 'Sorry, I could not generate a response.' },
      ]);
    } catch (error: any) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Something went wrong: ${error.message || 'try again in a moment.'}` },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="assistant-screen">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.aiIcon}>
            <Sparkles size={16} color={theme.colors.brandOn} strokeWidth={2} />
          </View>
          <View>
            <Text style={styles.eyebrow}>YOUR AI COPILOT</Text>
            <Text style={styles.title}>Copilot</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
            <View style={styles.welcome}>
              <View style={styles.welcomeIcon}>
                <Sparkles size={32} color={theme.colors.brand} strokeWidth={1.5} />
              </View>
              <Text style={styles.welcomeTitle}>How can I help{'\n'}you today?</Text>
              <Text style={styles.welcomeText}>
                I'm your AI cofounder, powered by Claude. Ask me anything about building your startup.
              </Text>
              <View style={styles.promptsList}>
                {PROMPTS.map((p, i) => {
                  const Icon = p.icon;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={styles.promptCard}
                      onPress={() => sendMessage(p.label)}
                      activeOpacity={0.7}
                      testID={`assistant-prompt-${i}`}
                    >
                      <Icon size={16} color={theme.colors.brand} strokeWidth={1.75} />
                      <Text style={styles.promptText}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={styles.messages}>
              {messages.map((msg, i) => (
                <View key={i} style={styles.msgWrap}>
                  {msg.role === 'assistant' ? (
                    <View style={styles.assistantMsg}>
                      <View style={styles.aiIndicator}>
                        <Sparkles size={10} color={theme.colors.brand} strokeWidth={2} />
                        <Text style={styles.aiIndicatorText}>COFOUND AI</Text>
                      </View>
                      <Text style={styles.assistantText}>{msg.content}</Text>
                    </View>
                  ) : (
                    <View style={styles.userMsg}>
                      <Text style={styles.userMsgText}>{msg.content}</Text>
                    </View>
                  )}
                </View>
              ))}
              {loading && (
                <View style={styles.msgWrap}>
                  <View style={styles.assistantMsg}>
                    <View style={styles.aiIndicator}>
                      <Sparkles size={10} color={theme.colors.brand} strokeWidth={2} />
                      <Text style={styles.aiIndicatorText}>THINKING...</Text>
                    </View>
                    <ActivityIndicator color={theme.colors.brand} size="small" style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 100 }]}>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder="Ask your AI cofounder anything..."
              placeholderTextColor={theme.colors.textSecondary}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={2000}
              testID="assistant-input"
            />
            <TouchableOpacity
              style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
              onPress={() => sendMessage()}
              disabled={!input.trim() || loading}
              testID="assistant-send"
            >
              <Send size={16} color={theme.colors.brandOn} strokeWidth={2} />
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
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  aiIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.goldGlow,
  },
  eyebrow: { ...theme.typography.micro, color: theme.colors.brand, marginBottom: 2 },
  title: { ...theme.typography.title2, color: theme.colors.text },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  welcome: { alignItems: 'center', paddingTop: theme.spacing.xl },
  welcomeIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: theme.colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.spacing.xl,
  },
  welcomeTitle: {
    ...theme.typography.display,
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  welcomeText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
    marginBottom: theme.spacing.xxl,
  },
  promptsList: { width: '100%', gap: theme.spacing.sm },
  promptCard: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  promptText: { ...theme.typography.callout, color: theme.colors.text, flex: 1 },
  messages: { gap: theme.spacing.xl },
  msgWrap: { gap: theme.spacing.sm },
  assistantMsg: {
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)',
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    gap: theme.spacing.sm,
  },
  aiIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aiIndicatorText: { ...theme.typography.micro, color: theme.colors.brand },
  assistantText: { ...theme.typography.body, color: theme.colors.text, lineHeight: 24 },
  userMsg: {
    backgroundColor: theme.colors.brand,
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    alignSelf: 'flex-end', maxWidth: '85%',
  },
  userMsgText: { ...theme.typography.body, color: theme.colors.brandOn },
  inputBar: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1, borderTopColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
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
