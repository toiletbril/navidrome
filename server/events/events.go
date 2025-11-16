package events

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"time"
	"unicode"
)

type eventCtxKey string

const broadcastToAllKey eventCtxKey = "broadcastToAll"
const excludeUserIDKey eventCtxKey = "excludeUserID"
const roomParticipantsKey eventCtxKey = "roomParticipants"

// broadcastToAll is a context key that can be used to broadcast an event to all clients
func broadcastToAll(ctx context.Context) context.Context {
	return context.WithValue(ctx, broadcastToAllKey, true)
}

// WithExcludeUserID adds a userID to exclude from the broadcast (prevents echo to originator)
func WithExcludeUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, excludeUserIDKey, userID)
}

// WithRoomParticipants adds list of participant userIDs to filter recipients (only send to these users)
func WithRoomParticipants(ctx context.Context, participantIDs []string) context.Context {
	return context.WithValue(ctx, roomParticipantsKey, participantIDs)
}

type Event interface {
	Name(Event) string
	Data(Event) string
}

type baseEvent struct{}

func (e *baseEvent) Name(evt Event) string {
	str := strings.TrimPrefix(reflect.TypeOf(evt).String(), "*events.")
	return str[:0] + string(unicode.ToLower(rune(str[0]))) + str[1:]
}

func (e *baseEvent) Data(evt Event) string {
	data, _ := json.Marshal(evt)
	return string(data)
}

type ScanStatus struct {
	baseEvent
	Scanning    bool          `json:"scanning"`
	Count       int64         `json:"count"`
	FolderCount int64         `json:"folderCount"`
	Error       string        `json:"error"`
	ScanType    string        `json:"scanType"`
	ElapsedTime time.Duration `json:"elapsedTime"`
}

type KeepAlive struct {
	baseEvent
	TS int64 `json:"ts"`
}

type ServerStart struct {
	baseEvent
	StartTime time.Time `json:"startTime"`
	Version   string    `json:"version"`
}

const Any = "*"

type RefreshResource struct {
	baseEvent
	resources map[string][]string
}

type NowPlayingCount struct {
	baseEvent
	Count int `json:"count"`
}

// RoomUpdate contains the complete room state including participants
// This replaces the fragmented RoomStateChange, RoomQueueChanged, RoomHostControlChanged events
// to eliminate state synchronization issues and simplify frontend state management
type RoomUpdate struct {
	baseEvent
	RoomID          string `json:"roomId"`
	RoomName        string `json:"roomName"`
	HostUserID      string `json:"hostUserId"`
	HostControlOnly bool   `json:"hostControlOnly"`
	QueueItems      []string `json:"queueItems"`
	CurrentIndex    int    `json:"currentIndex"`
	CurrentTrackID  string `json:"currentTrackId,omitempty"`
	CurrentPosition int64  `json:"currentPosition"`
	IsPlaying       bool   `json:"isPlaying"`
	Participants    []RoomParticipant `json:"participants"`
	UserID          string `json:"userId,omitempty"` // Originating user ID for client-side deduplication
}

type RoomParticipant struct {
	UserID   string `json:"userId"`
	UserName string `json:"userName"`
	RoomID   string `json:"roomId"`
}

// RoomParticipantKicked is kept separate since kicked users need immediate notification before they can receive room updates
type RoomParticipantKicked struct {
	baseEvent
	RoomID       string `json:"roomId"`
	KickedUserID string `json:"kickedUserId"`
}

func (rr *RefreshResource) With(resource string, ids ...string) *RefreshResource {
	if rr.resources == nil {
		rr.resources = make(map[string][]string)
	}
	if len(ids) == 0 {
		rr.resources[resource] = append(rr.resources[resource], Any)
	}
	rr.resources[resource] = append(rr.resources[resource], ids...)
	return rr
}

func (rr *RefreshResource) Data(evt Event) string {
	if rr.resources == nil {
		return `{"*":"*"}`
	}
	r := evt.(*RefreshResource)
	data, _ := json.Marshal(r.resources)
	return string(data)
}
