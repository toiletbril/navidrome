/**
 * Syncplay Room Redux Reducer
 *
 * Manages Redux state for syncplay rooms including room metadata, participants,
 * queue synchronization, and real-time playback state.
 *
 * State Shape:
 *   {
 *     roomId: string | null           - Current room ID
 *     roomName: string | null         - Room name
 *     hostUserId: string | null       - Room host's user ID (empty = democratic)
 *     hostControlOnly: boolean        - true = host only, false = fluffy party mode
 *     isHost: boolean                 - Whether current user is host
 *     canControl: boolean             - Whether current user can control playback/queue
 *     isInRoom: boolean               - Whether user is currently in a room
 *     participants: array             - List of {userId, userName, roomId}
 *     sharedQueue: array              - Room's shared queue (track IDs)
 *     currentIndex: number            - Current playing track index in queue
 *     error: string | null            - Last error message
 *     currentTrackId: string | null   - Currently synced track ID
 *     currentPosition: number         - Playback position in milliseconds
 *     isPlaying: boolean              - Playback state
 *   }
 *
 * Action Types:
 *   - ROOM_UPDATE: Unified event that updates entire room state (both local and SSE)
 *   - ROOM_LEAVE: User leaves current room (resets to initialState)
 *   - ROOM_SET_ERROR / ROOM_CLEAR_ERROR: Error handling
 *
 * SSE Event Types:
 *   - 'roomUpdate': Complete room state update from server
 *   - 'roomParticipantKicked': User was kicked from room
 *
 * Permission Model:
 *   - canControl = !hostControlOnly || isHost
 *   - Host can always kick participants (even in fluffy party mode)
 *   - When host leaves, room becomes democratic (hostUserId = null, hostControlOnly = false)
 */
import {
  ROOM_UPDATE,
  ROOM_LEAVE,
  ROOM_SET_ERROR,
  ROOM_CLEAR_ERROR,
} from '../actions'

const getUserId = () => {
  return localStorage.getItem('userId') || null
}

const computeCanControl = (hostControlOnly, hostUserId) => {
  if (!hostControlOnly) return true // Fluffy party mode
  const currentUserId = getUserId()
  return currentUserId === hostUserId // Host control mode - only host can control
}

const initialState = {
  roomId: null,
  roomName: null,
  hostUserId: null,
  hostControlOnly: true, // Default: host control enabled
  isHost: false,
  canControl: false,
  isInRoom: false,
  participants: [],
  sharedQueue: [],
  currentIndex: 0,
  error: null,
  currentTrackId: null,
  currentPosition: 0,
  isPlaying: false,
  userId: null,
  lastUpdateTimestamp: null, // Track when position was last updated (for drift calculation)
}

// Single unified reducer for all room updates (create, join, state changes, queue changes, etc.)
// This replaces fragmented reducers to eliminate state synchronization issues
const reduceRoomUpdate = (state, { data }) => {
  console.log('[RoomReducer] Room update received:', data)

  const currentUserId = getUserId()
  const newState = {
    ...state,
    roomId: data.id || data.roomId,
    roomName: data.name || data.roomName,
    hostUserId: data.hostUserId,
    hostControlOnly: data.hostControlOnly !== undefined ? data.hostControlOnly : true,
    isInRoom: true,
    participants: data.participants || [],
    sharedQueue: data.queueItems || [],
    currentIndex: data.currentIndex !== undefined ? data.currentIndex : 0,
    currentTrackId: data.currentTrackId,
    currentPosition: data.currentPosition !== undefined ? data.currentPosition : 0,
    isPlaying: data.isPlaying !== undefined ? data.isPlaying : false,
    error: null,
    lastUpdateTimestamp: Date.now(), // Track when this update arrived
  }

  // Compute derived state
  newState.isHost = newState.hostUserId === currentUserId
  newState.canControl = computeCanControl(newState.hostControlOnly, newState.hostUserId)

  console.log('[RoomReducer] Updated state:', 'roomId:', newState.roomId, 'isHost:', newState.isHost, 'canControl:', newState.canControl, 'participants:', newState.participants.length, 'queue:', newState.sharedQueue.length)
  return newState
}

const reduceLeaveRoom = () => {
  console.log('[RoomReducer] Left room, resetting state')
  return {
    ...initialState,
  }
}

const reduceParticipantKicked = (state, { data }) => {
  const currentUserId = getUserId()
  // If we were kicked, leave room
  if (data.kickedUserId === currentUserId) {
    console.log('[RoomReducer] You were kicked from the room')
    // Show notification (handled by UI layer)
    return {
      ...initialState,
      error: 'You were kicked from the room',
    }
  }
  // Otherwise, remove the kicked participant from list
  return {
    ...state,
    participants: state.participants.filter(p => p.userId !== data.kickedUserId),
  }
}

const reduceSetError = (state, { data }) => {
  return {
    ...state,
    error: data.error,
  }
}

const reduceClearError = (state) => {
  return {
    ...state,
    error: null,
  }
}

export const roomReducer = (previousState = initialState, payload) => {
  const { type } = payload
  switch (type) {
    // Unified room update handles: create, join, state changes, queue changes, host control changes, user join/leave
    case ROOM_UPDATE:
    case 'roomUpdate':  // SSE event
      return reduceRoomUpdate(previousState, payload)
    case ROOM_LEAVE:
      return reduceLeaveRoom()
    case 'roomParticipantKicked':  // SSE event
      return reduceParticipantKicked(previousState, payload)
    case ROOM_SET_ERROR:
      return reduceSetError(previousState, payload)
    case ROOM_CLEAR_ERROR:
      return reduceClearError(previousState)
    default:
      return previousState
  }
}
