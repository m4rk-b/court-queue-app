import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import {
  addAnnouncement,
  addAssignment,
  bookCourt,
  cancelBooking,
  clearQueue,
  createCourt,
  deleteCourt,
  getAnnouncements,
  getAssignments,
  getBookings,
  getCourtAvailability,
  getCourts,
  getQueues,
  joinQueue,
  leaveQueue,
  removeAssignment,
  resetAllQueues,
  updateCourt,
  finishMatch,
  getMatchHistory,
  assignToSlot,
  getQueuedMatchups,
  addQueuedMatchup,
  removeQueuedMatchup,
  startNextMatch,
} from './queue';
import { createAccount, loginAccount, getAccounts, type Account } from './accounts';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT ? Number(process.env.PORT) : 4100;

app.post('/api/accounts', (req, res) => {
  try {
    const account = createAccount(req.body);
    res.json(account);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create account';
    res.status(400).json({ error: message });
  }
});

app.post('/api/accounts/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const account = loginAccount(username, password);
  if (!account) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json(account);
});

app.get('/api/queues', async (_req, res) => {
  const q = await getQueues();
  res.json(q);
});

app.get('/api/accounts/ranks', (_req, res) => {
  const ranks: Record<string, string> = {};
  getAccounts().forEach(a => {
    if (a.role === 'player' && a.rank) {
      ranks[a.name] = a.rank;
    }
  });
  res.json(ranks);
});

