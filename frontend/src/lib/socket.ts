/**
 * Shared Socket.io connection.
 *
 * `socket.io-client` was a dependency from the start but was never imported, so
 * the server broadcast `new_message` into the void and the chat only updated on a
 * full screen reload. One socket is shared across the app and authenticated with
 * the same bearer token the REST client uses.
 */
import { io, Socket } from 'socket.io-client';
import { API_URL } from '@/src/api/client';
import { storage } from '@/src/utils/storage';

let socket: Socket | null = null;
let connectingFor: string | null = null;

/**
 * Connect (or reuse) the shared socket.
 *
 * Returns null when there is no backend URL or no stored token — callers should
 * treat real-time delivery as a bonus and keep working without it.
 */
export async function getSocket(): Promise<Socket | null> {
  if (!API_URL) return null;

  const token = await storage.secureGet('auth_token', null);
  if (!token) return null;

  // Reconnect from scratch when the account changed.
  if (socket && connectingFor !== token) {
    socket.disconnect();
    socket = null;
  }

  if (socket) return socket;

  connectingFor = token;
  socket = io(API_URL, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 10000,
  });

  if (__DEV__) {
    socket.on('connect_error', (err) => console.warn('[socket] connect_error', err.message));
  }

  return socket;
}

/** Drop the connection — called on sign-out so the next user gets a fresh socket. */
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  connectingFor = null;
}
