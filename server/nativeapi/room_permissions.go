package nativeapi

import (
	"github.com/navidrome/navidrome/model"
)

// canControlPlayback checks if a user can control playback (play, pause, seek, queue operations)
// Returns true if:
// - Room is in fluffy party mode (HostControlOnly = false), OR
// - User is the room host
func canControlPlayback(userID string, room *model.Room) bool {
	if !room.HostControlOnly {
		return true // Fluffy party mode - everyone can control
	}
	return userID == room.HostUserID // Host control mode - only host
}

// isHost checks if a user is the room host
func isHost(userID string, room *model.Room) bool {
	return userID == room.HostUserID
}
