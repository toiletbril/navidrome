# Navidrome Syncplay Feature

## Overview

Synchronized playback system allowing multiple users to listen to music together in real-time with shared queues. Features host-controlled and "fluffy party" modes for flexible collaboration.

**Last Updated**: November 2025 - Major redesign with queue sync and permission system

## Architecture Overview

### Core Features

- **Named Rooms**: Each room has unique ID and display name
- **Shared Queue**: Room maintains its own synchronized music queue
- **Dual Mode System**:
  - **Host Control** (default): Only room creator controls playback/queue
  - **Fluffy Party Mode**: Everyone can control (host can toggle)
- **Room Discovery**: Browse active rooms with participant counts
- **Democratic Transition**: When host leaves, room becomes fluffy party mode
- **Real-time Sync**: SSE broadcasts with originator exclusion

## Permission Model

**Core Logic**:
```
canControl = !hostControlOnly || isHost
```

**Rules**:
- Default room creation: `hostControlOnly = true` (host control enabled)
- Host can toggle fluffy party mode via settings
- When host leaves: `hostUserID = ""`, `hostControlOnly = false` (democratic)
- Host always retains kick privileges (even in fluffy party mode)

**Backend Enforcement** (server/nativeapi/room_permissions.go):
```go
func canControlPlayback(userID string, room *model.Room) bool {
    if !room.HostControlOnly {
        return true  // Fluffy party mode
    }
    return userID == room.HostUserID  // Host control mode
}

func isHost(userID string, room *model.Room) bool {
    return userID == room.HostUserID
}
```

**Frontend Computation** (ui/src/reducers/roomReducer.js:66-70):
```javascript
const computeCanControl = (hostControlOnly, hostUserId) => {
    if (!hostControlOnly) return true  // Fluffy party
    const currentUserId = getUserId()
    return currentUserId === hostUserId  // Host control
}
```

## Data Flow

### Playback State Update Flow
```
1. User action (play/pause/seek)
   ↓
2. Player.jsx event handler
   ↓ [Permission check: if in room, verify canControl]
3. useRoomSync.handlePlay/Pause/Seek()
   ↓
4. useRoomSync.broadcastState() [deduplication & throttling]
   ↓
5. roomService.updateState() → POST /api/room/state
   ↓
6. room.go updateRoomState() [canControlPlayback() check]
   ↓
7. ds.Room().UpdateState() [in-memory update]
   ↓
8. broker.SendBroadcastMessage(ctx with excludeUserID)
   ↓
9. SSE → All clients EXCEPT originator
   ↓
10. eventStream.js listener → dispatch(roomStateChange)
    ↓
11. roomReducer updates Redux state
    ↓
12. Player.jsx useEffect detects change
    ↓
13. useRoomSync.applyRemoteState() [state deduplication]
    ↓
14. Direct audioInstance manipulation
```

### Queue Synchronization Flow
```
1. User modifies queue (add/remove/reorder)
   ↓
2. Player.onAudioListsChange() [Permission check: canControl]
   ↓
3. If !canControl → notify('no permission'), return
   ↓
4. dispatch(syncQueue()) [local Redux update]
   ↓
5. roomSync.handleQueueChange(trackIds, currentIndex)
   ↓
6. roomService.updateQueue() → POST /api/room/queue
   ↓
7. room.go updateQueue() [canControlPlayback() check]
   ↓
8. ds.Room().UpdateQueue() [in-memory update]
   ↓
9. broker.SendBroadcastMessage(RoomQueueChanged, excludeUserID)
   ↓
10. SSE → All clients except originator
    ↓
11. roomReducer.reduceQueueChanged() [updates sharedQueue, currentIndex]
    ↓
12. Player.jsx useEffect detects queue change
    ↓
13. Fetches tracks from dataProvider, replaces local queue
```

## Backend (Go)

### Model Layer (model/room.go)

**Room Structure**:
```go
type Room struct {
    ID              string    `json:"id"`
    Name            string    `json:"name"`
    HostUserID      string    `json:"hostUserId"`        // Empty = democratic
    QueueItems      []string  `json:"queueItems"`        // Track IDs
    CurrentIndex    int       `json:"currentIndex"`      // Current playing index
    HostControlOnly bool      `json:"hostControlOnly"`   // true = host control, false = fluffy party
    CurrentTrackID  string    `json:"currentTrackId"`
    CurrentPosition int64     `json:"currentPosition"`   // milliseconds
    IsPlaying       bool      `json:"isPlaying"`
    CreatedAt       time.Time `json:"createdAt"`
    UpdatedAt       time.Time `json:"updatedAt"`
}

type RoomParticipant struct {
    RoomID   string    `json:"roomId"`
    UserID   string    `json:"userId"`
    UserName string    `json:"userName"`
    JoinedAt time.Time `json:"joinedAt"`
}
```

