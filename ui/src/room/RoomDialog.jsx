/**
 * Syncplay Room Dialog Component
 *
 * Modal dialog for creating or joining syncplay rooms. Provides a tabbed interface
 * with two modes: Create (new room) and Join (existing room by ID).
 *
 * Features:
 *   - Create Tab: Input room name, creates room and sets user as host
 *   - Join Tab: Input room ID, joins existing room and syncs current state
 *   - Error display for failed operations
 *   - Loading states during API calls
 *   - Enter key support for form submission
 *
 * State Sync on Join:
 *   When joining a room, the component dispatches ROOM_UPDATE_STATE with the
 *   room's current playback state (currentTrackId, currentPosition, isPlaying).
 *   This allows the Player component to sync immediately on join.
 *
 * Props:
 *   @param {boolean} open - Whether dialog is visible
 *   @param {function} onClose - Callback when dialog should close
 *
 * Usage:
 *   <RoomDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
 */
import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Tab,
  Tabs,
  Box,
  Typography,
} from '@material-ui/core'
import { useTranslate, useNotify } from 'react-admin'
import { updateRoom, setRoomError } from '../actions'
import { roomService } from './roomService'
import { RoomList } from './RoomList'

const TabPanel = ({ children, value, index, ...other }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`room-tabpanel-${index}`}
      aria-labelledby={`room-tab-${index}`}
      {...other}
    >
      {value === index && <Box p={3}>{children}</Box>}
    </div>
  )
}

export const RoomDialog = ({ open, onClose }) => {
  const translate = useTranslate()
  const notify = useNotify()
  const dispatch = useDispatch()
  const roomState = useSelector((state) => state.room)
  const playerState = useSelector((state) => state.player)

  const [tabValue, setTabValue] = useState(0)
  const [roomName, setRoomName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [loading, setLoading] = useState(false)

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue)
  }

  const handleCreateRoom = async () => {
    if (!roomName.trim()) {
      notify('room.errors.nameRequired', { type: 'warning' })
      return
    }

    setLoading(true)
    try {
      // Capture current local playback state to transfer to room
      const initialState = {
        queueItems: playerState.queue.map(item => item.trackId).filter(Boolean),
        currentIndex: playerState.savedPlayIndex || 0,
        currentTrackId: playerState.current?.trackId || null,
        currentPosition: Math.floor((playerState.current?.currentTime || 0) * 1000),
        isPlaying: playerState.current?.paused === false,
      }

      console.log('[RoomDialog] Creating room with initial state:', initialState)
      const room = await roomService.create(roomName, initialState)

      // Single unified update with complete room data from server
      dispatch(updateRoom(room))
      notify('room.created', { type: 'info' })
      onClose()
    } catch (error) {
      console.error('Error creating room:', error)
      dispatch(setRoomError(error.message || 'Failed to create room'))
      notify('room.errors.createFailed', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleJoinRoom = async () => {
    if (!roomId.trim()) {
      notify('room.errors.idRequired', { type: 'warning' })
      return
    }

    setLoading(true)
    try {
      const room = await roomService.join(roomId)

      // Single unified update with complete room data from server
      dispatch(updateRoom(room))
      notify('room.joined', { type: 'info' })
      onClose()
    } catch (error) {
      console.error('Error joining room:', error)
      dispatch(setRoomError(error.message || 'Failed to join room'))
      notify('room.errors.joinFailed', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setRoomName('')
    setRoomId('')
    setTabValue(0)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      aria-labelledby="room-dialog-title"
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle id="room-dialog-title">
        {translate('room.dialog.title')}
      </DialogTitle>
      <DialogContent>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="room tabs"
          indicatorColor="primary"
          textColor="primary"
        >
          <Tab label={translate('room.dialog.browseTab', { _: 'Browse' })} />
          <Tab label={translate('room.dialog.createTab')} />
          <Tab label={translate('room.dialog.joinTab')} />
        </Tabs>

        <TabPanel value={tabValue} index={0}>
          <RoomList open={open && tabValue === 0} onClose={handleClose} embedded />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Typography variant="body2" gutterBottom>
            {translate('room.dialog.createDescription')}
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label={translate('room.dialog.roomName')}
            type="text"
            fullWidth
            variant="outlined"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            disabled={loading}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleCreateRoom()
              }
            }}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <Typography variant="body2" gutterBottom>
            {translate('room.dialog.joinDescription')}
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label={translate('room.dialog.roomId')}
            type="text"
            fullWidth
            variant="outlined"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            disabled={loading}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleJoinRoom()
              }
            }}
          />
        </TabPanel>

        {roomState.error && (
          <Box mt={2}>
            <Typography color="error" variant="body2">
              {roomState.error}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color="primary" disabled={loading}>
          {translate('ra.action.cancel')}
        </Button>
        {tabValue === 1 && (
          <Button
            onClick={handleCreateRoom}
            color="primary"
            disabled={loading || !roomName.trim()}
          >
            {translate('room.dialog.create')}
          </Button>
        )}
        {tabValue === 2 && (
          <Button
            onClick={handleJoinRoom}
            color="primary"
            disabled={loading || !roomId.trim()}
          >
            {translate('room.dialog.join')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
