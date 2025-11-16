// Package nativeapi provides REST API endpoints for Navidrome's syncplay feature.
//
// Syncplay Room Management:
// This module implements a democratic room-based synchronization system where multiple
// users can listen to music together in real-time. Any participant can control playback
// (play, pause, seek) and changes are broadcast to all room members via SSE.
//
// Endpoints:
//   - POST /api/room        - Create a new room
//   - GET  /api/room?id=... - Get room details with participants
//   - POST /api/room/join?id=... - Join an existing room
//   - POST /api/room/leave  - Leave current room
//   - PUT  /api/room/state  - Update room playback state (democratic - anyone can update)
//
// Architecture:
//   - Uses Server-Sent Events (SSE) for real-time state broadcasting
//   - In-memory room storage via RoomRepository
//   - State includes: currentTrackId, currentPosition (ms), isPlaying, userId (for loop prevention)
//   - All state changes broadcast to all participants using SendBroadcastMessage
//
// Feedback Loop Prevention:
//   - Each RoomStateChange event includes the userId of who triggered it
//   - Clients skip applying their own broadcasts based on userId matching
package nativeapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/events"
)

// Helper to get participant IDs for room event filtering
func getRoomParticipantIDs(ctx context.Context, ds model.DataStore, roomID string) []string {
	participants, err := ds.Room(ctx).GetParticipants(roomID)
	if err != nil {
		log.Error(ctx, "Error getting room participants for broadcast", err)
		return nil
	}
	userIDs := make([]string, len(participants))
	for i, p := range participants {
		userIDs[i] = p.UserID
	}
	return userIDs
}

type createRoomPayload struct {
	Name string `json:"name"`
}

type updateRoomStatePayload struct {
	CurrentTrackID  *string `json:"currentTrackId,omitempty"`
	CurrentPosition *int64  `json:"currentPosition,omitempty"`
	IsPlaying       *bool   `json:"isPlaying,omitempty"`
}

