import { useEffect, useRef, useState } from 'react'
import { audioUrl, getWaveform } from '../api'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import type { ManualTag, ManualTagInput, SegmentOut, SegmentState, TimelineOut, WaveformOut } from '../types'
import { TagModal } from './TagModal'

// Manual user-authored tags get a distinct accent so they're never confused
// with provider-generated segments.
const MANUAL_DOT = 'bg-violet-300'

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
  onCreateTag,
  onDeleteTag,
}: {
  timeline: TimelineOut
  onRebuild?: () => void
  rebuilding?: boolean
  onCreateTag?: (input: ManualTagInput) => Promise<void>
  onDeleteTag?: (tagId: string) => Promise<void>
}) {
  const { segments, media, manual_tags } = timeline
  const duration = media.duration_seconds ?? 0

  // Hover state for bidirectional waveform↔row highlight.
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Region selected by drag on the waveform — null until the user releases.
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null)
  // Tag modal visibility (driven from the selection).
  const [modalOpen, setModalOpen] = useState(false)

  // Audio playback shared by header button + waveform cursor + click-to-seek.
  const audio = useAudioPlayer(audioUrl(media.id))

  // Measure the segment-list column so the fixed-position PlayerBar can
  // mirror its width and horizontal offset (the rows live in a grid column
  // that's narrower than the page max-width because of the Recent sidebar).
  const contentRef = useRef<HTMLDivElement>(null)
  const [barRect, setBarRect] = useState<{ left: number; width: number } | null>(null)
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setBarRect({ left: r.left, width: r.width })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // Position can also shift on window scroll-induced layout changes
    // (e.g. mobile URL bar resize) and on viewport resize.
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  async function handleSave(input: ManualTagInput) {
    if (!onCreateTag) return
    await onCreateTag(input)
    setPendingSelection(null)
    setModalOpen(false)
  }

  return (
    // pb-28 leaves clearance for the fixed PlayerBar so the last row in the
    // segment list can scroll fully into view above it. The ref drives the
    // bar's width / horizontal offset so it tracks the content column.
    <div ref={contentRef} className="mt-6 pb-28">
      <div className="flex items-center gap-3 text-sm text-zinc-400 mb-2">
        <span className="truncate">
          {media.original_filename} · {fmtTime(duration)} · {segments.length} segments
          {manual_tags.length > 0 && (
            <span className="text-violet-300 ml-1">· {manual_tags.length} tagged</span>
          )}
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
          manualTags={manual_tags}
          hoveredId={hoveredId}
          onHoverChange={setHoveredId}
          playbackTime={audio.currentTime}
          onSeek={audio.seek}
          pendingSelection={pendingSelection}
          onSelectionChange={setPendingSelection}
          onTagClick={() => setModalOpen(true)}
          taggingEnabled={!!onCreateTag}
        />
      )}

      {(segments.length > 0 || manual_tags.length > 0) && (
        <ul className="mt-4 rounded-lg border border-zinc-800/70 divide-y divide-zinc-800/70 overflow-hidden">
          {[
            ...manual_tags.map((t) => ({ kind: 'manual' as const, t })),
            ...segments.map((s) => ({ kind: 'segment' as const, s })),
          ]
            .sort((a, b) => {
              const aStart = a.kind === 'manual' ? a.t.start_seconds : a.s.start_seconds
              const bStart = b.kind === 'manual' ? b.t.start_seconds : b.s.start_seconds
              return aStart - bStart
            })
            .map((row) => row.kind === 'manual' ? (
              <ManualTagRow
                key={`m:${row.t.id}`}
                tag={row.t}
                highlighted={row.t.id === hoveredId}
                onHoverChange={setHoveredId}
                onDelete={onDeleteTag ? () => onDeleteTag(row.t.id) : undefined}
                onSeek={audio.seek}
              />
            ) : (
              <SegmentRow
                key={row.s.id}
                seg={row.s}
                highlighted={row.s.id === hoveredId}
                onHoverChange={setHoveredId}
              />
            ))}
        </ul>
      )}

      {modalOpen && pendingSelection && onCreateTag && (
        <TagModal
          startSeconds={pendingSelection.start}
          endSeconds={pendingSelection.end}
          onCancel={() => setModalOpen(false)}
          onSave={handleSave}
        />
      )}

      {duration > 0 && barRect && (
        <PlayerBar
          isPlaying={audio.isPlaying}
          currentTime={audio.currentTime}
          duration={duration}
          segments={segments}
          manualTags={manual_tags}
          onTogglePlay={audio.togglePlay}
          onSeek={audio.seek}
          rect={barRect}
        />
      )}
    </div>
  )
}

