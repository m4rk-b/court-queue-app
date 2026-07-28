import React, { useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import type { Announcement as AnnouncementItem, Booking, Court, MatchResult, QueuedMatchup } from './types'

const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:4100')

type Queues = Record<string, string[]>
type Role = 'admin' | 'qm' | 'player'

type AnnouncementEvent = {
  type: 'join' | 'leave'
  court: string
  name: string
  availability: Record<string, boolean>
}

// Sport Theme Configurations
const SPORT_THEMES: Record<string, { bgGradient: string; badgeBg: string; textColor: string; borderColor: string; icon: string }> = {
  badminton: {
    bgGradient: 'from-emerald-950/40 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/30',
    icon: '🏸',
  },
  basketball: {
    bgGradient: 'from-amber-950/40 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-500/30',
    icon: '🏀',
  },
  volleyball: {
    bgGradient: 'from-purple-950/40 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    textColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
    icon: '🏐',
  },
  pickleball: {
    bgGradient: 'from-lime-950/40 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-lime-500/10 text-lime-400 border-lime-500/20',
    textColor: 'text-lime-400',
    borderColor: 'border-lime-500/30',
    icon: '🏓',
  },
}

function getSportTheme(sport: string) {
  const key = sport.toLowerCase().trim()
  return (
    SPORT_THEMES[key] || {
      bgGradient: 'from-sky-950/40 via-slate-900/90 to-slate-950',
      badgeBg: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
      textColor: 'text-sky-400',
      borderColor: 'border-sky-500/30',
    }
  )
}
const TIME_OPTIONS = [
  '6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
  '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM',
  '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM', '10:00 PM'
]

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6]

function parseHour(timeStr: string): number {
  const match = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i)
  if (!match) return 18
  let hour = parseInt(match[1], 10)
  const isPM = match[3].toUpperCase() === 'PM'
  if (isPM && hour < 12) hour += 12
  if (!isPM && hour === 12) hour = 0
  return hour
}

function formatHour(hour24: number): string {
  const normalized = (hour24 + 24) % 24
  const period = normalized >= 12 ? 'PM' : 'AM'
  let hour12 = normalized % 12
  if (hour12 === 0) hour12 = 12
  return `${hour12}:00 ${period}`
}

function computeTimeSlot(startTime: string, durationHours: number): string {
  const startH = parseHour(startTime)
  const endH = startH + durationHours
  return `${formatHour(startH)} - ${formatHour(endH)}`
}

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

