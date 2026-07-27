import { query } from './db';

export type Queues = Record<string, string[]>;

export type Court = {
  id: string;
  label: string;
  sport: string;
  slots: string[];
  active: boolean;
  matchType?: 'singles' | 'doubles';
};

export type Announcement = {
  id: number;
  message: string;
};

export type Booking = {
  slot: string;
  name: string;
  date: string;
};

const courts = new Map<string, Court>([
  ['badminton-1', { id: 'badminton-1', label: 'Badminton Court 1', sport: 'Badminton', slots: ['6:00 PM - 7:00 PM', '7:00 PM - 8:00 PM', '8:00 PM - 9:00 PM'], active: true, matchType: 'doubles' }],
  ['badminton-2', { id: 'badminton-2', label: 'Badminton Court 2', sport: 'Badminton', slots: ['6:00 PM - 7:00 PM', '7:00 PM - 8:00 PM', '8:00 PM - 9:00 PM'], active: true, matchType: 'doubles' }],
  ['basketball-1', { id: 'basketball-1', label: 'Basketball Court', sport: 'Basketball', slots: ['6:00 PM - 7:00 PM', '7:00 PM - 8:00 PM', '8:00 PM - 9:00 PM'], active: true, matchType: 'doubles' }],
  ['volleyball-1', { id: 'volleyball-1', label: 'Volleyball Court', sport: 'Volleyball', slots: ['6:00 PM - 7:00 PM', '7:00 PM - 8:00 PM', '8:00 PM - 9:00 PM'], active: true, matchType: 'doubles' }],
  ['pickleball-1', { id: 'pickleball-1', label: 'Pickleball Court', sport: 'Pickleball', slots: ['6:00 PM - 7:00 PM', '7:00 PM - 8:00 PM', '8:00 PM - 9:00 PM'], active: true, matchType: 'doubles' }]
]);

const announcements: Announcement[] = [{ id: 1, message: 'Welcome to the court queue hub.' }];
const bookings = new Map<string, Booking[]>();
const assignments = new Map<string, string[]>();

const memoryQueues = new Map<string, string[]>();

const testFirstNames = [
  'Mark', 'Kathy', 'David', 'Serena',
  'Roger', 'LeBron', 'Lionel', 'Tom',
  'Rafael', 'Cristiano', 'Stephen', 'Lewis'
];

setTimeout(async () => {
  try {
    for (const name of testFirstNames) {
      await query(
        'INSERT INTO queue_entries (court, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        ['badminton-1', name]
      );
    }
  } catch (e) {
    memoryQueues.set('badminton-1', [...testFirstNames]);
  }
}, 1000);

export async function getQueues(): Promise<Queues> {
  try {
    const res = await query(
      'SELECT court, array_agg(name ORDER BY joined_at) as names FROM queue_entries GROUP BY court'
    );
    const out: Queues = {};
    for (const row of res.rows) {
      out[row.court] = row.names || [];
    }
    return out;
  } catch (err) {
    const out: Queues = {};
    for (const [court, names] of memoryQueues.entries()) {
      out[court] = names;
    }
    return out;
  }
}

export async function joinQueue(court: string, name: string): Promise<Queues> {
  try {
    await query(
      'INSERT INTO queue_entries (court, name) VALUES ($1, $2) ON CONFLICT (court, name) DO NOTHING',
      [court, name]
    );
  } catch (err) {
    const existing = memoryQueues.get(court) ?? [];
    if (!existing.includes(name)) {
      existing.push(name);
    }
    memoryQueues.set(court, existing);
  }
  return getQueues();
}

export async function leaveQueue(court: string, name: string): Promise<Queues> {
  try {
    await query('DELETE FROM queue_entries WHERE court = $1 AND name = $2', [court, name]);
  } catch (err) {
    const existing = memoryQueues.get(court) ?? [];
    memoryQueues.set(court, existing.filter(n => n !== name));
  }
  return getQueues();
}

export async function getCourtAvailability(): Promise<Record<string, boolean>> {
  try {
    const res = await query('SELECT court, COUNT(*) as count FROM queue_entries GROUP BY court');
    const totals: Record<string, boolean> = {};
    for (const row of res.rows) {
      const c = courts.get(row.court);
      const limit = c?.matchType === 'singles' ? 2 : 4;
      totals[row.court] = Number(row.count) < limit;
    }
    return totals;
  } catch (err) {
    const totals: Record<string, boolean> = {};
    for (const [court, names] of memoryQueues.entries()) {
      const c = courts.get(court);
      const limit = c?.matchType === 'singles' ? 2 : 4;
      totals[court] = names.length < limit;
    }
    return totals;
  }
}

