/**
 * Syncplay Room Controls Component
 *
 * Displays current room information when user is in a syncplay room.
 * Shows as a clickable chip in the UI that opens a popover with room details.
 *
 * Features:
 *   - Chip shows room name and participant count
 *   - Popover displays:
 *     - Room name and host badge (if current user is host)
 *     - Room ID with copy-to-clipboard button
 *     - Participant list with host indicator
 *     - Leave room button
 *   - Clipboard fallback for non-secure contexts (http://)
 *   - Auto-hides when user is not in a room
 *
 * Visual Indicators:
 *   - Host badge: Green badge next to room name and participant name
 *   - Participant count: Shown in chip label (e.g., "Room Name (3)")
 *
 * State Management:
 *   - Reads room state from Redux store
 *   - Dispatches leaveRoom() action when user leaves
 *
 * Usage:
 *   <RoomControls />
 */
import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Box,
  Chip,
  IconButton,
  Popover,
  Typography,
  List,
  ListItem,
  ListItemText,
  Button,
  Divider,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@material-ui/core'
import { makeStyles } from '@material-ui/core/styles'
import {
  People as PeopleIcon,
  ExitToApp as ExitIcon,
  FileCopy as CopyIcon,
  Lock as LockIcon,
  Delete as DeleteIcon,
} from '@material-ui/icons'
import { useTranslate, useNotify } from 'react-admin'
import { leaveRoom } from '../actions'
import { roomService } from './roomService'

const useStyles = makeStyles((theme) => ({
  roomChip: {
    marginLeft: theme.spacing(1),
    cursor: 'pointer',
  },
  popoverContent: {
    padding: theme.spacing(2),
    minWidth: 300,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
  },
  participants: {
    maxHeight: 200,
    overflow: 'auto',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: theme.spacing(2),
  },
  hostBadge: {
    backgroundColor: theme.palette.success.main,
    color: theme.palette.success.contrastText,
    marginLeft: theme.spacing(1),
    fontSize: '0.7rem',
    padding: '2px 6px',
    borderRadius: 4,
  },
  modeSection: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: theme.spacing(1),
  },
  modeIcon: {
    marginRight: theme.spacing(1),
    verticalAlign: 'middle',
  },
  participantItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kickButton: {
    marginLeft: theme.spacing(1),
  },
}))

export const RoomControls = () => {
  const classes = useStyles()
  const translate = useTranslate()
  const notify = useNotify()
  const dispatch = useDispatch()
  const roomState = useSelector((state) => state.room)

  const [anchorEl, setAnchorEl] = useState(null)

  if (!roomState.isInRoom) {
    return null
  }

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleLeaveRoom = async () => {
    try {
      await roomService.leave()

      dispatch(leaveRoom())
      notify('room.left', { type: 'info' })
      handleClose()
    } catch (error) {
      console.error('Error leaving room:', error)
      notify('room.errors.leaveFailed', { type: 'error' })
    }
  }

  const handleCopyRoomId = () => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(roomState.roomId)
        .then(() => {
          notify('room.idCopied', { type: 'info' })
        })
        .catch((err) => {
          notify('room.errors.copyFailed', { type: 'warning' })
        })
    } else {
      // Fallback for non-secure contexts
      const textArea = document.createElement('textarea')
      textArea.value = roomState.roomId
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        notify('room.idCopied', { type: 'info' })
      } catch (err) {
        notify('room.errors.copyFailed', { type: 'warning' })
      }
      document.body.removeChild(textArea)
    }
  }

  const handleToggleHostControl = async () => {
    try {
      const newMode = !roomState.hostControlOnly
      await roomService.toggleHostControl(newMode)
      notify(
        newMode
          ? 'room.controls.hostControlEnabled'
          : 'room.controls.fluffyPartyEnabled',
        { type: 'info' }
      )
    } catch (error) {
      console.error('Error toggling host control:', error)
      notify('room.errors.toggleFailed', { type: 'error' })
    }
  }

  const handleKickParticipant = async (userId, userName) => {
    if (!window.confirm(`Kick ${userName} from the room?`)) {
      return
    }

    try {
      await roomService.kickParticipant(userId)
      notify('room.controls.participantKicked', { type: 'info' })
    } catch (error) {
      console.error('Error kicking participant:', error)
      notify('room.errors.kickFailed', { type: 'error' })
    }
  }

  const open = Boolean(anchorEl)
  const id = open ? 'room-popover' : undefined
  const currentUserId = localStorage.getItem('userId')

  return (
    <>
      <Tooltip title={translate('room.controls.tooltip')}>
        <Chip
          icon={<PeopleIcon />}
          label={`${roomState.roomName || translate('room.controls.inRoom')} (${roomState.participants.length})`}
          onClick={handleClick}
          className={classes.roomChip}
          color="primary"
          size="small"
        />
      </Tooltip>

      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
      >
        <Box className={classes.popoverContent}>
          <Box className={classes.header}>
            <Box>
              <Typography variant="h6">
                {roomState.roomName || translate('room.controls.roomDetails')}
              </Typography>
              {roomState.isHost && (
                <span className={classes.hostBadge}>
                  {translate('room.controls.host')}
                </span>
              )}
            </Box>
            <IconButton size="small" onClick={handleCopyRoomId}>
              <CopyIcon fontSize="small" />
            </IconButton>
          </Box>

          <Typography variant="caption" color="textSecondary" gutterBottom>
            {translate('room.controls.roomId')}: {roomState.roomId}
          </Typography>

          <Divider style={{ margin: '12px 0' }} />

          <Box className={classes.modeSection}>
            {roomState.hostControlOnly ? (
              <>
                <LockIcon className={classes.modeIcon} fontSize="small" />
                <Typography variant="body2">Host Control</Typography>
              </>
            ) : (
              <>
                <PeopleIcon className={classes.modeIcon} fontSize="small" />
                <Typography variant="body2">Fluffy Party</Typography>
              </>
            )}
          </Box>

          {roomState.isHost && (
            <FormControlLabel
              control={
                <Switch
                  checked={!roomState.hostControlOnly}
                  onChange={handleToggleHostControl}
                  color="primary"
                  size="small"
                />
              }
              label={
                <Typography variant="caption">
                  Enable Fluffy Party Mode
                </Typography>
              }
            />
          )}

          <Divider style={{ margin: '12px 0' }} />

          <Typography variant="subtitle2" gutterBottom>
            {translate('room.controls.participants')} (
            {roomState.participants.length})
          </Typography>
          <List className={classes.participants} dense>
            {roomState.participants.length === 0 ? (
              <ListItem>
                <ListItemText
                  primary={translate('room.controls.noParticipants')}
                />
              </ListItem>
            ) : (
              roomState.participants.map((participant) => (
                <ListItem key={participant.userId}>
                  <Box className={classes.participantItem}>
                    <ListItemText
                      primary={participant.userName}
                      secondary={
                        participant.userId === roomState.hostUserId
                          ? translate('room.controls.host')
                          : null
                      }
                    />
                    {roomState.isHost &&
                      participant.userId !== currentUserId && (
                        <IconButton
                          size="small"
                          onClick={() =>
                            handleKickParticipant(
                              participant.userId,
                              participant.userName
                            )
                          }
                          className={classes.kickButton}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                  </Box>
                </ListItem>
              ))
            )}
          </List>

          <Box className={classes.footer}>
            <Button
              variant="outlined"
              color="secondary"
              size="small"
              startIcon={<ExitIcon />}
              onClick={handleLeaveRoom}
            >
              {translate('room.controls.leave')}
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  )
}
