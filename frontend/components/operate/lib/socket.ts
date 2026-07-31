import { io, Socket } from 'socket.io-client'

// Socket.IO runs on the BACKEND's HTTP listener, so these connections must
// target the API origin — NOT the dashboard's. The Next.js server proxies
// /api/* to the backend but has no /socket.io handler, so a same-origin
// socket URL 404s and the live streams never connect.
//
// Cross-origin is expected here and already handled: the backend configures
// Socket.IO CORS against FRONTEND_ORIGIN. Empty string (same origin) is kept
// as the fallback for setups that front both on one host.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

const sockets = new Map<string, Socket>()

export function getMonitorSocket(connectionId: string): Socket {
  const key = `monitor-${connectionId}`
  if (!sockets.has(key)) {
    const socket = io(`${BASE}/monitor/${connectionId}`, {
      path: '/socket.io',
      auth: { token: localStorage.getItem('customdb.token') },
      transports: ['websocket'],
    })
    sockets.set(key, socket)
  }
  return sockets.get(key)!
}

export function disconnectSocket(connectionId: string) {
  const key = `monitor-${connectionId}`
  const socket = sockets.get(key)
  if (socket) {
    socket.disconnect()
    sockets.delete(key)
  }
}
