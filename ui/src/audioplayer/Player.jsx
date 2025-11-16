import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useMediaQuery } from '@material-ui/core'
import { ThemeProvider } from '@material-ui/core/styles'
import {
  createMuiTheme,
  useAuthState,
  useDataProvider,
  useTranslate,
  useNotify,
} from 'react-admin'
import ReactGA from 'react-ga'
import { GlobalHotKeys } from 'react-hotkeys'
import ReactJkMusicPlayer from 'navidrome-music-player'
import 'navidrome-music-player/assets/index.css'
import useCurrentTheme from '../themes/useCurrentTheme'
import config from '../config'
import useStyle from './styles'
import AudioTitle from './AudioTitle'
import {
  clearQueue,
  currentPlaying,
  setPlayMode,
  setTrack,
  setVolume,
  syncQueue,
} from '../actions'
import { mapToAudioLists } from '../reducers/playerReducer'
import PlayerToolbar from './PlayerToolbar'
import { sendNotification } from '../utils'
import subsonic from '../subsonic'
import locale from './locale'
import { keyMap } from '../hotkeys'
import keyHandlers from './keyHandlers'
import { calculateGain } from '../utils/calculateReplayGain'
import { useRoomSync } from '../room/useRoomSync'
import { RoomIndicator } from './RoomIndicator'

