// api/stats.js — Vercel Serverless Function
// GET /api/stats → global aggregate stats across all users

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.VITE_APP_URL || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Total session count
  const { count: totalSessions } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })

  // Aggregate stats
  const { data: agg } = await supabase
    .from('sessions')
    .select('score, focused_secs, violations, completed')

  if (!agg) return res.status(500).json({ error: 'Could not fetch stats' })

  const totalFocusMins  = Math.floor(agg.reduce((a, s) => a + (s.focused_secs || 0), 0) / 60)
  const avgScore        = agg.length ? Math.round(agg.reduce((a, s) => a + s.score, 0) / agg.length) : 0
  const totalViolations = agg.reduce((a, s) => a + (s.violations || 0), 0)
  const completionRate  = agg.length ? Math.round((agg.filter(s => s.completed).length / agg.length) * 100) : 0
  const uniqueUsers     = new Set(agg.map(s => s.user_id)).size

  return res.status(200).json({
    stats: {
      total_sessions:    totalSessions || 0,
      total_focus_mins:  totalFocusMins,
      avg_score:         avgScore,
      total_violations:  totalViolations,
      completion_rate:   completionRate,
      unique_users:      uniqueUsers,
    }
  })
}
