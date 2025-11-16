/**
 * Syncplay Room Service API Client
 *
 * Provides HTTP client methods for interacting with Navidrome's syncplay room API.
 * All methods return promises that resolve with room data or reject with errors.
 *
 * API Endpoints:
 *   - GET /api/rooms              - List all active rooms
 *   - POST /api/room              - Create new room
 *   - GET /api/room?id=...        - Get room details
 *   - POST /api/room/join?id=...  - Join existing room
 *   - DELETE /api/room/leave      - Leave current room
 *   - POST /api/room/state        - Update room playback state (permission check)
 *   - PUT /api/room/settings      - Toggle host control mode (host only)
 *   - POST /api/room/queue        - Replace entire queue (permission check)
 *   - PUT /api/room/queue/add     - Add tracks to queue (permission check)
 *   - DELETE /api/room/queue/remove?index=N - Remove track from queue (permission check)
 *   - DELETE /api/room/participant?userId=X - Kick participant (host only)
 *
 * Response Format:
 *   Room objects include:
 *     - id: string (room ID)
 *     - name: string (room name)
 *     - hostUserId: string (host's user ID, empty = democratic)
 *     - hostControlOnly: boolean (true = host only, false = fluffy party)
 *     - participants: array of {userId, userName, joinedAt}
 *     - queueItems: array of track IDs
 *     - currentIndex: number (current playing track index)
 *     - currentTrackId: string (currently synced track)
 *     - currentPosition: number (position in milliseconds)
 *     - isPlaying: boolean (playback state)
 *
 * Permission Model:
 *   - canControl = !hostControlOnly || isHost
 *   - Host can always kick participants (even in fluffy party mode)
 *   - When host leaves, room becomes democratic
 *
 * Usage:
 *   import { roomService } from './roomService'
 *
 *   // List rooms
 *   const rooms = await roomService.listRooms()
 *
 *   // Create room (default: host control enabled)
 *   const room = await roomService.create('My Room')
 *
 *   // Join room
 *   const room = await roomService.join('room-id-here')
 *
 *   // Toggle fluffy party mode (host only)
 *   await roomService.toggleHostControl(false) // Enable fluffy party
 *
 *   // Update queue (permission check)
 *   await roomService.updateQueue(['track1', 'track2'], 0)
 *
 *   // Kick participant (host only)
 *   await roomService.kickParticipant('user-id')
 *
 *   // Leave room
 *   await roomService.leave()
 */
import httpClient from '../dataProvider/httpClient'
import { REST_URL } from '../consts'

export const roomService = {
  listRooms: async () => {
    const response = await httpClient(`${REST_URL}/rooms`, {
      method: 'GET',
    })
    return response.json
  },

  create: async (name) => {
    const response = await httpClient(`${REST_URL}/room`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    return response.json
  },

  get: async (roomId) => {
    const response = await httpClient(`${REST_URL}/room?id=${roomId}`, {
      method: 'GET',
    })
    return response.json
  },

  join: async (roomId) => {
    const response = await httpClient(`${REST_URL}/room/join?id=${roomId}`, {
      method: 'POST',
    })
    return response.json
  },

  leave: async () => {
    await httpClient(`${REST_URL}/room/leave`, {
      method: 'DELETE',
    })
  },

  updateState: async (state) => {
    const response = await httpClient(`${REST_URL}/room/state`, {
      method: 'POST',
      body: JSON.stringify(state),
    })
    return response.json
  },

  toggleHostControl: async (hostControlOnly) => {
    const response = await httpClient(`${REST_URL}/room/settings`, {
      method: 'PUT',
      body: JSON.stringify({ hostControlOnly }),
    })
    return response.json
  },

  updateQueue: async (queueItems, currentIndex) => {
    await httpClient(`${REST_URL}/room/queue`, {
      method: 'POST',
      body: JSON.stringify({ queueItems, currentIndex }),
    })
  },

  addToQueue: async (trackIds) => {
    await httpClient(`${REST_URL}/room/queue/add`, {
      method: 'PUT',
      body: JSON.stringify({ trackIds }),
    })
  },

  removeFromQueue: async (index) => {
    await httpClient(`${REST_URL}/room/queue/remove?index=${index}`, {
      method: 'DELETE',
    })
  },

  kickParticipant: async (userId) => {
    await httpClient(`${REST_URL}/room/participant?userId=${userId}`, {
      method: 'DELETE',
    })
  },
}
