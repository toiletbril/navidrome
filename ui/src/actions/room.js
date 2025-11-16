// Room action types - unified to eliminate state synchronization issues
export const ROOM_UPDATE = 'ROOM_UPDATE'  // Handles create, join, state/queue/participant updates
export const ROOM_LEAVE = 'ROOM_LEAVE'
export const ROOM_SET_ERROR = 'ROOM_SET_ERROR'
export const ROOM_CLEAR_ERROR = 'ROOM_CLEAR_ERROR'

// Action creators
export const updateRoom = (roomData) => ({
  type: ROOM_UPDATE,
  data: roomData,
})

export const leaveRoom = () => ({
  type: ROOM_LEAVE,
})

export const setRoomError = (error) => ({
  type: ROOM_SET_ERROR,
  data: { error },
})

export const clearRoomError = () => ({
  type: ROOM_CLEAR_ERROR,
})
