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

export type QueuedMatchup = {
  id: string;
  matchType: 'singles' | 'doubles';
  teamA: string[];
  teamB: string[];
  courtId?: string;
};
