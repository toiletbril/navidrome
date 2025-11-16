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
 *     userId: string | null           - User who triggered last state change
 *   }
 *
 * Action Types:
 *   - ROOM_CREATE: User creates a new room
 *   - ROOM_JOIN: User joins an existing room
 *   - ROOM_LEAVE: User leaves current room (resets to initialState)
 *   - ROOM_UPDATE_STATE: Update room state (playback or metadata)
 *   - ROOM_QUEUE_CHANGED: Queue synchronized from server
 *   - ROOM_HOST_CONTROL_CHANGED: Host control mode toggled
 *   - ROOM_SET_ERROR / ROOM_CLEAR_ERROR: Error handling
 *   - ROOM_USER_JOINED / ROOM_USER_LEFT: Participant list updates
 *
 * SSE Event Types (handled as string types):
 *   - 'roomStateChange': Remote playback state update (includes userId)
 *   - 'roomQueueChanged': Queue changed by another user
 *   - 'roomHostControlChanged': Host control mode toggled
 *   - 'roomParticipantKicked': User was kicked from room
 *   - 'roomUserJoined': Another user joined the room
 *   - 'roomUserLeft': Another user left the room
 *
 * Permission Model:
 *   - canControl = !hostControlOnly || isHost
 *   - Host can always kick participants (even in fluffy party mode)
 *   - When host leaves, room becomes democratic (hostUserId = null, hostControlOnly = false)
 */
import {
  ROOM_CREATE,
  ROOM_JOIN,
  ROOM_LEAVE,
  ROOM_UPDATE_STATE,
  ROOM_QUEUE_CHANGED,
  ROOM_HOST_CONTROL_CHANGED,
  ROOM_SET_ERROR,
  ROOM_CLEAR_ERROR,
  ROOM_USER_JOINED,
  ROOM_USER_LEFT,
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
}

const reduceCreateRoom = (state, { data }) => {
  const currentUserId = getUserId()
  const newState = {
    ...state,
    roomId: data.id || data.roomId,
    roomName: data.name || data.roomName,
    hostUserId: data.hostUserId || currentUserId,
    hostControlOnly: data.hostControlOnly !== undefined ? data.hostControlOnly : true,
    isHost: true,
    isInRoom: true,
    participants: data.participants || [],
    sharedQueue: data.queueItems || [],
    currentIndex: data.currentIndex || 0,
    error: null,
  }
  newState.canControl = computeCanControl(newState.hostControlOnly, newState.hostUserId)
  return newState
}

const reduceJoinRoom = (state, { data }) => {
  const currentUserId = getUserId()
  const newState = {
    ...state,
    roomId: data.id || data.roomId,
    roomName: data.name || data.roomName,
    hostUserId: data.hostUserId,
    hostControlOnly: data.hostControlOnly !== undefined ? data.hostControlOnly : true,
    isHost: data.hostUserId === currentUserId,
    isInRoom: true,
    participants: data.participants || [],
    sharedQueue: data.queueItems || [],
    currentIndex: data.currentIndex || 0,
    currentTrackId: data.currentTrackId,
    currentPosition: data.currentPosition || 0,
    isPlaying: data.isPlaying || false,
    error: null,
  }
  newState.canControl = computeCanControl(newState.hostControlOnly, newState.hostUserId)
  return newState
}

const reduceLeaveRoom = () => {
  return {
    ...initialState,
  }
}

const reduceUpdateRoomState = (state, { data }) => {
  console.log('[RoomReducer] State update received:', data, 'Current state:', state)
  const newState = {
    ...state,
    ...data,
    error: null,
  }

  // If we have a roomId, we're in a room
  if (newState.roomId) {
    newState.isInRoom = true
  }

  // Recompute permissions if host or control mode changed
  if (data.hostUserId !== undefined || data.hostControlOnly !== undefined) {
    const currentUserId = getUserId()
    newState.isHost = newState.hostUserId === currentUserId
    newState.canControl = computeCanControl(newState.hostControlOnly, newState.hostUserId)
  }
  return newState
}

const reduceQueueChanged = (state, { data }) => {
  console.log('[RoomReducer] Queue changed:', data)
  return {
    ...state,
    sharedQueue: data.queueItems,
    currentIndex: data.currentIndex,
    userId: data.userId,
  }
}

const reduceHostControlChanged = (state, { data }) => {
  console.log('[RoomReducer] Host control changed:', data.hostControlOnly)
  const newState = {
    ...state,
    hostControlOnly: data.hostControlOnly,
  }
  newState.canControl = computeCanControl(newState.hostControlOnly, newState.hostUserId)
  return newState
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

const reduceUserJoined = (state, { data }) => {
  console.log('[RoomReducer] User joined event received:', data)
  const participants = [...state.participants]
  // SSE events send userId and userName directly
  const newParticipant = {
    userId: data.userId,
    userName: data.userName,
    roomId: data.roomId,
  }
  if (!participants.find((p) => p.userId === data.userId)) {
    participants.push(newParticipant)
  }
  return {
    ...state,
    participants,
  }
}

const reduceUserLeft = (state, { data }) => {
  const participants = state.participants.filter((p) => p.userId !== data.userId)
  return {
    ...state,
    participants,
  }
}

export const roomReducer = (previousState = initialState, payload) => {
  const { type } = payload
  switch (type) {
    case ROOM_CREATE:
      return reduceCreateRoom(previousState, payload)
    case ROOM_JOIN:
      return reduceJoinRoom(previousState, payload)
    case ROOM_LEAVE:
      return reduceLeaveRoom()
    case ROOM_UPDATE_STATE:
      return reduceUpdateRoomState(previousState, payload)
    case ROOM_QUEUE_CHANGED:
      return reduceQueueChanged(previousState, payload)
    case ROOM_HOST_CONTROL_CHANGED:
      return reduceHostControlChanged(previousState, payload)
    case ROOM_SET_ERROR:
      return reduceSetError(previousState, payload)
    case ROOM_CLEAR_ERROR:
      return reduceClearError(previousState)
    case ROOM_USER_JOINED:
      return reduceUserJoined(previousState, payload)
    case ROOM_USER_LEFT:
      return reduceUserLeft(previousState, payload)
    // SSE events (lowercase)
    case 'roomStateChange':
      return reduceUpdateRoomState(previousState, payload)
    case 'roomQueueChanged':
      return reduceQueueChanged(previousState, payload)
    case 'roomHostControlChanged':
      return reduceHostControlChanged(previousState, payload)
    case 'roomParticipantKicked':
      return reduceParticipantKicked(previousState, payload)
    case 'roomUserJoined':
      return reduceUserJoined(previousState, payload)
    case 'roomUserLeft':
      return reduceUserLeft(previousState, payload)
    default:
      return previousState
  }
}