**Repository Interface** (persistence/room_repository.go):
- `Create(room)` - Sets `hostControlOnly = true` by default
- `Get(roomId)`, `GetAll()`, `GetUserRoom(userId)`
- `GetWithParticipants(roomId)` - Returns room + participant list
- `AddParticipant()`, `RemoveParticipant()`, `GetParticipants()`
- `UpdateState()`, `UpdateQueue()`, `SetHostControlOnly()`

### API Endpoints (server/nativeapi/room.go)

**Room Management**:
- `GET /api/rooms` - List all active rooms (returns RoomSummary with participantCount)
- `POST /api/room` - Create room (body: `{name}`, returns full room with `hostControlOnly=true`)
- `GET /api/room?id=...` - Get room details
- `POST /api/room/join?id=...` - Join room (returns full room state including queue)
- `DELETE /api/room/leave` - Leave room (host leave → democratic transition)

**Playback Control** (requires `canControlPlayback()`):
- `POST /api/room/state` - Update playback state (body: `{currentTrackId, currentPosition, isPlaying}`)

**Settings** (requires `isHost()`):
- `PUT /api/room/settings` - Toggle host control (body: `{hostControlOnly: bool}`)

**Queue Operations** (requires `canControlPlayback()`):
- `POST /api/room/queue` - Replace entire queue (body: `{queueItems: string[], currentIndex: int}`)
- `PUT /api/room/queue/add` - Add tracks (body: `{trackIds: string[]}`)
- `DELETE /api/room/queue/remove?index=N` - Remove track at index

**Moderation** (requires `isHost()`):
- `DELETE /api/room/participant?userId=X` - Kick participant

**Permission Enforcement**:
All endpoints check permissions before modifying state. Return `403 Forbidden` if denied.

**Host Leave Behavior** (room.go:200-217):
```go
wasHost := user.ID == room.HostUserID
if wasHost {
    room.HostUserID = ""              // Clear host
    room.HostControlOnly = false      // Force fluffy party
    ds.Room(ctx).Update(room)
    broker.SendBroadcastMessage(ctx, &events.RoomHostControlChanged{
        RoomID: room.ID,
        HostControlOnly: false,
    })
}
```

### SSE Event System (server/events/)

**Broadcast Exclusion** (sse.go):
```go
// Add excludeUserID to context
ctx = events.WithExcludeUserID(ctx, userID)
broker.SendBroadcastMessage(ctx, &event)

// Broker filters: skip sending to excluded user
func (b *broker) shouldSend(msg message, c client) bool {
    if excludeUserID := msg.senderCtx.Value(excludeUserIDKey).(string); excludeUserID != "" {
        if c.userID == excludeUserID {
            return false  // Skip originator
        }
    }
    return true
}
```

**Event Types** (events.go):
- `RoomStateChange` - Playback state (includes userId for client-side dedup)
- `RoomQueueChanged` - Queue updated (includes userId, queueItems, currentIndex)
- `RoomHostControlChanged` - Mode toggled (includes roomId, hostControlOnly)
- `RoomParticipantKicked` - User kicked (includes kickedUserId)
- `RoomUserJoined` - User joined (includes userId, userName)
- `RoomUserLeft` - User left (includes userId, userName)

## Frontend (React)

### State Management (ui/src/reducers/roomReducer.js)

**Redux State Shape**:
```javascript
{
    roomId: string | null,
    roomName: string | null,
    hostUserId: string | null,
    hostControlOnly: bool,        // true = host control, false = fluffy party
    isHost: bool,                 // Current user is host
    canControl: bool,             // Computed: !hostControlOnly || isHost
    isInRoom: bool,
    participants: [{userId, userName, joinedAt}],
    sharedQueue: string[],        // Track IDs
    currentIndex: int,            // Playing track index
    currentTrackId: string,
    currentPosition: int,         // milliseconds
    isPlaying: bool,
    userId: string | null,        // Last state change originator
    error: string | null
}
```

**Computed Properties**:
- `canControl` recalculated whenever `hostControlOnly` or `hostUserId` changes
- `isHost` recalculated when `hostUserId` changes

### Room Service (ui/src/room/roomService.js)

