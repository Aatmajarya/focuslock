// ─── FocusLock API Helpers ────────────────────────────────────────────────────
// All frontend → backend calls live here.
// Falls back gracefully if backend is unavailable.

import { config } from '../config'

const BASE = config.apiUrl || ''

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.warn(`[FocusLock API] ${path} failed:`, err.message)
    return null
  }
}

// ── Save a completed session ───────────────────────────────────────────────────
// Called automatically from SummaryScreen after every session ends.
export async function saveSession({ session, violations, focusedSecs, score, userId }) {
  return apiFetch('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      user_id:       userId,
      allowed_url:   session.allowedUrl,
      mode:          session.mode,
      duration_mins: session.duration,
      focused_secs:  focusedSecs,
      violations:    violations.length,
      tab_switches:  violations.filter(v => v.reason === 'tab_switch').length,
      score,
      completed:     focusedSecs >= session.duration * 60 - 5,
      started_at:    new Date(session.startTime).toISOString(),
    })
  })
}

// ── Fetch global stats ────────────────────────────────────────────────────────
export async function fetchStats() {
  return apiFetch('/api/stats')
}

// ── Fetch personal session history ───────────────────────────────────────────
export async function fetchHistory(userId) {
  return apiFetch(`/api/sessions?userId=${encodeURIComponent(userId)}`)
}

// ── Generate or retrieve anonymous user ID ───────────────────────────────────
// Stored in localStorage — persistent across sessions, no login needed.
export function getUserId() {
  const KEY = 'focuslock_user_id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = 'user_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36)
    localStorage.setItem(KEY, id)
  }
  return id
}