const Player = () => {
  const theme = useCurrentTheme()
  const translate = useTranslate()
  const notify = useNotify()
  const playerTheme = theme.player?.theme || 'dark'
  const dataProvider = useDataProvider()
  const playerState = useSelector((state) => state.player)
  const dispatch = useDispatch()
  const [startTime, setStartTime] = useState(null)
  const [scrobbled, setScrobbled] = useState(false)
  const [preloaded, setPreload] = useState(false)
  const [audioInstance, setAudioInstance] = useState(null)
  const isDesktop = useMediaQuery('(min-width:810px)')
  const isMobilePlayer =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )

  // Ref to prevent infinite seek loop when blocking unauthorized seeks
  const blockingSeekRef = useRef(false)

  const { authenticated } = useAuthState()
  const visible = authenticated && playerState.queue.length > 0
  const isRadio = playerState.current?.isRadio || false
  const classes = useStyle({
    isRadio,
    visible,
    enableCoverAnimation: config.enableCoverAnimation,
  })
  const showNotifications = useSelector(
    (state) => state.settings.notifications || false,
  )
  const gainInfo = useSelector((state) => state.replayGain)
  const [context, setContext] = useState(null)
  const [gainNode, setGainNode] = useState(null)
  const [isCurrentlyPlaying, setIsCurrentlyPlaying] = useState(false)
  const isCurrentlyPlayingRef = useRef(false)
  const roomState = useSelector((state) => state.room)
  const roomSync = useRoomSync(audioInstance, isCurrentlyPlayingRef)

  useEffect(() => {
    if (
      context === null &&
      audioInstance &&
      config.enableReplayGain &&
      'AudioContext' in window &&
      (gainInfo.gainMode === 'album' || gainInfo.gainMode === 'track')
    ) {
      const ctx = new AudioContext()
      // we need this to support radios in firefox
      audioInstance.crossOrigin = 'anonymous'
      const source = ctx.createMediaElementSource(audioInstance)
      const gain = ctx.createGain()

      source.connect(gain)
      gain.connect(ctx.destination)

      setContext(ctx)
      setGainNode(gain)
    }
  }, [audioInstance, context, gainInfo.gainMode])

  useEffect(() => {
    if (gainNode) {
      const current = playerState.current || {}
      const song = current.song || {}

      const numericGain = calculateGain(gainInfo, song)
      gainNode.gain.setValueAtTime(numericGain, context.currentTime)
    }
  }, [audioInstance, context, gainNode, playerState, gainInfo])

  const defaultOptions = useMemo(
    () => ({
      theme: playerTheme,
      bounds: 'body',
      playMode: playerState.mode,
      mode: 'full',
      loadAudioErrorPlayNext: false,
      autoPlayInitLoadPlayList: true,
      clearPriorAudioLists: false,
      showDestroy: true,
      showDownload: false,
      showLyric: true,
      showReload: false,
      toggleMode: !isDesktop,
      glassBg: false,
      showThemeSwitch: false,
      showMediaSession: true,
      restartCurrentOnPrev: true,
      quietUpdate: true,
      defaultPosition: {
        top: 300,
        left: 120,
      },
      volumeFade: { fadeIn: 200, fadeOut: 200 },
      renderAudioTitle: (audioInfo, isMobile) => (
        <AudioTitle
          audioInfo={audioInfo}
          gainInfo={gainInfo}
          isMobile={isMobile}
        />
      ),
      locale: locale(translate),
    }),
    [gainInfo, isDesktop, playerTheme, translate, playerState.mode],
  )

  const options = useMemo(() => {
    const current = playerState.current || {}
    // In room without control permission, disable queue modifications and seeking
    const canModifyQueue = !roomState.isInRoom || roomState.canControl

    // Only autoPlay if: (1) not in room, OR (2) in room and room is playing
    // This prevents queue sync from auto-playing when room is paused
    const shouldAutoPlay = (playerState.clear || playerState.playIndex === 0) &&
                           (!roomState.isInRoom || roomState.isPlaying)

    return {
      ...defaultOptions,
      audioLists: playerState.queue.map((item) => item),
      playIndex: playerState.playIndex,
      autoPlay: shouldAutoPlay,
      clearPriorAudioLists: playerState.clear,
      extendsContent: (
        <PlayerToolbar id={current.trackId} isRadio={current.isRadio} audioInstance={audioInstance} />
      ),
      defaultVolume: isMobilePlayer ? 1 : playerState.volume,
      showMediaSession: !current.isRadio,
      // Disable queue modification controls when in room without permission
      remove: canModifyQueue,
      drag: canModifyQueue,
      // Hide playlist and play mode controls when no permission
      showPlayMode: canModifyQueue,
      showPlay: true, // Always show play/pause (allowed even without permission)
      // Disable seeking when in room without permission
      seeked: canModifyQueue,
    }
  }, [playerState, defaultOptions, isMobilePlayer, audioInstance, roomState.isInRoom, roomState.canControl, roomState.isPlaying])

  const onAudioListsChange = useCallback(
    (_, audioLists, audioInfo) => {
      // Check room permissions before allowing queue changes
      if (roomState.isInRoom && !roomState.canControl) {
        console.log('[Player] Queue change blocked - no permission in room')
        notify('room.errors.noPermission', { type: 'warning' })
        return
      }

      dispatch(syncQueue(audioInfo, audioLists))

      // If in room with control permission, broadcast queue change
      if (roomState.isInRoom && roomState.canControl) {
        // Extract track IDs from audioLists (use trackId field from mapped items)
        const trackIds = audioLists.map(item => item.trackId).filter(Boolean)
        let currentIndex = audioLists.findIndex(item => item.trackId === audioInfo?.trackId)

        // If current track was removed (findIndex returns -1), keep same index position
        // Next track shifts into current position naturally
        if (currentIndex === -1 && roomState.currentIndex !== undefined) {
          currentIndex = Math.min(roomState.currentIndex, audioLists.length - 1)
        } else if (currentIndex === -1) {
          currentIndex = 0 // Fallback if no room state
        }

        // Include current playback state to preserve position
        const playbackState = audioInstance ? {
          currentTrackId: audioInfo?.trackId || trackIds[currentIndex],
          currentPosition: Math.floor((audioInstance.currentTime || 0) * 1000),
          isPlaying: !audioInstance.paused
        } : null

        console.log('[Player] Broadcasting queue change:', {
          trackIds,
          currentIndex,
          playbackState,
          audioLists: audioLists.map(i => ({ trackId: i.trackId, name: i.name }))
        })

        roomSync.handleQueueChange(trackIds, currentIndex, playbackState)
      }
    },
    [dispatch, roomState.isInRoom, roomState.canControl, roomState.currentIndex, roomSync, notify, audioInstance],
  )

  const nextSong = useCallback(() => {
    const idx = playerState.queue.findIndex(
      (item) => item.uuid === playerState.current.uuid,
    )
    return idx !== null ? playerState.queue[idx + 1] : null
  }, [playerState])

  const onAudioProgress = useCallback(
    (info) => {
      if (info.ended) {
        document.title = 'Navidrome'
      }

      const progress = (info.currentTime / info.duration) * 100
      if (isNaN(info.duration) || (progress < 50 && info.currentTime < 240)) {
        return
      }

      if (info.isRadio) {
        return
      }

      if (!preloaded) {
        const next = nextSong()
        if (next != null) {
          const audio = new Audio()
          audio.src = next.musicSrc
        }
        setPreload(true)
        return
      }

      if (!scrobbled) {
        info.trackId && subsonic.scrobble(info.trackId, startTime)
        setScrobbled(true)
      }
    },
    [startTime, scrobbled, nextSong, preloaded],
  )

  const onAudioVolumeChange = useCallback(
    // sqrt to compensate for the logarithmic volume
    (volume) => dispatch(setVolume(Math.sqrt(volume))),
    [dispatch],
  )

  const onAudioPlay = useCallback(
    (info) => {
      // Do this to start the context; on chrome-based browsers, the context
      // will start paused since it is created prior to user interaction
      if (context && context.state !== 'running') {
        context.resume()
      }

      // If in room without control permission, sync to server position when unpausing
      if (roomState.isInRoom && !roomState.canControl && audioInstance && !isCurrentlyPlayingRef.current) {
        let serverPosition = roomState.currentPosition / 1000 // Convert from ms to seconds

        // Calculate expected position if host is playing (account for time drift)
        if (roomState.isPlaying && roomState.lastUpdateTimestamp) {
          const timeSinceUpdate = (Date.now() - roomState.lastUpdateTimestamp) / 1000
          serverPosition += timeSinceUpdate
          console.log('[Player] Calculated expected position with drift:', serverPosition, '(+', timeSinceUpdate.toFixed(2), 's)')
        }

        const currentPosition = info.currentTime || 0
        const positionDiff = Math.abs(serverPosition - currentPosition)

        // If more than 1 second difference, sync to server position
        if (positionDiff > 1) {
          console.log('[Player] Syncing to expected server position on unpause:', serverPosition, 'current:', currentPosition)
          notify('room.sync.position', { type: 'info' })
          audioInstance.currentTime = serverPosition
        }
      }

      dispatch(currentPlaying(info))
      if (startTime === null) {
        setStartTime(Date.now())
      }
      if (info.duration) {
        const song = info.song
        document.title = `${song.title} - ${song.artist} - Navidrome`
        if (!info.isRadio) {
          const pos = startTime === null ? null : Math.floor(info.currentTime)
          subsonic.nowPlaying(info.trackId, pos)
        }
        setPreload(false)
        if (config.gaTrackingId) {
          ReactGA.event({
            category: 'Player',
            action: 'Play song',
            label: `${song.title} - ${song.artist}`,
          })
        }
        if (showNotifications) {
          sendNotification(
            song.title,
            `${song.artist} - ${song.album}`,
            info.cover,
          )
        }
      }
      // ALWAYS update playing state ref for accurate subsequent broadcasts
      setIsCurrentlyPlaying(true)
      isCurrentlyPlayingRef.current = true

      // Broadcast play event (will be deduplicated if it matches recently applied remote state)
      roomSync.handlePlay(info)
    },
    [context, dispatch, showNotifications, startTime, roomSync, roomState.isInRoom, roomState.canControl, roomState.currentPosition, audioInstance, isCurrentlyPlayingRef],
  )

  const onBeforeAudioPlay = useCallback((audioLists, audioInfo) => {
    // Block track changes in room without control permission
    if (roomState.isInRoom && !roomState.canControl) {
      // Check if this is a user-initiated track change (different from current track)
      const currentTrackId = playerState.current?.trackId
      const newTrackId = audioInfo?.trackId

      if (currentTrackId && newTrackId && currentTrackId !== newTrackId) {
        console.log('[Player] Track change blocked - no control permission')
        notify('room.errors.noPermission', { type: 'warning' })
        return false // Prevent track change
      }
    }
    return true // Allow track change
  }, [roomState.isInRoom, roomState.canControl, playerState.current, notify])

  const onAudioPlayTrackChange = useCallback(() => {
    if (scrobbled) {
      setScrobbled(false)
    }
    if (startTime !== null) {
      setStartTime(null)
    }
  }, [scrobbled, startTime])

  const onAudioPause = useCallback(
    (info) => {
      dispatch(currentPlaying(info))

      // ALWAYS update playing state ref for accurate subsequent broadcasts
      setIsCurrentlyPlaying(false)
      isCurrentlyPlayingRef.current = false

      // Broadcast pause event (will be deduplicated if it matches recently applied remote state)
      roomSync.handlePause(info)
    },
    [dispatch, roomSync],
  )

  const onAudioEnded = useCallback(
    (currentPlayId, audioLists, info) => {
      setScrobbled(false)
      setStartTime(null)
      dispatch(currentPlaying(info))
      dataProvider
        .getOne('keepalive', { id: info.trackId })
        // eslint-disable-next-line no-console
        .catch((e) => console.log('Keepalive error:', e))

      // Room queue auto-advance: move to next track in shared queue
      if (roomState.isInRoom && roomState.canControl && roomState.sharedQueue.length > 0) {
        const nextIndex = roomState.currentIndex + 1
        if (nextIndex < roomState.sharedQueue.length) {
          console.log('[Player] Auto-advancing to next track in room queue:', nextIndex)
          // Broadcast new index to room (will trigger queue sync)
          roomSync.handleQueueChange(roomState.sharedQueue, nextIndex)
        } else {
          console.log('[Player] Reached end of room queue')
        }
      }
    },
    [dispatch, dataProvider, roomState, roomSync],
  )

  const onCoverClick = useCallback((mode, audioLists, audioInfo) => {
    if (mode === 'full' && audioInfo?.song?.albumId) {
      window.location.href = `#/album/${audioInfo.song.albumId}/show`
    }
  }, [])

  const onBeforeDestroy = useCallback(() => {
    return new Promise((resolve, reject) => {
      dispatch(clearQueue())
      reject()
    })
  }, [dispatch])

  if (!visible) {
    document.title = 'Navidrome'
  }

  const handlers = useMemo(
    () => keyHandlers(audioInstance, playerState),
    [audioInstance, playerState],
  )

  useEffect(() => {
    if (isMobilePlayer && audioInstance) {
      audioInstance.volume = 1
    }
  }, [isMobilePlayer, audioInstance])

  // Listen for room state changes and apply them
  // Track which room track we're loading to prevent infinite loop
  const loadingTrackIdRef = useRef(null)

  // Auto-load room track when joining with different track
  useEffect(() => {
    const roomTrackId = roomState.currentTrackId
    const currentTrackId = playerState.current?.trackId

    // Skip if already loading this track
    if (loadingTrackIdRef.current === roomTrackId) {
      return
    }

    if (roomState.isInRoom && roomTrackId && roomTrackId !== currentTrackId) {
      console.log('[Player] Room track mismatch, auto-loading:', roomTrackId)
      loadingTrackIdRef.current = roomTrackId
      // Set flag to suppress broadcasts during auto-load (prevents desyncing room)
      roomSync.loadingRoomTrackRef.current = true
      dataProvider
        .getOne('song', { id: roomTrackId })
        .then((response) => {
          console.log('[Player] Fetched room track, loading:', response.data)
          dispatch(setTrack(response.data))
        })
        .catch((error) => {
          console.error('[Player] Failed to load room track:', error)
          // Clear flags on error
          roomSync.loadingRoomTrackRef.current = false
          loadingTrackIdRef.current = null
        })
    } else if (roomTrackId === currentTrackId) {
      // Track loaded successfully, clear loading flag
      loadingTrackIdRef.current = null
    }
  }, [roomState.isInRoom, roomState.currentTrackId, playerState.current?.trackId, dataProvider, dispatch, roomSync])

  // DEBUG: Log all native HTML5 audio events to trace what happens during remote seek
  useEffect(() => {
    if (!audioInstance) return

    const events = ['play', 'playing', 'pause', 'seeking', 'seeked', 'timeupdate', 'loadstart', 'canplay']
    const handlers = {}

    events.forEach(eventName => {
      handlers[eventName] = () => {
        console.log(`[NativeAudio] ${eventName} event fired, paused=${audioInstance.paused}, currentTime=${audioInstance.currentTime.toFixed(2)}`)
      }
      audioInstance.addEventListener(eventName, handlers[eventName])
    })

    return () => {
      events.forEach(eventName => {
        audioInstance.removeEventListener(eventName, handlers[eventName])
      })
    }
  }, [audioInstance])

  // Listen for seek events and broadcast to room
  useEffect(() => {
    if (!audioInstance) return

    const handleSeeked = () => {
      const currentTime = audioInstance.currentTime
      const wasPaused = audioInstance.paused

      // Don't broadcast if this was a remote seek we applied (check time match)
      if (roomSync.lastRemoteSeekTime.current !== null) {
        const timeDiff = Math.abs(currentTime - roomSync.lastRemoteSeekTime.current)
        if (timeDiff < 0.1) {
          console.log('[Player] Skipping seek broadcast - was remote seek', {
            currentTime,
            remoteSeekTime: roomSync.lastRemoteSeekTime.current,
            diff: timeDiff,
          })
          roomSync.lastRemoteSeekTime.current = null  // Clear after checking
          return
        }
      }

      const trackId = playerState.current?.trackId
      if (trackId && roomState.isInRoom) {
        // Block seeking if user doesn't have control permission
        if (!roomState.canControl) {
          // Prevent infinite loop: if we're already blocking a seek, don't trigger another
          if (blockingSeekRef.current) {
            blockingSeekRef.current = false
            return
          }

          console.log('[Player] Seek blocked - no control permission, reverting to server position')
          blockingSeekRef.current = true

          // Revert to server position
          const serverPosition = roomState.currentPosition / 1000
          if (Math.abs(currentTime - serverPosition) > 0.1) {
            audioInstance.currentTime = serverPosition
          }
          return
        }

        // If seeking while paused, expect library to auto-play and reverse it
        if (wasPaused) {
          console.log('[Player] User seeked while paused, expecting auto-play (will reverse)')
          roomSync.expectingAutoPlayRef.current = true
        }

        // Read play state directly from audio element at seek time to avoid stale ref values
        roomSync.handleSeek({
          trackId,
          currentTime: currentTime,
          isPlaying: !wasPaused,  // Use the paused state we captured
        })
      }
    }

    audioInstance.addEventListener('seeked', handleSeeked)
    return () => audioInstance.removeEventListener('seeked', handleSeeked)
  }, [audioInstance, playerState.current, isCurrentlyPlaying, roomState.isInRoom, roomState.canControl, roomState.currentPosition, roomSync])
  const prevRoomStateRef = useRef({
    isPlaying: false,
    currentPosition: 0,
    currentTrackId: null,
    isInRoom: false,
  })
  const prevPlayerTrackRef = useRef(null)

  useEffect(() => {
    // Apply remote state changes if we're in a room and state changed
    if (roomState.isInRoom && audioInstance) {
      const prevState = prevRoomStateRef.current
      const currentTrackId = playerState.current?.trackId

      const hasStateChanged =
        prevState.isPlaying !== roomState.isPlaying ||
        prevState.currentPosition !== roomState.currentPosition ||
        prevState.currentTrackId !== roomState.currentTrackId

      // Also sync when player track just became equal to room track (auto-loaded)
      const justLoadedRoomTrack =
        currentTrackId === roomState.currentTrackId &&
        prevPlayerTrackRef.current !== currentTrackId

      if (hasStateChanged || justLoadedRoomTrack) {
        // Only apply if room has a track (skip if room is empty/idle)
        if (roomState.currentTrackId) {
          console.log('[Player] Applying room state change:', {
            prev: prevState,
            next: roomState,
            currentTrack: currentTrackId,
            reason: hasStateChanged ? 'state changed' : 'just loaded room track',
          })
          // Apply remote state - the play/pause handlers will update isCurrentlyPlaying
          roomSync.applyRemoteState({
            isPlaying: roomState.isPlaying,
            currentPosition: roomState.currentPosition,
            currentTrackId: roomState.currentTrackId,
            userId: roomState.userId,
          }, currentTrackId)
        }

        // Clear loading flag after sync attempt (even if it returned early)
        if (roomSync.loadingRoomTrackRef.current) {
          console.log('[Player] Cleared loadingRoomTrackRef after sync')
          roomSync.loadingRoomTrackRef.current = false
        }
      }

      // CRITICAL: Only update prevRoomStateRef after successfully processing
      // If we update it while audioInstance is null, we lose the state change
      prevRoomStateRef.current = {
        isPlaying: roomState.isPlaying,
        currentPosition: roomState.currentPosition,
        currentTrackId: roomState.currentTrackId,
        isInRoom: roomState.isInRoom,
      }

      // Track player's previous track to detect auto-loads
      prevPlayerTrackRef.current = currentTrackId
    }
  }, [roomState.isPlaying, roomState.currentPosition, roomState.currentTrackId, roomState.isInRoom, audioInstance, playerState.current, roomSync])

  // Sync room's shared queue to player queue
  const prevQueueRef = useRef(null)
  const prevIsInRoomRef = useRef(false)

  useEffect(() => {
    if (!roomState.isInRoom) {
      prevIsInRoomRef.current = false
      return
    }

    // If we just joined a room, force queue replacement even if empty
    const justJoinedRoom = roomState.isInRoom && !prevIsInRoomRef.current
    prevIsInRoomRef.current = true

    if (!roomState.sharedQueue || roomState.sharedQueue.length === 0) {
      // If room has empty queue, clear player queue (always, not just when joining)
      console.log('[Player] Room queue is empty, clearing player queue')
      dispatch(clearQueue())
      return
    }

    // Check if queue actually changed (avoid re-fetching on every render)
    const queueKey = JSON.stringify(roomState.sharedQueue)
    if (prevQueueRef.current === queueKey && !justJoinedRoom) {
      return
    }
    prevQueueRef.current = queueKey

    console.log('[Player] Room queue changed, syncing to player:', {
      sharedQueue: roomState.sharedQueue,
      currentIndex: roomState.currentIndex,
      justJoinedRoom
    })

    // Fetch full track data for all queue items
    Promise.all(
      roomState.sharedQueue.map(trackId =>
        dataProvider.getOne('song', { id: trackId }).catch(err => {
          console.error('[Player] Failed to fetch track:', trackId, err)
          return null
        })
      )
    ).then(responses => {
      const tracks = responses.filter(r => r !== null).map(r => r.data)
      console.log('[Player] Fetched room queue tracks:', tracks)

      // Map tracks to audio player format
      const audioLists = tracks.map(track => mapToAudioLists(track))
      console.log('[Player] Mapped to audioLists:', audioLists)

      // Sync queue to player with clear flag to force complete replacement
      if (audioLists.length > 0) {
        const currentTrack = audioLists[roomState.currentIndex]
        dispatch(syncQueue({ trackId: currentTrack?.trackId }, audioLists, true))
      } else {
        // Empty queue - clear player queue
        dispatch(clearQueue())
      }
    })
  }, [roomState.isInRoom, roomState.sharedQueue, roomState.currentIndex, dataProvider, dispatch])

  return (
    <ThemeProvider theme={createMuiTheme(theme)}>
      <ReactJkMusicPlayer
        {...options}
        className={classes.player}
        onAudioListsChange={onAudioListsChange}
        onAudioVolumeChange={onAudioVolumeChange}
        onAudioProgress={onAudioProgress}
        onBeforeAudioPlay={onBeforeAudioPlay}
        onAudioPlay={onAudioPlay}
        onAudioPlayTrackChange={onAudioPlayTrackChange}
        onAudioPause={onAudioPause}
        onPlayModeChange={(mode) => dispatch(setPlayMode(mode))}
        onAudioEnded={onAudioEnded}
        onCoverClick={onCoverClick}
        onBeforeDestroy={onBeforeDestroy}
        getAudioInstance={setAudioInstance}
      />
      <RoomIndicator />
      <GlobalHotKeys handlers={handlers} keyMap={keyMap} allowChanges />
    </ThemeProvider>
  )
}

export { Player }
