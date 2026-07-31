import { io, Socket } from 'socket.io-client'

// Same-origin; Socket.IO shares the backend's HTTP listener.
const BASE = ''

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