export async function clearQueue(court: string): Promise<Queues> {
  try {
    await query('DELETE FROM queue_entries WHERE court = $1', [court]);
  } catch (err) {
    memoryQueues.delete(court);
  }
  return getQueues();
}

export async function resetAllQueues(): Promise<Queues> {
  try {
    await query('DELETE FROM queue_entries');
  } catch (err) {
    memoryQueues.clear();
  }
  return getQueues();
}

export function getCourts(): Court[] {
  return Array.from(courts.values()).filter(c => c.active);
}

function parseSlots(slots?: string[] | string): string[] {
  if (!slots) return ['6:00 PM - 7:00 PM'];
  if (Array.isArray(slots)) return slots;
  if (typeof slots === 'string') return slots.split(',').map((s: string) => s.trim()).filter(Boolean);
  return ['6:00 PM - 7:00 PM'];
}

export function createCourt(data: Partial<Court> & { label: string; sport: string; slots?: string[] | string; matchType?: 'singles' | 'doubles' }): Court[] {
  const id = data.id || data.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const next: Court = {
    id,
    label: data.label,
    sport: data.sport,
    slots: parseSlots(data.slots),
    active: data.active !== false,
    matchType: data.matchType || 'doubles',
  };
  courts.set(id, next);
  return getCourts();
}

export function updateCourt(id: string, data: Partial<Court> & { label?: string; sport?: string; slots?: string[] | string; matchType?: 'singles' | 'doubles' }): Court[] {
  const existing = courts.get(id);
  if (!existing) return getCourts();
  const next: Court = {
    ...existing,
    ...(data.label ? { label: data.label } : {}),
    ...(data.sport ? { sport: data.sport } : {}),
    ...(data.slots ? { slots: parseSlots(data.slots) } : {}),
    ...(typeof data.active === 'boolean' ? { active: data.active } : {}),
    ...(data.matchType ? { matchType: data.matchType } : {}),
  };
  courts.set(id, next);
  return getCourts();
}

export function deleteCourt(id: string): Court[] {
  courts.delete(id);
  assignments.delete(id);
  bookings.delete(id);
  return getCourts();
}

export function getAnnouncements(): Announcement[] {
  return announcements;
}

export function addAnnouncement(message: string): Announcement[] {
  announcements.push({ id: Date.now(), message });
  return announcements;
}

export function getBookings(): Record<string, Booking[]> {
  const out: Record<string, Booking[]> = {};
  for (const [court, entries] of bookings.entries()) {
    out[court] = entries;
  }
  return out;
}

export function bookCourt(court: string, slot: string, name: string, date: string): Record<string, Booking[]> {
  const existing = bookings.get(court) ?? [];
  const next = existing.filter(entry => entry.slot !== slot || entry.date !== date);
  next.push({ slot, name, date });
  bookings.set(court, next);
  return getBookings();
}

export function cancelBooking(court: string, slot: string, date: string): Record<string, Booking[]> {
  const existing = bookings.get(court) ?? [];
  console.log('[DEBUG] cancelBooking input:', { court, slot, date, existingCount: existing.length });
  const next = existing.filter(entry => {
    const match = entry.slot === slot && entry.date === date;
    console.log('[DEBUG] Comparing entry:', entry, 'with:', { slot, date }, 'match:', match);
    return !match;
  });
  console.log('[DEBUG] cancelBooking output count:', next.length);
  bookings.set(court, next);
  return getBookings();
}

export function getAssignments(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [court, names] of assignments.entries()) {
    out[court] = names;
  }
  return out;
}

export function addAssignment(court: string, name: string): Record<string, string[]> {
  const c = courts.get(court);
  const limit = c?.matchType === 'singles' ? 2 : 4;
  const existing = assignments.get(court) ?? [];
  if (existing.length >= limit) {
    return getAssignments();
  }
  if (!existing.includes(name)) existing.push(name);
  assignments.set(court, existing);
  cleanQueuesAndMatchups();
  return getAssignments();
}

export function removeAssignment(court: string, name: string): Record<string, string[]> {
  const existing = assignments.get(court) ?? [];
  const next = existing.filter(item => item !== name);
  assignments.set(court, next);
  cleanQueuesAndMatchups();
  return getAssignments();
}

export async function removePlayerFromAllQueues(name: string): Promise<void> {
  try {
    await query('DELETE FROM queue_entries WHERE name = $1', [name]);
  } catch (e) {
    // DB offline
  }
  for (const [court, list] of memoryQueues.entries()) {
    memoryQueues.set(court, list.filter(p => p !== name));
  }
}

