/**
 * Room Indicator Component
 *
 * Displays visual indicators when the user is in a syncplay room.
 * Shows room mode (Host Control / Fluffy Party) and sync status on the player.
 *
 * Features:
 *   - Lock icon for Host Control mode
 *   - People icon for Fluffy Party mode
 *   - Room name badge
 *   - Sync status indicator
 *   - Only visible when user is in a room
 *
 * Usage:
 *   <RoomIndicator />
 */
import React from 'react'
import { useSelector } from 'react-redux'
import { Box, Chip, Tooltip } from '@material-ui/core'
import { makeStyles } from '@material-ui/core/styles'
import { Lock as LockIcon, People as PeopleIcon, SyncAlt as SyncIcon } from '@material-ui/icons'

const useStyles = makeStyles((theme) => ({
  indicator: {
    position: 'fixed',
    bottom: 90,
    right: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    zIndex: 99,
    pointerEvents: 'none',
    '@media screen and (max-width:810px)': {
      bottom: 70,
      right: 10,
    },
  },
  chip: {
    pointerEvents: 'auto',
  },
  modeChip: {
    backgroundColor: theme.palette.background.paper,
    boxShadow: theme.shadows[2],
  },
  syncChip: {
    backgroundColor: theme.palette.success.light,
    color: theme.palette.success.contrastText,
    boxShadow: theme.shadows[2],
  },
}))

export const RoomIndicator = () => {
  const classes = useStyles()
  const roomState = useSelector((state) => state.room)

  if (!roomState.isInRoom) {
    return null
  }

  return (
    <Box className={classes.indicator}>
      <Tooltip title={roomState.hostControlOnly ? 'Host Control Mode' : 'Fluffy Party Mode'}>
        <Chip
          icon={roomState.hostControlOnly ? <LockIcon /> : <PeopleIcon />}
          label={roomState.hostControlOnly ? 'Host Control' : 'Fluffy Party'}
          size="small"
          className={`${classes.chip} ${classes.modeChip}`}
        />
      </Tooltip>
      <Tooltip title={`Synced with ${roomState.roomName}`}>
        <Chip
          icon={<SyncIcon />}
          label={roomState.roomName || 'Room'}
          size="small"
          className={`${classes.chip} ${classes.syncChip}`}
          color="primary"
        />
      </Tooltip>
    </Box>
  )
}
