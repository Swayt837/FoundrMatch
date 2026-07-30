/**
 * One-to-one WebRTC call between two matched founders.
 *
 * The whole call lifecycle lives here so the screen is only presentation. Shape of
 * it, because WebRTC has a specific ordering that is easy to get subtly wrong:
 *
 * 1. Both sides open their camera/mic and create a peer connection.
 * 2. The **caller** waits for `call_accepted` before creating an offer. Offering to
 *    a peer that has not accepted wastes an ICE gathering round and, worse, starts
 *    sending media to someone who never agreed to be on camera.
 * 3. The **callee** answers the offer it receives.
 * 4. ICE candidates flow both ways as they are discovered, over the same relay.
 *
 * Two ordering hazards are handled explicitly:
 *
 * - **Candidates arriving before the remote description.** A candidate cannot be
 *   added until the description it belongs to exists, and on a fast network the
 *   first candidates land before the answer is applied. They are queued rather than
 *   dropped, because dropping them costs connectivity on exactly the networks that
 *   have least of it.
 * - **Signalling for a stale call.** Anything carrying a different `call_id` than
 *   the active one is ignored, so a previous call's late ICE cannot disturb the
 *   current one.
 *
 * The media is peer-to-peer: it never reaches the backend, which only relays
 * signalling (see `backend/realtime.py`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { api } from '@/src/api/client';
import { getSocket } from '@/src/lib/socket';
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  isSupported,
  mediaDevices,
} from '@/src/lib/webrtc';

export type CallStatus =
  | 'idle'
  | 'preparing'
  | 'ringing'
  | 'incoming'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'failed';

export interface UseCallOptions {
  matchId?: string;
  /** Set when arriving from an incoming-call notification. */
  incoming?: { callId: string; fromUserId: string; media: 'video' | 'audio' } | null;
}

interface CallConfig {
  ice_servers: any[];
  relay_configured: boolean;
}

const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302'] }];