/**
 * Floating playback control tray. Fixed-position so it stays visible while
 * the segment list scrolls. Timeline applies pb-28 to the page-flow content
 * so the last segment can scroll above this.
 *
 * Transport: ±10s skip, prev/next unresolved (jump to the start of the
 * nearest unresolved segment), play/pause, current/total time.
 */
function PlayerBar({
  isPlaying,
  currentTime,
  duration,
  segments,
  manualTags,
  onTogglePlay,
  onSeek,
  rect,
}: {
  isPlaying: boolean
  currentTime: number
  duration: number
  segments: SegmentOut[]
  manualTags: ManualTag[]
  onTogglePlay: () => void
  onSeek: (seconds: number) => void
  // Live measurements of the segment-list column — the bar mirrors these so
  // it lines up with the rows above it on any viewport / sidebar layout.
  rect: { left: number; width: number }
}) {
  const unresolved = segments
    .filter((s) => s.state === 'unresolved')
    .sort((a, b) => a.start_seconds - b.start_seconds)

  function jumpPrevUnresolved() {
    // Small backoff so repeated clicks step backwards instead of landing on
    // the same segment when the cursor is *inside* an unresolved region.
    const cutoff = currentTime - 0.5
    let target: SegmentOut | undefined
    for (const s of unresolved) {
      if (s.start_seconds < cutoff) target = s
      else break
    }
    if (target) onSeek(target.start_seconds)
  }

  function jumpNextUnresolved() {
    const cutoff = currentTime + 0.5
    const target = unresolved.find((s) => s.start_seconds > cutoff)
    if (target) onSeek(target.start_seconds)
  }

  const hasUnresolved = unresolved.length > 0

  // "Now playing" label — manual tags win over auto segments since they
  // represent the user's explicit assertion, then fall back to the segment,
  // then to the file itself.
  const activeTag = manualTags.find(
    (t) => currentTime >= t.start_seconds && currentTime < t.end_seconds,
  )
  const activeSeg = segments.find(
    (s) => currentTime >= s.start_seconds && currentTime < s.end_seconds,
  )
  const nowTitle = activeTag?.title ?? activeSeg?.title ?? null
  const nowSubtitle = activeTag?.artist ?? activeSeg?.artist ?? null
  const nowAccent = activeTag ? 'bg-violet-300' :
    activeSeg ? STATE_STYLE[activeSeg.state].dot : 'bg-zinc-600'

  return (
    // Anchored to the segment-list column's measured rect (left + width)
    // so the bar visually matches the rows above it regardless of layout
    // (sidebar present/absent, viewport width, etc.). Outer is
    // pointer-events-none so empty space around the pill stays click-through.
    <div
      className="fixed bottom-4 z-40 pointer-events-none"
      style={{ left: rect.left, width: rect.width }}
      role="region"
      aria-label="Playback controls"
    >
      <div className="pointer-events-auto">
        <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-zinc-900/95 backdrop-blur border border-zinc-700 shadow-2xl">
          {/* Left: now-playing — what's under the playback cursor right now. */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${nowAccent}`} aria-hidden />
            <div className="min-w-0 flex-1">
              {nowTitle ? (
                <>
                  <div className="truncate text-[12.5px] leading-tight text-zinc-100">
                    {nowTitle}
                  </div>
                  {nowSubtitle && (
                    <div className="truncate text-[10.5px] leading-tight text-zinc-500 mt-px">
                      {nowSubtitle}
                    </div>
                  )}
                </>
              ) : (
                <div className="truncate text-[11.5px] text-zinc-500 italic">
                  {currentTime === 0 ? 'press play' : 'unidentified region'}
                </div>
              )}
            </div>
          </div>

          {/* Center: transport. shrink-0 so the now-playing label is what
              compresses on narrow viewports, not the controls. */}
          <div className="shrink-0 flex items-center gap-0.5">
            <PlayerBarButton
              onClick={jumpPrevUnresolved}
              disabled={!hasUnresolved}
              title="Previous unresolved segment"
              aria-label="Previous unresolved"
            >
              <UnresolvedJumpIcon direction="back" />
            </PlayerBarButton>
            <PlayerBarButton
              onClick={() => onSeek(Math.max(0, currentTime - 10))}
              title="Back 10 seconds"
              aria-label="Back 10 seconds"
            >
              <SkipIcon direction="back" />
            </PlayerBarButton>
            <button
              onClick={onTogglePlay}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="w-10 h-10 inline-flex items-center justify-center rounded-full bg-zinc-100 hover:bg-white text-zinc-900 transition mx-1"
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6 4l14 8-14 8z" />
                </svg>
              )}
            </button>
            <PlayerBarButton
              onClick={() => onSeek(Math.min(duration, currentTime + 10))}
              title="Forward 10 seconds"
              aria-label="Forward 10 seconds"
            >
              <SkipIcon direction="forward" />
            </PlayerBarButton>
            <PlayerBarButton
              onClick={jumpNextUnresolved}
              disabled={!hasUnresolved}
              title="Next unresolved segment"
              aria-label="Next unresolved"
            >
              <UnresolvedJumpIcon direction="forward" />
            </PlayerBarButton>
          </div>

          {/* Right: time. Hidden on narrow widths to keep the controls primary. */}
          <div className="shrink-0 hidden sm:block w-32 text-right font-mono text-[11px] text-zinc-300 tabular-nums">
            {fmtTime(currentTime)}
            <span className="text-zinc-600 mx-1">/</span>
            {fmtTime(duration)}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlayerBarButton({
  children, onClick, disabled, title, ...rest
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title: string
  'aria-label': string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
      className="w-9 h-9 inline-flex items-center justify-center rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800 transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-300"
    >
      {children}
    </button>
  )
}

function SkipIcon({ direction }: { direction: 'back' | 'forward' }) {
  // ±10s rewind/fast-forward — double chevron, the universal jog glyph.
  // Different path per direction (no SVG transform hackery).
  if (direction === 'back') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M11 5L4 12l7 7zM20 5l-7 7 7 7z" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 5l7 7-7 7zM4 5l7 7-7 7z" />
    </svg>
  )
}

function UnresolvedJumpIcon({ direction }: { direction: 'back' | 'forward' }) {
  // Skip-to-track-edge glyph, amber-tinted so the colour echoes the
  // unresolved-state styling in the waveform / segment list.
  if (direction === 'back') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
           className="text-amber-400">
        <path d="M19 4L8 12l11 8z" />
        <rect x="4.5" y="4" width="2.5" height="16" rx="0.5" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
         className="text-amber-400">
      <path d="M5 4l11 8-11 8z" />
      <rect x="17" y="4" width="2.5" height="16" rx="0.5" />
    </svg>
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
  manualTags,
  hoveredId,
  onHoverChange,
  playbackTime,
  onSeek,
  pendingSelection,
  onSelectionChange,
  onTagClick,
  taggingEnabled,
}: {
  mediaId: string
  duration: number
  segments: SegmentOut[]
  manualTags: ManualTag[]
  hoveredId: string | null
  onHoverChange: (id: string | null) => void
  playbackTime: number
  onSeek: (seconds: number) => void
  pendingSelection: { start: number; end: number } | null
  onSelectionChange: (s: { start: number; end: number } | null) => void
  onTagClick: () => void
  taggingEnabled: boolean
}) {
  const [waveform, setWaveform] = useState<WaveformOut | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerW, setContainerW] = useState(0)
  const [hoverX, setHoverX] = useState<number | null>(null)
  // Live drag state — independent of the committed `pendingSelection` so the
  // band updates fluidly during the drag without round-tripping through the
  // parent on every mouse-move. `dragStartRef` only stores the anchor time
  // (read in event handlers, never in render); `isDragging` is the render-
  // visible flag — promoted to state so React knows when to re-render the
  // cursor / tooltip suppression.
  const dragStartRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [liveSelection, setLiveSelection] = useState<{ start: number; end: number } | null>(null)
  const hoveredSeg = hoveredId ? segments.find((s) => s.id === hoveredId) ?? null : null
  const hoveredTag = hoveredId ? manualTags.find((t) => t.id === hoveredId) ?? null : null
  const selection = liveSelection ?? pendingSelection

  useEffect(() => {
    let alive = true
    getWaveform(mediaId, 800).then((w) => { if (alive) setWaveform(w) }).catch(() => {})
    return () => { alive = false }
  }, [mediaId])

  // Track the container's width as state so render reads don't poke the
  // ref directly (which can return stale values between renders).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  function eventToTime(e: React.MouseEvent | MouseEvent): { x: number; t: number } | null {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return null
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const t = (x / Math.max(1, rect.width)) * duration
    return { x, t }
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    const pt = eventToTime(e)
    if (!pt) return
    // Start a drag — but don't commit a selection yet. If the user just
    // releases without moving, this becomes a click-to-seek (handled in
    // mouseUp below).
    dragStartRef.current = pt.t
    setIsDragging(true)
    setLiveSelection(null)
    onSelectionChange(null)
  }

  function onMouseMove(e: React.MouseEvent) {
    const pt = eventToTime(e)
    if (!pt) return
    setHoverX(pt.x)

    if (dragStartRef.current != null) {
      const startTime = dragStartRef.current
      const start = Math.min(startTime, pt.t)
      const end = Math.max(startTime, pt.t)
      // Only treat it as a real selection once the user has moved a meaningful
      // amount; this preserves the "click to seek" affordance.
      if (Math.abs(end - start) >= 0.25) setLiveSelection({ start, end })
      return
    }

    const seg = segments.find((s) => pt.t >= s.start_seconds && pt.t < s.end_seconds)
    const tag = manualTags.find((t) => pt.t >= t.start_seconds && pt.t < t.end_seconds)
    // Manual tags win for hover identification — they're the user's intent.
    onHoverChange(tag?.id ?? seg?.id ?? null)
  }

  function onMouseUp(e: React.MouseEvent) {
    const wasDragging = dragStartRef.current != null
    const moved = liveSelection !== null
    dragStartRef.current = null
    setIsDragging(false)
    if (!wasDragging) return
    if (moved && liveSelection) {
      onSelectionChange(liveSelection)
      setLiveSelection(null)
    } else {
      // Click without drag → seek the audio cursor here.
      const pt = eventToTime(e)
      if (pt) onSeek(pt.t)
    }
  }

  function onMouseLeave() {
    setHoverX(null)
    onHoverChange(null)
    if (dragStartRef.current != null && liveSelection) {
      onSelectionChange(liveSelection)
      setLiveSelection(null)
    }
    dragStartRef.current = null
    setIsDragging(false)
  }

  const tooltipText = hoverX != null ? fmtTime((hoverX / Math.max(1, containerW)) * duration) : null
  const hoveredHighlight = hoveredSeg
    ? { start: hoveredSeg.start_seconds, end: hoveredSeg.end_seconds }
    : hoveredTag
      ? { start: hoveredTag.start_seconds, end: hoveredTag.end_seconds }
      : null

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      style={{ cursor: isDragging ? 'ew-resize' : 'crosshair' }}
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 96 }} />
      {!waveform && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
          loading waveform…
        </div>
      )}

      {/* Manual-tag bands — full-height, always visible (taggingEnabled=false
          still shows existing tags, just hides the Tag-this affordance). */}
      {duration > 0 && manualTags.map((tag) => (
        <div
          key={tag.id}
          className="absolute top-0 bottom-0 pointer-events-none border-l border-r border-violet-300/70"
          style={{
            left: `${(tag.start_seconds / duration) * 100}%`,
            width: `${((tag.end_seconds - tag.start_seconds) / duration) * 100}%`,
            background: 'rgba(196, 181, 253, 0.18)',
          }}
          title={tag.title ?? 'manual tag'}
        />
      ))}

      {/* Hover region (segment OR manual tag). */}
      {hoveredHighlight && duration > 0 && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none ring-2 ring-white/70 bg-white/10 transition-[left,width] duration-100"
          style={{
            left: `${(hoveredHighlight.start / duration) * 100}%`,
            width: `${((hoveredHighlight.end - hoveredHighlight.start) / duration) * 100}%`,
          }}
        />
      )}

      {/* Pending / live drag selection — solid violet outline so it stands
          apart from the hover highlight. Tag button anchors to its end. */}
      {selection && duration > 0 && (
        <>
          <div
            className="absolute top-0 bottom-0 pointer-events-none ring-2 ring-violet-400 bg-violet-400/15"
            style={{
              left: `${(selection.start / duration) * 100}%`,
              width: `${((selection.end - selection.start) / duration) * 100}%`,
            }}
          />
          {pendingSelection && taggingEnabled && (
            <button
              onClick={(e) => { e.stopPropagation(); onTagClick() }}
              className="absolute -bottom-9 px-2.5 py-1 rounded-md bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium shadow-lg z-10"
              style={{
                left: `${(pendingSelection.start / duration) * 100}%`,
              }}
            >
              + Tag {fmtTime(pendingSelection.start)}–{fmtTime(pendingSelection.end)}
            </button>
          )}
        </>
      )}

      {/* Playback cursor — pink, doesn't disappear when mouse leaves. */}
      {duration > 0 && playbackTime > 0 && (
        <div
          className="absolute top-0 bottom-0 w-px bg-pink-400 pointer-events-none"
          style={{
            left: `${(playbackTime / duration) * 100}%`,
            boxShadow: '0 0 6px rgba(244, 114, 182, 0.7)',
          }}
        />
      )}

      {/* Hover cursor + time tooltip. Suppressed during drag — the selection
          band already shows the range. */}
      {hoverX != null && waveform && !isDragging && (
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
            {hoveredTag?.title && (
              <span className="text-violet-300"> · {hoveredTag.title}</span>
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

      {/* Right rail: actions + meta. Both have fixed widths so the dividers
          and meta blocks line up vertically across rows. The +N popover
          slot is always reserved (invisible when no competitors) so its
          presence on some rows doesn't shift everything else. */}
      <div className="shrink-0 flex items-stretch">
        {seg.title && (
          <div className="px-2 py-2 flex items-center gap-0.5 transition">
            <Links urls={primary?.external_urls ?? {}} title={seg.title} artist={seg.artist} />
            <div className="w-7 shrink-0 flex items-center justify-center">
              {competitors.length > 0 && <CompetitorsPopover competitors={competitors} />}
            </div>
          </div>
        )}

        {/* Meta block — fixed width so the duration string ("20s" vs
            "1m 35s") doesn't wobble the actions cluster's right edge. */}
        <div className="pl-2 pr-3 py-2.5 w-48 flex flex-col items-end justify-center text-[11px] tabular-nums">
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

function ManualTagRow({
  tag,
  highlighted,
  onHoverChange,
  onDelete,
  onSeek,
}: {
  tag: ManualTag
  highlighted: boolean
  onHoverChange: (id: string | null) => void
  onDelete?: () => Promise<void>
  onSeek: (seconds: number) => void
}) {
  const duration = tag.end_seconds - tag.start_seconds
  // Two-click confirm for delete (matches the Recent panel pattern, no popups).
  const [armed, setArmed] = useState(false)
  const armTimeout = useRef<number | null>(null)
  useEffect(() => () => { if (armTimeout.current) window.clearTimeout(armTimeout.current) }, [])
  function arm() {
    setArmed(true)
    if (armTimeout.current) window.clearTimeout(armTimeout.current)
    armTimeout.current = window.setTimeout(() => setArmed(false), 2500)
  }
  return (
    <li
      onMouseEnter={() => onHoverChange(tag.id)}
      onMouseLeave={() => onHoverChange(null)}
      className={
        'group relative flex items-stretch transition ' +
        (highlighted ? 'bg-zinc-800/70' : 'hover:bg-zinc-900/60')
      }
    >
      {/* Distinct violet stripe: this row is user-authored, not provider output. */}
      <span className={`w-[3px] shrink-0 ${MANUAL_DOT}`} aria-hidden />

      <div className="pl-3 pr-3 py-2.5 flex items-center">
        <div className="w-9 h-9 rounded shrink-0 bg-violet-500/15 ring-1 ring-violet-400/40 flex items-center justify-center">
          {/* tag/star glyph — user-authored */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-300" aria-hidden="true">
            <path d="M20.5 13.5l-8 8a1 1 0 01-1.4 0L2.5 13a1 1 0 01-.3-.7V4a2 2 0 012-2h8a1 1 0 01.7.3l8.6 8.6a1 1 0 010 1.4l-1 1.2z" />
            <circle cx="7" cy="7" r="1.2" fill="currentColor" />
          </svg>
        </div>
      </div>

      <div className="flex-1 min-w-0 py-2.5 pr-3 flex flex-col justify-center">
        <div className="flex items-baseline gap-2">
          <div className="truncate text-[13.5px] leading-tight text-zinc-100">
            {tag.title || tag.artist || 'Untitled tag'}
          </div>
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[10px] uppercase tracking-wider">
            manual
          </span>
        </div>
        <div className="truncate text-[11.5px] leading-tight text-zinc-500 mt-0.5">
          {tag.artist}
          {tag.notes && <span className="text-zinc-600"> · {tag.notes}</span>}
        </div>
      </div>

      <div className="shrink-0 flex items-stretch">
        <div className="px-2 py-2 flex items-center gap-0.5 transition">
          <button
            onClick={(e) => { e.stopPropagation(); onSeek(tag.start_seconds) }}
            title="Play from this tag"
            aria-label="Play from this tag"
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 4l14 8-14 8z" />
            </svg>
          </button>
          <Links urls={tag.external_urls} title={tag.title} artist={tag.artist} />
          {onDelete && (armed ? (
            <button
              onClick={(e) => { e.stopPropagation(); setArmed(false); void onDelete() }}
              onMouseLeave={() => setArmed(false)}
              className="px-2 py-1 rounded text-[11px] font-medium bg-red-600 hover:bg-red-500 text-white"
            >
              Confirm delete
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); arm() }}
              title="Delete this tag"
              aria-label="Delete tag"
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-red-300 hover:bg-zinc-800 transition"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18" /><path d="M6 6l12 12" />
              </svg>
            </button>
          ))}
        </div>

        <div className="pl-2 pr-3 py-2.5 w-48 flex flex-col items-end justify-center text-[11px] tabular-nums">
          <div className="font-mono text-zinc-300">
            {fmtTime(tag.start_seconds)}
            <span className="text-zinc-600">–</span>
            {fmtTime(tag.end_seconds)}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-zinc-500 font-mono">{fmtDur(duration)}</span>
          </div>
        </div>
      </div>
    </li>
  )
}

// Platforms we generate fallback search URLs for when the provider didn't
// give us a direct link. Apple Music + Shazam stay direct-only — nobody
// discovers via Shazam search and Apple Music's web search is poor.
const SEARCHABLE: ReadonlySet<LinkKind> = new Set(['spotify', 'youtube', 'soundcloud'])

// Render order WITHIN the search cluster. Deliberately different from the
// direct order: Shazam almost always returns Spotify direct, so Spotify-as-
// search is the rare case. Putting it last keeps SoundCloud + YouTube in a
// consistent column across rows (otherwise Spotify-search elbowing in
// shifts everything else right).
const SEARCH_ORDER: readonly LinkKind[] = ['soundcloud', 'youtube', 'spotify']

function buildSearchUrl(kind: LinkKind, query: string): string {
  const q = encodeURIComponent(query)
  switch (kind) {
    case 'spotify':    return `https://open.spotify.com/search/${q}`
    case 'youtube':    return `https://www.youtube.com/results?search_query=${q}`
    case 'soundcloud': return `https://soundcloud.com/search?q=${q}`
    default:           return ''
  }
}

interface ResolvedLink { kind: LinkKind; url: string; source: 'direct' | 'search' }

function resolveLinks(
  urls: Record<string, string>,
  title: string | null | undefined,
  artist: string | null | undefined,
): { direct: ResolvedLink[]; search: ResolvedLink[] } {
  const direct: ResolvedLink[] = []
  const query = [title, artist].filter(Boolean).join(' ').trim()
  // Direct cluster walks the platform priority order.
  for (const k of LINK_KINDS) {
    if (urls[k]) direct.push({ kind: k, url: urls[k], source: 'direct' })
  }
  // Search cluster uses its own order so columns line up across rows
  // regardless of which platforms returned direct links.
  const search: ResolvedLink[] = []
  if (query) {
    for (const k of SEARCH_ORDER) {
      if (!urls[k] && SEARCHABLE.has(k)) {
        search.push({ kind: k, url: buildSearchUrl(k, query), source: 'search' })
      }
    }
  }
  return { direct, search }
}

function Links({
  urls,
  title,
  artist,
}: {
  urls: Record<string, string>
  // Title/artist drive search-URL construction for platforms missing a
  // direct link. Direct links cluster on the left, search fallbacks on
  // the right with a divider — at a glance the user knows which links
  // are confirmed matches vs constructed search queries.
  title?: string | null
  artist?: string | null
}) {
  const { direct, search } = resolveLinks(urls, title, artist)
  if (direct.length === 0 && search.length === 0) return null
  // Fixed-width slots so the divider sits at the same column across rows
  // (icons would otherwise drift left/right with each row's link count).
  // Direct slot fits up to 4 icons (the realistic Shazam max is ~3); search
  // slot fits the 3 SEARCHABLE platforms. Right-align directs and
  // left-align searches so they meet at the divider.
  const showDivider = direct.length > 0 && search.length > 0
  return (
    <div className="flex items-center">
      <div className="flex items-center gap-0.5 justify-end w-28">
        {direct.map(renderLinkButton)}
      </div>
      <span
        className={
          'w-px h-4 bg-zinc-700 mx-1.5 self-center ' + (showDivider ? '' : 'invisible')
        }
        aria-hidden
      />
      <div className="flex items-center gap-0.5 justify-start w-24">
        {search.map(renderLinkButton)}
      </div>
    </div>
  )
}

function renderLinkButton(l: ResolvedLink) {
  const verb = l.source === 'direct' ? 'Open in' : 'Search'
  return (
    <a
      key={l.kind}
      href={l.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${verb} ${LINK_LABEL[l.kind]}`}
      title={`${verb} ${LINK_LABEL[l.kind]}`}
      onClick={(e) => e.stopPropagation()}
      className={
        'relative w-7 h-7 inline-flex items-center justify-center rounded-md transition ' +
        (l.source === 'direct'
          ? 'text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800'
          : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 opacity-50 hover:opacity-100')
      }
    >
      <PlatformIcon kind={l.kind} />
      {l.source === 'search' && (
        <svg
          width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          className="absolute right-0.5 bottom-0.5 text-zinc-200 bg-zinc-900 rounded-full p-px"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      )}
    </a>
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
