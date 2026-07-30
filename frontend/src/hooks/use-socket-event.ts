/**
 * Subscribe to a single Socket.io event for the lifetime of a component.
 *
 * Used by screens that need push-style updates without joining a match room —
 * the matches list refreshing its unread badges, for example.
 */
import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket } from '@/src/lib/socket';

export function useSocketEvent<T = any>(
  event: string,
  handler: (payload: T) => void,
  enabled: boolean = true
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let socket: Socket | null = null;
    const listener = (payload: T) => handlerRef.current?.(payload);

    (async () => {
      socket = await getSocket();
      if (!socket || cancelled) return;
      socket.on(event, listener);
    })();

    return () => {
      cancelled = true;
      socket?.off(event, listener);
    };
  }, [event, enabled]);
}
