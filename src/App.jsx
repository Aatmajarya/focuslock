import { useState, useEffect, useRef, useCallback } from 'react'
import { saveSession, fetchStats, getUserId } from './lib/api'

// ─── Extension Bridge ─────────────────────────────────────────────────────────
// Auto-detects the FocusLock extension — no hardcoded ID needed.
//
// How it works:
//   1. background.js writes its own ID into chrome.storage.local on startup
//   2. The webapp reads that ID from storage (works because the webapp runs
//      inside the browser where the extension is installed, sharing storage
//      when accessed via the extension's externally_connectable origin)
//   3. Fallback: if storage read fails, we try sending to the well-known
//      custom event channel the extension also listens on

let _extensionId = null

async function resolveExtensionId() {
  if (_extensionId) return _extensionId

  // Method 1: env var set at build time (most reliable for production)
  const envId = import.meta.env.VITE_EXTENSION_ID
  if (envId) {
    _extensionId = envId
    return _extensionId
  }

  // Method 2: injected by content script on page load
  if (window.__focuslockId) {
    _extensionId = window.__focuslockId
    return _extensionId
  }

  // Method 3: chrome.storage (only works on extension pages, not external sites)
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    try {
      const data = await chrome.storage.local.get('focuslock_extension_id')
      if (data?.focuslock_extension_id) {
        _extensionId = data.focuslock_extension_id
        return _extensionId
      }
    } catch {}
  }

  return null
}

function sendToExtension(type, data = {}) {
  return new Promise(async (resolve) => {
    if (typeof chrome === 'undefined' || !chrome?.runtime) {
      resolve({ success: false, error: 'no_extension' })
      return
    }
    try {
      const id = await resolveExtensionId()
      if (!id) {
        resolve({ success: false, error: 'extension_id_unknown' })
        return
      }
      chrome.runtime.sendMessage(id, { type, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
        } else {
          resolve(response || { success: true })
        }
      })
    } catch (e) {
      resolve({ success: false, error: e.message })
    }
  })
}

async function checkExtensionInstalled() {
  // Also try reading storage directly — works even before ID is known
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    try {
      const data = await chrome.storage.local.get('focuslock_extension_id')
      if (data?.focuslock_extension_id) {
        _extensionId = data.focuslock_extension_id
        return true
      }
    } catch {}
  }
  const res = await sendToExtension('GET_STATUS')
  return res.success !== false && !res.error
}

// Write session to chrome.storage so extension picks it up
function writeSessionToStorage(session) {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ focuslock_session: session })
  }
}

// ─── localStorage Persistence ─────────────────────────────────────────────────
// Survives page refresh — saves session + violations so nothing is lost

const LS_SESSION    = 'focuslock_session'
const LS_VIOLATIONS = 'focuslock_violations'
const LS_SCREEN     = 'focuslock_screen'

function saveToLocalStorage(session, violations, screen) {
  try {
    localStorage.setItem(LS_SESSION,    JSON.stringify(session))
    localStorage.setItem(LS_VIOLATIONS, JSON.stringify(violations))
    localStorage.setItem(LS_SCREEN,     screen)
  } catch {}
}

function loadFromLocalStorage() {
  try {
    const session    = JSON.parse(localStorage.getItem(LS_SESSION)    || 'null')
    const violations = JSON.parse(localStorage.getItem(LS_VIOLATIONS) || '[]')
    const screen     = localStorage.getItem(LS_SCREEN) || 'setup'
    return { session, violations, screen }
  } catch {
    return { session: null, violations: [], screen: 'setup' }
  }
}

