'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './auth-client';

// Realtime connects directly to the API origin's /rt namespace (websockets aren't
// proxied through the Next rewrite). Override with NEXT_PUBLIC_API_WS_URL in prod.
const WS_ORIGIN = process.env.NEXT_PUBLIC_API_WS_URL || 'http://localhost:4000';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket && socket.connected) return socket;
  socket = io(`${WS_ORIGIN}/rt`, {
    auth: { token: getAccessToken() ?? '' },
    transports: ['websocket'],
    autoConnect: true,
  });
  return socket;
}

export function closeSocket(): void {
  socket?.close();
  socket = null;
}
