import React, { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  IconButton,
  Button,
  CircularProgress,
  Typography,
  Box,
} from '@material-ui/core'
import { makeStyles } from '@material-ui/core/styles'
import { Refresh, Lock, People as PeopleIcon } from '@material-ui/icons'
import { roomService } from './roomService'
import { useDispatch } from 'react-redux'
import { updateRoomState } from '../actions'

const useStyles = makeStyles((theme) => ({
  title: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  table: {
    minWidth: 500,
  },
  modeIcon: {
    marginRight: theme.spacing(1),
    verticalAlign: 'middle',
  },
  emptyState: {
    padding: theme.spacing(4),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(4),
  },
}))

export const RoomList = ({ open, onClose, embedded = false }) => {
  const classes = useStyles()
  const dispatch = useDispatch()
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchRooms = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await roomService.listRooms()
      setRooms(data)
      console.log('[RoomList] Fetched rooms:', data)
    } catch (err) {
      console.error('[RoomList] Failed to fetch rooms:', err)
      setError('Failed to load rooms')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) {
      fetchRooms()
      // Auto-refresh every 5 seconds
      const interval = setInterval(fetchRooms, 5000)
      return () => clearInterval(interval)
    }
  }, [open, fetchRooms])

  const handleJoin = async (roomId) => {
    try {
      console.log('[RoomList] Joining room:', roomId)
      const roomData = await roomService.join(roomId)
      console.log('[RoomList] Joined room:', roomData)

      // Update Redux state with room data
      dispatch(updateRoomState(roomData))

      onClose()
    } catch (err) {
      console.error('[RoomList] Failed to join room:', err)
      setError(`Failed to join room: ${err.message}`)
    }
  }

  const content = (
    <>
      {!embedded && (
        <Box className={classes.title}>
          <span>Active Rooms</span>
          <IconButton onClick={fetchRooms} disabled={loading} size="small">
            <Refresh />
          </IconButton>
        </Box>
      )}
      {loading && rooms.length === 0 ? (
        <Box className={classes.loadingContainer}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Box className={classes.emptyState}>
          <Typography color="error">{error}</Typography>
          <Button onClick={fetchRooms} style={{ marginTop: 16 }}>
            Retry
          </Button>
        </Box>
      ) : rooms.length === 0 ? (
        <Box className={classes.emptyState}>
          <PeopleIcon style={{ fontSize: 48, marginBottom: 16 }} />
          <Typography variant="h6">No Active Rooms</Typography>
          <Typography variant="body2">
            Create a room to start listening together
          </Typography>
        </Box>
      ) : (
        <Table className={classes.table}>
          <TableHead>
            <TableRow>
              <TableCell>Room Name</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell align="right">Participants</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rooms.map((room) => (
              <TableRow key={room.id}>
                <TableCell>{room.name}</TableCell>
                <TableCell>
                  {room.hostControlOnly ? (
                    <>
                      <Lock className={classes.modeIcon} fontSize="small" />
                      Host Control
                    </>
                  ) : (
                    <>
                      <PeopleIcon className={classes.modeIcon} fontSize="small" />
                      Fluffy Party
                    </>
                  )}
                </TableCell>
                <TableCell align="right">{room.participantCount}</TableCell>
                <TableCell align="right">
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    onClick={() => handleJoin(room.id)}
                  >
                    Join
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )

  if (embedded) {
    return content
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box className={classes.title}>
          <span>Active Rooms</span>
          <IconButton onClick={fetchRooms} disabled={loading} size="small">
            <Refresh />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>{content}</DialogContent>
    </Dialog>
  )
}
