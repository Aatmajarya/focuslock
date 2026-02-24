// ─── Supabase Client ──────────────────────────────────────────────────────────
// Used by both the frontend (anon key) and API functions (service key).
// Import from here — never instantiate directly elsewhere.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('[FocusLock] Supabase env vars not set — backend features disabled.')
}

export const supabase = (SUPABASE_URL && SUPABASE_ANON)
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null

export const isBackendEnabled = !!supabase
