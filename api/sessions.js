// api/sessions.js — Vercel Serverless Function
// POST /api/sessions  → save a completed session
// GET  /api/sessions?userId=xxx → personal session history

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key — server-side only, never exposed to browser
)

export default async function handler(req, res) {
  // CORS headers — allow requests from your webapp domain
  res.setHeader('Access-Control-Allow-Origin', process.env.VITE_APP_URL || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── POST — save session ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const {
      user_id, allowed_url, mode, duration_mins,
      focused_secs, violations, tab_switches,
      score, completed, started_at
    } = req.body

    // Basic validation
    if (!user_id || score === undefined) {
      return res.status(400).json({ error: 'Missing required fields: user_id, score' })
    }

    if (score < 0 || score > 100) {
      return res.status(400).json({ error: 'Score must be 0–100' })
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        user_id,
        allowed_url:   allowed_url || '',
        mode:          mode || 'domain',
        duration_mins: Number(duration_mins) || 0,
        focused_secs:  Number(focused_secs)  || 0,
        violations:    Number(violations)    || 0,
        tab_switches:  Number(tab_switches)  || 0,
        score:         Number(score),
        completed:     Boolean(completed),
        started_at:    started_at || new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('[sessions POST]', error)
      return res.status(500).json({ error: error.message })
    }

    return res.status(201).json({ session: data })
  }

  // ── GET — personal history ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { userId, limit = 20, offset = 0 } = req.query

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId query param' })
    }

    const { data, error, count } = await supabase
      .from('sessions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (error) {
      console.error('[sessions GET]', error)
      return res.status(500).json({ error: error.message })
    }

    // Personal stats summary
    const scores     = (data || []).map(s => s.score)
    const avgScore   = scores.length ? Math.round(scores.reduce((a,b) => a+b, 0) / scores.length) : 0
    const bestScore  = scores.length ? Math.max(...scores) : 0
    const totalMins  = (data || []).reduce((a, s) => a + Math.floor(s.focused_secs / 60), 0)
    const completed  = (data || []).filter(s => s.completed).length

    return res.status(200).json({
      sessions: data,
      total: count,
      stats: { avgScore, bestScore, totalMins, completed }
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
