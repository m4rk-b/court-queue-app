export type AccountRole = 'qm' | 'player';

export type Account = {
  id: string;
  name: string;
  username: string;
  password: string;
  role: AccountRole;
  clubName?: string;
  rank?: string;
};

const accounts = new Map<string, Account>();
let nextId = 1;

// Seed test player accounts with ranks
const testPlayersList = [
  { name: 'Mark', rank: 'Intermediate' },
  { name: 'Kathy', rank: 'Intermediate' },
  { name: 'David', rank: 'Advanced' },
  { name: 'Serena', rank: 'Advanced' },
  { name: 'Roger', rank: 'Advanced' },
  { name: 'LeBron', rank: 'Beginner' },
  { name: 'Lionel', rank: 'Beginner' },
  { name: 'Tom', rank: 'Beginner' },
  { name: 'Rafael', rank: 'High Intermediate' },
  { name: 'Cristiano', rank: 'High Intermediate' },
  { name: 'Stephen', rank: 'Low Intermediate' },
  { name: 'Lewis', rank: 'Advanced Beginner' }
];

testPlayersList.forEach(p => {
  const account: Account = {
    id: `account-${nextId++}`,
    name: p.name,
    username: p.name.toLowerCase(),
    password: 'password123',
    role: 'player',
    rank: p.rank
  };
  accounts.set(account.id, account);
});

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function getAccounts(): Account[] {
  return Array.from(accounts.values());
}

export function createAccount(data: { name: string; username: string; password: string; role: AccountRole; clubName?: string; rank?: string }): Account {
  const name = data.name.trim();
  const username = data.username.trim();
  const password = data.password.trim();
  const role = data.role;
  const clubName = data.clubName?.trim();
  const rank = data.rank?.trim();

  if (!name || !username || !password) {
    throw new Error('Name, username, and password are required');
  }

  if (role === 'qm' && !clubName) {
    throw new Error('Club name is required for QM accounts');
  }

  const normalizedUsername = normalizeUsername(username);
  const exists = Array.from(accounts.values()).some(account => normalizeUsername(account.username) === normalizedUsername);
  if (exists) {
    throw new Error('Username already exists');
  }

  const account: Account = {
    id: `account-${nextId++}`,
    name,
    username,
    password,
    role,
    ...(role === 'qm' ? { clubName } : {}),
    ...(role === 'player' ? { rank } : {}),
  };

  accounts.set(account.id, account);
  return account;
}

export function loginAccount(username: string, password: string): Account | null {
  const normalizedUsername = normalizeUsername(username);
  return Array.from(accounts.values()).find(account => normalizeUsername(account.username) === normalizedUsername && account.password === password) ?? null;
}