func createRoom(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)

		var payload createRoomPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if payload.Name == "" {
			http.Error(w, "room name is required", http.StatusBadRequest)
			return
		}

		// Check if user is already in a room
		existingRoom, err := ds.Room(ctx).GetUserRoom(user.ID)
		if err == nil && existingRoom != nil {
			http.Error(w, "user already in a room", http.StatusConflict)
			return
		}

		room := &model.Room{
			Name:       payload.Name,
			HostUserID: user.ID,
			IsPlaying:  false,
		}

		if err := ds.Room(ctx).Create(room); err != nil {
			log.Error(ctx, "Error creating room", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "Room created", "roomId", room.ID, "roomName", room.Name, "hostUserId", user.ID, "hostControlOnly", room.HostControlOnly)

		// Add creator as participant
		if err := ds.Room(ctx).AddParticipant(room.ID, user.ID, user.UserName); err != nil {
			log.Error(ctx, "Error adding creator to room", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Get room with participants
		roomWithParticipants, err := ds.Room(ctx).GetWithParticipants(room.ID)
		if err != nil {
			log.Error(ctx, "Error getting room with participants", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(roomWithParticipants)
	}
}

func getRoom(ds model.DataStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		roomID := r.URL.Query().Get("id")

		if roomID == "" {
			http.Error(w, "room id is required", http.StatusBadRequest)
			return
		}

		room, err := ds.Room(ctx).GetWithParticipants(roomID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "room not found", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(room)
	}
}

func joinRoom(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)
		roomID := r.URL.Query().Get("id")

		if roomID == "" {
			http.Error(w, "room id is required", http.StatusBadRequest)
			return
		}

		// Check if room exists
		_, err := ds.Room(ctx).Get(roomID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "room not found", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		// Add user to room
		if err := ds.Room(ctx).AddParticipant(roomID, user.ID, user.UserName); err != nil {
			log.Error(ctx, "Error joining room", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Broadcast user joined event to room participants
		log.Info(ctx, "Broadcasting RoomUserJoined event", "roomId", roomID, "userId", user.ID, "userName", user.UserName)
		participantIDs := getRoomParticipantIDs(ctx, ds, roomID)
		broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
		broker.SendBroadcastMessage(broadcastCtx, &events.RoomUserJoined{
			RoomID:   roomID,
			UserID:   user.ID,
			UserName: user.UserName,
		})

		// Get room with participants
		roomWithParticipants, err := ds.Room(ctx).GetWithParticipants(roomID)
		if err != nil {
			log.Error(ctx, "Error getting room with participants", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "User joined room", "roomId", roomID, "currentTrackId", roomWithParticipants.CurrentTrackID, "currentPosition", roomWithParticipants.CurrentPosition, "isPlaying", roomWithParticipants.IsPlaying)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(roomWithParticipants)
	}
}

func leaveRoom(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)

		// Get user's current room
		room, err := ds.Room(ctx).GetUserRoom(user.ID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "not in a room", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting user room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		// If host is leaving, transition to democratic mode (remove host)
		wasHost := user.ID == room.HostUserID
		if wasHost {
			log.Info(ctx, "Host leaving room, transitioning to democratic mode", "roomId", room.ID, "userId", user.ID)
			room.HostUserID = ""              // Remove host
			room.HostControlOnly = false      // Force fluffy party mode
			if err := ds.Room(ctx).Update(room); err != nil {
				log.Error(ctx, "Error updating room on host leave", err)
			}

			// Broadcast host control changed to room participants
			participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)
			broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
			broker.SendBroadcastMessage(broadcastCtx, &events.RoomHostControlChanged{
				RoomID:          room.ID,
				HostControlOnly: false,
			})
		}

		// Get participant IDs BEFORE removing user
		participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)

		// Remove user from room
		if err := ds.Room(ctx).RemoveParticipant(room.ID, user.ID); err != nil {
			log.Error(ctx, "Error leaving room", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "User left room", "roomId", room.ID, "userId", user.ID, "wasHost", wasHost)

		// Broadcast user left event to room participants
		broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
		broker.SendBroadcastMessage(broadcastCtx, &events.RoomUserLeft{
			RoomID: room.ID,
			UserID: user.ID,
		})

		w.WriteHeader(http.StatusNoContent)
	}
}

// cleanupDisconnectedUser removes a user from their room when their SSE connection closes
func cleanupDisconnectedUser(ctx context.Context, ds model.DataStore, broker events.Broker, username string) {
	// Get user by username to find their ID
	// We can't use request.UserFrom(ctx) because this is called from SSE cleanup, not an HTTP request
	// So we need to query the user by username first
	user, err := ds.User(ctx).FindByUsername(username)
	if err != nil {
		log.Warn(ctx, "Could not find user for cleanup", "username", username, err)
		return
	}

	// Check if user is in any room
	room, err := ds.Room(ctx).GetUserRoom(user.ID)
	if err != nil {
		if err != model.ErrNotFound {
			log.Warn(ctx, "Error checking user room during cleanup", "username", username, err)
		}
		// User not in a room, nothing to clean up
		return
	}

	// Get participant IDs BEFORE removing user
	participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)

	// Remove user from room
	if err := ds.Room(ctx).RemoveParticipant(room.ID, user.ID); err != nil {
		log.Error(ctx, "Error removing disconnected user from room", "username", username, "roomId", room.ID, err)
		return
	}

	log.Info(ctx, "Cleaned up disconnected user from room", "username", username, "roomId", room.ID)

	// Broadcast user left event to remaining participants
	broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
	broker.SendBroadcastMessage(broadcastCtx, &events.RoomUserLeft{
		RoomID: room.ID,
		UserID: user.ID,
	})
}

func updateRoomState(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)

		// Get user's current room
		room, err := ds.Room(ctx).GetUserRoom(user.ID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "not in a room", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting user room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		// Check permissions
		if !canControlPlayback(user.ID, room) {
			http.Error(w, "permission denied: only host can control playback", http.StatusForbidden)
			return
		}

		var payload updateRoomStatePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Update room state
		if payload.CurrentTrackID != nil {
			room.CurrentTrackID = *payload.CurrentTrackID
		}
		if payload.CurrentPosition != nil {
			room.CurrentPosition = *payload.CurrentPosition
		}
		if payload.IsPlaying != nil {
			room.IsPlaying = *payload.IsPlaying
		}

		if err := ds.Room(ctx).Update(room); err != nil {
			log.Error(ctx, "Error updating room state", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Broadcast state change to room participants EXCEPT originator
		log.Info(ctx, "Broadcasting RoomStateChange event", "roomId", room.ID, "userId", user.ID, "trackId", room.CurrentTrackID, "position", room.CurrentPosition, "isPlaying", room.IsPlaying)
		participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)
		broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
		broadcastCtx = events.WithExcludeUserID(broadcastCtx, user.ID)
		broker.SendBroadcastMessage(broadcastCtx, &events.RoomStateChange{
			RoomID:          room.ID,
			CurrentTrackID:  room.CurrentTrackID,
			CurrentPosition: room.CurrentPosition,
			IsPlaying:       room.IsPlaying,
			UserID:          user.ID,
		})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(room)
	}
}

// List all active rooms
func listRooms(ds model.DataStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		rooms, err := ds.Room(ctx).GetAll()
		if err != nil {
			log.Error(ctx, "Error getting rooms", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		type RoomSummary struct {
			ID              string `json:"id"`
			Name            string `json:"name"`
			ParticipantCount int   `json:"participantCount"`
			HostControlOnly bool   `json:"hostControlOnly"`
		}

		summaries := make([]RoomSummary, 0, len(rooms))
		for _, room := range rooms {
			participants, _ := ds.Room(ctx).GetParticipants(room.ID)
			summaries = append(summaries, RoomSummary{
				ID:              room.ID,
				Name:            room.Name,
				ParticipantCount: len(participants),
				HostControlOnly: room.HostControlOnly,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(summaries)
	}
}

// Update room settings (host control toggle)
type updateSettingsPayload struct {
	HostControlOnly *bool `json:"hostControlOnly,omitempty"`
}

func updateSettings(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)

		// Get user's current room
		room, err := ds.Room(ctx).GetUserRoom(user.ID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "not in a room", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting user room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		// Only host can change settings
		if !isHost(user.ID, room) {
			http.Error(w, "permission denied: only host can change settings", http.StatusForbidden)
			return
		}

		var payload updateSettingsPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if payload.HostControlOnly != nil {
			if err := ds.Room(ctx).SetHostControlOnly(room.ID, *payload.HostControlOnly); err != nil {
				log.Error(ctx, "Error updating host control setting", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			room.HostControlOnly = *payload.HostControlOnly

			log.Info(ctx, "Room host control setting changed", "roomId", room.ID, "hostControlOnly", *payload.HostControlOnly, "userId", user.ID)

			// Broadcast settings changed to room participants
			participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)
			broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
			broker.SendBroadcastMessage(broadcastCtx, &events.RoomHostControlChanged{
				RoomID:          room.ID,
				HostControlOnly: *payload.HostControlOnly,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(room)
	}
}

// Update room queue
type roomQueuePayload struct {
	QueueItems   []string `json:"queueItems"`
	CurrentIndex int      `json:"currentIndex"`
}

func updateRoomQueue(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)

		// Get user's current room
		room, err := ds.Room(ctx).GetUserRoom(user.ID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "not in a room", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting user room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		// Check permissions
		if !canControlPlayback(user.ID, room) {
			http.Error(w, "permission denied: only host can control queue", http.StatusForbidden)
			return
		}

		var payload roomQueuePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Update queue
		if err := ds.Room(ctx).UpdateQueue(room.ID, payload.QueueItems, payload.CurrentIndex); err != nil {
			log.Error(ctx, "Error updating queue", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "Room queue updated", "roomId", room.ID, "userId", user.ID, "queueLength", len(payload.QueueItems), "currentIndex", payload.CurrentIndex)

		// Broadcast queue change to room participants EXCEPT originator
		participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)
		broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
		broadcastCtx = events.WithExcludeUserID(broadcastCtx, user.ID)
		broker.SendBroadcastMessage(broadcastCtx, &events.RoomQueueChanged{
			RoomID:       room.ID,
			QueueItems:   payload.QueueItems,
			CurrentIndex: payload.CurrentIndex,
			UserID:       user.ID,
		})

		w.WriteHeader(http.StatusNoContent)
	}
}

// Add tracks to queue
type addToRoomQueuePayload struct {
	TrackIDs []string `json:"trackIds"`
}

func addToRoomQueue(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)

		// Get user's current room
		room, err := ds.Room(ctx).GetUserRoom(user.ID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "not in a room", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting user room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		// Check permissions
		if !canControlPlayback(user.ID, room) {
			http.Error(w, "permission denied: only host can control queue", http.StatusForbidden)
			return
		}

		var payload addToRoomQueuePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Append to existing queue
		newQueue := append(room.QueueItems, payload.TrackIDs...)
		if err := ds.Room(ctx).UpdateQueue(room.ID, newQueue, room.CurrentIndex); err != nil {
			log.Error(ctx, "Error adding to queue", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "Tracks added to room queue", "roomId", room.ID, "userId", user.ID, "addedCount", len(payload.TrackIDs), "newQueueLength", len(newQueue))

		// Broadcast queue change to room participants
		participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)
		broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
		broadcastCtx = events.WithExcludeUserID(broadcastCtx, user.ID)
		broker.SendBroadcastMessage(broadcastCtx, &events.RoomQueueChanged{
			RoomID:       room.ID,
			QueueItems:   newQueue,
			CurrentIndex: room.CurrentIndex,
			UserID:       user.ID,
		})

		w.WriteHeader(http.StatusNoContent)
	}
}

// Remove track from queue
func removeFromRoomQueue(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)

		// Get user's current room
		room, err := ds.Room(ctx).GetUserRoom(user.ID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "not in a room", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting user room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		// Check permissions
		if !canControlPlayback(user.ID, room) {
			http.Error(w, "permission denied: only host can control queue", http.StatusForbidden)
			return
		}

		// Parse index from query
		indexStr := r.URL.Query().Get("index")
		if indexStr == "" {
			http.Error(w, "index parameter required", http.StatusBadRequest)
			return
		}
		var index int
		if _, err := fmt.Sscanf(indexStr, "%d", &index); err != nil {
			http.Error(w, "invalid index parameter", http.StatusBadRequest)
			return
		}

		// Validate index
		if index < 0 || index >= len(room.QueueItems) {
			http.Error(w, "index out of range", http.StatusBadRequest)
			return
		}

		// Remove from queue
		newQueue := append(room.QueueItems[:index], room.QueueItems[index+1:]...)
		newIndex := room.CurrentIndex
		if index < room.CurrentIndex {
			newIndex-- // Adjust current index if we removed before it
		}

		if err := ds.Room(ctx).UpdateQueue(room.ID, newQueue, newIndex); err != nil {
			log.Error(ctx, "Error removing from queue", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "Track removed from room queue", "roomId", room.ID, "userId", user.ID, "removedIndex", index, "newQueueLength", len(newQueue), "newCurrentIndex", newIndex)

		// Broadcast queue change to room participants
		participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)
		broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
		broadcastCtx = events.WithExcludeUserID(broadcastCtx, user.ID)
		broker.SendBroadcastMessage(broadcastCtx, &events.RoomQueueChanged{
			RoomID:       room.ID,
			QueueItems:   newQueue,
			CurrentIndex: newIndex,
			UserID:       user.ID,
		})

		w.WriteHeader(http.StatusNoContent)
	}
}

// Kick participant from room
func kickParticipant(ds model.DataStore, broker events.Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := request.UserFrom(ctx)

		// Get user's current room
		room, err := ds.Room(ctx).GetUserRoom(user.ID)
		if err != nil {
			if err == model.ErrNotFound {
				http.Error(w, "not in a room", http.StatusNotFound)
			} else {
				log.Error(ctx, "Error getting user room", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		// Only host can kick
		if !isHost(user.ID, room) {
			http.Error(w, "permission denied: only host can kick participants", http.StatusForbidden)
			return
		}

		// Get userID to kick from query
		kickUserID := r.URL.Query().Get("userId")
		if kickUserID == "" {
			http.Error(w, "userId parameter required", http.StatusBadRequest)
			return
		}

		// Can't kick self
		if kickUserID == user.ID {
			http.Error(w, "cannot kick yourself", http.StatusBadRequest)
			return
		}

		// Get participant IDs BEFORE removing user
		participantIDs := getRoomParticipantIDs(ctx, ds, room.ID)

		// Remove participant
		if err := ds.Room(ctx).RemoveParticipant(room.ID, kickUserID); err != nil {
			log.Error(ctx, "Error kicking participant", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info(ctx, "Participant kicked from room", "roomId", room.ID, "kickedUserId", kickUserID, "hostUserId", user.ID)

		// Broadcast kick event to room participants
		broadcastCtx := events.WithRoomParticipants(ctx, participantIDs)
		broker.SendBroadcastMessage(broadcastCtx, &events.RoomParticipantKicked{
			RoomID:       room.ID,
			KickedUserID: kickUserID,
		})

		// Also broadcast user left event
		broker.SendBroadcastMessage(broadcastCtx, &events.RoomUserLeft{
			RoomID: room.ID,
			UserID: kickUserID,
		})

		w.WriteHeader(http.StatusNoContent)
	}
}