// Debug: list all in-memory accounts (username, hashed/plain password stored in memory)
app.get('/api/admin/accounts', (_req, res) => {
  try {
    const list = getAccounts().map(a => ({ id: a.id, name: a.name, username: a.username, password: a.password, role: a.role, clubName: a.clubName, rank: a.rank }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Unable to read accounts' });
  }
});

app.get('/api/status', async (_req, res) => {
  const [queues, availability] = await Promise.all([getQueues(), getCourtAvailability()]);
  res.json({ queues, availability, courts: getCourts(), announcements: getAnnouncements(), assignments: getAssignments() });
});

app.post('/api/queues/:court/join', async (req, res) => {
  const { court } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const q = await joinQueue(court, name);
  const availability = await getCourtAvailability();
  io.emit('queues', q);
  io.emit('announcement', { type: 'join', court, name, availability });
  res.json(q);
});

app.post('/api/queues/:court/leave', async (req, res) => {
  const { court } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const q = await leaveQueue(court, name);
  const availability = await getCourtAvailability();
  io.emit('queues', q);
  io.emit('announcement', { type: 'leave', court, name, availability });
  res.json(q);
});

app.get('/api/admin/courts', (_req, res) => {
  res.json(getCourts());
});

app.post('/api/admin/courts', (req, res) => {
  const next = createCourt(req.body);
  io.emit('courts', next);
  res.json(next);
});

app.put('/api/admin/courts/:id', (req, res) => {
  const { id } = req.params;
  const next = updateCourt(id, req.body);
  io.emit('courts', next);
  res.json(next);
});

app.delete('/api/admin/courts/:id', (req, res) => {
  const { id } = req.params;
  const next = deleteCourt(id);
  io.emit('courts', next);
  res.json(next);
});

app.get('/api/admin/announcements', (_req, res) => {
  res.json(getAnnouncements());
});

app.post('/api/admin/announcements', (req, res) => {
  const next = addAnnouncement(req.body.message);
  io.emit('announcements', next);
  res.json(next);
});

app.post('/api/admin/queues/:court/clear', async (req, res) => {
  const { court } = req.params;
  const q = await clearQueue(court);
  const availability = await getCourtAvailability();
  io.emit('queues', q);
  io.emit('availability', availability);
  res.json(q);
});

app.post('/api/admin/queues/reset', async (_req, res) => {
  const q = await resetAllQueues();
  const availability = await getCourtAvailability();
  io.emit('queues', q);
  io.emit('availability', availability);
  res.json(q);
});

app.get('/api/bookings', (_req, res) => {
  res.json(getBookings());
});

app.post('/api/bookings/:court', (req, res) => {
  const { court } = req.params;
  const { slot, name, date } = req.body;
  if (!slot || !name || !date) return res.status(400).json({ error: 'slot, name and date required' });
  const bookings = bookCourt(court, slot, name, date);
  io.emit('bookings', bookings);
  res.json(bookings);
});

function getBookingStartTimeDate(dateStr: string, slotStr: string): Date | null {
  try {
    const startTimePart = slotStr.split(' - ')[0].trim();
    const match = startTimePart.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const isPM = match[3].toUpperCase() === 'PM';
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0);
  } catch (e) {
    return null;
  }
}

function canCancelBooking(dateStr: string, slotStr: string): boolean {
  const bookingTime = getBookingStartTimeDate(dateStr, slotStr);
  if (!bookingTime) return true;
  const now = new Date();
  const diffMs = bookingTime.getTime() - now.getTime();
  const fourHoursMs = 4 * 60 * 60 * 1000;
  return diffMs >= fourHoursMs;
}

app.delete('/api/bookings/:court', (req, res) => {
  const { court } = req.params;
  const { slot, date } = req.query;
  const decodedDate = decodeURIComponent(String(date || ''));
  const decodedSlot = decodeURIComponent(String(slot || ''));

  if (!canCancelBooking(decodedDate, decodedSlot)) {
    return res.status(400).json({ error: 'Bookings cannot be cancelled within 4 hours of the scheduled time.' });
  }

  const updatedBookings = cancelBooking(court, decodedSlot, decodedDate);
  io.emit('bookings', updatedBookings);
  res.json(updatedBookings);
});

app.get('/api/assignments', (_req, res) => {
  res.json(getAssignments());
});

app.post('/api/qm/assignments/:court', async (req, res) => {
  const { court } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const assignments = addAssignment(court, name);
  const [queues, matchups] = [await getQueues(), getQueuedMatchups()];
  io.emit('assignments', assignments);
  io.emit('queues', queues);
  io.emit('matchups', matchups);
  res.json(assignments);
});

app.delete('/api/qm/assignments/:court/:name', async (req, res) => {
  const { court, name } = req.params;
  const assignments = removeAssignment(court, decodeURIComponent(name));
  const [queues, matchups] = [await getQueues(), getQueuedMatchups()];
  io.emit('assignments', assignments);
  io.emit('queues', queues);
  io.emit('matchups', matchups);
  res.json(assignments);
});

app.get('/api/matches/history', (_req, res) => {
  res.json(getMatchHistory());
});

app.post('/api/qm/matches/finish/:court', async (req, res) => {
  const { court } = req.params;
  const { scoreA, scoreB } = req.body;
  const result = await finishMatch(court, Number(scoreA || 0), Number(scoreB || 0));
  
  const [queues, availability] = await Promise.all([getQueues(), getCourtAvailability()]);
  io.emit('assignments', result.assignments);
  io.emit('history', result.history);
  io.emit('queues', queues);
  io.emit('availability', availability);
  io.emit('matchups', getQueuedMatchups());
  res.json({ ...result, queues, availability, matchups: getQueuedMatchups() });
});

app.post('/api/qm/assignments/:court/slot/:index', async (req, res) => {
  const { court, index } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const updatedAssignments = assignToSlot(court, Number(index), name);
  await leaveQueue(court, name);

  const [queues, availability] = await Promise.all([getQueues(), getCourtAvailability()]);
  io.emit('assignments', updatedAssignments);
  io.emit('queues', queues);
  io.emit('availability', availability);
  io.emit('matchups', getQueuedMatchups());

  res.json({ assignments: updatedAssignments, queues, availability, matchups: getQueuedMatchups() });
});

app.get('/api/matchups', (_req, res) => {
  res.json(getQueuedMatchups());
});

app.post('/api/qm/matchups', async (req, res) => {
  const { matchType, teamA, teamB, courtId } = req.body;
  const players = [...(teamA || []), ...(teamB || [])];
  
  for (const p of players) {
    if (courtId) {
      await leaveQueue(courtId, p);
    }
  }

  const matchups = addQueuedMatchup(matchType, teamA, teamB, courtId);
  const queues = await getQueues();

  io.emit('matchups', matchups);
  io.emit('queues', queues);

  res.json({ matchups, queues });
});

app.delete('/api/qm/matchups/:id', async (req, res) => {
  const { id } = req.params;
  const { courtId } = req.query;

  const currentMatchups = getQueuedMatchups();
  const match = currentMatchups.find(m => m.id === id);
  if (match && courtId) {
    const players = [...match.teamA, ...match.teamB];
    for (const p of players) {
      await joinQueue(String(courtId), p);
    }
  }

  const updated = removeQueuedMatchup(id);
  const queues = await getQueues();

  io.emit('matchups', updated);
  io.emit('queues', queues);

  res.json({ matchups: updated, queues });
});

app.post('/api/qm/courts/:courtId/start-next', async (req, res) => {
  const { courtId } = req.params;
  const result = startNextMatch(courtId);
  const [queues, availability] = await Promise.all([getQueues(), getCourtAvailability()]);

  io.emit('assignments', result.assignments);
  io.emit('matchups', result.matchups);
  io.emit('queues', queues);
  io.emit('availability', availability);

  res.json({ ...result, queues, availability });
});

io.on('connection', async socket => {
  const [queues, availability] = await Promise.all([getQueues(), getCourtAvailability()]);
  socket.emit('queues', queues);
  socket.emit('availability', availability);
  socket.emit('bookings', getBookings());
  socket.emit('courts', getCourts());
  socket.emit('announcements', getAnnouncements());
  socket.emit('assignments', getAssignments());
  socket.emit('history', getMatchHistory());
  socket.emit('matchups', getQueuedMatchups());
});

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
