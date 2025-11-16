import React, { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useGetOne } from 'react-admin'
import { GlobalHotKeys } from 'react-hotkeys'
import IconButton from '@material-ui/core/IconButton'
import { useMediaQuery, Tooltip } from '@material-ui/core'
import { RiSaveLine } from 'react-icons/ri'
import { MdSync } from 'react-icons/md'
import { LoveButton, useToggleLove } from '../common'
import { openSaveQueueDialog } from '../actions'
import { keyMap } from '../hotkeys'
import { makeStyles } from '@material-ui/core/styles'
import { roomService } from '../room/roomService'

const useStyles = makeStyles((theme) => ({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'flex-end',
    gap: '0.5rem',
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  mobileListItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    listStyle: 'none',
    padding: theme.spacing(0.5),
    margin: 0,
    height: 24,
  },
  button: {
    width: '2.5rem',
    height: '2.5rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  mobileButton: {
    width: 24,
    height: 24,
    padding: 0,
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
  },
  mobileIcon: {
    fontSize: '18px',
    display: 'flex',
    alignItems: 'center',
  },
}))

const PlayerToolbar = ({ id, isRadio, audioInstance }) => {
  const dispatch = useDispatch()
  const { data, loading } = useGetOne('song', id, { enabled: !!id && !isRadio })
  const [toggleLove, toggling] = useToggleLove('song', data)
  const isDesktop = useMediaQuery('(min-width:810px)')
  const classes = useStyles()
  const roomState = useSelector((state) => state.room)

  const handlers = {
    TOGGLE_LOVE: useCallback(() => toggleLove(), [toggleLove]),
  }

  const handleSaveQueue = useCallback(
    (e) => {
      dispatch(openSaveQueueDialog())
      e.stopPropagation()
    },
    [dispatch],
  )

  const handleSyncRoom = useCallback(
    async (e) => {
      e.stopPropagation()
      if (!audioInstance || !id || isRadio || !roomState.isInRoom) {
        return
      }

      try {
        const state = {
          isPlaying: !audioInstance.paused,
          currentPosition: Math.floor(audioInstance.currentTime * 1000),
          currentTrackId: id,
        }
        console.log('[PlayerToolbar] Manual sync triggered:', state)
        await roomService.updateState(state)
      } catch (error) {
        console.error('[PlayerToolbar] Failed to sync room:', error)
      }
    },
    [audioInstance, id, isRadio, roomState.isInRoom],
  )

  const buttonClass = isDesktop ? classes.button : classes.mobileButton
  const listItemClass = isDesktop ? classes.toolbar : classes.mobileListItem

  const saveQueueButton = (
    <IconButton
      size={isDesktop ? 'small' : undefined}
      onClick={handleSaveQueue}
      disabled={isRadio}
      data-testid="save-queue-button"
      className={buttonClass}
    >
      <RiSaveLine className={!isDesktop ? classes.mobileIcon : undefined} />
    </IconButton>
  )

  const loveButton = (
    <LoveButton
      record={data}
      resource={'song'}
      size={isDesktop ? undefined : 'inherit'}
      disabled={loading || toggling || !id || isRadio}
      className={buttonClass}
    />
  )

  const syncButton = roomState.isInRoom && (
    <Tooltip title="Sync playback state to room">
      <IconButton
        size={isDesktop ? 'small' : undefined}
        onClick={handleSyncRoom}
        disabled={isRadio || !audioInstance}
        data-testid="sync-room-button"
        className={buttonClass}
      >
        <MdSync className={!isDesktop ? classes.mobileIcon : undefined} />
      </IconButton>
    </Tooltip>
  )

  return (
    <>
      <GlobalHotKeys keyMap={keyMap} handlers={handlers} allowChanges />
      {isDesktop ? (
        <li className={`${listItemClass} item`}>
          {saveQueueButton}
          {loveButton}
          {syncButton}
        </li>
      ) : (
        <>
          <li className={`${listItemClass} item`}>{saveQueueButton}</li>
          <li className={`${listItemClass} item`}>{loveButton}</li>
          {syncButton && <li className={`${listItemClass} item`}>{syncButton}</li>}
        </>
      )}
    </>
  )
}

export default PlayerToolbar
