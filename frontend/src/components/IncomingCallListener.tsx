/**
 * App-wide listener for incoming calls.
 *
 * The server rings the callee's *personal* socket room, not the match room, so a
 * call has to be answerable from anywhere in the app — the discovery deck, the
 * projects board, wherever. This component is mounted once at the root and routes to
 * the call screen when a call arrives.
 *
 * It renders nothing itself: the call screen owns the answer/decline UI, so there is
 * one place where a call is presented rather than two that can disagree.
 */
import { useRef } from 'react';
import { useRouter } from 'expo-router';

import { useSocketEvent } from '@/src/hooks/use-socket-event';

interface IncomingCall {
  call_id?: string;
  match_id?: string;
  from_user_id?: string;
  media?: 'video' | 'audio';
}

export function IncomingCallListener() {
  const router = useRouter();
  // Socket.io can redeliver on reconnect; the same call must not push the screen
  // twice. Call ids are server-minted uuids, so remembering the last one is enough —
  // an id never comes back for a different call.
  const handled = useRef<string | null>(null);

  useSocketEvent<IncomingCall>('call_incoming', (payload) => {
    if (!payload?.call_id || !payload.match_id) return;
    if (handled.current === payload.call_id) return;
    handled.current = payload.call_id;

    router.push({
      pathname: '/call/[matchId]',
      params: {
        matchId: payload.match_id,
        callId: payload.call_id,
        fromUserId: payload.from_user_id ?? '',
        media: payload.media ?? 'video',
      },
    });
  });

  return null;
}
