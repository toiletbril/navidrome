/**
 * Syncplay Room Synchronization Hook
 *
 * Core synchronization logic for Navidrome's real-time music listening rooms.
 * Handles bidirectional state sync between local audio player and remote participants.
 *
 * Responsibilities:
 *   - Broadcasts local playback events (play, pause, seek) to room
 *   - Applies remote state changes from other participants to local player
 *   - Prevents feedback loops using multiple strategies
 *
 * Feedback Loop Prevention (3 layers):
 *   1. userId matching: Skips applying own broadcasts (server includes userId in events)
 *   2. applyingRemoteStateRef flag: Blocks broadcasts during 500ms window when applying remote state
 *   3. Throttling: Minimum 500ms between broadcasts from same client
 *
 * State Synchronization Rules:
 *   - Position: Syncs if difference >1 second
 *   - Play/Pause: Only changes if state actually differs
 *   - Track: Only syncs if playing same track
 *
 * Parameters:
 *   @param {HTMLAudioElement} audioInstance - The audio player DOM element
 *   @param {React.MutableRefObject<boolean>} isCurrentlyPlayingRef - Ref for synchronous playing state access
 *
 * Returns:
 *   @returns {Object} Hook methods and refs
 *     - handlePlay: Broadcast play event to room
 *     - handlePause: Broadcast pause event to room
 *     - handleSeek: Broadcast seek event to room
 *     - applyRemoteState: Apply remote state changes to local player
 *     - applyingRemoteStateRef: Flag indicating remote state application in progress
 *
 * Usage Notes:
 *   - Must be called with audioInstance from player component
 *   - Requires isCurrentlyPlayingRef for synchronous state access in event handlers
 *   - All broadcasts go through roomService.updateState() API call
 *   - Event handlers check applyingRemoteStateRef to prevent broadcast during remote apply
 */
import { useEffect, useCallback, useRef } from 'react'
import { useSelector } from 'react-redux'
import { roomService } from './roomService'

