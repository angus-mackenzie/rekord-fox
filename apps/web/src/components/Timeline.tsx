import { useEffect, useRef, useState } from 'react'
import { getWaveform } from '../api'
import type { SegmentOut, SegmentState, TimelineOut, WaveformOut } from '../types'

const STATE_STYLE: Record<SegmentState, { dot: string; label: string; border: string }> = {
  confirmed:  { dot: 'bg-emerald-400',  label: 'text-emerald-300',  border: 'border-emerald-700/60' },
  likely:     { dot: 'bg-sky-400',      label: 'text-sky-300',      border: 'border-sky-700/60' },
  uncertain:  { dot: 'bg-amber-400',    label: 'text-amber-300',    border: 'border-amber-700/60' },
  unresolved: { dot: 'bg-zinc-500',     label: 'text-zinc-400',     border: 'border-zinc-700' },
}

// Canvas fill colors keyed by state — picked to match the dot colors above.
const STATE_FILL: Record<SegmentState, string> = {
  confirmed:  'rgba(52, 211, 153, 0.95)',  // emerald-400
  likely:     'rgba(56, 189, 248, 0.95)',  // sky-400
  uncertain:  'rgba(251, 191, 36, 0.9)',   // amber-400
  unresolved: 'rgba(82, 82, 91, 0.55)',    // zinc-600 (dim — unresolved is absence)
}
const PENDING_FILL = 'rgba(82, 82, 91, 0.55)'

// Brand-color icon glyphs for external links. Order = display priority
// (Spotify first per docs/INVARIANTS.md), so the most-useful link is leftmost.
const LINK_KINDS = ['spotify', 'soundcloud', 'youtube', 'apple_music', 'shazam'] as const
type LinkKind = (typeof LINK_KINDS)[number]
const LINK_LABEL: Record<LinkKind, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  youtube: 'YouTube',
  apple_music: 'Apple Music',
  shazam: 'Shazam',
}
const LINK_COLOR: Record<LinkKind, string> = {
  spotify: '#1DB954',
  soundcloud: '#FF7700',
  youtube: '#FF0033',
  apple_music: '#FA2D48',
  shazam: '#0866FF',
}

