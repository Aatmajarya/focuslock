// ─── FocusLock Config ─────────────────────────────────────────────────────────
// Single source of truth for all environment-dependent values.
// Import this instead of reading import.meta.env directly anywhere in the app.

export const config = {
  appUrl:      import.meta.env.VITE_APP_URL       || 'http://localhost:5173',
  extensionId: import.meta.env.VITE_EXTENSION_ID  || null,
  apiUrl:      import.meta.env.VITE_APP_URL        || '',

  supabase: {
    url:     import.meta.env.VITE_SUPABASE_URL      || null,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || null,
  },

  features: {
    backend:     !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY),
    history:     import.meta.env.VITE_ENABLE_HISTORY     === 'true',
    backend:     !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY),
  },

  isDev:  import.meta.env.DEV,
  isProd: import.meta.env.PROD,
}
