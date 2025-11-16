// Room action types
export const ROOM_CREATE = 'ROOM_CREATE'
export const ROOM_JOIN = 'ROOM_JOIN'
export const ROOM_LEAVE = 'ROOM_LEAVE'
export const ROOM_UPDATE_STATE = 'ROOM_UPDATE_STATE'
export const ROOM_QUEUE_CHANGED = 'ROOM_QUEUE_CHANGED'
export const ROOM_HOST_CONTROL_CHANGED = 'ROOM_HOST_CONTROL_CHANGED'
export const ROOM_SET_ERROR = 'ROOM_SET_ERROR'
export const ROOM_CLEAR_ERROR = 'ROOM_CLEAR_ERROR'
export const ROOM_USER_JOINED = 'ROOM_USER_JOINED'
export const ROOM_USER_LEFT = 'ROOM_USER_LEFT'

// Action creators
export const createRoom = (roomName) => ({
  type: ROOM_CREATE,
  data: { roomName },
})

export const joinRoom = (roomId) => ({
  type: ROOM_JOIN,
  data: { roomId },
})

export const leaveRoom = () => ({
  type: ROOM_LEAVE,
})

export const updateRoomState = (state) => ({
  type: ROOM_UPDATE_STATE,
  data: state,
})

export const setRoomError = (error) => ({
  type: ROOM_SET_ERROR,
  data: { error },
})

export const clearRoomError = () => ({
  type: ROOM_CLEAR_ERROR,
})

export const roomUserJoined = (user) => ({
  type: ROOM_USER_JOINED,
  data: { user },
})

export const roomUserLeft = (userId) => ({
  type: ROOM_USER_LEFT,
  data: { userId },
})