HTTP client wrapping all room API endpoints:
- `listRooms()`, `create(name)`, `get(roomId)`, `join(roomId)`, `leave()`
- `updateState({isPlaying, currentPosition, currentTrackId})`
- `toggleHostControl(hostControlOnly)`
- `updateQueue(queueItems, currentIndex)`, `addToQueue(trackIds)`, `removeFromQueue(index)`
- `kickParticipant(userId)`

### Synchronization Hook (ui/src/room/useRoomSync.js)

**Core Responsibilities**:
1. **Broadcast** local playback events to room
2. **Apply** remote state changes to local player
3. **Prevent** feedback loops (3 layers)
4. **Manage** queue synchronization

**Feedback Loop Prevention**:
1. **Server-side exclusion**: Originator doesn't receive SSE broadcast
2. **State deduplication**: Track last applied remote state, skip broadcasts matching it within 2s
3. **Throttling**: 500ms minimum between broadcasts

**State Deduplication** (lines 88-104):
```javascript
// After applying remote state, store it
lastAppliedRemoteState.current = {
    isPlaying: remoteState.isPlaying,
    position: remoteState.currentPosition,
    trackId: remoteState.currentTrackId,
    timestamp: Date.now()
}

// Before broadcasting, check if it matches recently applied state
if (lastAppliedRemoteState.current) {
    const timeSinceApply = Date.now() - appliedState.timestamp
    const positionMatches = Math.abs((currentTime * 1000) - appliedState.position) < 1000
    const playStateMatches = isPlaying === appliedState.isPlaying
    const trackMatches = trackId === appliedState.trackId

    if (timeSinceApply < 2000 && positionMatches && playStateMatches && trackMatches) {
        return  // Skip, it's an echo
    }
}
```

**Auto-Play Prevention** (lines 58-72):
Reactive approach catches unwanted library auto-play and immediately reverses it.
```javascript
const handlePlayEvent = () => {
    if (expectingAutoPlayRef.current) {
        audioInstance.pause()  // Reverse auto-play
        expectingAutoPlayRef.current = false
    }
}
audioInstance.addEventListener('play', handlePlayEvent)
```

### UI Components

**RoomDialog** (ui/src/room/RoomDialog.jsx):
- 3-tab interface: Browse / Create / Join
- **Browse Tab**: Embeds RoomList for room discovery
- **Create Tab**: Input room name, dispatches full room state including `hostControlOnly=true`
- **Join Tab**: Input room ID, dispatches complete state including queue

**RoomList** (ui/src/room/RoomList.jsx):
- Dual mode: Standalone Dialog or embedded in RoomDialog
- Auto-refresh every 5 seconds
- Table columns: Room Name, Mode (Lock/People icon), Participants, Join button
- Empty state with friendly message

**RoomControls** (ui/src/room/RoomControls.jsx):
- Chip in AppBar showing room name + participant count
- Popover displays:
  - Mode indicator (Lock = Host Control, People = Fluffy Party)
  - **Fluffy party toggle switch** (host only)
  - Participant list with kick buttons (host only, excluding self)
  - Leave room button

**RoomIndicator** (ui/src/audioplayer/RoomIndicator.jsx):
- Fixed position badges on player
- Mode chip (Lock/People icon with label)
- Sync status chip (room name with sync icon)
- Only visible when in room

**Player Integration** (ui/src/audioplayer/Player.jsx):
- **Permission Guard**: `onAudioListsChange()` checks `canControl` before allowing queue modifications
- Displays notification if user lacks permission
- Broadcasts queue changes when `canControl=true`
- Auto-loads room track when joining with different track
- Dual state pattern (React state + ref) for synchronous event handler access

### Event Stream (ui/src/eventStream.js)

SSE client registers listeners for all room events:
```javascript
stream.addEventListener('roomStateChange', eventHandler(dispatchFn))
stream.addEventListener('roomQueueChanged', eventHandler(dispatchFn))
stream.addEventListener('roomHostControlChanged', eventHandler(dispatchFn))
stream.addEventListener('roomParticipantKicked', eventHandler(dispatchFn))
stream.addEventListener('roomUserJoined', eventHandler(dispatchFn))
stream.addEventListener('roomUserLeft', eventHandler(dispatchFn))
```

## Key Design Decisions

### Why Server-Side Broadcast Exclusion?

**Before** (client-side userId matching only):
- Server sends event to ALL clients including originator
- Originator checks `event.userId === localStorage.userId` and skips
- Problem: Still processes event unnecessarily, wastes bandwidth

**After** (server-side exclusion):
- Server checks `excludeUserID` context before sending
- Originator never receives the event
- Cleaner, more efficient, still has state deduplication as backup

### Why State Deduplication?