export function cleanQueuesAndMatchups(): void {
  const activePlayers = new Set<string>();
  for (const list of assignments.values()) {
    if (list) {
      list.forEach(p => {
        if (p && p.trim()) activePlayers.add(p);
      });
    }
  }

  for (const name of activePlayers) {
    for (const [court, list] of memoryQueues.entries()) {
      if (list.includes(name)) {
        memoryQueues.set(court, list.filter(p => p !== name));
        query('DELETE FROM queue_entries WHERE name = $1', [name]).catch(() => {});
      }
    }
  }

  for (let i = queuedMatchups.length - 1; i >= 0; i--) {
    const match = queuedMatchups[i];
    const matchPlayers = [...match.teamA, ...match.teamB];
    const hasActivePlayer = matchPlayers.some(p => activePlayers.has(p));
    if (hasActivePlayer) {
      queuedMatchups.splice(i, 1);
    }
  }
}

export type MatchResult = {
  id: string;
  courtId: string;
  courtLabel: string;
  sport: string;
  matchType: 'singles' | 'doubles';
  teamAPlayers: string[];
  teamBPlayers: string[];
  scoreA: number;
  scoreB: number;
  timestamp: string;
};

const matchHistory: MatchResult[] = [];

export function getMatchHistory(): MatchResult[] {
  return matchHistory;
}

export async function finishMatch(courtId: string, scoreA: number, scoreB: number): Promise<{ assignments: Record<string, string[]>, history: MatchResult[] }> {
  const c = courts.get(courtId);
  const assigned = assignments.get(courtId) ?? [];
  if (assigned.length > 0 && c) {
    const isSingles = c.matchType === 'singles';
    const teamAPlayers = isSingles ? [assigned[0]] : [assigned[0], assigned[1]].filter(Boolean);
    const teamBPlayers = isSingles ? [assigned[1]].filter(Boolean) : [assigned[2], assigned[3]].filter(Boolean);

    matchHistory.unshift({
      id: Math.random().toString(36).substring(2, 11),
      courtId,
      courtLabel: c.label,
      sport: c.sport,
      matchType: c.matchType || 'doubles',
      teamAPlayers,
      teamBPlayers,
      scoreA,
      scoreB,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    if (matchHistory.length > 20) {
      matchHistory.pop();
    }
  }

  assignments.delete(courtId);

  if (assigned.length > 0) {
    for (const p of assigned) {
      if (p && p.trim()) {
        await joinQueue(courtId, p);
      }
    }
  }

  if (c) {
    if (queuedMatchups.length > 0) {
      const matchup = queuedMatchups.splice(0, 1)[0];
      const listToAssign = [...matchup.teamA, ...matchup.teamB];
      assignments.set(courtId, listToAssign);
    }
  }

  cleanQueuesAndMatchups();

  return {
    assignments: getAssignments(),
    history: getMatchHistory()
  };
}

export type QueuedMatchup = {
  id: string;
  matchType: 'singles' | 'doubles';
  teamA: string[];
  teamB: string[];
  courtId?: string;
};

const queuedMatchups: QueuedMatchup[] = [];

export function getQueuedMatchups(): QueuedMatchup[] {
  return queuedMatchups;
}

export function addQueuedMatchup(matchType: 'singles' | 'doubles', teamA: string[], teamB: string[], courtId?: string): QueuedMatchup[] {
  queuedMatchups.push({
    id: Math.random().toString(36).substring(2, 11),
    matchType,
    teamA,
    teamB,
    courtId
  });
  return queuedMatchups;
}

export function removeQueuedMatchup(id: string): QueuedMatchup[] {
  const idx = queuedMatchups.findIndex(m => m.id === id);
  if (idx !== -1) {
    queuedMatchups.splice(idx, 1);
  }
  return queuedMatchups;
}

export function assignToSlot(courtId: string, index: number, name: string): Record<string, string[]> {
  const existing = assignments.get(courtId) ?? [];
  while (existing.length <= index) {
    existing.push('');
  }
  existing[index] = name;
  assignments.set(courtId, existing);
  cleanQueuesAndMatchups();
  return getAssignments();
}

export function startNextMatch(courtId: string): { assignments: Record<string, string[]>, matchups: QueuedMatchup[] } {
  if (queuedMatchups.length > 0) {
    const matchup = queuedMatchups.splice(0, 1)[0];
    const listToAssign = [...matchup.teamA, ...matchup.teamB];
    assignments.set(courtId, listToAssign);
  }
  cleanQueuesAndMatchups();
  return {
    assignments: getAssignments(),
    matchups: getQueuedMatchups()
  };
}
