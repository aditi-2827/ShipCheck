import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './http';

export interface AuthSecretRecord {
  salt: string;
  hash: string;
}

export interface SessionRecord {
  createdAt: number;
}

// Single source of truth for the session lifetime (shared with auth.ts).
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

// Bounds sessions.json so it cannot grow without limit.
const MAX_SESSIONS = 100;

const DATA_DIR = path.join(process.cwd(), '.data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SECRET_FILE = path.join(DATA_DIR, 'auth-secret.json');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Reads and parses a JSON file. Returns `missingFallback` only when the file
// does not exist (fresh install). A file that exists but fails to parse is a
// storage error, surfaced instead of being silently treated as "empty".
function readJsonStrict<T>(file: string, missingFallback: T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return missingFallback;
    throw new ApiError('INTERNAL', `Could not read storage file: ${path.basename(file)}`, 500, { cause: String(err) });
  }
  try {
    const parsed = JSON.parse(raw) as T;
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('parsed value is not an object');
    }
    return parsed;
  } catch {
    throw new ApiError('INTERNAL', `Storage file is corrupt: ${path.basename(file)}`, 500);
  }
}

// Lax reader used only for the optional auth secret (a missing file legitimately
// means "not created yet" on first-run, and a corrupt secret file should not
// block startup).
function readJsonOptional<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, value: unknown): void {
  ensureDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// --- History ---

export function getHistory<T>(): T[] {
  const all = readJsonStrict<{ history?: T[] }>(HISTORY_FILE, { history: [] });
  return Array.isArray(all.history) ? all.history : [];
}

export function appendHistory<T>(entry: T): T[] {
  const all = readJsonStrict<{ history?: T[] }>(HISTORY_FILE, { history: [] });
  const history = Array.isArray(all.history) ? all.history : [];
  history.unshift(entry);
  const trimmed = history.slice(0, 200);
  writeJsonFile(HISTORY_FILE, { history: trimmed });
  return trimmed;
}

// --- Auth secret ---

export function getAuthSecret(): AuthSecretRecord | null {
  return readJsonOptional<AuthSecretRecord>(SECRET_FILE);
}

export function setAuthSecret(record: AuthSecretRecord): void {
  writeJsonFile(SECRET_FILE, record);
}

// --- Sessions ---

function readSessions(): Record<string, SessionRecord> {
  const all = readJsonStrict<{ sessions?: Record<string, SessionRecord> }>(SESSION_FILE, { sessions: {} });
  return all.sessions ?? {};
}

function pruneExpired(sessions: Record<string, SessionRecord>, now: number): void {
  for (const [token, record] of Object.entries(sessions)) {
    if (now - record.createdAt > SESSION_TTL_MS) {
      delete sessions[token];
    }
  }
}

export function getSession(token: string): SessionRecord | null {
  const sessions = readSessions();
  const record = sessions[token];
  if (!record) return null;
  // TTL is enforced for privilege in auth.ts; proactively prune expired here too.
  if (Date.now() - record.createdAt > SESSION_TTL_MS) {
    delete sessions[token];
    writeJsonFile(SESSION_FILE, { sessions });
    return null;
  }
  return record;
}

export async function setSession(token: string, record: SessionRecord): Promise<void> {
  const sessions = readSessions();
  const now = Date.now();
  pruneExpired(sessions, now);

  if (!(token in sessions) && Object.keys(sessions).length >= MAX_SESSIONS) {
    // Evict the oldest session to stay within the cap. Only happens at the
    // boundary, so active sessions are not invalidated unnecessarily.
    const oldest = Object.keys(sessions).reduce((a, b) => (sessions[a].createdAt <= sessions[b].createdAt ? a : b));
    delete sessions[oldest];
  }

  sessions[token] = record;
  writeJsonFile(SESSION_FILE, { sessions });
}

export async function deleteSession(token: string): Promise<void> {
  const sessions = readSessions();
  pruneExpired(sessions, Date.now());
  delete sessions[token];
  writeJsonFile(SESSION_FILE, { sessions });
}

// Re-export a single store facade for convenience.
export const store = {
  getHistory,
  appendHistory,
  getAuthSecret,
  setAuthSecret,
  getSession,
  setSession,
  deleteSession,
};