Even with server exclusion, applying remote state triggers local events (play, pause, seeked) which would normally broadcast. Deduplication prevents these "echo broadcasts" by recognizing they match recently applied remote state.

### Why Host Control Default?

Users expect to create their own room with control by default (like Spotify, Discord). They can opt-in to collaborative mode via toggle. Democratic-only would be frustrating for privacy/control.

### Why Democratic Transition on Host Leave?

Alternative would be transferring host to another user (complex: who? what if they leave immediately?). Democratic transition is simpler and allows room to continue functioning.

## Common Patterns

### Adding a New Room Event

1. **Backend**: Define in `server/events/events.go`
   ```go
   type YourNewEvent struct {
       baseEvent
       RoomID string `json:"roomId"`
       YourData string `json:"yourData"`
   }
   ```
2. **Backend**: Broadcast with exclusion
   ```go
   ctx = events.WithExcludeUserID(ctx, user.ID)
   broker.SendBroadcastMessage(ctx, &events.YourNewEvent{...})
   ```
3. **Frontend**: Register listener in `ui/src/eventStream.js`
   ```javascript
   stream.addEventListener('yourNewEvent', eventHandler(dispatchFn))
   ```
4. **Frontend**: Handle in `ui/src/reducers/roomReducer.js`
   ```javascript
   case 'yourNewEvent':
       return { ...state, yourData: payload.data.yourData }
   ```

### Adding a New Permission-Controlled Endpoint

1. **Backend**: Check permission before operation
   ```go
   if !canControlPlayback(user.ID, room) {
       http.Error(w, "permission denied", http.StatusForbidden)
       return
   }
   ```
2. **Frontend**: Check `canControl` in UI
   ```jsx
   <Button disabled={!roomState.canControl} onClick={handleAction}>
   ```
3. **Frontend**: Check `canControl` before API call
   ```javascript
   if (!roomState.canControl) {
       notify('room.errors.noPermission', {type: 'warning'})
       return
   }
   ```

## Debugging

### Debug Logging

Console logs with prefixes:
- `[RoomSync]` - useRoomSync operations
- `[RoomReducer]` - State updates in reducer
- `[Player]` - Player component actions
- `[RoomList]` - Room list operations
- `[NativeAudio]` - HTML5 audio events

### Common Issues

**Queue not syncing**:
- Check `canControl` in Redux state
- Verify permission guard in `onAudioListsChange`
- Check backend permission in `/api/room/queue` endpoint

**Feedback loops**:
- Verify `excludeUserID` is set in SSE context
- Check state deduplication logs (should see "Skipping broadcast - matches recently applied")
- Verify 500ms throttling between broadcasts

**Host control not working**:
- Check `hostControlOnly` field in room state
- Verify `isHost` computed correctly (compare userId)
- Check `canControl = !hostControlOnly || isHost`

**Mode toggle not visible**:
- Only visible to host (`isHost === true`)
- Check RoomControls component conditional rendering

**Kicked user not leaving**:
- SSE event should set `kickedUserId`
- Frontend checks `kickedUserId === currentUserId` and dispatches `leaveRoom()`

## Testing

**Manual Testing Setup**:
1. Two browser sessions (different users or incognito + normal)
2. User A creates room (should be host with control)
3. User B joins via room ID (should see host control mode)
4. Verify only User A can control playback/queue
5. User A enables fluffy party mode
6. Verify User B can now control
7. User A leaves room
8. Verify room becomes fluffy party (User B can still control)

**Permission Testing**:
- Try queue operations as non-host in host control mode (should fail with notification)
- Try kicking as non-host (button shouldn't appear)
- Try toggling settings as non-host (toggle shouldn't appear)

## Implementation Status

**✅ Fully Implemented**:
- Named rooms with unique IDs
- Room listing/discovery UI
- Shared queue synchronization
- Host control / fluffy party mode toggle
- Permission system (backend + frontend)
- Democratic transition on host leave
- Kick functionality (host only)
- Visual mode indicators
- Auto-track loading when joining
- Feedback loop prevention (server exclusion + state deduplication)
- Room UI in AppBar
- Manual sync button (PlayerToolbar)

**⚠️ Known Limitations**:
- Auto-play bug causes brief flicker on paused seeks (reactive fix, acceptable trade-off)
- No room persistence (in-memory, lost on server restart)
- Single room per user (can't be in multiple rooms)

**🔮 Future Enhancements**:
- Persistent rooms (database storage)
- Room privacy settings (public/private/password)
- Room invitations via shareable links
- Voice chat integration
- Room history/analytics
