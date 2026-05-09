import { useEffect, useRef, useState } from 'react'
import { getJobCandidates, getWaveform } from '../api'
import type { ChunkCandidate, JobOut, WaveformOut } from '../types'

const ANALYZED_COLOR = 'rgba(167, 139, 250, 0.95)' // violet-400
const PENDING_COLOR  = 'rgba(82, 82, 91, 0.65)'    // zinc-600
const CURSOR_COLOR   = 'rgba(244, 114, 182, 1)'    // pink-400
const BG_COLOR       = '#0b0b10'

function fmtTime(s: number): string {
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

interface Props {
  job: JobOut
  mediaId: string
  filename: string
  pausing: boolean
  onPause: () => void
  onResume: () => void
}

export function AnalysisView({ job, mediaId, filename, pausing, onPause, onResume }: Props) {
  const [waveform, setWaveform] = useState<WaveformOut | null>(null)
  const [candidates, setCandidates] = useState<ChunkCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Fetch waveform once per media.
  useEffect(() => {
    let alive = true
    getWaveform(mediaId, 800).then((w) => { if (alive) setWaveform(w) }).catch(() => {})
    return () => { alive = false }
  }, [mediaId])

  // Poll candidates while job is still in flight. For paused jobs, fetch once
  // (so we show what was found before the pause) but don't keep polling.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const cs = await getJobCandidates(job.id)
        if (alive) setCandidates(cs)
      } catch { /* swallow — next tick will retry */ }
    }
    tick()
    if (job.status !== 'running' && job.status !== 'queued') return
    const id = window.setInterval(tick, 2000)
    return () => { alive = false; window.clearInterval(id) }
  }, [job.id, job.status])

  // Redraw the waveform whenever progress, peaks, or canvas size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform) return
    drawWaveform(canvas, waveform.peaks, job.progress)
  }, [waveform, job.progress])

  // Resize canvas for HiDPI on mount + on window resize.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      if (waveform) drawWaveform(canvas, waveform.peaks, job.progress)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [waveform, job.progress])

  const duration = waveform?.duration_seconds ?? 0
  const cursorTime = duration * job.progress
  const uniqueTracks = dedupeCandidates(candidates)

  const paused = job.status === 'paused'
  // While `pausing` is true the parent has fired the pause request but the
  // worker hasn't acknowledged yet (in-flight chunks still draining). Show
  // "Pausing…" and lock the button until the transition completes.
  const showPausing = pausing && !paused

  async function clickPauseResume() {
    if (busy || showPausing) return
    setBusy(true)
    try {
      if (paused) await onResume()
      else await onPause()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3 text-sm mb-2">
        <div className="truncate flex-1">
          <span className="font-medium">{filename}</span>
          {duration > 0 && (
            <span className="text-zinc-500 ml-2">{fmtTime(duration)}</span>
          )}
          {paused && <span className="ml-2 text-amber-300 text-xs uppercase tracking-wider">paused</span>}
          {showPausing && <span className="ml-2 text-amber-200 text-xs uppercase tracking-wider animate-pulse">pausing…</span>}
        </div>
        <div className="text-zinc-400 tabular-nums shrink-0">
          {fmtTime(cursorTime)} / {fmtTime(duration)} · {(job.progress * 100).toFixed(0)}%
        </div>
        <button
          onClick={clickPauseResume}
          disabled={busy || showPausing}
          title={
            showPausing ? 'Waiting for in-flight chunks to drain…'
              : paused ? 'Resume analysis' : 'Pause analysis'
          }
          aria-label={paused ? 'Resume' : showPausing ? 'Pausing' : 'Pause'}
          className={
            'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition disabled:opacity-60 ' +
            (paused
              ? 'border-emerald-700 text-emerald-200 hover:bg-emerald-900/30'
              : showPausing
                ? 'border-amber-700 text-amber-200'
                : 'border-zinc-700 text-zinc-200 hover:bg-zinc-800/60')
          }
        >
          {paused ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 4l14 8-14 8z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
          {showPausing ? 'Pausing…' : busy ? '…' : paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="relative rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block w-full"
          style={{ height: 120 }}
        />
        {!waveform && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
            generating waveform…
          </div>
        )}
        {waveform && job.status === 'running' && (
          <div
            className="absolute top-0 bottom-0 w-px bg-pink-400"
            style={{
              left: `${job.progress * 100}%`,
              boxShadow: '0 0 8px rgba(244, 114, 182, 0.8)',
            }}
          >
            <div className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-pink-400 animate-ping" />
          </div>
        )}
        {waveform && paused && job.progress > 0 && job.progress < 1 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-amber-300/80"
            style={{ left: `${job.progress * 100}%` }}
          />
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
          Found so far · {uniqueTracks.length} {uniqueTracks.length === 1 ? 'track' : 'tracks'}
        </div>
        {uniqueTracks.length === 0 ? (
          <div className="text-sm text-zinc-500 italic">
            {paused ? 'paused — resume to keep scanning' :
              job.progress === 0 ? 'queued…' : 'scanning…'}
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {uniqueTracks.map((t) => (
              <li
                key={`${t.title}::${t.artist}`}
                className="flex items-center gap-2 p-2 rounded bg-zinc-900/60 border border-zinc-800"
              >
                {t.artwork_url ? (
                  <img
                    src={t.artwork_url}
                    alt=""
                    loading="lazy"
                    className="w-8 h-8 rounded shrink-0 object-cover bg-zinc-800"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded shrink-0 bg-zinc-800/50" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{t.title}</div>
                  <div className="truncate text-xs text-zinc-400">{t.artist}</div>
                </div>
                <div className="text-[11px] font-mono text-zinc-500 shrink-0 tabular-nums">
                  {fmtTime(t.first_seen)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface UniqueTrack {
  title: string
  artist: string
  artwork_url: string | null
  first_seen: number
  hits: number
}

function dedupeCandidates(cs: ChunkCandidate[]): UniqueTrack[] {
  const map = new Map<string, UniqueTrack>()
  for (const c of cs) {
    const key = `${c.title.toLowerCase()}::${c.artist.toLowerCase()}`
    const cur = map.get(key)
    if (!cur) {
      map.set(key, {
        title: c.title,
        artist: c.artist,
        artwork_url: c.artwork_url,
        first_seen: c.chunk_start_seconds,
        hits: 1,
      })
    } else {
      cur.hits += 1
      cur.first_seen = Math.min(cur.first_seen, c.chunk_start_seconds)
      if (!cur.artwork_url && c.artwork_url) cur.artwork_url = c.artwork_url
    }
  }
  // Sort by support desc, then earliest appearance — reflects which tracks the
  // user is most likely to care about right now (highest-evidence first).
  return Array.from(map.values()).sort(
    (a, b) => b.hits - a.hits || a.first_seen - b.first_seen,
  )
}

function drawWaveform(canvas: HTMLCanvasElement, peaks: number[], progress: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, w, h)

  const n = peaks.length
  if (n === 0) return

  const barWidth = w / n
  const gap = barWidth > 3 ? 1 : 0
  const cursor = Math.floor(progress * n)

  for (let i = 0; i < n; i++) {
    const peak = Math.max(0.02, Math.min(1, peaks[i]))
    const barH = Math.max(1, peak * (h - 2))
    const x = i * barWidth
    const y = (h - barH) / 2
    ctx.fillStyle = i <= cursor ? ANALYZED_COLOR : PENDING_COLOR
    ctx.fillRect(x, y, Math.max(1, barWidth - gap), barH)
  }

  if (progress > 0 && progress < 1) {
    const cx = progress * w
    ctx.fillStyle = CURSOR_COLOR
    ctx.fillRect(Math.floor(cx), 0, 1, h)
  }
}
