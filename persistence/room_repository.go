// Package persistence provides data storage for Navidrome's syncplay rooms.
//
// Room Repository (In-Memory Implementation):
// This module implements a thread-safe in-memory storage system for syncplay rooms
// and their participants. It uses a singleton pattern to ensure a single shared
// instance across the application.
//
// Key Features:
//   - Thread-safe operations using sync.RWMutex for concurrent access
//   - Automatic room cleanup when last participant leaves
//   - Prevents users from joining multiple rooms simultaneously
//   - Fast lookups via map-based storage
//
// Data Structures:
//   - rooms: map[roomID]*Room - stores room state (currentTrackId, position, isPlaying)
//   - participants: map[roomID][]RoomParticipant - tracks who's in each room
//   - userRooms: map[userID]roomID - quick lookup of user's current room
//
// Important Notes:
//   - Data is NOT persisted - all rooms are lost on server restart
//   - Room IDs are randomly generated using id.NewRandom()
//   - When room creator leaves and room is empty, the room is deleted
//
// Thread Safety:
//   - All methods acquire appropriate locks (RLock for reads, Lock for writes)
//   - Returns copies of data to prevent external modification of internal state
package persistence

import (
	"errors"
	"sync"
	"time"

	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/id"
)

var (
	roomRepoSingleton     model.RoomRepository
	roomRepoSingletonOnce sync.Once
)

// In-memory implementation for bare minimum functionality
type roomRepository struct {
	mu           sync.RWMutex
	rooms        map[string]*model.Room
	participants map[string][]model.RoomParticipant // roomID -> participants
	userRooms    map[string]string                   // userID -> roomID
}

func NewRoomRepository() model.RoomRepository {
	roomRepoSingletonOnce.Do(func() {
		roomRepoSingleton = &roomRepository{
			rooms:        make(map[string]*model.Room),
			participants: make(map[string][]model.RoomParticipant),
			userRooms:    make(map[string]string),
		}
	})
	return roomRepoSingleton
}

func (r *roomRepository) Create(room *model.Room) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if room.ID == "" {
		room.ID = id.NewRandom()
	}
	room.CreatedAt = time.Now()
	room.UpdatedAt = time.Now()

	// Initialize defaults for new fields
	if room.QueueItems == nil {
		room.QueueItems = []string{}
	}
	// Default: host control enabled (fluffy party mode OFF)
	room.HostControlOnly = true

	r.rooms[room.ID] = room
	r.participants[room.ID] = []model.RoomParticipant{}

	return nil
}

func (r *roomRepository) Get(id string) (*model.Room, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	room, exists := r.rooms[id]
	if !exists {
		return nil, model.ErrNotFound
	}

	// Return a copy to avoid race conditions
	roomCopy := *room
	return &roomCopy, nil
}

func (r *roomRepository) GetWithParticipants(id string) (*model.RoomWithParticipants, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	room, exists := r.rooms[id]
	if !exists {
		return nil, model.ErrNotFound
	}

	participants := r.participants[id]
	participantsCopy := make([]model.RoomParticipant, len(participants))
	copy(participantsCopy, participants)

	return &model.RoomWithParticipants{
		Room:         *room,
		Participants: participantsCopy,
	}, nil
}

func (r *roomRepository) Update(room *model.Room) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.rooms[room.ID]; !exists {
		return model.ErrNotFound
	}

	room.UpdatedAt = time.Now()
	r.rooms[room.ID] = room

	return nil
}

func (r *roomRepository) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.rooms[id]; !exists {
		return model.ErrNotFound
	}

	// Remove all participants from userRooms mapping
	for _, participant := range r.participants[id] {
		delete(r.userRooms, participant.UserID)
	}

	delete(r.rooms, id)
	delete(r.participants, id)

	return nil
}

func (r *roomRepository) AddParticipant(roomID, userID, userName string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.rooms[roomID]; !exists {
		return model.ErrNotFound
	}

	// Check if user already in a room
	if existingRoom, exists := r.userRooms[userID]; exists && existingRoom != roomID {
		return errors.New("user already in another room")
	}

	// Check if user already in this room
	for _, p := range r.participants[roomID] {
		if p.UserID == userID {
			return nil // Already a participant
		}
	}

	participant := model.RoomParticipant{
		RoomID:   roomID,
		UserID:   userID,
		UserName: userName,
		JoinedAt: time.Now(),
	}

	r.participants[roomID] = append(r.participants[roomID], participant)
	r.userRooms[userID] = roomID

	return nil
}

func (r *roomRepository) RemoveParticipant(roomID, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	participants := r.participants[roomID]
	newParticipants := make([]model.RoomParticipant, 0, len(participants))

	for _, p := range participants {
		if p.UserID != userID {
			newParticipants = append(newParticipants, p)
		}
	}

	r.participants[roomID] = newParticipants
	delete(r.userRooms, userID)

	// If room is empty and creator left, delete the room
	if len(newParticipants) == 0 {
		if room, exists := r.rooms[roomID]; exists && room.HostUserID == userID {
			delete(r.rooms, roomID)
			delete(r.participants, roomID)
		}
	}

	return nil
}

func (r *roomRepository) GetParticipants(roomID string) ([]model.RoomParticipant, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	participants, exists := r.participants[roomID]
	if !exists {
		return []model.RoomParticipant{}, nil
	}

	// Return a copy
	participantsCopy := make([]model.RoomParticipant, len(participants))
	copy(participantsCopy, participants)

	return participantsCopy, nil
}

func (r *roomRepository) GetUserRoom(userID string) (*model.Room, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	roomID, exists := r.userRooms[userID]
	if !exists {
		return nil, model.ErrNotFound
	}

	room, exists := r.rooms[roomID]
	if !exists {
		return nil, model.ErrNotFound
	}

	roomCopy := *room
	return &roomCopy, nil
}

func (r *roomRepository) GetAll() ([]*model.Room, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	rooms := make([]*model.Room, 0, len(r.rooms))
	for _, room := range r.rooms {
		roomCopy := *room
		rooms = append(rooms, &roomCopy)
	}

	return rooms, nil
}

func (r *roomRepository) UpdateQueue(roomID string, queueItems []string, currentIndex int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	room, exists := r.rooms[roomID]
	if !exists {
		return model.ErrNotFound
	}

	room.QueueItems = queueItems
	room.CurrentIndex = currentIndex
	room.UpdatedAt = time.Now()

	return nil
}

func (r *roomRepository) SetHostControlOnly(roomID string, enabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	room, exists := r.rooms[roomID]
	if !exists {
		return model.ErrNotFound
	}

	room.HostControlOnly = enabled
	room.UpdatedAt = time.Now()

	return nil
}
