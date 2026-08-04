/**
 * Verification — proving a founder is who they say they are.
 *
 * The four methods are not equally strong and the screen says so rather than
 * showing four identical checkmarks. LinkedIn in particular is a link the
 * founder typed, and is labelled that way: their API needs app review for
 * profile access, so a badge would be theatre.
 *
 * A method the server cannot perform is shown as unavailable instead of as a
 * button that answers 503.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
// This build of lucide-react-native ships no brand icons, so GitHub and
// LinkedIn borrow generic ones rather than the marks.
import {
  ArrowLeft, Mail, Terminal, Globe, Link2, Check, Copy, ShieldCheck,
} from 'lucide-react-native';
import { useVerificationStatus, useVerificationActions } from '@/src/api/queries';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

export default function VerifyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: status, isPending, refetch } = useVerificationStatus();
  const actions = useVerificationActions();

  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [challenge, setChallenge] = useState<{ meta_tag: string; url: string } | null>(null);
  const [linkedIn, setLinkedIn] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const fail = (fallback: string) => (e: any) =>
    setError(e?.detail || e?.message || fallback);

  const sendCode = () => {
    haptic();
    setError(null);
    actions.sendEmailCode.mutate(undefined, {
      onSuccess: (result: any) => {
        setCodeSent(true);
        setNotice(
          result?.already_verified
            ? 'That address is already verified.'
            : `Code sent to ${status?.email?.address}. It expires in ${result.expires_in_minutes} minutes.`
        );
      },
      onError: fail('Could not send the code'),
    });
  };

  const confirmCode = () => {
    haptic();
    setError(null);
    actions.confirmEmailCode.mutate(code.trim(), {
      onSuccess: () => {
        setCode('');
        setCodeSent(false);
        setNotice('Email verified.');
      },
      onError: fail('That code was not accepted'),
    });
  };

  /**
   * GitHub round trip. The state comes back in the redirect and is checked
   * server-side — without it someone could finish this flow with their own
   * account inside another user's session.
   */
  const verifyGithub = async () => {
    haptic();
    setError(null);
    setBusy('github');
    try {
      const redirectUri = Linking.createURL('verify');
      const { url } = await api.startGithubVerification(redirectUri);

      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (result.type !== 'success' || !result.url) return;

      const params = Linking.parse(result.url).queryParams || {};
      if (!params.code || !params.state) {
        setError('GitHub did not return a result');
        return;
      }

      await actions.finishGithub.mutateAsync({
        code: String(params.code),
        state: String(params.state),
      });
      setNotice('GitHub account verified.');
    } catch (e: any) {
      fail('GitHub verification failed')(e);
    } finally {
      setBusy(null);
      refetch();
    }
  };

  const startWebsite = () => {
    haptic();
    setError(null);
    actions.startWebsite.mutate(siteUrl.trim(), {
      onSuccess: (result: any) => setChallenge(result),
      onError: fail('Could not start the website check'),
    });
  };

  const confirmWebsite = () => {
    haptic();
    setError(null);
    actions.confirmWebsite.mutate(undefined, {
      onSuccess: () => {
        setChallenge(null);
        setSiteUrl('');
        setNotice('Website verified.');
      },
      onError: fail('The tag was not found'),
    });
  };

  const saveLinkedIn = () => {
    haptic();
    setError(null);
    actions.setLinkedIn.mutate(linkedIn.trim() || null, {
      onSuccess: () => setNotice('LinkedIn link saved.'),
      onError: fail('Could not save that link'),
    });
  };

  if (isPending || !status) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="verify-screen">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
            <ArrowLeft size={22} color={theme.colors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Verification</Text>
          <View style={styles.headerBack} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <ShieldCheck size={18} color={theme.colors.brand} strokeWidth={1.75} />
            <Text style={styles.introText}>
              You are about to discuss equity with strangers. Every badge you add
              is one less reason for them to hesitate.
            </Text>
          </View>

          {error && (
            <TouchableOpacity style={styles.errorBanner} onPress={() => setError(null)}>
              <Text style={styles.errorText}>{error}</Text>
            </TouchableOpacity>
          )}
          {notice && (
            <TouchableOpacity style={styles.noticeBanner} onPress={() => setNotice(null)}>
              <Text style={styles.noticeText}>{notice}</Text>
            </TouchableOpacity>
          )}

          {/* Email */}
          <Method
            icon={<Mail size={16} color={theme.colors.brand} strokeWidth={1.75} />}
            title="Email"
            subtitle={status.email.address}
            verified={status.email.verified}
            unavailable={!status.email.available && 'Not configured on this server'}
          >
            {!codeSent ? (
              <TouchableOpacity style={styles.cta} onPress={sendCode} testID="verify-email-send">
                {actions.sendEmailCode.isPending ? (
                  <ActivityIndicator color={theme.colors.brandOn} />
                ) : (
                  <Text style={styles.ctaText}>Send me a code</Text>
                )}
              </TouchableOpacity>
            ) : (
              <>
                <TextInput
                  style={styles.codeInput}
                  placeholder="123456"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  testID="verify-email-code"
                />
                <TouchableOpacity
                  style={[styles.cta, code.length < 6 && styles.ctaOff]}
                  onPress={confirmCode}
                  disabled={code.length < 6 || actions.confirmEmailCode.isPending}
                  testID="verify-email-confirm"
                >
                  {actions.confirmEmailCode.isPending ? (
                    <ActivityIndicator color={theme.colors.brandOn} />
                  ) : (
                    <Text style={styles.ctaText}>Confirm</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </Method>

          {/* GitHub */}
          <Method
            icon={<Terminal size={16} color={theme.colors.brand} strokeWidth={1.75} />}
            title="GitHub"
            subtitle={
              status.github.verified
                ? `@${status.github.username}`
                : 'Proves you control the account. No repository access is requested.'
            }
            verified={status.github.verified}
            unavailable={!status.github.available && 'Not configured on this server'}
          >
            <TouchableOpacity
              style={styles.cta}
              onPress={verifyGithub}
              disabled={busy === 'github'}
              testID="verify-github"
            >
              {busy === 'github' ? (
                <ActivityIndicator color={theme.colors.brandOn} />
              ) : (
                <Text style={styles.ctaText}>Connect GitHub</Text>
              )}
            </TouchableOpacity>
          </Method>

          {/* Website */}
          <Method
            icon={<Globe size={16} color={theme.colors.brand} strokeWidth={1.75} />}
            title="Website"
            subtitle={
              status.website.verified
                ? status.website.url
                : 'Proves you control the domain — which is what "my company" means.'
            }
            verified={status.website.verified}
          >
            {!challenge ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="acme.com"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={siteUrl}
                  onChangeText={setSiteUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                  testID="verify-site-url"
                />
                <TouchableOpacity
                  style={[styles.cta, !siteUrl.trim() && styles.ctaOff]}
                  onPress={startWebsite}
                  disabled={!siteUrl.trim() || actions.startWebsite.isPending}
                  testID="verify-site-start"
                >
                  {actions.startWebsite.isPending ? (
                    <ActivityIndicator color={theme.colors.brandOn} />
                  ) : (
                    <Text style={styles.ctaText}>Get my tag</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  Add this inside the &lt;head&gt; of {challenge.url}, publish, then confirm.
                  It has to be in the HTML your server sends — a tag added by
                  JavaScript after load is not visible to us.
                </Text>
                <TouchableOpacity
                  style={styles.tagBox}
                  onPress={async () => {
                    await Clipboard.setStringAsync(challenge.meta_tag);
                    setNotice('Tag copied.');
                  }}
                  testID="verify-site-copy"
                >
                  <Text style={styles.tagText} numberOfLines={2}>{challenge.meta_tag}</Text>
                  <Copy size={14} color={theme.colors.textSecondary} strokeWidth={1.75} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cta}
                  onPress={confirmWebsite}
                  disabled={actions.confirmWebsite.isPending}
                  testID="verify-site-confirm"
                >
                  {actions.confirmWebsite.isPending ? (
                    <ActivityIndicator color={theme.colors.brandOn} />
                  ) : (
                    <Text style={styles.ctaText}>I&apos;ve added it — check now</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </Method>

          {/* LinkedIn — a claim, and labelled as one */}
          <Method
            icon={<Link2 size={16} color={theme.colors.textSecondary} strokeWidth={1.75} />}
            title="LinkedIn"
            subtitle={status.linkedin.note}
            verified={false}
            muted
          >
            <TextInput
              style={styles.input}
              placeholder={status.linkedin.url || 'linkedin.com/in/…'}
              placeholderTextColor={theme.colors.textSecondary}
              value={linkedIn}
              onChangeText={setLinkedIn}
              autoCapitalize="none"
              testID="verify-linkedin-url"
            />
            <TouchableOpacity
              style={styles.secondary}
              onPress={saveLinkedIn}
              testID="verify-linkedin-save"
            >
              <Text style={styles.secondaryText}>Save link</Text>
            </TouchableOpacity>
          </Method>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Method({
  icon, title, subtitle, verified, unavailable, muted, children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  verified: boolean;
  unavailable?: string | false;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, muted && styles.cardMuted]}>
      <View style={styles.cardHead}>
        {icon}
        <Text style={styles.cardTitle}>{title}</Text>
        {verified && (
          <View style={styles.badge}>
            <Check size={11} color={theme.colors.brandOn} strokeWidth={3} />
            <Text style={styles.badgeText}>VERIFIED</Text>
          </View>
        )}
      </View>

      {!!subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}

      {unavailable ? (
        <Text style={styles.unavailable}>{unavailable}</Text>
      ) : verified ? null : (
        <View style={styles.cardBody}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.surface },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  headerBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...theme.typography.headline, color: theme.colors.text },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },

  intro: {
    flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start',
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  introText: { ...theme.typography.footnote, color: theme.colors.textTertiary, flex: 1, lineHeight: 18 },

  card: {
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1, borderColor: theme.colors.border, gap: theme.spacing.sm,
  },
  cardMuted: { opacity: 0.9 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  cardTitle: { ...theme.typography.headline, color: theme.colors.text, flex: 1 },
  cardSubtitle: { ...theme.typography.footnote, color: theme.colors.textSecondary, lineHeight: 18 },
  cardBody: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: theme.radius.sm, backgroundColor: theme.colors.brand,
  },
  badgeText: {
    ...theme.typography.caption, color: theme.colors.brandOn,
    fontWeight: '700', fontSize: 9, letterSpacing: 0.5,
  },
  unavailable: { ...theme.typography.caption, color: theme.colors.textSecondary, fontStyle: 'italic' },

  input: {
    ...theme.typography.body, color: theme.colors.text,
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md, paddingVertical: 12,
  },
  codeInput: {
    ...theme.typography.title2, color: theme.colors.text, textAlign: 'center',
    letterSpacing: 8, backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border,
    paddingVertical: 12,
  },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary, lineHeight: 17 },
  tagBox: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    padding: theme.spacing.md, borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
  },
  tagText: { ...theme.typography.caption, color: theme.colors.brand, flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  cta: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 13,
    borderRadius: theme.radius.pill, backgroundColor: theme.colors.brand,
  },
  ctaOff: { opacity: 0.45 },
  ctaText: { ...theme.typography.callout, color: theme.colors.brandOn, fontWeight: '700' },
  secondary: {
    alignItems: 'center', paddingVertical: 12, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  secondaryText: { ...theme.typography.callout, color: theme.colors.textSecondary },

  errorBanner: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.error,
  },
  errorText: { ...theme.typography.footnote, color: theme.colors.errorOn },
  noticeBanner: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)',
  },
  noticeText: { ...theme.typography.footnote, color: theme.colors.brand },
});