export function useCall({ matchId, incoming }: UseCallOptions) {
  const [status, setStatus] = useState<CallStatus>(incoming ? 'incoming' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [relayConfigured, setRelayConfigured] = useState(true);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const callIdRef = useRef<string | null>(incoming?.callId ?? null);
  const isCallerRef = useRef(!incoming);
  const pendingCandidates = useRef<any[]>([]);
  const remoteDescriptionSet = useRef(false);
  const endedRef = useRef(false);

  const emit = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      socketRef.current?.emit(event, {
        match_id: matchId,
        call_id: callIdRef.current,
        ...payload,
      });
    },
    [matchId]
  );

  /** Release the camera and mic. Skipping this leaves the indicator light on. */
  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks?.().forEach((track: any) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
  }, []);

  const teardown = useCallback(
    (next: CallStatus) => {
      if (endedRef.current) return;
      endedRef.current = true;

      try {
        pcRef.current?.close();
      } catch {
        // Closing an already-closed connection is not an error worth surfacing.
      }
      pcRef.current = null;
      pendingCandidates.current = [];
      remoteDescriptionSet.current = false;
      stopLocalMedia();
      setRemoteStream(null);
      setStatus(next);
    },
    [stopLocalMedia]
  );

  const applyPendingCandidates = useCallback(async () => {
    const queued = pendingCandidates.current;
    pendingCandidates.current = [];
    for (const candidate of queued) {
      try {
        await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // A single unusable candidate is normal; the connection uses the others.
      }
    }
  }, []);

  const createPeerConnection = useCallback(
    (iceServers: any[], stream: any) => {
      const pc = new RTCPeerConnection({ iceServers });

      stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));

      // `ontrack` fires per track (audio, then video); both belong to one stream, so
      // the remote stream is assembled rather than replaced.
      pc.ontrack = (event: any) => {
        const incomingStream = event.streams?.[0];
        if (incomingStream) {
          setRemoteStream(incomingStream);
          return;
        }
        setRemoteStream((current: any) => {
          const merged = current ?? new MediaStream();
          merged.addTrack?.(event.track);
          return merged;
        });
      };

      pc.onicecandidate = (event: any) => {
        if (event.candidate) {
          emit('call_signal', { signal: { kind: 'candidate', candidate: event.candidate } });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') setStatus('connected');
        if (state === 'failed') {
          setError(
            relayConfigured
              ? 'The connection failed. Try again on a different network.'
              : 'Could not connect. This network needs a TURN relay, which is not configured.'
          );
          teardown('failed');
        }
        if (state === 'disconnected' || state === 'closed') {
          teardown('ended');
        }
      };

      pcRef.current = pc;
      return pc;
    },
    [emit, relayConfigured, teardown]
  );

  /** Open the camera/mic and the peer connection. Both sides run this. */
  const prepare = useCallback(
    async (media: 'video' | 'audio') => {
      if (!isSupported) {
        setError(
          'Video calls need a development build of the app — they are not available in Expo Go or over plain HTTP.'
        );
        setStatus('failed');
        return null;
      }

      setStatus('preparing');
      setError(null);

      let config: CallConfig;
      try {
        config = matchId
          ? await api.getMatchCallConfig(matchId)
          : await api.getCallConfig();
      } catch {
        // A missing config is not a reason to refuse the call: STUN alone works on
        // most home networks.
        config = { ice_servers: FALLBACK_ICE, relay_configured: false };
      }
      setRelayConfigured(config.relay_configured);

      let stream: any;
      try {
        stream = await mediaDevices.getUserMedia({
          audio: true,
          video: media === 'video' ? { facingMode: 'user' } : false,
        });
      } catch {
        setError('CoFound needs access to your camera and microphone to place a call.');
        setStatus('failed');
        return null;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraEnabled(media === 'video');

      return createPeerConnection(
        config.ice_servers?.length ? config.ice_servers : FALLBACK_ICE,
        stream
      );
    },
    [createPeerConnection, matchId]
  );

  /** Caller: ring the other founder. */
  const startCall = useCallback(
    async (media: 'video' | 'audio' = 'video') => {
      endedRef.current = false;
      isCallerRef.current = true;
      const pc = await prepare(media);
      if (!pc) return;

      setStatus('ringing');
      // The call id comes back on `call_ringing`; until then signalling has none to
      // quote, which is why the offer waits for acceptance anyway.
      socketRef.current?.emit('call_invite', { match_id: matchId, media });
    },
    [matchId, prepare]
  );

  /** Callee: accept a ringing call. */
  const acceptCall = useCallback(async () => {
    if (!incoming) return;
    endedRef.current = false;
    isCallerRef.current = false;
    callIdRef.current = incoming.callId;

    const pc = await prepare(incoming.media);
    if (!pc) return;

    setStatus('connecting');
    emit('call_accept');
  }, [emit, incoming, prepare]);

  const declineCall = useCallback(() => {
    emit('call_decline', { reason: 'declined' });
    teardown('ended');
  }, [emit, teardown]);

  const hangUp = useCallback(() => {
    // Told to the other side on every ending, so they never sit on a dead
    // connection waiting for a timeout.
    emit('call_end');
    teardown('ended');
  }, [emit, teardown]);

  const toggleMic = useCallback(() => {
    const tracks = localStreamRef.current?.getAudioTracks?.() ?? [];
    const next = !micEnabled;
    tracks.forEach((track: any) => {
      track.enabled = next;
    });
    setMicEnabled(next);
  }, [micEnabled]);

  const toggleCamera = useCallback(() => {
    const tracks = localStreamRef.current?.getVideoTracks?.() ?? [];
    if (!tracks.length) return;
    const next = !cameraEnabled;
    tracks.forEach((track: any) => {
      track.enabled = next;
    });
    setCameraEnabled(next);
  }, [cameraEnabled]);

  const switchCamera = useCallback(() => {
    // `_switchCamera` is react-native-webrtc's own extension; the browser has no
    // equivalent, so this is a no-op on web rather than an error.
    localStreamRef.current?.getVideoTracks?.().forEach((track: any) => {
      track._switchCamera?.();
    });
  }, []);

  // ===== Signalling =====

  useEffect(() => {
    if (!matchId) return;

    let cancelled = false;
    const listeners: [string, (payload: any) => void][] = [];

    const relevant = (payload: any) =>
      payload?.match_id === matchId &&
      // Late signalling from a previous call must not disturb this one.
      (!payload.call_id || !callIdRef.current || payload.call_id === callIdRef.current);

    (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;
      socketRef.current = socket;

      const on = (event: string, handler: (payload: any) => void) => {
        socket.on(event, handler);
        listeners.push([event, handler]);
      };

      on('call_ringing', (payload: any) => {
        if (payload?.match_id !== matchId) return;
        callIdRef.current = payload.call_id;
      });

      // Caller side: the callee is on board, so now make the offer.
      on('call_accepted', async (payload: any) => {
        if (!relevant(payload) || !isCallerRef.current || !pcRef.current) return;
        setStatus('connecting');
        try {
          const offer = await pcRef.current.createOffer({});
          await pcRef.current.setLocalDescription(offer);
          emit('call_signal', { signal: { kind: 'offer', description: offer } });
        } catch {
          setError('Could not start the call.');
          teardown('failed');
        }
      });

      on('call_declined', () => {
        setError('Call declined.');
        teardown('ended');
      });

      on('call_ended', () => teardown('ended'));

      on('call_error', (payload: any) => {
        if (payload?.match_id !== matchId) return;
        setError(
          payload.reason === 'not_authorized'
            ? 'You can only call founders you have matched with.'
            : 'The call could not be set up.'
        );
        teardown('failed');
      });

      on('call_signal', async (payload: any) => {
        if (!relevant(payload) || !pcRef.current) return;
        const signal = payload.signal;

        try {
          if (signal?.kind === 'offer') {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription(signal.description)
            );
            remoteDescriptionSet.current = true;
            await applyPendingCandidates();

            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);
            emit('call_signal', { signal: { kind: 'answer', description: answer } });
            return;
          }

          if (signal?.kind === 'answer') {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription(signal.description)
            );
            remoteDescriptionSet.current = true;
            await applyPendingCandidates();
            return;
          }

          if (signal?.kind === 'candidate' && signal.candidate) {
            // Queue until there is a description to attach the candidate to.
            if (!remoteDescriptionSet.current) {
              pendingCandidates.current.push(signal.candidate);
              return;
            }
            await pcRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
        } catch {
          setError('The connection could not be negotiated.');
          teardown('failed');
        }
      });
    })();

    return () => {
      cancelled = true;
      const socket = socketRef.current;
      listeners.forEach(([event, handler]) => socket?.off(event, handler));
    };
  }, [applyPendingCandidates, emit, matchId, teardown]);

  // Leaving the screen must release the camera and tell the other side.
  useEffect(() => {
    return () => {
      if (!endedRef.current) {
        socketRef.current?.emit('call_end', {
          match_id: matchId,
          call_id: callIdRef.current,
        });
      }
      pcRef.current?.close?.();
      localStreamRef.current?.getTracks?.().forEach((track: any) => track.stop());
    };
    // Intentionally on unmount only — this is the release path, not a reaction to
    // state, and re-running it on every status change would kill live calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    error,
    localStream,
    remoteStream,
    micEnabled,
    cameraEnabled,
    relayConfigured,
    isSupported,
    startCall,
    acceptCall,
    declineCall,
    hangUp,
    toggleMic,
    toggleCamera,
    switchCamera,
  };
}
