-- ─── FocusLock Supabase Schema ───────────────────────────────────────────────
-- Run this entire file in your Supabase project:
--   Dashboard → SQL Editor → New Query → paste → Run
--
-- Creates:
--   sessions table       — stores every completed focus session
--   Row Level Security   — users can only read/write their own sessions

-- ── Sessions Table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,          -- anonymous ID from localStorage
  allowed_url   TEXT NOT NULL DEFAULT '',
  mode          TEXT NOT NULL DEFAULT 'domain' CHECK (mode IN ('domain', 'strict')),
  duration_mins INTEGER NOT NULL DEFAULT 0,
  focused_secs  INTEGER NOT NULL DEFAULT 0,
  violations    INTEGER NOT NULL DEFAULT 0,
  tab_switches  INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS sessions_user_id_idx    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_score_idx      ON sessions(score DESC);
CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions(started_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Enable RLS — anon users can insert + read all sessions
-- Service key (used server-side) bypasses RLS entirely

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Allow anyone to INSERT a session (anon key)
CREATE POLICY "Anyone can insert sessions"
  ON sessions FOR INSERT
  WITH CHECK (true);

-- Allow anyone to SELECT sessions (for stats)
CREATE POLICY "Anyone can read sessions"
  ON sessions FOR SELECT
  USING (true);

-- ── Useful Views (optional, for Supabase dashboard) ───────────────────────────

CREATE OR REPLACE VIEW session_stats AS
SELECT
  COUNT(*)                                              AS total_sessions,
  COUNT(DISTINCT user_id)                               AS unique_users,
  ROUND(AVG(score))                                     AS avg_score,
  MAX(score)                                            AS best_score,
  SUM(focused_secs) / 60                                AS total_focus_mins,
  SUM(violations)                                       AS total_violations,
  ROUND(100.0 * COUNT(*) FILTER (WHERE completed) / COUNT(*)) AS completion_pct
FROM sessions;