export const useRoomSync = (audioInstance, isCurrentlyPlayingRef) => {
  const roomState = useSelector((state) => state.room)
  const playerState = useSelector((state) => state.player)
  const lastSyncRef = useRef(null)
  const lastRemoteSeekTime = useRef(null)
  // Track the last remote state we applied to deduplicate resulting events
  const lastAppliedRemoteState = useRef(null)

  // Track if we're expecting auto-play to happen (and should reverse it)
  const expectingAutoPlayRef = useRef(false)

  // Track if we're loading a room track (suppress broadcasts during load)
  const loadingRoomTrackRef = useRef(false)

  // Reactive fix: catch unwanted auto-play and immediately reverse it
  useEffect(() => {
    if (!audioInstance) return

    const handlePlayEvent = () => {
      if (expectingAutoPlayRef.current) {
        console.log('[RoomSync] Detected unwanted auto-play, re-pausing immediately')
        audioInstance.pause()
        expectingAutoPlayRef.current = false
      }
    }

    audioInstance.addEventListener('play', handlePlayEvent)
    return () => audioInstance.removeEventListener('play', handlePlayEvent)
  }, [audioInstance])

  // Broadcast state changes (anyone in room can broadcast)
  const broadcastState = useCallback(
    async (isPlaying, currentTime, trackId) => {
      if (!roomState.isInRoom) {
        return
      }

      // Skip broadcasts while loading room track (prevents desyncing others)
      if (loadingRoomTrackRef.current) {
        console.log('[RoomSync] Skipping broadcast - loading room track')
        return
      }

      // Check if this broadcast matches the remote state we just applied (deduplication)
      if (lastAppliedRemoteState.current) {
        const appliedState = lastAppliedRemoteState.current
        const timeSinceApply = Date.now() - appliedState.timestamp
        const positionMatches = Math.abs((currentTime * 1000) - appliedState.position) < 1000 // within 1s
        const playStateMatches = isPlaying === appliedState.isPlaying
        const trackMatches = trackId === appliedState.trackId

        // If this broadcast matches what we just applied from remote, skip it (it's an echo)
        if (timeSinceApply < 2000 && positionMatches && playStateMatches && trackMatches) {
          console.log('[RoomSync] Skipping broadcast - matches recently applied remote state', {
            timeSinceApply,
            appliedState,
            currentBroadcast: { isPlaying, position: currentTime * 1000, trackId }
          })
          return
        }
      }

      // Throttle updates to avoid flooding
      const now = Date.now()
      if (lastSyncRef.current && now - lastSyncRef.current < 500) {
        return
      }

      lastSyncRef.current = now

      try {
        const state = {
          isPlaying,
          currentPosition: Math.floor(currentTime * 1000), // Convert to milliseconds
          currentTrackId: trackId,
        }
        console.log('[RoomSync] Broadcasting state:', state)
        await roomService.updateState(state)
      } catch (error) {
        console.error('Error broadcasting room state:', error)
      }
    },
    [roomState.isInRoom],
  )

  // Handle play event
  const handlePlay = useCallback(
    (audioInfo) => {
      console.log('[RoomSync] handlePlay called')
      // Only broadcast if user has control permission
      if (!roomState.canControl) {
        console.log('[RoomSync] Skipping play broadcast - no control permission')
        return
      }
      if (audioInfo && audioInfo.trackId) {
        broadcastState(true, audioInfo.currentTime || 0, audioInfo.trackId)
      }
    },
    [broadcastState, roomState.canControl],
  )

  // Handle pause event
  const handlePause = useCallback(
    (audioInfo) => {
      console.log('[RoomSync] handlePause called')
      // Only broadcast if user has control permission
      if (!roomState.canControl) {
        console.log('[RoomSync] Skipping pause broadcast - no control permission')
        return
      }
      if (audioInfo && audioInfo.trackId) {
        broadcastState(false, audioInfo.currentTime || 0, audioInfo.trackId)
      }
    },
    [broadcastState, roomState.canControl],
  )

  // Handle seek event (when user scrubs the timeline)
  const handleSeek = useCallback(
    (seekInfo) => {
      // Only broadcast if user has control permission
      if (!roomState.canControl) {
        console.log('[RoomSync] Skipping seek broadcast - no control permission')
        return
      }
      if (seekInfo && seekInfo.trackId && seekInfo.isPlaying !== undefined) {
        // Use isPlaying from seekInfo (read from audioInstance at exact event time)
        const isPlaying = seekInfo.isPlaying
        console.log('[RoomSync] handleSeek called with isPlaying:', isPlaying)
        broadcastState(isPlaying, seekInfo.currentTime || 0, seekInfo.trackId)
      }
    },
    [broadcastState, roomState.canControl],
  )

  // Handle queue change (broadcast to room)
  const handleQueueChange = useCallback(
    async (queueItems, currentIndex, currentPlaybackState) => {
      if (!roomState.isInRoom || !roomState.canControl) {
        console.log('[RoomSync] Cannot change queue - no permission')
        return
      }

      // Throttle queue updates
      const now = Date.now()
      if (lastSyncRef.current && now - lastSyncRef.current < 500) {
        return
      }

      lastSyncRef.current = now

      try {
        console.log('[RoomSync] Broadcasting queue change:', { queueItems, currentIndex, playbackState: currentPlaybackState })
        await roomService.updateQueue(queueItems, currentIndex, currentPlaybackState)
      } catch (error) {
        console.error('[RoomSync] Error broadcasting queue change:', error)
      }
    },
    [roomState.isInRoom, roomState.canControl],
  )

  // Apply remote queue changes (from other participants)
  const applyRemoteQueue = useCallback(
    (remoteQueue, remoteIndex) => {
      // Don't apply our own broadcasts (avoid feedback loop)
      const currentUserId = localStorage.getItem('userId')
      if (remoteQueue.userId && remoteQueue.userId === currentUserId) {
        console.log('[RoomSync] Skipping own queue broadcast (userId match)')
        return
      }

      console.log('[RoomSync] Applying remote queue:', remoteQueue)
      // Actual queue replacement will be handled by Player component
      // This just logs for debugging
    },
    [],
  )

  // Apply remote state changes (from any participant)
  const applyRemoteState = useCallback(
    (remoteState, currentTrackId) => {
      if (!audioInstance || !remoteState.currentTrackId) {
        return
      }

      // Don't apply our own broadcasts (avoid feedback loop)
      const currentUserId = localStorage.getItem('userId')
      if (remoteState.userId && remoteState.userId === currentUserId) {
        console.log('[RoomSync] Skipping own broadcast (userId match)', {
          userId: currentUserId,
          remoteUserId: remoteState.userId,
        })
        return
      }

      console.log('[RoomSync] Applying remote state:', remoteState, 'Current track:', currentTrackId)

      // Handle track mismatch
      if (currentTrackId !== remoteState.currentTrackId) {
        // If user doesn't have control permission, they must follow the room's track
        if (!roomState.canControl) {
          console.log('[RoomSync] Track mismatch - forcing switch to room track (no permission)')
          // The queue sync should handle loading the correct track
          // For now, just skip position/play sync since track is changing anyway
          return
        } else {
          // User has permission, they can play different tracks - skip sync
          console.log('[RoomSync] Track mismatch, skipping sync (user has control)')
          return
        }
      }

      // Store the state we're about to apply for deduplication
      lastAppliedRemoteState.current = {
        isPlaying: remoteState.isPlaying,
        position: remoteState.currentPosition,
        trackId: remoteState.currentTrackId,
        timestamp: Date.now()
      }
      console.log('[RoomSync] Stored applied remote state for deduplication:', lastAppliedRemoteState.current)

      // CRITICAL: Sync play/pause state FIRST, before seeking
      // This prevents spurious play events when seeking on a paused element
      const currentlyPlaying = !audioInstance.paused
      console.log('[RoomSync] Play/pause check:', {
        remotePlaying: remoteState.isPlaying,
        currentlyPlaying,
        paused: audioInstance.paused,
        needsChange: remoteState.isPlaying !== currentlyPlaying,
      })

      if (remoteState.isPlaying !== currentlyPlaying) {
        // Update ref BEFORE calling play/pause so subsequent seeks have correct state
        if (isCurrentlyPlayingRef) {
          isCurrentlyPlayingRef.current = remoteState.isPlaying
        }

        if (remoteState.isPlaying) {
          console.log('[RoomSync] Starting playback')
          audioInstance.play().catch((e) => console.warn('Auto-play blocked:', e))
        } else {
          console.log('[RoomSync] Pausing playback')
          audioInstance.pause()
        }
      } else {
        console.log('[RoomSync] Play/pause state already matches, no change needed')
      }

      // NOW sync position after play/pause state is correct
      const currentTime = audioInstance.currentTime
      const remoteTime = remoteState.currentPosition / 1000 // Convert from milliseconds

      // Sync if time difference is significant (> 1 second)
      const needsSeek = Math.abs(currentTime - remoteTime) > 1
      if (needsSeek) {
        console.log('[RoomSync] Syncing position:', remoteTime, 'readyState:', audioInstance.readyState)
        // Store the seek target so we can identify the seeked event later
        lastRemoteSeekTime.current = remoteTime

        // If remote wants paused, expect library to auto-play after seek and reverse it
        if (!remoteState.isPlaying) {
          console.log('[RoomSync] Expecting auto-play after seek (will reverse)')
          expectingAutoPlayRef.current = true
        }

        // Wait for audio to be ready before seeking (prevents race condition on join)
        const performSeek = () => {
          console.log('[RoomSync] Performing seek to:', remoteTime)
          audioInstance.currentTime = remoteTime
        }

        if (audioInstance.readyState >= 2) {
          // HAVE_CURRENT_DATA or better - safe to seek
          performSeek()
        } else {
          // Audio not ready yet - wait for canplay event
          console.log('[RoomSync] Audio not ready, waiting for canplay event')
          const canplayHandler = () => {
            performSeek()
            audioInstance.removeEventListener('canplay', canplayHandler)
          }
          audioInstance.addEventListener('canplay', canplayHandler)
        }
      }

      // Events triggered by our state changes will be deduplicated in broadcastState()
    },
    [audioInstance],
  )

  return {
    handlePlay,
    handlePause,
    handleSeek,
    handleQueueChange,
    applyRemoteState,
    applyRemoteQueue,
    lastRemoteSeekTime,
    loadingRoomTrackRef,
    expectingAutoPlayRef,
  }
}