function fmtTime(s: number): string {
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

export function Timeline({
  timeline,
  onRebuild,
  rebuilding,
}: {
  timeline: TimelineOut
  onRebuild?: () => void
  rebuilding?: boolean
}) {
  const { segments, media } = timeline
  const duration = media.duration_seconds ?? 0
  // Hover state lives here so a row hover highlights its waveform region and
  // a waveform hover highlights the matching row — bidirectional cross-link.
  // Deliberately no auto-scroll: yanking the page on every cursor move makes
  // it impossible to navigate between the waveform and a row out of view.
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 text-sm text-zinc-400 mb-2">
        <span className="truncate">
          {media.original_filename} · {fmtTime(duration)} · {segments.length} segments
        </span>
        {onRebuild && timeline.candidate_count > 0 && (
          <button
            onClick={onRebuild}
            disabled={rebuilding}
            title="Re-fuse segments from existing matches using the latest algorithm. No re-analysis."
            className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/60 text-xs text-zinc-300 disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" />
            </svg>
            {rebuilding ? 'Rebuilding…' : 'Rebuild'}
          </button>
        )}
      </div>
      {duration > 0 && (
        <WaveformBar
          mediaId={media.id}
          duration={duration}
          segments={segments}
          hoveredId={hoveredId}
          onHoverChange={setHoveredId}
        />
      )}
      <ul className="mt-4 rounded-lg border border-zinc-800/70 divide-y divide-zinc-800/70 overflow-hidden">
        {segments.map((seg) => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            highlighted={seg.id === hoveredId}
            onHoverChange={setHoveredId}
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * Waveform with per-bar segment tinting + a thin coverage strip beneath.
 *
 * Each peak is colored by the state of whichever segment covers its time
 * position; gaps fall back to a dim "pending" grey. A hover-tooltip on the
 * canvas shows the time + segment title at the cursor for quick scanning.
 */
function WaveformBar({
  mediaId,
  duration,
  segments,
  hoveredId,
  onHoverChange,
}: {
  mediaId: string
  duration: number
  segments: SegmentOut[]
  hoveredId: string | null
  onHoverChange: (id: string | null) => void
}) {
  const [waveform, setWaveform] = useState<WaveformOut | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const hoveredSeg = hoveredId ? segments.find((s) => s.id === hoveredId) ?? null : null

  useEffect(() => {
    let alive = true
    getWaveform(mediaId, 800).then((w) => { if (alive) setWaveform(w) }).catch(() => {})
    return () => { alive = false }
  }, [mediaId])

  // HiDPI fit + redraw on resize / data change.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform) return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      drawSegmentedWaveform(canvas, waveform.peaks, segments, duration)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [waveform, segments, duration])

  function onMouseMove(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const frac = Math.max(0, Math.min(1, x / rect.width))
    const t = frac * duration
    const seg = segments.find((s) => t >= s.start_seconds && t < s.end_seconds) ?? null
    setHoverX(x)
    onHoverChange(seg?.id ?? null)
  }

  function onMouseLeave() {
    setHoverX(null)
    onHoverChange(null)
  }

  const containerW = containerRef.current?.clientWidth ?? 0
  const tooltipText = hoverX != null ? fmtTime((hoverX / Math.max(1, containerW)) * duration) : null

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 96 }} />
      {!waveform && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
          loading waveform…
        </div>
      )}

      {/* Region highlight for the currently-hovered segment (from either side). */}
      {hoveredSeg && duration > 0 && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none ring-2 ring-white/70 bg-white/10 transition-[left,width] duration-100"
          style={{
            left: `${(hoveredSeg.start_seconds / duration) * 100}%`,
            width: `${((hoveredSeg.end_seconds - hoveredSeg.start_seconds) / duration) * 100}%`,
          }}
        />
      )}

      {/* Cursor line + tooltip when hovering directly on the waveform. */}
      {hoverX != null && waveform && (
        <>
          <div
            className="absolute top-0 bottom-0 w-px bg-zinc-200/50 pointer-events-none"
            style={{ left: hoverX }}
          />
          <div
            className="absolute -top-7 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-200 whitespace-nowrap pointer-events-none shadow-lg"
            style={{ left: Math.min(Math.max(0, hoverX - 80), containerW - 160) }}
          >
            <span className="font-mono tabular-nums">{tooltipText}</span>
            {hoveredSeg?.title && (
              <span className="text-zinc-400"> · {hoveredSeg.title}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function drawSegmentedWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  segments: SegmentOut[],
  duration: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#0b0b10'
  ctx.fillRect(0, 0, w, h)

  const n = peaks.length
  if (n === 0 || duration <= 0) return

  // Pre-compute the segment covering each bar so we don't .find() per bar.
  // Segments are sorted by start_seconds; walk both arrays in lockstep.
  const sorted = [...segments].sort((a, b) => a.start_seconds - b.start_seconds)
  let segIdx = 0

  const barWidth = w / n
  const gap = barWidth > 3 ? 1 : 0

  for (let i = 0; i < n; i++) {
    const tStart = (i / n) * duration
    while (segIdx < sorted.length && sorted[segIdx].end_seconds <= tStart) segIdx++
    const seg = sorted[segIdx]
    const inSeg = seg && tStart >= seg.start_seconds && tStart < seg.end_seconds
    const fill = inSeg ? STATE_FILL[seg.state] : PENDING_FILL

    const peak = Math.max(0.02, Math.min(1, peaks[i]))
    const barH = Math.max(1, peak * (h - 2))
    const x = i * barWidth
    const y = (h - barH) / 2
    ctx.fillStyle = fill
    ctx.fillRect(x, y, Math.max(1, barWidth - gap), barH)
  }
}

function SegmentRow({
  seg,
  highlighted,
  onHoverChange,
}: {
  seg: SegmentOut
  highlighted: boolean
  onHoverChange: (id: string | null) => void
}) {
  const styles = STATE_STYLE[seg.state]
  const primary = seg.candidates[0]
  const artwork = primary?.artwork_url
  const competitors = seg.candidates.slice(1)
  const duration = seg.end_seconds - seg.start_seconds
  return (
    <li
      onMouseEnter={() => onHoverChange(seg.id)}
      onMouseLeave={() => onHoverChange(null)}
      className={
        'group relative flex items-stretch transition ' +
        (highlighted ? 'bg-zinc-800/70' : 'hover:bg-zinc-900/60')
      }
    >
      {/* Left state stripe — narrow, full-height. State at a glance, no chrome. */}
      <span className={`w-[3px] shrink-0 ${styles.dot}`} aria-hidden />

      {/* Artwork */}
      <div className="pl-3 pr-3 py-2.5 flex items-center">
        {artwork ? (
          <img
            src={artwork}
            alt=""
            loading="lazy"
            className="w-9 h-9 rounded shrink-0 object-cover bg-zinc-800 ring-1 ring-black/40"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-9 h-9 rounded shrink-0 bg-zinc-800/60 ring-1 ring-black/40 flex items-center justify-center">
            <span className="text-zinc-600 text-xs">♪</span>
          </div>
        )}
      </div>

      {/* Title block — main visual weight, single tight line + secondary muted line */}
      <div className="flex-1 min-w-0 py-2.5 pr-3 flex flex-col justify-center">
        {seg.title ? (
          <>
            <div className="truncate text-[13.5px] leading-tight text-zinc-100">{seg.title}</div>
            <div className="truncate text-[11.5px] leading-tight text-zinc-500 mt-0.5">
              {seg.artist}
              {primary?.album && <span className="text-zinc-600"> · {primary.album}</span>}
            </div>
          </>
        ) : (
          <div className="text-zinc-500 italic text-sm">{seg.notes ?? 'no match'}</div>
        )}
      </div>

      {/* Right rail: actions (hover-reveal) + meta (always) */}
      <div className="shrink-0 flex items-stretch">
        {/* Action icons — Raycast-style, hover-revealed, brand-colored */}
        {seg.title && (
          <div className="px-2 py-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
            <Links urls={primary?.external_urls ?? {}} />
            {competitors.length > 0 && <CompetitorsPopover competitors={competitors} />}
          </div>
        )}

        {/* Meta block — time range, state label, confidence. Monospaced numbers. */}
        <div className="pl-2 pr-3 py-2.5 flex flex-col items-end justify-center text-[11px] tabular-nums">
          <div className="font-mono text-zinc-300">
            {fmtTime(seg.start_seconds)}
            <span className="text-zinc-600">–</span>
            {fmtTime(seg.end_seconds)}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`uppercase tracking-wider ${styles.label}`}>{seg.state}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">{(seg.confidence * 100).toFixed(0)}%</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-600 font-mono">{fmtDur(duration)}</span>
          </div>
        </div>
      </div>
    </li>
  )
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function Links({ urls }: { urls: Record<string, string> }) {
  const present = LINK_KINDS.filter((k) => urls[k]) as LinkKind[]
  if (present.length === 0) return null
  return (
    <>
      {present.map((k) => (
        <a
          key={k}
          href={urls[k]}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open in ${LINK_LABEL[k]}`}
          title={LINK_LABEL[k]}
          onClick={(e) => e.stopPropagation()}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition"
        >
          <PlatformIcon kind={k} />
        </a>
      ))}
    </>
  )
}

function PlatformIcon({ kind }: { kind: LinkKind }) {
  const color = LINK_COLOR[kind]
  // Simple, monochrome glyphs — recognizable by silhouette + brand color.
  // Not the official marks (avoids trademark fuss), close enough at 14px.
  switch (kind) {
    case 'spotify':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M4.2 6.5c2.4-.7 5.4-.5 7.6.9M4.7 8.7c2-.5 4.4-.4 6.2.7M5.1 10.7c1.6-.4 3.4-.3 4.8.5"
                stroke="#000" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      )
    case 'soundcloud':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 11V8M3.3 11V7M4.6 11V6M6 11V5.5M7.4 11V5c0-1 .8-1.7 1.7-1.7s1.6.7 1.7 1.6c.3-.1.6-.2 1-.2 1.4 0 2.5 1.1 2.5 2.5S13.2 11 11.8 11H7.4z"
                stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'youtube':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="3" width="14" height="10" rx="2.5" fill={color} />
          <path d="M6.5 6L10.5 8 6.5 10z" fill="#fff" />
        </svg>
      )
    case 'apple_music':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="14" height="14" rx="3.5" fill={color} />
          <path d="M6.5 4.5l4-1v6.2a1.7 1.7 0 11-1-1.6V5.7l-2 .5v4a1.7 1.7 0 11-1-1.6V4.5z"
                fill="#fff" />
        </svg>
      )
    case 'shazam':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )
  }
}

function CompetitorsPopover({ competitors }: { competitors: SegmentOut['candidates'] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        title={`${competitors.length} other candidate${competitors.length > 1 ? 's' : ''}`}
        aria-label="Other candidates"
        className="h-7 px-1.5 inline-flex items-center justify-center rounded-md text-[11px] font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition tabular-nums"
      >
        +{competitors.length}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute right-0 top-full mt-1 z-20 w-72 rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl py-1 max-h-72 overflow-auto">
            {competitors.map((c, i) => (
              <li key={i} className="px-3 py-1.5 text-xs hover:bg-zinc-800/60">
                <div className="truncate text-zinc-200">{c.title}</div>
                <div className="truncate text-[11px] text-zinc-500">
                  {c.artist}
                  <span className="text-zinc-600 ml-1.5">· {c.provider} · {(c.confidence * 100).toFixed(0)}%</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
