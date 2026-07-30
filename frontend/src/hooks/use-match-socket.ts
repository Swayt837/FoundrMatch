/**
 * Real-time chat for a single match.
 *
 * Joins the match room on mount, leaves it on unmount, and surfaces incoming
 * messages, typing indicators and read receipts to the chat screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket } from '@/src/lib/socket';

export interface IncomingMessage {
  message_id: string;
  match_id: string;
  sender_id: string;
  content: string;
  type: string;
  read: boolean;
  created_at: string;
}

interface Options {
  matchId?: string;
  /** Called for every message broadcast in this match, including your own echo. */
  onMessage?: (message: IncomingMessage) => void;
  /** Called when the other participant has read your messages. */
  onRead?: (readerId: string) => void;
}

const TYPING_TIMEOUT = 3000;

export function useMatchSocket({ matchId, onMessage, onRead }: Options) {
  const [connected, setConnected] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  // Keep the latest callbacks in refs so re-renders don't re-subscribe.
  const onMessageRef = useRef(onMessage);
  const onReadRef = useRef(onRead);
  onMessageRef.current = onMessage;
  onReadRef.current = onRead;

  useEffect(() => {
    if (!matchId) return;

    let cancelled = false;
    let socket: Socket | null = null;

    const handleConnect = () => {
      setConnected(true);
      socket?.emit('join_match', { match_id: matchId });
    };

    const handleDisconnect = () => setConnected(false);

    const handleMessage = (message: IncomingMessage) => {
      if (message?.match_id !== matchId) return;
      setPeerTyping(false);
      onMessageRef.current?.(message);
    };

    const handleTyping = (data: { match_id?: string; typing?: boolean }) => {
      if (data?.match_id && data.match_id !== matchId) return;
      setPeerTyping(data?.typing !== false);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setPeerTyping(false), TYPING_TIMEOUT);
    };

    const handleRead = (data: { match_id?: string; reader_id?: string }) => {
      if (data?.match_id !== matchId) return;
      if (data.reader_id) onReadRef.current?.(data.reader_id);
    };

    (async () => {
      socket = await getSocket();
      if (!socket || cancelled) return;

      socketRef.current = socket;

      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.on('new_message', handleMessage);
      socket.on('user_typing', handleTyping);
      socket.on('messages_read', handleRead);

      if (socket.connected) handleConnect();
    })();

    return () => {
      cancelled = true;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (!socket) return;

      socket.emit('leave_match', { match_id: matchId });
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('new_message', handleMessage);
      socket.off('user_typing', handleTyping);
      socket.off('messages_read', handleRead);
      socketRef.current = null;
    };
  }, [matchId]);

  /** Broadcast that the user is typing, throttled to one event per second. */
  const notifyTyping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !matchId) return;

    const now = Date.now();
    if (now - lastTypingSent.current < 1000) return;
    lastTypingSent.current = now;
    socket.emit('typing', { match_id: matchId, typing: true });
  }, [matchId]);

  return { connected, peerTyping, notifyTyping };
}