function clearLocalStorage() {
  try {
    localStorage.removeItem(LS_SESSION)
    localStorage.removeItem(LS_VIOLATIONS)
    localStorage.removeItem(LS_SCREEN)
  } catch {}
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #080808;
    --surface: #0f0f0f;
    --border: #1c1c1c;
    --border-hover: #2a2a2a;
    --text: #e8e8e8;
    --muted: #4a4a4a;
    --red: #ef4444;
    --green: #22c55e;
    --orange: #f97316;
    --blue: #60a5fa;
    --yellow: #fbbf24;
  }

  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Syne', sans-serif;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  #root {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Noise texture overlay */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
    pointer-events: none;
    z-index: 9999;
    opacity: 0.4;
  }

  .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
    min-height: 100vh;
    position: relative;
  }

  /* SETUP SCREEN */
  .setup-container {
    width: 100%;
    max-width: 480px;
    animation: fadeUp 0.5s ease;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 3rem;
  }

  .brand-icon {
    font-size: 2rem;
    filter: drop-shadow(0 0 20px rgba(239,68,68,0.5));
  }

  .brand-name {
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: -1px;
    color: var(--text);
  }

  .brand-name span { color: var(--red); }

  .tagline {
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    color: var(--muted);
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-left: auto;
    padding-top: 0.25rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2rem;
    margin-bottom: 1rem;
  }

  .card-title {
    font-size: 0.65rem;
    font-family: 'Space Mono', monospace;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 1.25rem;
  }

  .input-group {
    margin-bottom: 1.25rem;
  }

  .input-label {
    display: block;
    font-size: 0.75rem;
    font-family: 'Space Mono', monospace;
    color: var(--muted);
    letter-spacing: 1px;
    margin-bottom: 0.5rem;
    text-transform: uppercase;
  }

  .input-field {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: var(--text);
    font-family: 'Space Mono', monospace;
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.2s;
  }

  .input-field:focus {
    border-color: var(--red);
  }

  .input-field::placeholder { color: var(--muted); }

  .mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }

  .mode-tab {
    padding: 0.75rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  .mode-tab.active {
    border-color: var(--red);
    background: rgba(239,68,68,0.08);
  }

  .mode-tab-title {
    font-size: 0.85rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
    color: var(--text);
  }

  .mode-tab.active .mode-tab-title { color: var(--red); }

  .mode-tab-desc {
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    color: var(--muted);
    line-height: 1.4;
  }

  .duration-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .duration-input {
    width: 100px;
    text-align: center;
  }

  .duration-presets {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .preset-btn {
    padding: 0.35rem 0.65rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .preset-btn:hover, .preset-btn.active {
    border-color: var(--red);
    color: var(--red);
  }

  .start-btn {
    width: 100%;
    padding: 1rem;
    background: var(--red);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-family: 'Syne', sans-serif;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
  }

  .start-btn:hover { background: #dc2626; transform: translateY(-1px); box-shadow: 0 8px 30px rgba(239,68,68,0.3); }
  .start-btn:active { transform: translateY(0); }
  .start-btn:disabled { background: #222; color: var(--muted); cursor: not-allowed; transform: none; box-shadow: none; }

  .extension-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: rgba(96,165,250,0.08);
    border: 1px solid rgba(96,165,250,0.2);
    border-radius: 8px;
    margin-bottom: 1rem;
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    color: var(--blue);
  }

  .extension-banner a {
    color: var(--blue);
    margin-left: auto;
    text-decoration: none;
    font-weight: 700;
  }

  .extension-banner.installed {
    background: rgba(34,197,94,0.08);
    border-color: rgba(34,197,94,0.2);
    color: var(--green);
  }

  /* FOCUS SCREEN */
  .focus-container {
    width: 100%;
    max-width: 560px;
    animation: fadeUp 0.4s ease;
  }

  .focus-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2rem;
  }

  .focus-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    color: var(--green);
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: var(--green);
    border-radius: 50%;
    animation: pulseDot 1.5s ease infinite;
  }

  @keyframes pulseDot {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.4); opacity: 0.6; }
  }

  .end-early-btn {
    padding: 0.4rem 0.9rem;
    background: transparent;
    border: 1px solid #222;
    border-radius: 4px;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .end-early-btn:hover { border-color: var(--red); color: var(--red); }

  .timer-block {
    text-align: center;
    margin-bottom: 2.5rem;
    position: relative;
  }

  .timer-circle {
    width: 240px;
    height: 240px;
    margin: 0 auto 1.5rem;
    position: relative;
  }

  .timer-svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .timer-track {
    fill: none;
    stroke: var(--border);
    stroke-width: 4;
  }

  .timer-progress {
    fill: none;
    stroke: var(--red);
    stroke-width: 4;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.5s ease;
  }

  .timer-inner {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .timer-digits {
    font-family: 'Space Mono', monospace;
    font-size: 3.5rem;
    font-weight: 700;
    letter-spacing: -2px;
    line-height: 1;
    color: var(--text);
    transition: color 0.3s;
  }

  .timer-digits.urgent { color: var(--red); }

  .timer-sub {
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-top: 0.25rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem;
    text-align: center;
  }

  .stat-value {
    font-family: 'Space Mono', monospace;
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1;
    margin-bottom: 0.25rem;
  }

  .stat-value.red { color: var(--red); }
  .stat-value.green { color: var(--green); }
  .stat-value.orange { color: var(--orange); }

  .stat-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    color: var(--muted);
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }

  .session-info-bar {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem 1.25rem;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .session-url {
    font-family: 'Space Mono', monospace;
    font-size: 0.8rem;
    color: var(--green);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-mode-badge {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .badge-strict { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-domain { background: rgba(96,165,250,0.15); color: var(--blue); }

  .violation-log {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    max-height: 180px;
  }

  .vlog-header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .vlog-empty {
    padding: 1.25rem;
    text-align: center;
    font-family: 'Space Mono', monospace;
    font-size: 0.75rem;
    color: var(--green);
  }

  .vlog-list {
    overflow-y: auto;
    max-height: 130px;
  }

  .vlog-item {
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
  }

  .vlog-item:last-child { border-bottom: none; }

  .vlog-type {
    color: var(--orange);
    flex-shrink: 0;
  }

  .vlog-url {
    color: var(--muted);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .vlog-time {
    color: #333;
    flex-shrink: 0;
    font-size: 0.65rem;
  }

  /* NO EXTENSION BANNER */
  .no-ext-overlay {
    background: rgba(96,165,250,0.08);
    border: 1px solid rgba(96,165,250,0.25);
    border-radius: 10px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    font-family: 'Space Mono', monospace;
    font-size: 0.72rem;
    color: var(--blue);
    line-height: 1.6;
  }

  .no-ext-overlay strong { color: #fff; }

  /* SUMMARY SCREEN */
  .summary-container {
    width: 100%;
    max-width: 500px;
    animation: fadeUp 0.5s ease;
  }

  .summary-header {
    text-align: center;
    margin-bottom: 2.5rem;
  }

  .summary-icon {
    font-size: 3.5rem;
    margin-bottom: 1rem;
    display: block;
  }

  .summary-title {
    font-size: 2.5rem;
    font-weight: 800;
    letter-spacing: -1.5px;
    margin-bottom: 0.5rem;
  }

  .summary-subtitle {
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .summary-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .summary-stat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.25rem;
    text-align: center;
  }

  .summary-stat-value {
    font-family: 'Space Mono', monospace;
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 0.4rem;
  }

  .summary-stat-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .score-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.5rem;
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .score-value {
    font-size: 4rem;
    font-weight: 800;
    letter-spacing: -3px;
    line-height: 1;
    margin-bottom: 0.5rem;
  }

  .score-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .action-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .action-btn {
    padding: 0.875rem;
    border-radius: 8px;
    font-family: 'Syne', sans-serif;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border: none;
  }

  .action-btn-primary {
    background: var(--red);
    color: #fff;
  }

  .action-btn-primary:hover { background: #dc2626; transform: translateY(-1px); }

  .action-btn-secondary {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .action-btn-secondary:hover { border-color: var(--border-hover); }

  /* Violation flash overlay */
  .violation-flash {
    position: fixed;
    inset: 0;
    background: rgba(239,68,68,0.15);
    pointer-events: none;
    z-index: 1000;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .violation-flash.active {
    opacity: 1;
    animation: flash 0.4s ease;
  }

  @keyframes flash {
    0% { opacity: 1; }
    100% { opacity: 0; }
  }

  /* Roast Modal */
  .roast-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(6px);
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    animation: roastFadeIn 0.2s ease;
  }

  @keyframes roastFadeIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  .roast-card {
    background: #0f0f0f;
    border: 1px solid var(--red);
    border-radius: 16px;
    padding: 2.5rem 2rem;
    max-width: 420px;
    width: 100%;
    text-align: center;
    position: relative;
    box-shadow: 0 0 60px rgba(239,68,68,0.2), 0 0 120px rgba(239,68,68,0.05);
    animation: roastCardIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes roastCardIn {
    from { transform: translateY(30px) scale(0.9); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }

  .roast-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 28px;
    height: 28px;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 50%;
    color: var(--muted);
    font-size: 0.9rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    line-height: 1;
  }

  .roast-close:hover {
    background: var(--red);
    border-color: var(--red);
    color: #fff;
  }

  .roast-emoji {
    font-size: 3.5rem;
    display: block;
    margin-bottom: 1.25rem;
    animation: roastWiggle 0.5s ease 0.2s;
  }

  @keyframes roastWiggle {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-10deg); }
    75% { transform: rotate(10deg); }
  }

  .roast-quote {
    font-family: 'Syne', sans-serif;
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.4;
    margin-bottom: 1.5rem;
    letter-spacing: -0.5px;
  }

  .roast-quote span {
    color: var(--red);
  }

  .roast-sub {
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 1.75rem;
  }

  .roast-dismiss {
    padding: 0.7rem 2rem;
    background: var(--red);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-family: 'Syne', sans-serif;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.5px;
  }

  .roast-dismiss:hover {
    background: #dc2626;
    transform: translateY(-1px);
  }

  .roast-violation-count {
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    color: #333;
    margin-top: 1rem;
  }
`

// ─── Main App ─────────────────────────────────────────────────────────────────

// ─── Roast Quotes ─────────────────────────────────────────────────────────────

const ROAST_QUOTES = [
  { emoji: '😤', text: 'Padhle beta, kitna samay barbad karega?' },
  { emoji: '🤦', text: 'Padhega nahi to kya karega zindagi mein?' },
  { emoji: '😬', text: 'Kya kar raha hai tu zindagi mein?' },
]

function RoastModal({ violationCount, onClose }) {
  const quote = ROAST_QUOTES[(violationCount - 1) % ROAST_QUOTES.length]

  return (
    <div className="roast-overlay">
      <div className="roast-card">
        <button className="roast-close" onClick={onClose}>✕</button>
        <span className="roast-emoji">{quote.emoji}</span>
        <div className="roast-quote">
          "{quote.text}"
        </div>
        <div className="roast-sub">— your conscience, probably</div>
        <button className="roast-dismiss" onClick={onClose}>
          okay okay i'll focus 😔
        </button>
        <div className="roast-violation-count">violation #{violationCount}</div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState('setup') // 'setup' | 'focus' | 'summary'
  const [extensionInstalled, setExtensionInstalled] = useState(null) // null = checking
  const [session, setSession] = useState(null)
  const [violations, setViolations] = useState([])
  const [violationFlash, setViolationFlash] = useState(false)
  const [roastVisible, setRoastVisible] = useState(false)
  const [roastCount, setRoastCount] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [restored, setRestored] = useState(false) // gate: don't render until restored
  const timerRef = useRef(null)
  const lastViolationTime = useRef(0) // dedup guard

  // ── Restore session on mount (survives refresh) ────────────────────────────
  useEffect(() => {
    const { session: saved, violations: savedViolations, screen: savedScreen } = loadFromLocalStorage()

    if (saved && saved.active) {
      // Check if session is still within time
      const elapsed = Math.floor((Date.now() - saved.startTime) / 1000)
      const total   = saved.duration * 60

      if (elapsed < total) {
        // Session still running — restore it
        setSession(saved)
        setViolations(savedViolations || [])
        setScreen('focus')
        setElapsed(elapsed)
        setTimeLeft(total - elapsed)
      } else {
        // Session expired while away — go to summary
        setSession(saved)
        setViolations(savedViolations || [])
        setElapsed(total)
        setTimeLeft(0)
        setScreen('summary')
      }
    } else if (saved && !saved.active && savedScreen === 'summary') {
      // Was on summary screen
      setSession(saved)
      setViolations(savedViolations || [])
      setScreen('summary')
    }
    // else: fresh load — show landing page
    else {
      setScreen("landing")
    }

    setRestored(true)
    checkExtensionInstalled().then(installed => setExtensionInstalled(installed))
  }, [])

  // ── Persist to localStorage whenever state changes ─────────────────────────
  useEffect(() => {
    if (!restored) return
    saveToLocalStorage(session, violations, screen)
  }, [session, violations, screen, restored])

  // Timer
  useEffect(() => {
    if (screen !== 'focus' || !session) return

    timerRef.current = setInterval(() => {
      const now = Date.now()
      const el = Math.floor((now - session.startTime) / 1000)
      const total = session.duration * 60
      const left = Math.max(0, total - el)
      setElapsed(el)
      setTimeLeft(left)

      if (left === 0) {
        clearInterval(timerRef.current)
        endSession()
      }
    }, 500)

    return () => clearInterval(timerRef.current)
  }, [screen, session])

  // Listen for violations from extension (when running in same browser context)
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime) return

    const listener = (msg) => {
      if (msg.type === 'VIOLATION') {
        triggerViolation(msg.url || 'tab switch', msg.reason || 'tab_switch')
      }
      if (msg.type === 'SESSION_ENDED') {
        endSession()
      }
    }

    try {
      chrome.runtime.onMessage.addListener(listener)
      return () => chrome.runtime.onMessage.removeListener(listener)
    } catch { }
  }, [])

  // Tab visibility detection — only when extension is NOT installed
  // Extension handles tab switches via onActivated, so we skip here if installed
  useEffect(() => {
    if (screen !== 'focus') return
    if (extensionInstalled) return

    const handleVisibility = () => {
      if (!document.hidden) {
        triggerViolation(window.location.href, 'tab_switch')
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [screen, extensionInstalled])

  const triggerViolation = useCallback((url, reason) => {
    const now = Date.now()
    if (now - lastViolationTime.current < 2000) return // dedup: ignore if within 2 seconds
    lastViolationTime.current = now

    setViolations(prev => {
      const newCount = prev.length + 1
      setRoastCount(newCount)
      setRoastVisible(true)
      return [...prev, { url, reason, timestamp: now }]
    })
    setViolationFlash(true)
    setTimeout(() => setViolationFlash(false), 400)
  }, [])

  const startSession = (config) => {
    const newSession = {
      ...config,
      active: true,
      startTime: Date.now(),
    }
    setSession(newSession)
    setViolations([])
    setTimeLeft(config.duration * 60)
    setElapsed(0)
    setScreen('focus')

    // Tell extension
    writeSessionToStorage(newSession)
    sendToExtension('START_SESSION', { session: newSession })

    // Open the allowed URL in the current tab
    const targetUrl = config.allowedUrl.includes('://') ? config.allowedUrl : 'https://' + config.allowedUrl
    window.location.href = targetUrl
  }

  const endSession = () => {
    clearInterval(timerRef.current)
    setScreen('summary')

    // Tell extension
    const ended = { ...session, active: false, endTime: Date.now() }
    writeSessionToStorage(ended)
    sendToExtension('END_SESSION')

    // Auto-save to backend (non-blocking — fails silently if no backend)
    const focusedSecs = Math.min(elapsed, session.duration * 60)
    const { score } = computeFocusScore(session, violations, focusedSecs)
    saveSession({
      session,
      violations,
      focusedSecs,
      score,
      userId: getUserId(),
    }).catch(() => {})
  }

  const restart = () => {
    clearLocalStorage()
    setSession(null)
    setViolations([])
    setScreen('setup')
  }

  // Don't render until we've checked localStorage — prevents flash of setup screen
  if (!restored) return null

  return (
    <>
      <style>{styles}</style>
      <div className={`violation-flash ${violationFlash ? 'active' : ''}`} />
      {roastVisible && (
        <RoastModal
          violationCount={roastCount}
          onClose={() => setRoastVisible(false)}
        />
      )}
      <div className="page">
        {screen === 'landing' && (
          <LandingScreen
            extensionInstalled={extensionInstalled}
            onTryIt={() => setScreen('setup')}
          />
        )}
        {screen === 'setup' && (
          <SetupScreen
            extensionInstalled={extensionInstalled}
            onStart={startSession}
          />
        )}
        {screen === 'focus' && (
          <FocusScreen
            session={session}
            timeLeft={timeLeft}
            elapsed={elapsed}
            violations={violations}
            onEnd={endSession}
          />
        )}
        {screen === 'summary' && (
          <SummaryScreen
            session={session}
            violations={violations}
            elapsed={elapsed}
            onRestart={restart}
          />
        )}
      </div>
    </>
  )
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────

function SetupScreen({ extensionInstalled, onStart }) {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState('domain')
  const [duration, setDuration] = useState(25)
  const [error, setError] = useState('')

  const presets = [5, 15, 25, 45, 60, 90]

  const handleStart = () => {
    if (!url.trim()) { setError('Enter a URL to focus on.'); return }
    setError('')
    onStart({ allowedUrl: url.trim(), mode, duration: parseInt(duration) || 25 })
  }

  return (
    <div className="setup-container">
      <div className="brand">
        <span className="brand-icon">🔒</span>
        <h1 className="brand-name">Focus<span>Lock</span></h1>
        <span className="tagline">deep work enforcer</span>
      </div>

      {extensionInstalled === false && (
        <div className="extension-banner">
          <span>⚡ Install extension for full URL blocking</span>
          <a href="https://chrome.google.com/webstore" target="_blank" rel="noreferrer">Install →</a>
        </div>
      )}

      {extensionInstalled === true && (
        <div className="extension-banner installed">
          <span>✓ FocusLock extension active — full blocking enabled</span>
        </div>
      )}

      <div className="card">
        <div className="card-title">01 — Session Config</div>

        <div className="input-group">
          <label className="input-label">Target URL</label>
          <input
            className="input-field"
            type="text"
            placeholder="youtube.com or https://youtube.com/watch?v=..."
            value={url}
            onChange={e => { setUrl(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleStart()}
          />
          {error && (
            <div style={{ color: 'var(--red)', fontFamily: "'Space Mono'", fontSize: '0.7rem', marginTop: '0.4rem' }}>
              ⚠ {error}
            </div>
          )}
        </div>

        <div className="input-group">
          <label className="input-label">Blocking Mode</label>
          <div className="mode-tabs">
            <div
              className={`mode-tab ${mode === 'domain' ? 'active' : ''}`}
              onClick={() => setMode('domain')}
            >
              <div className="mode-tab-title">Domain Mode</div>
              <div className="mode-tab-desc">
                All links on youtube.com stay accessible. Other domains blocked.
              </div>
            </div>
            <div
              className={`mode-tab ${mode === 'strict' ? 'active' : ''}`}
              onClick={() => setMode('strict')}
            >
              <div className="mode-tab-title">Strict Mode</div>
              <div className="mode-tab-desc">
                Only your exact URL works. Every other link is blocked.
              </div>
            </div>
          </div>
        </div>

        <div className="input-group" style={{ marginBottom: 0 }}>
          <label className="input-label">Duration</label>
          <div className="duration-row">
            <input
              className="input-field duration-input"
              type="number"
              min="1"
              max="480"
              value={duration}
              onChange={e => setDuration(e.target.value)}
            />
            <div className="duration-presets">
              {presets.map(p => (
                <button
                  key={p}
                  className={`preset-btn ${parseInt(duration) === p ? 'active' : ''}`}
                  onClick={() => setDuration(p)}
                >
                  {p}m
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button
        className="start-btn"
        onClick={handleStart}
        disabled={!url.trim()}
      >
        🔒 Start Focus Session — {duration}m
      </button>

      <div style={{ textAlign: 'center', marginTop: '1.25rem', fontFamily: "'Space Mono'", fontSize: '0.65rem', color: 'var(--muted)' }}>
        {extensionInstalled
          ? '✓ Extension will enforce URL blocking across all tabs'
          : 'Tab switching will be tracked • Install extension for full blocking'
        }
      </div>
    </div>
  )
}

// ─── Focus Screen ─────────────────────────────────────────────────────────────

function FocusScreen({ session, timeLeft, elapsed, violations, onEnd }) {
  if (!session) return null

  const total = session.duration * 60
  const progress = total > 0 ? (timeLeft / total) : 0
  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60
  const isUrgent = timeLeft < 60 && timeLeft > 0

  // Circle progress
  const radius = 108
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - progress)

  const elapsedMins = Math.floor(elapsed / 60)
  const elapsedSecs = elapsed % 60

  const typeLabel = (reason) => {
    if (reason === 'tab_switch') return 'TAB SWITCH'
    return 'BLOCKED URL'
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  }

  return (
    <div className="focus-container">
      <div className="focus-header">
        <div className="focus-status">
          <div className="pulse-dot" />
          Session Active
        </div>
        <button className="end-early-btn" onClick={onEnd}>End Session</button>
      </div>

      {/* Timer */}
      <div className="timer-block">
        <div className="timer-circle">
          <svg className="timer-svg" viewBox="0 0 240 240">
            <circle
              className="timer-track"
              cx="120" cy="120"
              r={radius}
            />
            <circle
              className="timer-progress"
              cx="120" cy="120"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ stroke: isUrgent ? '#ef4444' : '#ef4444' }}
            />
          </svg>
          <div className="timer-inner">
            <div className={`timer-digits ${isUrgent ? 'urgent' : ''}`}>
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
            <div className="timer-sub">remaining</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className={`stat-value ${violations.length > 0 ? 'red' : 'green'}`}>
            {violations.length}
          </div>
          <div className="stat-label">Violations</div>
        </div>
        <div className="stat-card">
          <div className="stat-value green">
            {String(elapsedMins).padStart(2,'0')}:{String(elapsedSecs).padStart(2,'0')}
          </div>
          <div className="stat-label">Focused</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--text)' }}>
            {session.duration}m
          </div>
          <div className="stat-label">Goal</div>
        </div>
      </div>

      {/* Session info */}
      <div className="session-info-bar">
        <div className="session-url">✓ {session.allowedUrl}</div>
        <div className={`session-mode-badge ${session.mode === 'strict' ? 'badge-strict' : 'badge-domain'}`}>
          {session.mode}
        </div>
      </div>

      {/* Violation log */}
      <div className="violation-log">
        <div className="vlog-header">Violation Log</div>
        {violations.length === 0 ? (
          <div className="vlog-empty">✓ Clean session — no violations</div>
        ) : (
          <div className="vlog-list">
            {[...violations].reverse().map((v, i) => (
              <div key={i} className="vlog-item">
                <span className="vlog-type">⚠ {typeLabel(v.reason)}</span>
                <span className="vlog-url">{v.url}</span>
                <span className="vlog-time">{formatTime(v.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!window.chrome && (
        <div className="no-ext-overlay" style={{ marginTop: '1rem' }}>
          <strong>Running without extension.</strong> Tab switching is tracked, but URL blocking requires the FocusLock Chrome extension.
        </div>
      )}
    </div>
  )
}

// ─── Focus Score Formula ─────────────────────────────────────────────────────
// Factors: completion rate, violation rate per minute, early vs late violations,
// strict mode bonus, clean streak bonus

function computeFocusScore(session, violations, focusedSecs) {
  const totalSecs   = session.duration * 60
  const focusedMins = Math.max(focusedSecs / 60, 0.1) // avoid /0

  // 1. Completion rate (0–40 pts)
  //    Full session = 40pts, bailing at 50% = 20pts
  const completionRate = Math.min(focusedSecs / totalSecs, 1)
  const completionPts  = completionRate * 40

  // 2. Violation rate penalty (0–40 pts)
  //    Rate = violations per minute. 0 = full 40pts.
  //    Each 0.1 violations/min loses ~8pts. Capped at 40pt loss.
  const violationRate    = violations.length / focusedMins
  const violationPenalty = Math.min(violationRate * 80, 40)
  const violationPts     = 40 - violationPenalty

  // 3. Timing bonus (0–10 pts)
  //    Violations early in session hurt more — if most violations
  //    happened in the last 25% of session, award timing bonus
  let timingPts = 5 // neutral baseline
  if (violations.length > 0 && focusedSecs > 0) {
    const sessionStart = session.startTime
    const lateThreshold = sessionStart + (focusedSecs * 0.75 * 1000)
    const lateViolations = violations.filter(v => v.timestamp >= lateThreshold).length
    const lateRatio = lateViolations / violations.length
    // If >70% of violations were in last 25% of session → you held strong early
    if (lateRatio >= 0.7) timingPts = 10
    // If >50% were in first 25% → bad start
    const earlyThreshold = sessionStart + (focusedSecs * 0.25 * 1000)
    const earlyViolations = violations.filter(v => v.timestamp <= earlyThreshold).length
    const earlyRatio = earlyViolations / violations.length
    if (earlyRatio >= 0.5) timingPts = 0
  } else if (violations.length === 0) {
    timingPts = 10 // perfect — no violations at all
  }

  // 4. Clean streak bonus (0–10 pts)
  //    If longest clean streak > 80% of session duration → +10pts
  let cleanStreakPts = 0
  if (violations.length === 0) {
    cleanStreakPts = 10
  } else if (violations.length > 0 && focusedSecs > 60) {
    // Find longest gap between violations (or start/end)
    const times = [
      session.startTime,
      ...violations.map(v => v.timestamp).sort((a,b) => a - b),
      session.startTime + focusedSecs * 1000
    ]
    let longestGap = 0
    for (let i = 1; i < times.length; i++) {
      longestGap = Math.max(longestGap, times[i] - times[i-1])
    }
    const longestGapSecs = longestGap / 1000
    if (longestGapSecs / focusedSecs >= 0.8) cleanStreakPts = 10
    else if (longestGapSecs / focusedSecs >= 0.5) cleanStreakPts = 5
  }

  // 5. Strict mode bonus (+5pts flat for choosing harder mode)
  const strictBonus = session.mode === 'strict' ? 5 : 0

  const raw = completionPts + violationPts + timingPts + cleanStreakPts + strictBonus
  return {
    score: Math.min(100, Math.max(0, Math.round(raw))),
    breakdown: { completionPts: Math.round(completionPts), violationPts: Math.round(violationPts), timingPts, cleanStreakPts, strictBonus }
  }
}

// ─── Share Card Generator ─────────────────────────────────────────────────────
// Draws a PNG summary card via Canvas API — downloadable + shareable

function generateShareCard(session, violations, focusedSecs, score, breakdown) {
  const W = 800, H = 420
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#080808'
  ctx.fillRect(0, 0, W, H)

  // Grid lines
  ctx.strokeStyle = 'rgba(239,68,68,0.05)'
  ctx.lineWidth = 1
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

  // Border
  ctx.strokeStyle = '#1c1c1c'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

  // Red accent left bar
  ctx.fillStyle = '#ef4444'
  ctx.fillRect(0, 0, 4, H)

  // Brand
  ctx.font = 'bold 14px monospace'
  ctx.fillStyle = '#ef4444'
  ctx.fillText('🔒 FOCUSLOCK', 28, 36)

  ctx.font = '11px monospace'
  ctx.fillStyle = '#333'
  ctx.fillText('DEEP WORK SESSION REPORT', 28, 54)

  // Date
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  ctx.font = '11px monospace'
  ctx.fillStyle = '#2a2a2a'
  ctx.textAlign = 'right'
  ctx.fillText(dateStr, W - 28, 36)
  ctx.textAlign = 'left'

  // Divider
  ctx.strokeStyle = '#1c1c1c'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(28, 68); ctx.lineTo(W - 28, 68); ctx.stroke()

  // Big score
  const scoreColor = score >= 80 ? '#22c55e' : score >= 50 ? '#f97316' : '#ef4444'
  ctx.font = 'bold 96px monospace'
  ctx.fillStyle = scoreColor
  ctx.fillText(String(score), 28, 180)

  ctx.font = '12px monospace'
  ctx.fillStyle = '#444'
  ctx.fillText('FOCUS SCORE / 100', 28, 200)

  // Score breakdown bar
  const barX = 28, barY = 215, barW = 200, barH = 6
  ctx.fillStyle = '#111'
  ctx.fillRect(barX, barY, barW, barH)
  ctx.fillStyle = scoreColor
  ctx.fillRect(barX, barY, Math.round(barW * score / 100), barH)

  // Score label
  const label = score >= 90 ? 'EXCEPTIONAL' : score >= 75 ? 'GREAT' : score >= 60 ? 'GOOD' : score >= 40 ? 'OKAY' : 'NEEDS WORK'
  ctx.font = 'bold 11px monospace'
  ctx.fillStyle = scoreColor
  ctx.fillText(label, 28, 240)

  // Stats block
  const stats = [
    { label: 'TIME FOCUSED', value: `${Math.floor(focusedSecs / 60)}m ${focusedSecs % 60}s` },
    { label: 'VIOLATIONS',   value: String(violations.length) },
    { label: 'DURATION',     value: `${session.duration}m` },
    { label: 'MODE',         value: session.mode.toUpperCase() },
  ]

  stats.forEach((s, i) => {
    const x = 28 + (i % 2) * 200
    const y = 275 + Math.floor(i / 2) * 60
    ctx.font = '10px monospace'
    ctx.fillStyle = '#333'
    ctx.fillText(s.label, x, y)
    ctx.font = 'bold 22px monospace'
    ctx.fillStyle = '#e8e8e8'
    ctx.fillText(s.value, x, y + 22)
  })

  // Score breakdown (right side)
  const bkX = W - 260
  ctx.font = '10px monospace'
  ctx.fillStyle = '#333'
  ctx.fillText('SCORE BREAKDOWN', bkX, 90)

  const bkItems = [
    { label: 'Completion',    pts: breakdown.completionPts, max: 40 },
    { label: 'Consistency',   pts: breakdown.violationPts,  max: 40 },
    { label: 'Timing',        pts: breakdown.timingPts,     max: 10 },
    { label: 'Clean streak',  pts: breakdown.cleanStreakPts, max: 10 },
    { label: 'Mode bonus',    pts: breakdown.strictBonus,   max: 5  },
  ]

  bkItems.forEach((item, i) => {
    const y = 112 + i * 46
    ctx.font = '10px monospace'
    ctx.fillStyle = '#444'
    ctx.fillText(item.label, bkX, y)

    // mini bar
    const bw = 160
    ctx.fillStyle = '#111'
    ctx.fillRect(bkX, y + 6, bw, 4)
    ctx.fillStyle = item.pts === item.max ? '#22c55e' : '#ef4444'
    ctx.fillRect(bkX, y + 6, Math.round(bw * item.pts / item.max), 4)

    ctx.font = 'bold 11px monospace'
    ctx.fillStyle = '#666'
    ctx.textAlign = 'right'
    ctx.fillText(`${item.pts}/${item.max}`, bkX + bw + 40, y + 8)
    ctx.textAlign = 'left'
  })

  // URL (bottom)
  ctx.strokeStyle = '#1c1c1c'
  ctx.beginPath(); ctx.moveTo(28, H - 52); ctx.lineTo(W - 28, H - 52); ctx.stroke()

  const urlDisplay = session.allowedUrl.length > 55 ? session.allowedUrl.slice(0, 55) + '…' : session.allowedUrl
  ctx.font = '11px monospace'
  ctx.fillStyle = '#22c55e'
  ctx.fillText('✓ ' + urlDisplay, 28, H - 28)

  ctx.font = '10px monospace'
  ctx.fillStyle = '#222'
  ctx.textAlign = 'right'
  ctx.fillText('focuslock.vercel.app', W - 28, H - 28)
  ctx.textAlign = 'left'

  return canvas
}

// ─── Summary Screen ───────────────────────────────────────────────────────────

function SummaryScreen({ session, violations, elapsed, onRestart }) {
  if (!session) return null

  const totalSecs   = session.duration * 60
  const focusedSecs = Math.min(elapsed, totalSecs)
  const focusedMins = Math.floor(focusedSecs / 60)
  const focusedSecsRem = focusedSecs % 60
  const completed   = focusedSecs >= totalSecs - 5

  const { score: focusScore, breakdown } = computeFocusScore(session, violations, focusedSecs)
  const scoreColor = focusScore >= 80 ? 'var(--green)' : focusScore >= 50 ? 'var(--orange)' : 'var(--red)'
  const scoreLabel = focusScore >= 90 ? 'Exceptional' : focusScore >= 75 ? 'Great' : focusScore >= 60 ? 'Good' : focusScore >= 40 ? 'Okay' : 'Needs work'

  const tabSwitches    = violations.filter(v => v.reason === 'tab_switch').length
  const blockedAttempts = violations.filter(v => v.reason !== 'tab_switch').length

  const handleDownloadCard = () => {
    const canvas = generateShareCard(session, violations, focusedSecs, focusScore, breakdown)
    const link = document.createElement('a')
    link.download = `focuslock-${new Date().toISOString().slice(0,10)}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const handleCopyText = () => {
    const text = [
      '🔒 FocusLock Session Report',
      `🎯 Score: ${focusScore}/100 — ${scoreLabel}`,
      `⏱  Focused: ${focusedMins}m ${focusedSecsRem}s / ${session.duration}m`,
      `⚠  Violations: ${violations.length} (${tabSwitches} tab switches, ${blockedAttempts} blocked)`,
      `🔒 Mode: ${session.mode}`,
      `📍 URL: ${session.allowedUrl}`,
      `📊 Breakdown: Completion ${breakdown.completionPts}/40 · Consistency ${breakdown.violationPts}/40 · Timing ${breakdown.timingPts}/10 · Streak ${breakdown.cleanStreakPts}/10`,
      `🗓  ${new Date().toLocaleDateString()}`,
      '',
      'focuslock.vercel.app'
    ].join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div className="summary-container">
      <div className="summary-header">
        <span className="summary-icon">{completed ? '🎯' : '⏱️'}</span>
        <div className="summary-title" style={{ color: completed ? 'var(--green)' : 'var(--text)' }}>
          {completed ? 'Session Complete!' : 'Session Ended'}
        </div>
        <div className="summary-subtitle">
          {completed ? 'You crushed it.' : 'Good effort. Keep going.'}
        </div>
      </div>

      {/* Focus Score */}
      <div className="score-card">
        <div className="score-value" style={{ color: scoreColor }}>{focusScore}</div>
        <div className="score-label" style={{ marginBottom: '1rem' }}>Focus Score — {scoreLabel}</div>

        {/* Score breakdown bars */}
        <div style={{ display: 'grid', gap: '0.5rem', textAlign: 'left' }}>
          {[
            { label: 'Completion',   pts: breakdown.completionPts,  max: 40 },
            { label: 'Consistency',  pts: breakdown.violationPts,   max: 40 },
            { label: 'Timing',       pts: breakdown.timingPts,      max: 10 },
            { label: 'Clean streak', pts: breakdown.cleanStreakPts, max: 10 },
            { label: 'Mode bonus',   pts: breakdown.strictBonus,    max: 5  },
          ].map(b => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontFamily: "'Space Mono'", fontSize: '0.6rem', color: 'var(--muted)', width: '80px', flexShrink: 0 }}>{b.label}</span>
              <div style={{ flex: 1, height: '4px', background: '#111', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(b.pts / b.max) * 100}%`, background: b.pts === b.max ? 'var(--green)' : 'var(--red)', borderRadius: '2px', transition: 'width 0.8s ease' }} />
              </div>
              <span style={{ fontFamily: "'Space Mono'", fontSize: '0.6rem', color: 'var(--muted)', width: '32px', textAlign: 'right', flexShrink: 0 }}>{b.pts}/{b.max}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="summary-stats">
        <div className="summary-stat">
          <div className="summary-stat-value" style={{ color: 'var(--green)' }}>
            {String(focusedMins).padStart(2,'0')}m
          </div>
          <div className="summary-stat-label">Time Focused</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat-value" style={{ color: violations.length > 0 ? 'var(--red)' : 'var(--green)' }}>
            {violations.length}
          </div>
          <div className="summary-stat-label">Total Violations</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat-value" style={{ color: 'var(--orange)' }}>
            {tabSwitches}
          </div>
          <div className="summary-stat-label">Tab Switches</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat-value" style={{ color: 'var(--blue)' }}>
            {blockedAttempts}
          </div>
          <div className="summary-stat-label">Blocked Attempts</div>
        </div>
      </div>

      <div className="action-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <button className="action-btn action-btn-primary" onClick={onRestart}>
          🔒 New Session
        </button>
        <button className="action-btn action-btn-secondary" onClick={handleDownloadCard}>
          🖼 Save Card
        </button>
        <button className="action-btn action-btn-secondary" onClick={handleCopyText}>
          📋 Copy
        </button>
      </div>
    </div>
  )
}

// ─── Landing Screen ───────────────────────────────────────────────────────────

const landingStyles = `
  /* ── Landing Page ── */

  .landing-wrap {
    width: 100%;
    min-height: 100vh;
    background: #080808;
    color: #e8e8e8;
    font-family: 'Syne', sans-serif;
    overflow-x: hidden;
  }

  /* Scanline overlay */
  .landing-wrap::before {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(255,255,255,0.012) 2px,
      rgba(255,255,255,0.012) 4px
    );
    pointer-events: none;
    z-index: 100;
  }

  /* ── NAV ── */
  .l-nav {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 3rem;
    border-bottom: 1px solid #111;
    background: rgba(8,8,8,0.92);
    backdrop-filter: blur(12px);
  }

  .l-nav-brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-weight: 800;
    font-size: 1.1rem;
    letter-spacing: -0.5px;
  }

  .l-nav-brand span { color: #ef4444; }

  .l-nav-links {
    display: flex;
    align-items: center;
    gap: 2rem;
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .l-nav-links a {
    color: #444;
    text-decoration: none;
    transition: color 0.2s;
    cursor: pointer;
  }

  .l-nav-links a:hover { color: #e8e8e8; }

  .l-nav-cta {
    padding: 0.5rem 1.25rem;
    background: #ef4444;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
  }

  .l-nav-cta:hover { background: #dc2626; }

  /* ── HERO ── */
  .l-hero {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8rem 2rem 4rem;
    position: relative;
    text-align: center;
  }

  /* Big grid background */
  .l-hero-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(239,68,68,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(239,68,68,0.04) 1px, transparent 1px);
    background-size: 60px 60px;
    z-index: 0;
  }

  /* Red glow center */
  .l-hero-glow {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 600px;
    height: 600px;
    background: radial-gradient(ellipse, rgba(239,68,68,0.08) 0%, transparent 70%);
    pointer-events: none;
    z-index: 0;
  }

  .l-hero-content {
    position: relative;
    z-index: 1;
    max-width: 860px;
  }

  .l-hero-tag {
    display: inline-block;
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: #ef4444;
    border: 1px solid rgba(239,68,68,0.3);
    padding: 0.35rem 1rem;
    border-radius: 2px;
    margin-bottom: 2rem;
    animation: fadeUp 0.6s ease both;
  }

  .l-hero-title {
    font-size: clamp(3.5rem, 10vw, 8rem);
    font-weight: 800;
    letter-spacing: -4px;
    line-height: 0.92;
    margin-bottom: 1.5rem;
    animation: fadeUp 0.6s ease 0.1s both;
  }

  .l-hero-title .red { color: #ef4444; }

  .l-hero-title .outline {
    -webkit-text-stroke: 1px rgba(232,232,232,0.3);
    color: transparent;
  }

  .l-hero-sub {
    font-family: 'Space Mono', monospace;
    font-size: 0.95rem;
    color: #555;
    max-width: 500px;
    margin: 0 auto 3rem;
    line-height: 1.7;
    animation: fadeUp 0.6s ease 0.2s both;
  }

  .l-hero-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    animation: fadeUp 0.6s ease 0.3s both;
    flex-wrap: wrap;
  }

  .l-btn-primary {
    padding: 1rem 2.5rem;
    background: #ef4444;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-family: 'Syne', sans-serif;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
  }

  .l-btn-primary:hover {
    background: #dc2626;
    transform: translateY(-2px);
    box-shadow: 0 12px 40px rgba(239,68,68,0.35);
  }

  .l-btn-secondary {
    padding: 1rem 2rem;
    background: transparent;
    color: #555;
    border: 1px solid #222;
    border-radius: 4px;
    font-family: 'Space Mono', monospace;
    font-size: 0.75rem;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
    text-decoration: none;
    display: inline-block;
  }

  .l-btn-secondary:hover { border-color: #444; color: #e8e8e8; }

  /* ── STATS BAR ── */
  .l-stats {
    display: flex;
    justify-content: center;
    gap: 0;
    margin-top: 5rem;
    border-top: 1px solid #111;
    border-bottom: 1px solid #111;
    animation: fadeUp 0.6s ease 0.4s both;
  }

  .l-stat {
    flex: 1;
    max-width: 200px;
    padding: 2rem 1rem;
    text-align: center;
    border-right: 1px solid #111;
  }

  .l-stat:last-child { border-right: none; }

  .l-stat-num {
    font-family: 'Space Mono', monospace;
    font-size: 2.25rem;
    font-weight: 700;
    color: #ef4444;
    line-height: 1;
    margin-bottom: 0.4rem;
  }

  .l-stat-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    color: #333;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  /* ── HOW IT WORKS ── */
  .l-section {
    padding: 7rem 2rem;
    max-width: 1000px;
    margin: 0 auto;
  }

  .l-section-tag {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: #333;
    margin-bottom: 1rem;
  }

  .l-section-title {
    font-size: clamp(2rem, 5vw, 3.5rem);
    font-weight: 800;
    letter-spacing: -2px;
    line-height: 1.05;
    margin-bottom: 4rem;
  }

  .l-section-title .red { color: #ef4444; }

  /* Steps */
  .l-steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1px;
    background: #111;
    border: 1px solid #111;
  }

  .l-step {
    background: #080808;
    padding: 2.5rem 2rem;
    position: relative;
    transition: background 0.2s;
  }

  .l-step:hover { background: #0d0d0d; }

  .l-step-num {
    font-family: 'Space Mono', monospace;
    font-size: 3.5rem;
    font-weight: 700;
    color: #111;
    line-height: 1;
    margin-bottom: 1rem;
    transition: color 0.2s;
  }

  .l-step:hover .l-step-num { color: rgba(239,68,68,0.15); }

  .l-step-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    letter-spacing: -0.3px;
  }

  .l-step-desc {
    font-family: 'Space Mono', monospace;
    font-size: 0.72rem;
    color: #444;
    line-height: 1.7;
  }

  /* ── FEATURES ── */
  .l-features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1px;
    background: #111;
    border: 1px solid #111;
    margin-top: 1px;
  }

  .l-feature {
    background: #080808;
    padding: 2rem;
    position: relative;
    overflow: hidden;
    transition: background 0.2s;
  }

  .l-feature:hover { background: #0d0d0d; }

  .l-feature-icon {
    font-size: 1.75rem;
    margin-bottom: 1rem;
    display: block;
  }

  .l-feature-title {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 0.4rem;
    letter-spacing: -0.2px;
  }

  .l-feature-desc {
    font-family: 'Space Mono', monospace;
    font-size: 0.68rem;
    color: #444;
    line-height: 1.65;
  }

  .l-feature-badge {
    position: absolute;
    top: 1.25rem;
    right: 1.25rem;
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    padding: 0.2rem 0.45rem;
    border-radius: 2px;
  }

  .badge-ext { background: rgba(239,68,68,0.15); color: #ef4444; }
  .badge-web { background: rgba(96,165,250,0.15); color: #60a5fa; }

  /* ── MODES ── */
  .l-modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: #111;
    border: 1px solid #111;
    margin-top: 1px;
  }

  .l-mode-card {
    background: #080808;
    padding: 3rem 2.5rem;
    transition: background 0.2s;
  }

  .l-mode-card:hover { background: #0d0d0d; }

  .l-mode-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 1rem;
  }

  .l-mode-label.strict { color: #ef4444; }
  .l-mode-label.domain { color: #60a5fa; }

  .l-mode-title {
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -1px;
    margin-bottom: 0.75rem;
  }

  .l-mode-desc {
    font-family: 'Space Mono', monospace;
    font-size: 0.72rem;
    color: #444;
    line-height: 1.7;
    margin-bottom: 1.5rem;
  }

  .l-mode-example {
    font-family: 'Space Mono', monospace;
    font-size: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    line-height: 1.5;
  }

  .l-mode-example.strict-ex {
    background: rgba(239,68,68,0.06);
    border: 1px solid rgba(239,68,68,0.15);
    color: #ef4444;
  }

  .l-mode-example.domain-ex {
    background: rgba(96,165,250,0.06);
    border: 1px solid rgba(96,165,250,0.15);
    color: #60a5fa;
  }

  /* ── ROAST SECTION ── */
  .l-roast-section {
    padding: 7rem 2rem;
    text-align: center;
    border-top: 1px solid #111;
    background: #050505;
  }

  .l-roast-quotes {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    flex-wrap: wrap;
    margin-top: 3rem;
  }

  .l-roast-quote-card {
    background: #0a0a0a;
    border: 1px solid #1a1a1a;
    border-radius: 8px;
    padding: 1.5rem 2rem;
    max-width: 280px;
    text-align: left;
    position: relative;
    transition: all 0.3s;
    cursor: default;
  }

  .l-roast-quote-card:hover {
    border-color: rgba(239,68,68,0.3);
    transform: translateY(-4px);
    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
  }

  .l-roast-emoji-big { font-size: 2rem; margin-bottom: 0.75rem; display: block; }

  .l-roast-text {
    font-family: 'Syne', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #e8e8e8;
    line-height: 1.4;
    margin-bottom: 0.5rem;
  }

  .l-roast-credit {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    color: #333;
    letter-spacing: 1px;
  }

  /* ── TECH STACK ── */
  .l-tech {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }

  .l-tech-tag {
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 0.35rem 0.75rem;
    border: 1px solid #1a1a1a;
    border-radius: 2px;
    color: #444;
    transition: all 0.2s;
  }

  .l-tech-tag:hover { border-color: #333; color: #888; }

  /* ── CTA SECTION ── */
  .l-cta-section {
    padding: 8rem 2rem;
    text-align: center;
    border-top: 1px solid #111;
    position: relative;
    overflow: hidden;
  }

  .l-cta-section::before {
    content: '';
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 800px;
    height: 400px;
    background: radial-gradient(ellipse, rgba(239,68,68,0.06) 0%, transparent 70%);
    pointer-events: none;
  }

  .l-cta-title {
    font-size: clamp(2.5rem, 6vw, 5rem);
    font-weight: 800;
    letter-spacing: -3px;
    line-height: 1;
    margin-bottom: 1.5rem;
    position: relative;
  }

  .l-cta-sub {
    font-family: 'Space Mono', monospace;
    font-size: 0.8rem;
    color: #444;
    margin-bottom: 2.5rem;
    position: relative;
  }

  /* ── FOOTER ── */
  .l-footer {
    border-top: 1px solid #111;
    padding: 2rem 3rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: 'Space Mono', monospace;
    font-size: 0.65rem;
    color: #2a2a2a;
    letter-spacing: 1px;
  }

  .l-footer a { color: #2a2a2a; text-decoration: none; transition: color 0.2s; }
  .l-footer a:hover { color: #ef4444; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 640px) {
    .l-nav { padding: 1rem 1.25rem; }
    .l-nav-links { display: none; }
    .l-hero-title { letter-spacing: -2px; }
    .l-modes { grid-template-columns: 1fr; }
    .l-footer { flex-direction: column; gap: 0.5rem; text-align: center; }
    .l-stats { flex-wrap: wrap; }
    .l-stat { min-width: 120px; }
  }
`

function LandingScreen({ extensionInstalled, onTryIt }) {
  return (
    <div className="landing-wrap">
      <style>{landingStyles}</style>

      {/* NAV */}
      <nav className="l-nav">
        <div className="l-nav-brand">🔒 Focus<span>Lock</span></div>
        <div className="l-nav-links">
          <a onClick={() => document.getElementById('how').scrollIntoView({ behavior: 'smooth' })}>How it works</a>
          <a onClick={() => document.getElementById('modes').scrollIntoView({ behavior: 'smooth' })}>Modes</a>
          <a onClick={() => document.getElementById('tech').scrollIntoView({ behavior: 'smooth' })}>Tech</a>
          <a href="https://github.com" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
        <button className="l-nav-cta" onClick={onTryIt}>Try it →</button>
      </nav>

      {/* HERO */}
      <section className="l-hero">
        <div className="l-hero-grid" />
        <div className="l-hero-glow" />
        <div className="l-hero-content">
          <div className="l-hero-tag">Chrome Extension + Web App</div>
          <h1 className="l-hero-title">
            Stop<br />
            <span className="red">Wasting</span><br />
            <span className="outline">Time.</span>
          </h1>
          <p className="l-hero-sub">
            FocusLock blocks every distraction at the network level.
            Not willpower. Not guilt. Actual enforcement.
          </p>
          <div className="l-hero-actions">
            <button className="l-btn-primary" onClick={onTryIt}>
              🔒 Start a Session
            </button>
            {!extensionInstalled && (
              <a
                className="l-btn-secondary"
                href="https://chrome.google.com/webstore"
                target="_blank"
                rel="noreferrer"
              >
                Install Extension ↗
              </a>
            )}
            {extensionInstalled && (
              <span style={{ fontFamily: "'Space Mono'", fontSize: '0.7rem', color: '#22c55e' }}>
                ✓ Extension detected
              </span>
            )}
          </div>

          {/* Stats bar */}
          <div className="l-stats">
            {[
              { num: '2',    label: 'Blocking Modes'   },
              { num: '0ms',  label: 'Bypass Possible'  },
              { num: '100%', label: 'Client-side'       },
              { num: '∞',    label: 'Roasts Delivered'  },
            ].map(s => (
              <div className="l-stat" key={s.label}>
                <div className="l-stat-num">{s.num}</div>
                <div className="l-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="l-section" id="how">
        <div className="l-section-tag">01 — How it works</div>
        <h2 className="l-section-title">
          Three steps.<br /><span className="red">No excuses.</span>
        </h2>
        <div className="l-steps">
          {[
            {
              n: '01',
              title: 'Set your target',
              desc: 'Enter the URL you need to work on — a doc, a course, a codebase. Pick Domain or Strict mode. Set your duration.'
            },
            {
              n: '02',
              title: 'Lock in',
              desc: 'The Chrome extension intercepts every network request in real time. Anything outside your allowed site gets blocked instantly.'
            },
            {
              n: '03',
              title: 'Get roasted',
              desc: 'Every violation triggers a full-screen roast you cannot dismiss until you click through it. Padhle beta.'
            },
          ].map(s => (
            <div className="l-step" key={s.n}>
              <div className="l-step-num">{s.n}</div>
              <div className="l-step-title">{s.title}</div>
              <div className="l-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Features grid */}
        <div className="l-features">
          {[
            { icon: '⏱', title: 'Real-time countdown', desc: 'Circular progress timer. Goes red in the last minute.', badge: 'web', bl: 'badge-web' },
            { icon: '⚠️', title: 'Violation counter', desc: 'Every blocked URL and tab switch is logged with a timestamp.', badge: 'ext', bl: 'badge-ext' },
            { icon: '🔒', title: 'Network-level blocking', desc: 'Uses Chrome declarativeNetRequest API. Blocks before the page even loads.', badge: 'ext', bl: 'badge-ext' },
            { icon: '😤', title: 'Hindi roast system', desc: '"Padhle beta" appears fullscreen. Cannot be skipped. Must be dismissed.', badge: 'web', bl: 'badge-web' },
            { icon: '🎯', title: 'Focus score', desc: 'Session ends with a 0–100 score based on violations and completion.', badge: 'web', bl: 'badge-web' },
            { icon: '💾', title: 'Survives refresh', desc: 'Session persists in localStorage. Accidental F5 won\'t kill your timer.', badge: 'web', bl: 'badge-web' },
          ].map(f => (
            <div className="l-feature" key={f.title}>
              <span className={`l-feature-badge ${f.bl}`}>{f.badge === 'ext' ? 'Extension' : 'Webapp'}</span>
              <span className="l-feature-icon">{f.icon}</span>
              <div className="l-feature-title">{f.title}</div>
              <div className="l-feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* MODES */}
      <section className="l-section" id="modes" style={{ paddingTop: 0 }}>
        <div className="l-section-tag">02 — Blocking Modes</div>
        <h2 className="l-section-title">
          Choose your<br /><span className="red">prison.</span>
        </h2>
        <div className="l-modes">
          <div className="l-mode-card">
            <div className="l-mode-label strict">Strict Mode</div>
            <div className="l-mode-title">One URL.<br />Nothing else.</div>
            <div className="l-mode-desc">
              Enter a single URL. Only that exact page works.
              Click any other link — blocked. Open a new tab — blocked.
              No exceptions.
            </div>
            <div className="l-mode-example strict-ex">
              ✓ https://docs.google.com/document/d/xyz<br />
              ✗ Everything else on the internet
            </div>
          </div>
          <div className="l-mode-card">
            <div className="l-mode-label domain">Domain Mode</div>
            <div className="l-mode-title">One domain.<br />Full access.</div>
            <div className="l-mode-desc">
              Enter a domain like youtube.com. All pages and links
              within that domain stay accessible. Everything outside
              it is blocked.
            </div>
            <div className="l-mode-example domain-ex">
              ✓ youtube.com/watch?v=anything<br />
              ✓ youtube.com/channel/anything<br />
              ✗ twitter.com, reddit.com, etc.
            </div>
          </div>
        </div>
      </section>

      {/* ROAST SECTION */}
      <section className="l-roast-section">
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <div className="l-section-tag" style={{ justifyContent: 'center', display: 'flex' }}>03 — The Accountability Layer</div>
          <h2 className="l-section-title" style={{ letterSpacing: '-2px', fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}>
            Get roasted.<br /><span className="red">Every. Single. Time.</span>
          </h2>
          <p style={{ fontFamily: "'Space Mono'", fontSize: '0.78rem', color: '#444', lineHeight: 1.8, marginBottom: '0.5rem' }}>
            Every violation triggers a fullscreen modal you cannot dismiss until you physically click through it.
            No auto-dismiss. No escape key. Just your conscience.
          </p>
        </div>
        <div className="l-roast-quotes">
          {[
            { emoji: '😤', text: 'Padhle beta, kitna samay barbad karega?' },
            { emoji: '🤦', text: 'Padhega nahi to kya karega zindagi mein?' },
            { emoji: '😬', text: 'Kya kar raha hai tu zindagi mein?' },
          ].map(q => (
            <div className="l-roast-quote-card" key={q.text}>
              <span className="l-roast-emoji-big">{q.emoji}</span>
              <div className="l-roast-text">"{q.text}"</div>
              <div className="l-roast-credit">— your conscience, probably</div>
            </div>
          ))}
        </div>
      </section>

      {/* TECH STACK */}
      <section className="l-section" id="tech">
        <div className="l-section-tag">04 — Tech Stack</div>
        <h2 className="l-section-title">
          Built with<br /><span className="red">real tools.</span>
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: '#111', border: '1px solid #111' }}>
          {[
            {
              layer: 'Chrome Extension',
              desc: 'Manifest V3 service worker. Uses declarativeNetRequest to intercept and block URLs before they load. Tab activation listener for switch detection. chrome.storage for cross-context state.',
              tags: ['Chrome MV3', 'declarativeNetRequest', 'Service Worker', 'chrome.storage', 'chrome.alarms']
            },
            {
              layer: 'Web App',
              desc: 'React 18 with hooks. localStorage persistence survives refresh. Bidirectional messaging with extension via externally_connectable. Deployed on Vercel.',
              tags: ['React 18', 'Vite', 'localStorage', 'Vercel', 'CSS-in-JS']
            },
          ].map(t => (
            <div key={t.layer} style={{ background: '#080808', padding: '2.5rem 2rem' }}>
              <div style={{ fontFamily: "'Space Mono'", fontSize: '0.6rem', color: '#ef4444', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '1rem' }}>{t.layer}</div>
              <div style={{ fontFamily: "'Space Mono'", fontSize: '0.72rem', color: '#444', lineHeight: '1.7', marginBottom: '1.25rem' }}>{t.desc}</div>
              <div className="l-tech">
                {t.tags.map(tag => <span key={tag} className="l-tech-tag">{tag}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="l-cta-section">
        <h2 className="l-cta-title">
          Stop reading.<br /><span style={{ color: '#ef4444' }}>Start focusing.</span>
        </h2>
        <p className="l-cta-sub">No account. No setup. Open the app and lock in.</p>
        <button className="l-btn-primary" onClick={onTryIt} style={{ fontSize: '1.1rem', padding: '1.1rem 3rem' }}>
          🔒 Launch FocusLock
        </button>
      </section>

      {/* FOOTER */}
      <footer className="l-footer">
        <div>🔒 FocusLock — Deep Work Enforcer</div>
        <div>Built with React + Chrome Extension API</div>
        <div><a href="https://github.com" target="_blank" rel="noreferrer">GitHub ↗</a></div>
      </footer>
    </div>
  )
}
