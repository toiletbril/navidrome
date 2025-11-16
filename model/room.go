package model

import (
	"time"
)

type Room struct {
	ID              string    `structs:"id" json:"id"`
	Name            string    `structs:"name" json:"name"`
	HostUserID      string    `structs:"host_user_id" json:"hostUserId"`
	QueueItems      []string  `structs:"queue_items" json:"queueItems"`
	CurrentIndex    int       `structs:"current_index" json:"currentIndex"`
	HostControlOnly bool      `structs:"host_control_only" json:"hostControlOnly"`
	CurrentTrackID  string    `structs:"current_track_id" json:"currentTrackId,omitempty"`
	CurrentPosition int64     `structs:"current_position" json:"currentPosition"`
	IsPlaying       bool      `structs:"is_playing" json:"isPlaying"`
	CreatedAt       time.Time `structs:"created_at" json:"createdAt"`
	UpdatedAt       time.Time `structs:"updated_at" json:"updatedAt"`
}

type RoomParticipant struct {
	RoomID   string    `structs:"room_id" json:"roomId"`
	UserID   string    `structs:"user_id" json:"userId"`
	UserName string    `structs:"user_name" json:"userName"`
	JoinedAt time.Time `structs:"joined_at" json:"joinedAt"`
}

type RoomWithParticipants struct {
	Room
	Participants []RoomParticipant `json:"participants"`
}

type Rooms []Room

type RoomRepository interface {
	Create(room *Room) error
	Get(id string) (*Room, error)
	GetAll() ([]*Room, error)
	GetWithParticipants(id string) (*RoomWithParticipants, error)
	Update(room *Room) error
	Delete(id string) error
	AddParticipant(roomID, userID, userName string) error
	RemoveParticipant(roomID, userID string) error
	GetParticipants(roomID string) ([]RoomParticipant, error)
	GetUserRoom(userID string) (*Room, error)
	UpdateQueue(roomID string, queueItems []string, currentIndex int) error
	SetHostControlOnly(roomID string, enabled bool) error
}
