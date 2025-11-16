package nativeapi

import (
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
)

// canControlPlayback checks if a user can control playback (play, pause, seek, queue operations)
// Returns true if:
// - Room is in fluffy party mode (HostControlOnly = false), OR
// - User is the room host
func canControlPlayback(userID string, room *model.Room) bool {
	if !room.HostControlOnly {
		log.Debug("Permission check: fluffy party mode enabled, user can control", "userId", userID, "roomId", room.ID)
		return true // Fluffy party mode - everyone can control
	}
	canControl := userID == room.HostUserID
	log.Debug("Permission check: host control mode", "userId", userID, "hostUserId", room.HostUserID, "canControl", canControl, "roomId", room.ID)
	return canControl // Host control mode - only host
}

// isHost checks if a user is the room host
func isHost(userID string, room *model.Room) bool {
	isRoomHost := userID == room.HostUserID
	log.Debug("Permission check: isHost", "userId", userID, "hostUserId", room.HostUserID, "isHost", isRoomHost, "roomId", room.ID)
	return isRoomHost
}