function renderMatchup(
  assigned: string[],
  matchType: 'singles' | 'doubles',
  removeFn?: (name: string) => void,
  queuesList: string[] = [],
  onAssignSlot?: (index: number, name: string) => void,
  isQm: boolean = false,
  playerStats: Record<string, { wins: number; losses: number; total: number }> = {}
) {
  const isSingles = matchType === 'singles';

  const renderSlot = (player: string | undefined, slotIndex: number, colorClasses: { active: string, empty: string }) => {
    const hasPlayer = !!player;
    return (
      <div className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center justify-between gap-1 min-h-[34px] ${hasPlayer ? colorClasses.active : colorClasses.empty
        }`}>
        {isQm && queuesList.length > 0 ? (
          <select
            value={player || ""}
            onChange={(e) => {
              if (e.target.value) {
                onAssignSlot?.(slotIndex, e.target.value);
              }
            }}
            className="w-full bg-transparent text-xs font-bold text-inherit focus:outline-none cursor-pointer border-none outline-none"
          >
            <option value="" disabled className="text-slate-500 bg-slate-950">
              {player || 'Select Player...'}
            </option>
            {queuesList.map(qPlayer => {
              const stats = playerStats[qPlayer] || { wins: 0, losses: 0, total: 0 };
              return (
                <option key={qPlayer} value={qPlayer} className="text-slate-200 bg-slate-950 font-sans">
                  {qPlayer} (W:{stats.wins}|L:{stats.losses}|G:{stats.total})
                </option>
              );
            })}
          </select>
        ) : (
          <span className="truncate">👤 {player || 'Open Slot'}</span>
        )}
        {hasPlayer && removeFn && (
          <button onClick={() => removeFn(player)} className="text-rose-400 hover:text-rose-350 font-bold px-1 text-sm select-none">×</button>
        )}
      </div>
    );
  };

  if (isSingles) {
    const p1 = assigned[0];
    const p2 = assigned[1];
    return (
      <div className="flex items-center justify-center gap-3 bg-slate-950/60 rounded-2xl p-4 border border-white/5 shadow-inner">
        <div className="flex-1 text-center">
          {renderSlot(p1, 0, {
            active: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
            empty: 'bg-slate-900/50 text-slate-650 border border-dashed border-slate-800'
          })}
        </div>
        <span className="text-slate-500 text-xs font-black italic select-none">VS</span>
        <div className="flex-1 text-center">
          {renderSlot(p2, 1, {
            active: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
            empty: 'bg-slate-900/50 text-slate-650 border border-dashed border-slate-800'
          })}
        </div>
      </div>
    );
  } else {
    // Doubles
    const p1 = assigned[0];
    const p2 = assigned[1];
    const p3 = assigned[2];
    const p4 = assigned[3];
    return (
      <div className="flex items-center justify-center gap-4 bg-slate-950/60 rounded-2xl p-4 border border-white/5 shadow-inner">
        {/* Team A */}
        <div className="flex-1 space-y-2">
          <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center select-none">Team A</span>
          <div className="space-y-1.5">
            {renderSlot(p1, 0, {
              active: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
              empty: 'bg-slate-900/50 text-slate-650 border border-dashed border-slate-850'
            })}
            {renderSlot(p2, 1, {
              active: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
              empty: 'bg-slate-900/50 text-slate-650 border border-dashed border-slate-850'
            })}
          </div>
        </div>

        <span className="text-slate-500 text-xs font-black italic mt-5 select-none">VS</span>

        {/* Team B */}
        <div className="flex-1 space-y-2">
          <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center select-none">Team B</span>
          <div className="space-y-1.5">
            {renderSlot(p3, 2, {
              active: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
              empty: 'bg-slate-900/50 text-slate-650 border border-dashed border-slate-850'
            })}
            {renderSlot(p4, 3, {
              active: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
              empty: 'bg-slate-900/50 text-slate-650 border border-dashed border-slate-850'
            })}
          </div>
        </div>
      </div>
    );
  }
}

export default function App() {
  const [role, setRole] = useState<Role>('player')
  const [queues, setQueues] = useState<Queues>({})
  const [availability, setAvailability] = useState<Record<string, boolean>>({})
  const [courts, setCourts] = useState<Court[]>([])
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([])
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [bookings, setBookings] = useState<Record<string, Booking[]>>({})
  const [matchHistory, setMatchHistory] = useState<MatchResult[]>([])
  const [matchups, setMatchups] = useState<QueuedMatchup[]>([])
  const [scoreModal, setScoreModal] = useState<{ courtId: string; label: string } | null>(null)
  const [scoreA, setScoreA] = useState('21')
  const [scoreB, setScoreB] = useState('21')
  const [announcement, setAnnouncement] = useState<AnnouncementEvent | null>(null)
  const [playerName, setPlayerName] = useState('')
  const [qmName, setQmName] = useState('')
  const [bookingName, setBookingName] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup')
  const [accountName, setAccountName] = useState('')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountRole, setAccountRole] = useState<'qm' | 'player'>('player')
  const [accountClubName, setAccountClubName] = useState('')
  const [accountRank, setAccountRank] = useState('Beginner')
  const [playerRanks, setPlayerRanks] = useState<Record<string, string>>({})
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [showDurationPicker, setShowDurationPicker] = useState(false)
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(new Date())
  const [authMessage, setAuthMessage] = useState('')
  const [activeAccount, setActiveAccount] = useState<{ id: string; name: string; username: string; role: Role; clubName?: string; rank?: string } | null>(null)
  const [selectedSlot, setSelectedSlot] = useState('6:00 PM - 7:00 PM')
  const [startTime, setStartTime] = useState('6:00 PM')
  const [durationHours, setDurationHours] = useState(3)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))

  const calendarDays = useMemo(() => {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth(); // 0-indexed
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    for (let d = 1; d <= totalDays; d++) {
      days.push(d);
    }
    return days;
  }, [currentCalendarMonth]);

  const computedSlot = useMemo(() => {
    return computeTimeSlot(startTime, durationHours)
  }, [startTime, durationHours])

  const playerStats = useMemo(() => {
    const stats: Record<string, { wins: number; losses: number; total: number }> = {}
    matchHistory.forEach(match => {
      const teamA = match.teamAPlayers || []
      const teamB = match.teamBPlayers || []
      const winA = match.scoreA > match.scoreB
      const winB = match.scoreB > match.scoreA

      teamA.forEach(p => {
        if (!stats[p]) stats[p] = { wins: 0, losses: 0, total: 0 }
        stats[p].total += 1
        if (winA) stats[p].wins += 1
        else if (winB) stats[p].losses += 1
      })

      teamB.forEach(p => {
        if (!stats[p]) stats[p] = { wins: 0, losses: 0, total: 0 }
        stats[p].total += 1
        if (winB) stats[p].wins += 1
        else if (winA) stats[p].losses += 1
      })
    })
    return stats
  }, [matchHistory])

  const allCheckedInPlayers = useMemo(() => {
    const set = new Set<string>();
    Object.values(queues).forEach(list => {
      if (list) list.forEach(p => set.add(p));
    });
    return Array.from(set);
  }, [queues])

  const checkedInDetails = useMemo(() => {
    const list: { name: string; courtId: string }[] = [];
    Object.entries(queues).forEach(([courtId, players]) => {
      if (players) {
        players.forEach(name => {
          list.push({ name, courtId });
        });
      }
    });
    return list;
  }, [queues])

  const [selectedCourt, setSelectedCourt] = useState<string>('')
  const [page, setPage] = useState<'dashboard' | 'booking'>('dashboard')
  const [loading, setLoading] = useState(true)
  const [newCourtLabel, setNewCourtLabel] = useState('')
  const [newCourtSport, setNewCourtSport] = useState('Badminton')
  const [newAnnouncement, setNewAnnouncement] = useState('')
  const [qmAssignment, setQmAssignment] = useState('')
  const [builderMatchType, setBuilderMatchType] = useState<'singles' | 'doubles'>('doubles')
  const [builderCourt, setBuilderCourt] = useState('')
  const [builderTeamA, setBuilderTeamA] = useState<string[]>(['', ''])
  const [builderTeamB, setBuilderTeamB] = useState<string[]>(['', ''])

  const visibleCourts = useMemo(() => courts.filter(court => court.active), [courts])
  const qmVisibleCourts = useMemo(() => {
    if (role !== 'qm') return visibleCourts
    const qmNameId = (activeAccount?.name || qmName || '').trim().toLowerCase()
    const qmClubId = (activeAccount?.clubName || '').trim().toLowerCase()
    return visibleCourts.filter(court => {
      const courtBookings = bookings[court.id] ?? []
      const courtAssignments = assignments[court.id] ?? []
      const isBookedByQm = courtBookings.some(entry => {
        if (entry.date !== selectedDate) return false
        const entryName = entry.name.trim().toLowerCase()
        if (qmClubId && (entryName === qmClubId || entryName.includes(qmClubId) || qmClubId.includes(entryName))) return true
        if (qmNameId && (entryName === qmNameId || entryName.includes(qmNameId) || qmNameId.includes(entryName))) return true
        return false
      })
      return isBookedByQm || courtAssignments.length > 0
    })
  }, [bookings, assignments, qmName, activeAccount, role, selectedDate, visibleCourts])

  const qmBookedCourtsAll = useMemo(() => {
    if (role !== 'qm') return visibleCourts
    const qmNameId = (activeAccount?.name || qmName || '').trim().toLowerCase()
    const qmClubId = (activeAccount?.clubName || '').trim().toLowerCase()
    return visibleCourts.filter(court => {
      const courtBookings = bookings[court.id] ?? []
      const isBookedByQm = courtBookings.some(entry => {
        const entryName = entry.name.trim().toLowerCase()
        if (qmClubId && (entryName === qmClubId || entryName.includes(qmClubId) || qmClubId.includes(entryName))) return true
        if (qmNameId && (entryName === qmNameId || entryName.includes(qmNameId) || qmNameId.includes(entryName))) return true
        return false
      })
      return isBookedByQm
    })
  }, [bookings, qmName, activeAccount, role, visibleCourts])

  const isBookingActiveNow = (courtId: string) => {
    const list = bookings[courtId] ?? []
    const todayStr = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local format
    const now = new Date()
    return list.some(b => {
      if (b.date !== todayStr) return false
      try {
        const parts = b.slot.split(' - ')
        if (parts.length !== 2) return false
        const start = getBookingStartTimeDate(b.date, parts[0])
        const end = getBookingStartTimeDate(b.date, parts[1])
        if (!start || !end) return false
        return now >= start && now <= end
      } catch (e) {
        return false
      }
    })
  }

  const isTimeOptionBookedOut = (timeOption: string) => {
    const activeCourts = courts.filter(c => c.active);
    if (activeCourts.length === 0) return false;

    const proposedStart = parseHour(timeOption);
    const proposedEnd = proposedStart + durationHours;

    const unavailableCourtsCount = activeCourts.filter(court => {
      const courtBookings = (bookings[court.id] ?? []).filter(b => b.date === selectedDate);
      return courtBookings.some(b => {
        try {
          const parts = b.slot.split(' - ');
          if (parts.length !== 2) return false;
          const bStart = parseHour(parts[0]);
          const bEnd = parseHour(parts[1]);
          // Check overlap
          const startMax = Math.max(proposedStart, bStart);
          const endMin = Math.min(proposedEnd, bEnd);
          return startMax < endMin;
        } catch (e) {
          return false;
        }
      });
    }).length;

    return unavailableCourtsCount >= activeCourts.length;
  };

  const isTimeOptionDisabled = (timeOption: string) => {
    const todayStr = new Date().toLocaleDateString('en-CA');
    if (selectedDate === todayStr) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const optionStartHour = parseHour(timeOption);
      if (optionStartHour < currentHour || (optionStartHour === currentHour && currentMinute > 0)) {
        return true;
      }
    }
    return isTimeOptionBookedOut(timeOption);
  };

  const totalPlayersInQueue = useMemo(() => {
    return Object.values(queues).reduce((sum, list) => sum + (list?.length || 0), 0)
  }, [queues])

  useEffect(() => {
    async function bootstrap() {
      try {
        const [statusRes, bookingsRes, historyRes, matchupsRes, ranksRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/api/bookings'),
          fetch('/api/matches/history'),
          fetch('/api/matchups'),
          fetch('/api/accounts/ranks'),
        ])
        const statusData = await statusRes.json()
        const bookingsData = await bookingsRes.json()
        const historyData = await historyRes.json()
        const matchupsData = await matchupsRes.json()
        const ranksData = await ranksRes.json()
        setQueues(statusData.queues)
        setAvailability(statusData.availability)
        setCourts(statusData.courts ?? [])
        setAnnouncements(statusData.announcements ?? [])
        setAssignments(statusData.assignments ?? {})
        setBookings(bookingsData)
        setMatchHistory(historyData)
        setMatchups(matchupsData)
        setPlayerRanks(ranksData)
        if (statusData.courts?.length) {
          if (!selectedCourt) setSelectedCourt(statusData.courts[0].id)
          setBuilderCourt(statusData.courts[0].id)
        }
      } finally {
        setLoading(false)
      }
    }

    bootstrap()
    socket.on('queues', (next: Queues) => setQueues(next))
    socket.on('availability', (next: Record<string, boolean>) => setAvailability(next))
    socket.on('courts', (next: Court[]) => setCourts(next))
    socket.on('announcements', (next: AnnouncementItem[]) => setAnnouncements(next))
    socket.on('assignments', (next: Record<string, string[]>) => setAssignments(next))
    socket.on('bookings', (next: Record<string, Booking[]>) => setBookings(next))
    socket.on('history', (next: MatchResult[]) => setMatchHistory(next))
    socket.on('matchups', (next: QueuedMatchup[]) => setMatchups(next))
    socket.on('announcement', (next: AnnouncementEvent) => {
      setAnnouncement(next)
      window.setTimeout(() => setAnnouncement(null), 3000)
    })

    return () => {
      socket.off('queues')
      socket.off('availability')
      socket.off('courts')
      socket.off('announcements')
      socket.off('assignments')
      socket.off('bookings')
      socket.off('history')
      socket.off('matchups')
      socket.off('announcement')
    }
  }, [selectedCourt])

  async function queueCreatedMatchup() {
    const finalTeamA = builderTeamA.filter(Boolean)
    const finalTeamB = builderTeamB.filter(Boolean)
    if (finalTeamA.length === 0 || finalTeamB.length === 0) {
      alert('Please add players to both teams.')
      return
    }
    await fetch('/api/qm/matchups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchType: builderMatchType,
        teamA: finalTeamA,
        teamB: finalTeamB,
        courtId: builderCourt || (qmVisibleCourts[0]?.id) || selectedCourt || ""
      }),
    })
    setBuilderTeamA(['', ''])
    setBuilderTeamB(['', ''])
  }

  async function cancelQueuedMatchup(id: string, courtId?: string) {
    const url = courtId ? `/api/qm/matchups/${id}?courtId=${courtId}` : `/api/qm/matchups/${id}`
    await fetch(url, { method: 'DELETE' })
  }

  async function startNextMatchOnCourt(courtId: string) {
    await fetch(`/api/qm/courts/${courtId}/start-next`, { method: 'POST' })
  }

  async function join() {
    const courtToJoin = selectedCourt || (visibleCourts[0]?.id)
    if (!playerName.trim() || !courtToJoin) return alert('Please enter your name.')
    await fetch(`/api/queues/${courtToJoin}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playerName.trim() }),
    })
    setPlayerName('')
  }

  async function assignPlayerToSlot(courtId: string, index: number, playerName: string) {
    await fetch(`/api/qm/assignments/${courtId}/slot/${index}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playerName }),
    })
  }

  async function leave(court: string, playerName: string) {
    await fetch(`/api/queues/${court}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playerName }),
    })
  }

  async function book(court: string, customSlot?: string) {
    const defaultClub = activeAccount?.clubName || activeAccount?.name || 'QM'
    const nameToBook = bookingName.trim() || defaultClub
    const finalSlot = customSlot || computedSlot || selectedSlot
    await fetch(`/api/bookings/${court}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: finalSlot, name: nameToBook, date: selectedDate }),
    })
    setBookingName(defaultClub)
  }

  async function cancel(court: string, slot: string, date: string) {
    if (!canCancelBooking(date, slot)) {
      alert('This booking cannot be cancelled because it is less than 4 hours before the scheduled time.');
      return;
    }
    const params = new URLSearchParams({ slot, date });
    await fetch(`/api/bookings/${court}?${params.toString()}`, { method: 'DELETE' })
  }

  async function createCourt() {
    if (!newCourtLabel.trim()) return
    await fetch('/api/admin/courts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newCourtLabel.trim(),
        sport: newCourtSport,
        slots: ['6:00 PM - 7:00 PM', '7:00 PM - 8:00 PM', '8:00 PM - 9:00 PM'],
      }),
    })
    setNewCourtLabel('')
    setNewCourtSport('Badminton')
  }

  async function submitMatchResult() {
    if (!scoreModal) return
    await fetch(`/api/qm/matches/finish/${scoreModal.courtId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoreA: Number(scoreA), scoreB: Number(scoreB) })
    })
    setScoreModal(null)
    setScoreA('21')
    setScoreB('21')
  }

  async function publishAnnouncement() {
    if (!newAnnouncement.trim()) return
    await fetch('/api/admin/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: newAnnouncement.trim() }),
    })
    setNewAnnouncement('')
  }

  async function assignToCourt(courtId: string, name?: string) {
    const finalName = name || qmAssignment.trim()
    if (!finalName) return

    const court = courts.find(c => c.id === courtId)
    const limit = court?.matchType === 'singles' ? 2 : 4
    const existing = assignments[courtId] ?? []
    if (existing.length >= limit) {
      alert(`This court is at capacity (${limit} players max for ${court?.matchType || 'doubles'}).`)
      return
    }

    await fetch(`/api/qm/assignments/${courtId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: finalName }),
    })
    setQmAssignment('')
  }

  async function removeAssignmentFromCourt(courtId: string, name: string) {
    await fetch(`/api/qm/assignments/${courtId}/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }

  async function resetAllQueues() {
    if (confirm('Are you sure you want to clear all queue entries across all courts?')) {
      await fetch('/api/admin/queues/reset', { method: 'POST' })
    }
  }

  async function handleAccountSubmit() {
    if (!accountName.trim() || !accountUsername.trim() || !accountPassword.trim()) {
      setAuthMessage('Please fill in your name, username, and password.')
      return
    }

    if (accountRole === 'qm' && !accountClubName.trim()) {
      setAuthMessage('Queue Manager accounts require a club name.')
      return
    }

    const payload = {
      name: accountName.trim(),
      username: accountUsername.trim(),
      password: accountPassword.trim(),
      role: accountRole,
      ...(accountRole === 'qm' ? { clubName: accountClubName.trim() } : {}),
      ...(accountRole === 'player' ? { rank: accountRank } : {}),
    }

    const response = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await response.json()
    if (!response.ok) {
      setAuthMessage(data.error || 'Unable to create account')
      return
    }

    // Refresh ranks
    const ranksRes = await fetch('/api/accounts/ranks')
    const ranksData = await ranksRes.json().catch(() => ({}))
    setPlayerRanks(ranksData)

    setAuthMessage(`Account created for ${data.name}!`)
    setActiveAccount({ id: data.id, name: data.name, username: data.username, role: data.role, clubName: data.clubName, rank: data.rank })
    setRole(data.role)
    if (data.role === 'qm') {
      setQmName(data.name)
      setPage('booking')
    } else {
      setPlayerName(data.name)
    }
    setAccountName('')
    setAccountUsername('')
    setAccountPassword('')
    setAccountClubName('')
  }

  async function handleLogin() {
    if (!accountUsername.trim() || !accountPassword.trim()) {
      setAuthMessage('Please enter your username and password.')
      return
    }

    const response = await fetch('/api/accounts/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: accountUsername.trim(), password: accountPassword.trim() }),
    })

    const data = await response.json()
    if (!response.ok) {
      setAuthMessage(data.error || 'Invalid credentials')
      return
    }

    // Refresh ranks
    const ranksRes = await fetch('/api/accounts/ranks')
    const ranksData = await ranksRes.json().catch(() => ({}))
    setPlayerRanks(ranksData)

    setAuthMessage(`Welcome back, ${data.name}!`)
    setActiveAccount({ id: data.id, name: data.name, username: data.username, role: data.role, clubName: data.clubName, rank: data.rank })
    setRole(data.role)
    if (data.role === 'qm') {
      setQmName(data.name)
      setPage('booking')
    } else {
      setPlayerName(data.name)
    }
  }

  function handleLogout() {
    setActiveAccount(null)
    setRole('player')
    setPlayerName('')
    setQmName('')
    setAuthMessage('')
    setPage('dashboard')
  }

  useEffect(() => {
    if (role === 'qm' && qmName.trim()) {
      setPage('booking')
    }
  }, [qmName, role])

  useEffect(() => {
    if (activeAccount) {
      const defaultName = activeAccount.clubName || activeAccount.name
      setBookingName(defaultName)
      if (activeAccount.role === 'qm') {
        setQmName(defaultName)
      }
    }
  }, [activeAccount])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent shadow-glow-cyan" />
          <p className="font-display text-lg tracking-wide text-slate-400 animate-pulse">Loading Court Queue Hub...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-16 pt-4 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Floating Real-time Event Announcement Banner */}
        {activeAccount && announcement && (
          <div className="fixed top-5 right-5 z-50 animate-slide-up">
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-slate-900/90 px-5 py-3.5 shadow-2xl backdrop-blur-xl">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <p className="text-sm font-medium text-emerald-200">
                <span className="font-semibold text-emerald-400">{announcement.name}</span>{' '}
                {announcement.type === 'join' ? 'joined the queue on' : 'left the queue on'}{' '}
                <span className="font-semibold text-white">{announcement.court}</span>
              </p>
            </div>
          </div>
        )}

        {/* Global Navigation Header */}
        <header className="glass-panel sticky top-4 z-40 rounded-3xl p-5 shadow-2xl transition-all">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Brand Logo & Title */}
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 shadow-glow-cyan">
                <span className="text-2xl font-black text-white">CQ</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    Court<span className="text-gradient-cyan">Queue</span>
                  </h1>
                  <span className="rounded-full bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-400 border border-cyan-500/20">
                    Live
                  </span>
                </div>
                <p className="text-xs text-slate-400 sm:text-sm">Real-Time Sports Queueing & Facility Management</p>
              </div>
            </div>

            {/* Quick Stats Bar */}
            {activeAccount && (
              <div className="hidden md:flex items-center gap-6 rounded-2xl bg-slate-900/60 px-4 py-2 border border-white/5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-slate-400">Courts:</span>
                  <span className="font-bold text-white">{visibleCourts.length}</span>
                </div>
                <div className="h-4 w-px bg-slate-800" />
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">In Queue:</span>
                  <span className="font-bold text-cyan-400">{totalPlayersInQueue}</span>
                </div>
                <div className="h-4 w-px bg-slate-800" />
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Selected Date:</span>
                  <span className="font-medium text-slate-200">{selectedDate}</span>
                </div>
              </div>
            )}

            {/* User Profile & Navigation Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 lg:border-t-0 lg:pt-0">
              {activeAccount ? (
                <>
                  {/* Account Badge displaying user role */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full bg-slate-800/90 border border-white/10 px-3.5 py-1.5 text-xs text-slate-200">
                      <span className="h-2 w-2 rounded-full bg-cyan-400" />
                      <span className="font-medium">{activeAccount.name}</span>
                      <span className="rounded bg-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold text-cyan-300">
                        {activeAccount.role}
                      </span>
                    </div>
                  </div>

                  {/* Navigation Page Tabs */}
                  <div className="flex items-center gap-2">
                    <button
                      className={`rounded-2xl px-4 py-2 text-xs sm:text-sm font-semibold transition-all ${page === 'dashboard'
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-glow-cyan'
                        : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      onClick={() => setPage('dashboard')}
                    >
                      Dashboard
                    </button>
                    <button
                      className={`rounded-2xl px-4 py-2 text-xs sm:text-sm font-semibold transition-all ${page === 'booking'
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-glow-emerald'
                        : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      onClick={() => setPage('booking')}
                    >
                      Court Booking
                    </button>
                    <button
                      className="rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-3.5 py-2 text-xs font-semibold text-rose-400 transition-all"
                      onClick={handleLogout}
                    >
                      Logout
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Sign in to join court queues</span>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Auth / Account Creation Card (Shown when logged out) */}
        {!activeAccount && (
          <section className="mx-auto max-w-xl animate-fade-in">
            <div className="glass-card overflow-hidden rounded-3xl p-8 shadow-2xl">
              <div className="text-center mb-6">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h2 className="font-display text-2xl font-bold text-white">Welcome to CourtQueue</h2>
                <p className="mt-1 text-sm text-slate-400">Sign in or create an account to start queueing and booking courts.</p>
              </div>

              {/* Mode Toggle Tabs */}
              <div className="grid grid-cols-2 rounded-2xl bg-slate-950 p-1.5 border border-white/10 mb-6 text-sm font-semibold">
                <button
                  className={`rounded-xl py-2.5 transition-all ${authMode === 'signup' ? 'bg-cyan-500 text-slate-950 shadow-md font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  onClick={() => {
                    setAuthMode('signup')
                    setAuthMessage('')
                  }}
                >
                  Create Account
                </button>
                <button
                  className={`rounded-xl py-2.5 transition-all ${authMode === 'login' ? 'bg-cyan-500 text-slate-950 shadow-md font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  onClick={() => {
                    setAuthMode('login')
                    setAuthMessage('')
                  }}
                >
                  Sign In
                </button>
              </div>

              <div className="space-y-4">
                {authMode === 'signup' ? (
                  <>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-300">Full Name</label>
                      <input
                        className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500"
                        placeholder="e.g. Alex Morgan"
                        value={accountName}
                        onChange={e => setAccountName(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-300">Username</label>
                        <input
                          className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500"
                          placeholder="e.g. alexm"
                          value={accountUsername}
                          onChange={e => setAccountUsername(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-300">Password</label>
                        <input
                          className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500"
                          type="password"
                          placeholder="••••••••"
                          value={accountPassword}
                          onChange={e => setAccountPassword(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-300">Account Type</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAccountRole('player')}
                          className={`flex-1 rounded-2xl py-3 px-4 text-xs font-bold border transition-all ${
                            accountRole === 'player'
                              ? 'bg-sky-500/10 text-sky-400 border-sky-500/30 shadow-glow-cyan'
                              : 'bg-slate-900/60 text-slate-400 border-white/5 hover:bg-slate-800'
                          }`}
                        >
                          👤 Player
                        </button>
                        <button
                          type="button"
                          onClick={() => setAccountRole('qm')}
                          className={`flex-1 rounded-2xl py-3 px-4 text-xs font-bold border transition-all ${
                            accountRole === 'qm'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 shadow-glow-amber'
                              : 'bg-slate-900/60 text-slate-400 border-white/5 hover:bg-slate-800'
                          }`}
                        >
                          ⚡ Queue Manager (QM)
                        </button>
                      </div>
                    </div>
                    {accountRole === 'qm' && (
                      <div className="animate-fade-in">
                        <label className="mb-1.5 block text-xs font-semibold text-amber-300">Club / Organization Name</label>
                        <input
                          className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 border-amber-500/30"
                          placeholder="e.g. Metro Sports Club"
                          value={accountClubName}
                          onChange={e => setAccountClubName(e.target.value)}
                        />
                      </div>
                    )}
                    {accountRole === 'player' && (
                      <div className="animate-fade-in space-y-1.5">
                        <label className="block text-xs font-semibold text-sky-300">Badminton Skill Level / Rank</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {['Beginner', 'Advanced Beginner', 'Low Intermediate', 'Intermediate', 'High Intermediate', 'Advanced'].map(rank => (
                            <button
                              key={rank}
                              type="button"
                              onClick={() => setAccountRank(rank)}
                              className={`rounded-xl py-2 px-2 text-xs font-bold border transition-all truncate text-center ${
                                accountRank === rank
                                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 shadow-glow-cyan'
                                  : 'bg-slate-900/65 text-slate-400 border-white/5 hover:bg-slate-850'
                              }`}
                            >
                              {rank}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      className="mt-2 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 py-3.5 font-bold text-white shadow-glow-cyan transition-all hover:opacity-95 active:scale-[0.99]"
                      onClick={handleAccountSubmit}
                    >
                      Create Account
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-300">Username</label>
                      <input
                        className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500"
                        placeholder="Enter your username"
                        value={accountUsername}
                        onChange={e => setAccountUsername(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-300">Password</label>
                      <input
                        className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500"
                        type="password"
                        placeholder="Enter your password"
                        value={accountPassword}
                        onChange={e => setAccountPassword(e.target.value)}
                      />
                    </div>
                    <button
                      className="mt-2 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 py-3.5 font-bold text-white shadow-glow-cyan transition-all hover:opacity-95 active:scale-[0.99]"
                      onClick={handleLogin}
                    >
                      Sign In
                    </button>
                  </>
                )}

                {authMessage && (
                  <div className="mt-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3.5 text-center text-xs font-medium text-cyan-300 animate-fade-in">
                    {authMessage}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Global Announcements Bar */}
        {activeAccount && announcements.length > 0 && (
          <section className="glass-card rounded-3xl p-4 shadow-xl border border-sky-500/20 bg-slate-900/60">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
                📢
              </div>
              <div className="flex-1 overflow-hidden">
                <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400">Announcements</h3>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-200">
                  {announcements.map(item => (
                    <span key={item.id} className="inline-flex items-center gap-1.5">
                      <span className="text-slate-400">•</span>
                      <span>{item.message}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Admin Dashboard Section */}
        {activeAccount && role === 'admin' && (
          <section className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between rounded-2xl bg-purple-500/10 border border-purple-500/20 px-5 py-3 text-purple-300">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚙️</span>
                <h2 className="font-display font-bold">Admin Management Portal</h2>
              </div>
              <button
                onClick={resetAllQueues}
                className="rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-all"
              >
                Reset All Queues
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Add Court Form */}
              <div className="glass-card rounded-3xl p-6 shadow-2xl">
                <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                  <span>➕</span> Add New Court
                </h3>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Court Label</label>
                    <input
                      className="glass-input w-full rounded-2xl px-4 py-2.5 text-sm text-white"
                      placeholder="e.g. Badminton Court 3"
                      value={newCourtLabel}
                      onChange={e => setNewCourtLabel(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Sport Category</label>
                    <select
                      className="glass-input w-full rounded-2xl px-4 py-2.5 text-sm text-white bg-slate-950"
                      value={newCourtSport}
                      onChange={e => setNewCourtSport(e.target.value)}
                    >
                      <option value="Badminton">Badminton</option>
                      <option value="Basketball">Basketball</option>
                      <option value="Volleyball">Volleyball</option>
                      <option value="Pickleball">Pickleball</option>
                    </select>
                  </div>
                  <button
                    className="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 py-3 font-semibold text-white shadow-glow-cyan transition-all hover:opacity-95"
                    onClick={createCourt}
                  >
                    Add Court
                  </button>
                </div>

                <div className="mt-6 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Courts ({visibleCourts.length})</h4>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {visibleCourts.map(court => (
                      <div key={court.id} className="flex items-center justify-between rounded-2xl bg-slate-950/70 p-3 border border-white/5">
                        <div>
                          <p className="text-sm font-semibold text-slate-200">{court.label}</p>
                          <p className="text-xs text-slate-400">{court.sport}</p>
                        </div>
                        <button
                          className="rounded-xl bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1 text-xs font-medium text-rose-400 border border-rose-500/20"
                          onClick={async () => {
                            await fetch(`/api/admin/courts/${court.id}`, { method: 'DELETE' })
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Broadcast Announcement Form */}
              <div className="glass-card rounded-3xl p-6 shadow-2xl">
                <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                  <span>📢</span> Post Public Announcement
                </h3>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Message</label>
                    <textarea
                      rows={3}
                      className="glass-input w-full rounded-2xl px-4 py-2.5 text-sm text-white"
                      placeholder="Write announcement for all players..."
                      value={newAnnouncement}
                      onChange={e => setNewAnnouncement(e.target.value)}
                    />
                  </div>
                  <button
                    className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 font-semibold text-white shadow-glow-emerald transition-all hover:opacity-95"
                    onClick={publishAnnouncement}
                  >
                    Post Announcement
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Queue Manager (QM) Section */}
        {activeAccount && role === 'qm' && (
          <section className="glass-card rounded-3xl p-6 shadow-2xl animate-fade-in border border-amber-500/20">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">📋</span>
                  <h2 className="font-display text-xl font-bold text-white">Queue Manager Hub</h2>
                  <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-400 border border-amber-500/20">
                    QM Mode
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">Managing courts and player assignments for {activeAccount?.name}.</p>
              </div>
            </div>

            {(() => {
              const qmNameId = (activeAccount?.name || qmName || '').trim().toLowerCase()
              const qmClubId = (activeAccount?.clubName || '').trim().toLowerCase()

              const courtsWithBookings = qmBookedCourtsAll.filter(court => {
                const bookingEntries = (bookings[court.id] ?? []).filter(entry => {
                  const entryName = entry.name.trim().toLowerCase()
                  if (qmClubId && (entryName === qmClubId || entryName.includes(qmClubId) || qmClubId.includes(entryName))) return true
                  if (qmNameId && (entryName === qmNameId || entryName.includes(qmNameId) || qmNameId.includes(entryName))) return true
                  return false
                })
                return bookingEntries.length > 0;
              });

              if (courtsWithBookings.length === 0) {
                return (
                  <div className="mt-6 rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-8 text-center text-slate-400">
                    <p className="text-sm font-medium">No booked courts found for "{activeAccount?.name}".</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Switch to the <button onClick={() => setPage('booking')} className="text-emerald-400 underline">Court Booking tab</button> to reserve a court time slot.
                    </p>
                  </div>
                );
              }

              return (
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  {courtsWithBookings.map(court => {
                    const bookingEntries = (bookings[court.id] ?? []).filter(entry => {
                      const entryName = entry.name.trim().toLowerCase()
                      if (qmClubId && (entryName === qmClubId || entryName.includes(qmClubId) || qmClubId.includes(entryName))) return true
                      if (qmNameId && (entryName === qmNameId || entryName.includes(qmNameId) || qmNameId.includes(entryName))) return true
                      return false
                    });
                    return (
                      <div key={`qm-booked-${court.id}`} className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5 space-y-4">
                        <div>
                          <h4 className="font-display font-bold text-white text-lg">{court.label}</h4>
                          <p className="text-xs text-slate-400">{court.sport}</p>
                        </div>

                        <div className="space-y-2 border-t border-white/5 pt-3">
                          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
                            <span>Bookings Schedule</span>
                          </div>
                          <div className="space-y-2">
                            {bookingEntries.map(b => (
                              <div key={`${b.slot}-${b.name}`} className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2 text-slate-355 border border-white/5 text-xs">
                                <div className="flex flex-col">
                                  <span className="font-bold text-slate-200">{b.name}</span>
                                  <span className="text-[10px] text-slate-400">📅 {b.date}</span>
                                  <span className="text-[10px] text-slate-500 font-mono">🕒 {b.slot}</span>
                                </div>
                                {(() => {
                                  const isThisBookingActiveNow = (() => {
                                    const todayStr = new Date().toLocaleDateString('en-CA');
                                    if (b.date !== todayStr) return false;
                                    try {
                                      const parts = b.slot.split(' - ');
                                      if (parts.length !== 2) return false;
                                      const start = getBookingStartTimeDate(b.date, parts[0]);
                                      const end = getBookingStartTimeDate(b.date, parts[1]);
                                      if (!start || !end) return false;
                                      const now = new Date();
                                      return now >= start && now <= end;
                                    } catch (e) {
                                      return false;
                                    }
                                  })();

                                  const gameStarted = isThisBookingActiveNow && (assignments[court.id] ?? []).length > 0;
                                  const tooLate = b.date === new Date().toLocaleDateString('en-CA') && !canCancelBooking(b.date, b.slot);
                                  const disabled = gameStarted || tooLate;
                                  let tooltip = "Cancel booking";
                                  if (gameStarted) tooltip = "Cannot cancel: game has started";
                                  else if (tooLate) tooltip = "Cannot cancel: less than 4 hours before slot time";

                                  return (
                                    <button
                                      disabled={disabled}
                                      onClick={() => cancel(court.id, b.slot, b.date)}
                                      className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold border transition-all ${
                                        disabled
                                          ? 'bg-slate-900/60 text-slate-650 border-slate-950 cursor-not-allowed'
                                          : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-455 border-rose-500/20'
                                      }`}
                                      title={tooltip}
                                    >
                                      Cancel Booking
                                    </button>
                                  );
                                })()}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </section>
        )}

        {/* Court Booking View Page */}
        {activeAccount && page === 'booking' && (
          <section className="glass-card rounded-3xl p-6 lg:p-8 shadow-2xl animate-fade-in border border-emerald-500/20">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-white/10 pb-6">
              <div>
                <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
                  <span>📅</span> Court Booking Schedule
                </h2>
                <p className="mt-1 text-xs text-slate-400 sm:text-sm">Reserve court slots for upcoming matches or club sessions.</p>
              </div>

              <div className="flex flex-col sm:flex-row flex-wrap gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Club Name</label>
                  <input
                    className="glass-input rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 w-full sm:w-44"
                    value={bookingName}
                    onChange={e => setBookingName(e.target.value)}
                    placeholder="e.g. Metro Sports Club"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Target Date</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDatePicker(!showDatePicker);
                        setShowTimePicker(false);
                        setShowDurationPicker(false);
                      }}
                      className="glass-input rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-white w-full sm:w-40 text-left flex items-center justify-between gap-2 min-h-[42px] select-none"
                    >
                      <span>📅 {selectedDate}</span>
                      <span className="text-[10px] text-slate-500 font-bold">▼</span>
                    </button>
                    
                    {showDatePicker && (
                      <div className="absolute right-0 sm:left-0 z-50 mt-2 p-4 rounded-2xl bg-slate-900 border border-white/10 shadow-2xl backdrop-blur-xl w-64 text-xs space-y-3">
                        {/* Calendar Header */}
                        <div className="flex items-center justify-between select-none">
                          <button
                            type="button"
                            onClick={() => {
                              const prev = new Date(currentCalendarMonth);
                              prev.setMonth(prev.getMonth() - 1);
                              setCurrentCalendarMonth(prev);
                            }}
                            className="text-slate-400 hover:text-white font-bold p-1 text-sm transition-colors"
                          >
                            ◀
                          </button>
                          <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                            {currentCalendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const next = new Date(currentCalendarMonth);
                              next.setMonth(next.getMonth() + 1);
                              setCurrentCalendarMonth(next);
                            }}
                            className="text-slate-400 hover:text-white font-bold p-1 text-sm transition-colors"
                          >
                            ▶
                          </button>
                        </div>
                        {/* Weekdays Header */}
                        <div className="grid grid-cols-7 gap-1 text-center font-bold text-slate-500 select-none text-[9px] uppercase">
                          <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
                        </div>
                        {/* Days Grid */}
                        <div className="grid grid-cols-7 gap-1 text-center">
                          {calendarDays.map((day, idx) => {
                            if (day === null) {
                              return <span key={`empty-${idx}`} />;
                            }
                            
                            const year = currentCalendarMonth.getFullYear();
                            const month = String(currentCalendarMonth.getMonth() + 1).padStart(2, '0');
                            const dateStr = `${year}-${month}-${String(day).padStart(2, '0')}`;
                            const isSelected = selectedDate === dateStr;
                            const isToday = new Date().toLocaleDateString('en-CA') === dateStr;

                            const todayStr = new Date().toLocaleDateString('en-CA');
                            const isPast = dateStr < todayStr;

                            return (
                              <button
                                type="button"
                                key={`day-${day}`}
                                disabled={isPast}
                                onClick={() => {
                                  setSelectedDate(dateStr);
                                  setShowDatePicker(false);
                                }}
                                className={`h-7 w-7 rounded-lg flex items-center justify-center font-bold transition-all ${
                                  isSelected
                                    ? 'bg-cyan-500 text-slate-950 font-black scale-105 shadow-glow-cyan'
                                    : isPast
                                    ? 'text-slate-700 cursor-not-allowed opacity-30 select-none'
                                    : isToday
                                    ? 'border border-cyan-500/50 text-cyan-400'
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                }`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                        {/* Footer helper */}
                        <div className="flex items-center justify-between border-t border-white/5 pt-2 select-none">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDate(new Date().toLocaleDateString('en-CA'));
                              setCurrentCalendarMonth(new Date());
                              setShowDatePicker(false);
                            }}
                            className="text-[10px] text-cyan-400 hover:underline"
                          >
                            Go to Today
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowDatePicker(false)}
                            className="text-[10px] text-slate-400 hover:text-white"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Start Time</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowTimePicker(!showTimePicker);
                        setShowDatePicker(false);
                        setShowDurationPicker(false);
                      }}
                      className="glass-input rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-white w-full sm:w-32 text-left flex items-center justify-between gap-2 min-h-[42px] select-none"
                    >
                      <span>🕒 {startTime}</span>
                      <span className="text-[10px] text-slate-500 font-bold">▼</span>
                    </button>
                    
                    {showTimePicker && (
                      <div className="absolute right-0 sm:left-0 z-50 mt-2 max-h-56 overflow-y-auto rounded-2xl bg-slate-900 border border-white/10 shadow-2xl backdrop-blur-xl w-36 text-xs divide-y divide-white/5 pr-1 py-1">
                        {TIME_OPTIONS.map(time => {
                          const disabled = isTimeOptionDisabled(time);
                          return (
                            <button
                              key={time}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                setStartTime(time);
                                setShowTimePicker(false);
                              }}
                              className={`w-full text-left py-2 px-3 transition-colors font-bold ${
                                disabled
                                  ? 'text-slate-700 line-through opacity-40 cursor-not-allowed'
                                  : startTime === time
                                  ? 'text-cyan-400 bg-cyan-950/20'
                                  : 'text-slate-300 hover:bg-slate-800'
                              }`}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Duration</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDurationPicker(!showDurationPicker);
                        setShowDatePicker(false);
                        setShowTimePicker(false);
                      }}
                      className="glass-input rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-white w-full sm:w-32 text-left flex items-center justify-between gap-2 min-h-[42px] select-none"
                    >
                      <span>⏳ {durationHours} Hour{durationHours === 1 ? '' : 's'}</span>
                      <span className="text-[10px] text-slate-500 font-bold">▼</span>
                    </button>
                    
                    {showDurationPicker && (
                      <div className="absolute right-0 sm:left-0 z-50 mt-2 rounded-2xl bg-slate-900 border border-white/10 shadow-2xl backdrop-blur-xl w-32 text-xs divide-y divide-white/5 py-1">
                        {DURATION_OPTIONS.map(hrs => (
                          <button
                            key={hrs}
                            type="button"
                            onClick={() => {
                              setDurationHours(hrs);
                              setShowDurationPicker(false);
                            }}
                            className={`w-full text-left py-2.5 px-3.5 hover:bg-slate-800 transition-colors font-bold ${
                              durationHours === hrs ? 'text-cyan-400' : 'text-slate-300'
                            }`}
                          >
                            {hrs} Hour{hrs === 1 ? '' : 's'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {visibleCourts.filter(court => (bookings[court.id] ?? []).filter(e => e.date === selectedDate).length === 0).length === 0 ? (
                <div className="col-span-full rounded-3xl border border-dashed border-slate-800 bg-slate-950/40 p-8 text-center text-slate-400">
                  All courts are already booked on {selectedDate}. Check another date or manage bookings in the Dashboard.
                </div>
              ) : (
                visibleCourts
                  .filter(court => (bookings[court.id] ?? []).filter(e => e.date === selectedDate).length === 0)
                  .map(court => {
                    const theme = getSportTheme(court.sport)
                    return (
                      <div key={court.id} className="glass-card rounded-3xl p-6 border border-white/10 space-y-4 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className={`rounded-full px-3 py-1 text-xs font-bold border ${theme.badgeBg}`}>
                              {theme.icon} {court.sport}
                            </span>
                            <span className="text-xs font-medium text-slate-400">
                              Available to book
                            </span>
                          </div>
                          <h3 className="font-display text-xl font-bold text-white">{court.label}</h3>

                          {/* Calculated Dynamic Booking Slot Banner */}
                          <div className="mt-4 rounded-2xl bg-slate-950/70 p-3.5 border border-emerald-500/20 text-xs space-y-1">
                            <span className="text-slate-400 font-medium">Selected Booking Window:</span>
                            <div className="font-bold text-emerald-400 text-sm flex items-center justify-between">
                              <span>🕒 {computedSlot}</span>
                              <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300 border border-emerald-500/20">
                                {durationHours} Hr{durationHours === 1 ? '' : 's'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-white/5 space-y-3">
                          <button
                            className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 text-sm font-bold text-white shadow-glow-emerald transition-all hover:opacity-95 active:scale-[0.99]"
                            onClick={() => book(court.id, computedSlot)}
                          >
                            Book Court ({computedSlot})
                          </button>
                        </div>
                      </div>
                    )
                  })
              )}
            </div>
          </section>
        )}

        {/* Main Dashboard View Page (Real-Time Queue Dashboard) */}
        {activeAccount && page === 'dashboard' && (
          <div className="space-y-6 animate-fade-in">
            {/* Player Join Queue Quick Action Card (Player Role) */}
            {role === 'player' && (
              <section className="glass-panel rounded-3xl p-6 shadow-2xl border border-cyan-500/20">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="font-display text-xl font-bold text-white flex items-center gap-2">
                      <span>⚡</span> Check-In to Queue
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">Enter your name to join the player pool and queue up for matches.</p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                    <input
                      className="glass-input w-full sm:w-64 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500"
                      value={playerName}
                      onChange={e => setPlayerName(e.target.value)}
                      placeholder="Enter Player Name (e.g. Sam)"
                    />
                    <button
                      className="w-full sm:w-auto min-w-[140px] rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 py-3 px-6 font-bold text-white shadow-glow-cyan transition-all hover:opacity-95 active:scale-[0.99]"
                      onClick={join}
                    >
                      Check-In
                    </button>
                  </div>
                </div>
              </section>
            )}
            {role !== 'player' && (
              <section className="glass-panel rounded-3xl p-6 shadow-2xl border border-amber-500/20">
                {/* Match Creator Card */}
                <div className="space-y-5">
                  <h3 className="font-display font-bold text-white text-base flex items-center gap-2">
                    <span>⚡</span> Match Creator
                  </h3>

                  <div className="grid gap-4 md:grid-cols-2">
                    {/* 1. Select Match Type */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-400 block">Match Type</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setBuilderMatchType('singles');
                            setBuilderTeamA(['']);
                            setBuilderTeamB(['']);
                          }}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold border transition-all ${builderMatchType === 'singles'
                            ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                            : 'bg-slate-900 text-slate-400 border-white/5 hover:bg-slate-850'
                            }`}
                        >
                          Singles (1v1)
                        </button>
                        <button
                          onClick={() => {
                            setBuilderMatchType('doubles');
                            setBuilderTeamA(['', '']);
                            setBuilderTeamB(['', '']);
                          }}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold border transition-all ${builderMatchType === 'doubles'
                            ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                            : 'bg-slate-900 text-slate-400 border-white/5 hover:bg-slate-850'
                            }`}
                        >
                          Doubles (2v2)
                        </button>
                      </div>
                    </div>

                    {/* 2. Target Court Label Display */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-400 block">Queue Target</label>
                      <div className="rounded-xl bg-slate-900 p-2 text-xs font-bold text-slate-300 border border-white/5 text-center min-h-[36px] flex items-center justify-center">
                        {qmVisibleCourts.length > 1 ? (
                          <span className="text-cyan-400">Next Available Court ⚡</span>
                        ) : (
                          <span>{qmVisibleCourts[0]?.label || 'No active court'}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Matchup Selection Slots */}
                  <div className="flex items-center justify-center gap-4 bg-slate-950/60 rounded-2xl p-4 border border-white/5 shadow-inner">
                    {/* Team A Slots */}
                    <div className="flex-1 space-y-2">
                      <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center select-none">Team A</span>
                      <div className="space-y-2">
                        {builderTeamA.map((val, idx) => (
                          <div
                            key={`teamA-slot-${idx}`}
                            className={`rounded-xl border p-2 flex items-center justify-between text-xs min-h-[38px] ${
                              val
                                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                                : 'bg-slate-900/40 border-dashed border-slate-850 text-slate-500'
                            }`}
                          >
                            <span className="truncate">{val ? `👤 ${val}` : `Empty Slot ${idx + 1}`}</span>
                            {val && (
                              <button
                                onClick={() => {
                                  const next = [...builderTeamA];
                                  next[idx] = '';
                                  setBuilderTeamA(next);
                                }}
                                className="text-slate-400 hover:text-slate-200 font-bold px-1 select-none text-sm"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <span className="text-slate-500 text-xs font-black italic mt-5 select-none">VS</span>

                    {/* Team B Slots */}
                    <div className="flex-1 space-y-2">
                      <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center select-none">Team B</span>
                      <div className="space-y-2">
                        {builderTeamB.map((val, idx) => (
                          <div
                            key={`teamB-slot-${idx}`}
                            className={`rounded-xl border p-2 flex items-center justify-between text-xs min-h-[38px] ${
                              val
                                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                                : 'bg-slate-900/40 border-dashed border-slate-850 text-slate-500'
                            }`}
                          >
                            <span className="truncate">{val ? `👤 ${val}` : `Empty Slot ${idx + 1}`}</span>
                            {val && (
                              <button
                                onClick={() => {
                                  const next = [...builderTeamB];
                                  next[idx] = '';
                                  setBuilderTeamB(next);
                                }}
                                className="text-slate-400 hover:text-slate-200 font-bold px-1 select-none text-sm"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Quick-Click Player Selection Panel */}
                  <div className="space-y-3 bg-slate-950/30 rounded-2xl p-4 border border-white/5">
                    <span className="text-xs font-bold text-slate-400 block select-none">
                      💡 Click a waiting player below to add them to a slot:
                    </span>
                    <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-950/40 p-3">
                      <div className="flex gap-3 min-w-max pb-1">
                        {['Advanced', 'High Intermediate', 'Intermediate', 'Low Intermediate', 'Advanced Beginner', 'Beginner', 'Unranked'].map(rankGroup => {
                          const playersInGroup = allCheckedInPlayers.filter(p => {
                            const pRank = playerRanks[p] || 'Unranked';
                            return pRank === rankGroup;
                          });

                          return (
                            <div key={`col-${rankGroup}`} className="rounded-xl border border-white/5 bg-slate-900/40 p-2.5 flex flex-col w-36 min-h-[140px] max-h-64 space-y-2">
                              {/* Column Header */}
                              <div className="border-b border-white/10 pb-1.5 flex items-center justify-between text-[9px] uppercase font-bold text-slate-400 select-none">
                                <span className="truncate" title={rankGroup}>{rankGroup}</span>
                                <span className="ml-1 rounded-full bg-slate-800 text-slate-300 px-1 py-0.25 text-[8px] font-medium">
                                  {playersInGroup.length}
                                </span>
                              </div>
                              {/* Column Content */}
                              <div className="flex flex-col gap-1.5 overflow-y-auto pr-0.5 flex-1">
                                {playersInGroup.length === 0 ? (
                                  <span className="text-[10px] text-slate-650 italic text-center py-4 select-none">Empty</span>
                                ) : (
                                  playersInGroup.map(p => {
                                    const stats = playerStats[p] || { wins: 0, losses: 0, total: 0 };
                                    const inTeamA = builderTeamA.includes(p);
                                    const inTeamB = builderTeamB.includes(p);
                                    const isSelected = inTeamA || inTeamB;

                                    const handleAddPlayer = () => {
                                      if (isSelected) {
                                        // Toggle off/remove player
                                        setBuilderTeamA(builderTeamA.map(x => x === p ? '' : x));
                                        setBuilderTeamB(builderTeamB.map(x => x === p ? '' : x));
                                        return;
                                      }
                                      // Try to slot into Team A first
                                      const emptyA = builderTeamA.indexOf('');
                                      if (emptyA !== -1) {
                                        const next = [...builderTeamA];
                                        next[emptyA] = p;
                                        setBuilderTeamA(next);
                                        return;
                                      }
                                      // If A is full, slot into Team B
                                      const emptyB = builderTeamB.indexOf('');
                                      if (emptyB !== -1) {
                                        const next = [...builderTeamB];
                                        next[emptyB] = p;
                                        setBuilderTeamB(next);
                                        return;
                                      }
                                    };

                                    return (
                                      <button
                                        key={`builder-select-${p}`}
                                        onClick={handleAddPlayer}
                                        className={`flex flex-col items-center justify-center rounded-xl p-1.5 text-[11px] border font-bold transition-all hover:scale-[1.02] active:scale-[0.98] text-center ${
                                          inTeamA
                                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-glow-indigo'
                                            : inTeamB
                                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-glow-rose'
                                            : 'bg-slate-900 hover:bg-slate-850 text-slate-200 border-white/5'
                                        }`}
                                      >
                                        <span className="truncate w-full">{p}</span>
                                        <span className="text-[8px] opacity-60 font-mono mt-0.5">
                                          W:{stats.wins} L:{stats.losses}
                                        </span>
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={queueCreatedMatchup}
                    className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-650 py-3 font-semibold text-white shadow-glow-emerald transition-all hover:scale-[1.01]"
                  >
                    Queue Matchup 🚀
                  </button>
                </div>
              </section>
            )}
            {/* Main Content Layout Grid */}
            <div className="grid gap-6 lg:grid-cols-4">
              {/* Left Column: Court status cards */}
              <div className="lg:col-span-3 space-y-6">
                {/* Courts Grid */}
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-2">
                  {(role === 'qm' ? qmVisibleCourts : visibleCourts).map(court => {
                    const theme = getSportTheme(court.sport)
                    const assignedList = assignments[court.id] ?? []
                    const limit = court.matchType === 'singles' ? 2 : 4
                    const isBusy = assignedList.length >= limit
                    const bookingEntries = (bookings[court.id] ?? []).filter(entry => entry.date === selectedDate)

                    return (
                      <article
                        key={court.id}
                        className="glass-card overflow-hidden rounded-3xl border border-white/10 shadow-xl flex flex-col justify-between"
                      >
                        <div>
                          {/* Court Header Banner */}
                          <div className={`p-5 bg-gradient-to-b ${theme.bgGradient} border-b border-white/5`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className={`rounded-full px-3 py-1 text-xs font-bold border ${theme.badgeBg}`}>
                                {theme.icon} {court.sport}
                              </span>
                              <span
                                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border ${isBusy
                                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                  }`}
                              >
                                <span className={`h-2 w-2 rounded-full ${isBusy ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
                                {isBusy ? 'At Capacity' : 'Available'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <h3 className="font-display text-2xl font-extrabold text-white tracking-tight">{court.label}</h3>
                              {/* Toggle matchType setting (Singles / Doubles) */}
                              {role !== 'player' ? (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const nextType = court.matchType === 'singles' ? 'doubles' : 'singles';
                                    await fetch(`/api/admin/courts/${court.id}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ matchType: nextType }),
                                    });
                                  }}
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border transition-all ${court.matchType === 'singles'
                                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30 hover:bg-sky-500/20 shadow-glow-cyan'
                                    : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/20'
                                    }`}
                                  title="Click to toggle Singles/Doubles"
                                >
                                  {court.matchType === 'singles' ? '👤 Singles' : '👥 Doubles'}
                                </button>
                              ) : (
                                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${court.matchType === 'singles'
                                  ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                                  : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                                  }`}>
                                  {court.matchType === 'singles' ? '👤 Singles' : '👥 Doubles'}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Content Body */}
                          <div className="p-5 space-y-5">
                            {/* Currently Playing Section */}
                            <div className="rounded-2xl bg-slate-950/40 p-4 border border-white/5 space-y-3 animate-fade-in">
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span className="text-slate-400">Currently Playing</span>
                                {role !== 'player' && (
                                  (assignments[court.id] ?? []).length > 0 ? (
                                    <button
                                      onClick={() => {
                                        setScoreModal({ courtId: court.id, label: court.label });
                                        setScoreA('21');
                                        setScoreB('21');
                                      }}
                                      className="rounded-full bg-emerald-500 hover:bg-emerald-450 px-2 py-0.5 text-[10px] font-bold text-slate-950 transition-all shadow-glow-emerald"
                                    >
                                      🏆 Finish
                                    </button>
                                  ) : (
                                    matchups.length > 0 && (() => {
                                      const active = isBookingActiveNow(court.id);
                                      return (
                                        <button
                                          disabled={!active}
                                          onClick={() => startNextMatchOnCourt(court.id)}
                                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition-all ${
                                            active
                                              ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-glow-cyan'
                                              : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                                          }`}
                                          title={active ? "Start the next queued match" : "Cannot start match: Not within booked date and time"}
                                        >
                                          ⚡ Start Next
                                        </button>
                                      );
                                    })()
                                  )
                                )}
                                {(assignments[court.id] ?? []).length > 0 && role === 'player' && (
                                  <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/20 uppercase tracking-wide animate-pulse">
                                    Live
                                  </span>
                                )}
                              </div>
                              {renderMatchup(assignments[court.id] ?? [], court.matchType || 'doubles')}
                            </div>

                            {/* Quick Booking Preview */}
                            <div className="rounded-2xl bg-slate-950/50 p-3.5 border border-white/5 text-xs space-y-2">
                              <div className="flex items-center justify-between text-slate-400 font-medium">
                                <span>Today's Reservations</span>
                                <button
                                  onClick={() => setPage('booking')}
                                  className="text-cyan-400 hover:underline font-semibold"
                                >
                                  Book court →
                                </button>
                              </div>
                              {bookingEntries.length === 0 ? (
                                <p className="text-slate-500 italic">No bookings scheduled for {selectedDate}.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {bookingEntries.map(b => (
                                    <div key={`${b.slot}-${b.name}`} className="flex items-center justify-between rounded-xl bg-slate-900 px-2.5 py-1.5 text-slate-300">
                                      <div className="flex flex-col">
                                        <span className="font-bold text-white">{b.name}</span>
                                        <span className="text-[10px] text-slate-400">🕒 {b.slot}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>

              {/* Right Column: Sidebar */}
              <div className="lg:col-span-1 space-y-6">
                {/* Queue Line Tracker */}
                <aside className="glass-panel rounded-3xl p-5 border border-white/10 space-y-5">
                  <div>
                    <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                      <span>👥</span> Queue Line Tracker
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">Real-time matchups and waiting player pool.</p>
                  </div>

                  {/* Part 1: Matchup Queue */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Matchup Queue</h4>
                    {matchups.length === 0 ? (
                      <p className="text-[11px] text-slate-500 italic">No matchups queued yet. QMs can build matchups from the pool.</p>
                    ) : (
                      <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-1">
                        {matchups.map((match, idx) => {
                          const targetCourtLabel = qmVisibleCourts.length > 1
                            ? 'Next Available Court ⚡'
                            : (courts.find(c => c.id === match.courtId)?.label || 'Next Available Court');

                          return (
                            <div key={match.id} className="rounded-xl bg-slate-900/60 p-3 border border-white/5 space-y-2">
                              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                                <span className="text-cyan-400">{targetCourtLabel}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-400">Match #{idx + 1}</span>
                                  {role !== 'player' && (
                                    <button
                                      onClick={() => cancelQueuedMatchup(match.id, match.courtId)}
                                      className="text-rose-400 hover:text-rose-300 font-bold px-1"
                                      title="Cancel matchup"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-2 text-xs">
                                {/* Team A */}
                                <div className="flex-1 bg-slate-950/40 p-2 rounded-xl border border-white/5 space-y-1">
                                  {match.teamA.map(p => {
                                    const stats = playerStats[p] || { wins: 0, losses: 0, total: 0 };
                                    return (
                                      <div key={p} className="flex flex-col text-[11px] truncate">
                                        <span className="truncate text-slate-200 font-semibold">{p}</span>
                                        <span className="text-[8px] text-slate-500">W:{stats.wins} L:{stats.losses} ({stats.total}G)</span>
                                      </div>
                                    );
                                  })}
                                </div>

                                <span className="text-slate-650 font-black italic text-[9px] select-none">VS</span>

                                {/* Team B */}
                                <div className="flex-1 bg-slate-950/40 p-2 rounded-xl border border-white/5 space-y-1">
                                  {match.teamB.map(p => {
                                    const stats = playerStats[p] || { wins: 0, losses: 0, total: 0 };
                                    return (
                                      <div key={p} className="flex flex-col text-[11px] truncate">
                                        <span className="truncate text-slate-200 font-semibold">{p}</span>
                                        <span className="text-[8px] text-slate-500">W:{stats.wins} L:{stats.losses} ({stats.total}G)</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Part 2: Checked-In Players Pool */}
                  <div className="space-y-2 pt-3 border-t border-white/5">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Checked-In Players ({checkedInDetails.length})
                    </h4>
                    <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-1">
                      {checkedInDetails.length === 0 ? (
                        <p className="text-[11px] text-slate-500 italic">No players checked in yet.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {checkedInDetails.map(({ name, courtId }) => {
                            const stats = playerStats[name] || { wins: 0, losses: 0, total: 0 };
                            return (
                              <div key={name} className="flex items-center justify-between rounded-xl bg-slate-900/60 p-2 text-[10px] border border-white/5 truncate">
                                <div className="flex flex-col truncate">
                                  <span className="font-semibold text-slate-300 truncate max-w-[65px]" title={name}>{name}</span>
                                  <span className="text-[8px] text-slate-550">W:{stats.wins} L:{stats.losses} ({stats.total}G)</span>
                                </div>
                                {role !== 'player' && (
                                  <button
                                    onClick={() => leave(courtId, name)}
                                    className="text-rose-450 hover:text-rose-350 font-bold px-0.5"
                                    title="Remove player"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </aside>

                {/* Match Results Scoreboard */}
                <aside className="glass-panel rounded-3xl p-5 border border-white/10 space-y-4">
                  <div>
                    <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                      <span>🏆</span> Match History
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">Recent game scores and results.</p>
                  </div>

                  <div className="space-y-3 max-h-[35vh] overflow-y-auto pr-1">
                    {matchHistory.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No matches recorded today.</p>
                    ) : (
                      matchHistory.map(match => {
                        const winner = match.scoreA > match.scoreB ? 'A' : 'B';
                        return (
                          <div key={match.id} className="rounded-2xl bg-slate-950/40 p-3.5 border border-white/5 space-y-2.5 text-xs animate-fade-in">
                            <div className="flex items-center justify-between text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                              <span>{match.courtLabel} ({match.matchType})</span>
                              <span>{match.timestamp}</span>
                            </div>

                            <div className="space-y-1.5">
                              {/* Team A */}
                              <div className="flex items-center justify-between">
                                <span className={`truncate max-w-[130px] ${winner === 'A' ? 'font-black text-emerald-450' : 'text-slate-400'}`}>
                                  {match.teamAPlayers.join(' & ') || 'Team A'}
                                </span>
                                <span className={`font-mono text-xs px-2 py-0.5 rounded ${winner === 'A' ? 'bg-emerald-500/10 text-emerald-400 font-black' : 'bg-slate-900 text-slate-500'}`}>
                                  {match.scoreA}
                                </span>
                              </div>
                              {/* Team B */}
                              <div className="flex items-center justify-between">
                                <span className={`truncate max-w-[130px] ${winner === 'B' ? 'font-black text-emerald-450' : 'text-slate-400'}`}>
                                  {match.teamBPlayers.join(' & ') || 'Team B'}
                                </span>
                                <span className={`font-mono text-xs px-2 py-0.5 rounded ${winner === 'B' ? 'bg-emerald-500/10 text-emerald-400 font-black' : 'bg-slate-900 text-slate-500'}`}>
                                  {match.scoreB}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </aside>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Score entry modal */}
      {scoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="glass-card max-w-sm w-full rounded-3xl p-6 border border-amber-500/25 shadow-2xl space-y-5 animate-scale-in">
            <div className="text-center">
              <span className="text-3xl">🏆</span>
              <h3 className="font-display text-lg font-bold text-white mt-2">Finish Match</h3>
              <p className="text-xs text-slate-400">{scoreModal.label}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-400 block text-center">Team A Score</label>
                <input
                  type="number"
                  value={scoreA}
                  onChange={e => setScoreA(e.target.value)}
                  className="glass-input w-full text-center text-xl font-mono rounded-2xl py-3 text-white bg-slate-950"
                  min="0"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400 block text-center">Team B Score</label>
                <input
                  type="number"
                  value={scoreB}
                  onChange={e => setScoreB(e.target.value)}
                  className="glass-input w-full text-center text-xl font-mono rounded-2xl py-3 text-white bg-slate-950"
                  min="0"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                className="flex-1 rounded-2xl bg-slate-800 hover:bg-slate-700 py-3 text-xs font-bold text-slate-200 transition-all"
                onClick={() => setScoreModal(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-650 py-3 text-xs font-bold text-white shadow-glow-emerald transition-all"
                onClick={submitMatchResult}
              >
                Submit Score
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
