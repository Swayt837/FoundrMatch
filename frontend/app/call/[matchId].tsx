/**
 * Video / audio call with a matched founder.
 *
 * Reached two ways: outbound from the chat header, and inbound from the incoming-call
 * banner. The difference is one route param (`callId`), which is what tells this
 * screen whether it is ringing someone or being rung.
 *
 * All the WebRTC lifecycle is in `useCall`; this file is the surface.
 */
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  Phone,
  SwitchCamera,
  ShieldAlert,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { CallVideo } from '@/src/components/CallVideo';
import { useCall } from '@/src/hooks/use-call';
import { theme } from '@/src/theme';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Starting…',
  preparing: 'Opening your camera…',
  ringing: 'Ringing…',
  incoming: 'Incoming call',
  connecting: 'Connecting…',
  connected: 'Connected',
  ended: 'Call ended',
  failed: 'Call failed',
};

export default function CallScreen() {
  const { matchId, callId, fromUserId, media, name } = useLocalSearchParams<{
    matchId: string;
    callId?: string;
    fromUserId?: string;
    media?: string;
    name?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isIncoming = !!callId;
  const call = useCall({
    matchId,
    incoming: isIncoming
      ? {
          callId: callId!,
          fromUserId: fromUserId ?? '',
          media: media === 'audio' ? 'audio' : 'video',
        }
      : null,
  });

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // An outbound call starts ringing as soon as the screen opens; an inbound one waits
  // for the user to accept, because opening someone's camera unasked is not on.
  useEffect(() => {
    if (!isIncoming && call.status === 'idle') {
      call.startCall(media === 'audio' ? 'audio' : 'video');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIncoming, call.status]);

  // Once the call is over, get off this screen rather than showing a dead surface.
  useEffect(() => {
    if (call.status !== 'ended') return;
    const timer = setTimeout(() => router.back(), 1200);
    return () => clearTimeout(timer);
  }, [call.status, router]);

  const peerName = name || 'Your cofounder';
  const showRemote = call.status === 'connected' && !!call.remoteStream;

  return (
    <View style={styles.container} testID="call-screen">
      {/* Remote feed fills the screen; the local preview is a thumbnail over it. */}
      {showRemote ? (
        <CallVideo
          stream={call.remoteStream}
          objectFit="cover"
          style={styles.remote}
          testID="call-remote-video"
        />
      ) : (
        <View style={[styles.remote, styles.remotePlaceholder]}>
          <Text style={styles.peerName}>{peerName}</Text>
          <Text style={styles.statusText}>{STATUS_LABEL[call.status] ?? ''}</Text>
          {(call.status === 'preparing' ||
            call.status === 'ringing' ||
            call.status === 'connecting') && (
            <ActivityIndicator color={theme.colors.brand} style={styles.spinner} />
          )}
        </View>
      )}

      {!!call.localStream && call.cameraEnabled && (
        <CallVideo
          stream={call.localStream}
          mirror
          objectFit="cover"
          style={[styles.local, { top: insets.top + 16 }]}
          testID="call-local-video"
        />
      )}

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.header}>
          <Text style={styles.headerName}>{peerName}</Text>
          <Text style={styles.headerStatus}>{STATUS_LABEL[call.status] ?? ''}</Text>
        </View>

        {/* No TURN relay means calls fail on restrictive networks. Saying so up front
            beats an unexplained failure thirty seconds in. */}
        {!call.relayConfigured && call.status !== 'connected' && (
          <View style={styles.notice} testID="call-relay-notice">
            <ShieldAlert size={14} color={theme.colors.brand} strokeWidth={1.75} />
            <Text style={styles.noticeText}>
              No relay server configured — calls may not connect on mobile data or
              behind a corporate firewall.
            </Text>
          </View>
        )}

        {!!call.error && (
          <View style={styles.errorBanner} testID="call-error">
            <Text style={styles.errorText}>{call.error}</Text>
          </View>
        )}

        <View style={styles.controls}>
          {call.status === 'incoming' ? (
            <>
              <TouchableOpacity
                style={[styles.controlButton, styles.declineButton]}
                onPress={() => {
                  haptic();
                  call.declineCall();
                }}
                testID="call-decline"
              >
                <PhoneOff size={22} color={theme.colors.errorOn} strokeWidth={2} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.controlButton, styles.answerButton]}
                onPress={() => {
                  haptic();
                  call.acceptCall();
                }}
                testID="call-accept"
              >
                <Phone size={22} color={theme.colors.brandOn} strokeWidth={2} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.controlButton, !call.micEnabled && styles.controlButtonOff]}
                onPress={call.toggleMic}
                testID="call-toggle-mic"
              >
                {call.micEnabled ? (
                  <Mic size={20} color={theme.colors.text} strokeWidth={1.75} />
                ) : (
                  <MicOff size={20} color={theme.colors.errorOn} strokeWidth={1.75} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.controlButton, !call.cameraEnabled && styles.controlButtonOff]}
                onPress={call.toggleCamera}
                testID="call-toggle-camera"
              >
                {call.cameraEnabled ? (
                  <VideoIcon size={20} color={theme.colors.text} strokeWidth={1.75} />
                ) : (
                  <VideoOff size={20} color={theme.colors.errorOn} strokeWidth={1.75} />
                )}
              </TouchableOpacity>

              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={call.switchCamera}
                  testID="call-switch-camera"
                >
                  <SwitchCamera size={20} color={theme.colors.text} strokeWidth={1.75} />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.controlButton, styles.declineButton]}
                onPress={() => {
                  haptic();
                  call.hangUp();
                  router.back();
                }}
                testID="call-hangup"
              >
                <PhoneOff size={22} color={theme.colors.errorOn} strokeWidth={2} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  remote: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  remotePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
  },
  peerName: { ...theme.typography.title2, color: theme.colors.text },
  statusText: { ...theme.typography.callout, color: theme.colors.textSecondary },
  spinner: { marginTop: theme.spacing.md },
  local: {
    position: 'absolute',
    right: 16,
    width: 108,
    height: 148,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  overlay: { flex: 1, justifyContent: 'space-between' },
  header: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md },
  headerName: { ...theme.typography.headline, color: theme.colors.text },
  headerStatus: { ...theme.typography.caption, color: theme.colors.textSecondary },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.xl,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.brandTertiary,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
  },
  noticeText: { ...theme.typography.caption, color: theme.colors.brand, flex: 1, lineHeight: 16 },
  errorBanner: {
    marginHorizontal: theme.spacing.xl,
    marginTop: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.4)',
  },
  errorText: { ...theme.typography.footnote, color: theme.colors.errorOn },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  controlButtonOff: { backgroundColor: 'rgba(220,38,38,0.18)' },
  declineButton: {
    backgroundColor: 'rgba(220,38,38,0.22)',
    borderColor: 'rgba(220,38,38,0.5)',
  },
  answerButton: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
});
