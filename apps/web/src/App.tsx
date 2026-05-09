import { useCallback, useEffect, useRef, useState } from 'react'
import { createJob, deleteJob, getJob, getTimeline, listJobs, pauseJob, rebuildTimeline, restartJob, resumeJob, uploadMedia } from './api'
import type { JobOut, JobSummary, TimelineOut } from './types'
import { AnalysisView } from './components/AnalysisView'
import { Timeline } from './components/Timeline'

type Stage = 'idle' | 'uploading' | 'analysing' | 'done' | 'error'

interface MediaInfo { id: string; filename: string }

export default function App() {
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobOut | null>(null)
  const [media, setMedia] = useState<MediaInfo | null>(null)
  const [timeline, setTimeline] = useState<TimelineOut | null>(null)
  const [recent, setRecent] = useState<JobSummary[]>([])
  // True from pause-click until the worker actually flips status to `paused`.
  // Drives the "Pausing…" button label and a faster poll cadence so the user
  // gets immediate feedback even when in-flight chunks haven't drained yet.
  const [pausing, setPausing] = useState(false)
  const pollRef = useRef<number | null>(null)

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await listJobs(20))
    } catch {
      // Backend not up yet — fine, panel will just stay empty.
    }
  }, [])

  useEffect(() => {
    refreshRecent()
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [refreshRecent])

  // intervalMs lets callers poll faster while waiting for a transition (e.g.
  // 'pausing' → 'paused' should feel snappy).
  function startPolling(jobId: string, intervalMs = 1000) {
    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(async () => {
      try {
        const updated = await getJob(jobId)
        setJob(updated)
        if (updated.status === 'succeeded') {
          window.clearInterval(pollRef.current!)
          pollRef.current = null
          const tl = await getTimeline(jobId)
          setTimeline(tl)
          setStage('done')
          setPausing(false)
          refreshRecent()
        } else if (updated.status === 'paused') {
          window.clearInterval(pollRef.current!)
          pollRef.current = null
          // Stay in the analysing stage so the AnalysisView keeps showing
          // the waveform + partial results; the view itself will switch its
          // primary action from Pause to Resume.
          setPausing(false)
          refreshRecent()
        } else if (updated.status === 'failed' || updated.status === 'cancelled') {
          window.clearInterval(pollRef.current!)
          pollRef.current = null
          setError(updated.error_message ?? 'job failed')
          setStage('error')
          setPausing(false)
          refreshRecent()
        }
      } catch (e) {
        window.clearInterval(pollRef.current!)
        pollRef.current = null
        setError(String(e))
        setStage('error')
      }
    }, intervalMs)
  }

  async function handleFile(file: File) {
    setError(null)
    setTimeline(null)
    setStage('uploading')
    try {
      const m = await uploadMedia(file)
      setMedia({ id: m.id, filename: m.original_filename })
      const j = await createJob(m.id)
      setJob(j)
      setStage('analysing')
      refreshRecent()
      startPolling(j.id)
    } catch (e) {
      setError(String(e))
      setStage('error')
    }
  }

  async function openJob(summary: JobSummary) {
    setError(null)
    setTimeline(null)
    setMedia({ id: summary.media_asset_id, filename: summary.media_filename })
    if (summary.status === 'succeeded') {
      try {
        const tl = await getTimeline(summary.id)
        setTimeline(tl)
        setJob(tl.job)
        setStage('done')
      } catch (e) {
        setError(String(e))
        setStage('error')
      }
    } else if (
      summary.status === 'running' ||
      summary.status === 'queued' ||
      summary.status === 'paused'
    ) {
      const j = await getJob(summary.id)
      setJob(j)
      setStage('analysing')
      // Only resume the poll loop if there's actually a worker to poll for.
      // Paused jobs sit still until the user clicks Resume.
      if (j.status === 'running' || j.status === 'queued') startPolling(summary.id)
    } else {
      const j = await getJob(summary.id)
      setJob(j)
      setError(j.error_message ?? `job ${summary.status}`)
      setStage('error')
    }
  }

  function reset() {
    setStage('idle')
    setError(null)
    setJob(null)
    setMedia(null)
    setTimeline(null)
    refreshRecent()
  }

  async function handlePause() {
    if (!job) return
    // Optimistic UX: flip the button to "Pausing…" immediately. The worker
    // can take seconds to drain in-flight chunks before status flips, but
    // the user needs to know their click registered. Speed up polling so
    // the transition lands quickly when it does.
    setPausing(true)
    startPolling(job.id, 400)
    try {
      await pauseJob(job.id)
      // Don't trust the response status — the worker may not have acknowledged
      // yet. The poll loop will clear `pausing` when it observes `paused`.
      refreshRecent()
    } catch (e) {
      setPausing(false)
      setError(String(e))
    }
  }

  async function handleResume(jobId?: string) {
    const id = jobId ?? job?.id
    if (!id) return
    try {
      const updated = await resumeJob(id)
      setJob(updated)
      setStage('analysing')
      refreshRecent()
      startPolling(id)
    } catch (e) {
      setError(String(e))
    }
  }

  async function handleRestart(jobId: string) {
    setError(null)
    setTimeline(null)
    try {
      const newJob = await restartJob(jobId)
      setJob(newJob)
      setStage('analysing')
      refreshRecent()
      startPolling(newJob.id)
    } catch (e) {
      setError(String(e))
      setStage('error')
    }
  }

  const [rebuilding, setRebuilding] = useState(false)
  async function handleRebuild() {
    if (!job) return
    setRebuilding(true)
    try {
      await rebuildTimeline(job.id)
      const tl = await getTimeline(job.id)
      setTimeline(tl)
    } catch (e) {
      setError(String(e))
    } finally {
      setRebuilding(false)
    }
  }

  async function handleDelete(jobId: string) {
    try {
      await deleteJob(jobId)
      // If the deleted job is the one we're currently looking at, return to idle.
      if (job?.id === jobId) reset()
      else refreshRecent()
    } catch (e) {
      setError(String(e))
    }
  }

  const showBack = stage !== 'idle'

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <button
          onClick={reset}
          aria-label="Back to upload"
          title="Back to upload"
          className={
            'shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border ' +
            'border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition ' +
            (showBack ? '' : 'invisible')
          }
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-2xl font-semibold tracking-tight">
          <button onClick={reset} className="hover:text-violet-300 transition">Rekord-Fox</button>
        </h1>
        <span className="ml-auto text-xs text-zinc-400">self-hosted track ID for DJ mixes</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-6">
        <main>
          {(stage === 'idle' || stage === 'error') && <Dropzone onFile={handleFile} />}

          {(stage === 'uploading' || stage === 'error') && job && (
            <JobStatus job={job} stage={stage} onReset={reset} />
          )}

          {stage === 'analysing' && job && media && (
            <AnalysisView
              job={job}
              mediaId={media.id}
              filename={media.filename}
              pausing={pausing}
              onPause={handlePause}
              onResume={() => handleResume()}
            />
          )}

          {error && (
            <div className="mt-4 p-3 rounded bg-red-900/40 border border-red-700 text-red-200 text-sm flex items-start gap-3">
              <span className="flex-1">{error}</span>
              {job && (
                <button
                  onClick={() => handleRestart(job.id)}
                  className="shrink-0 px-3 py-1 rounded border border-red-700 hover:border-red-500 hover:bg-red-900/40 text-red-100 text-xs font-medium"
                >
                  Restart
                </button>
              )}
            </div>
          )}

          {timeline && <Timeline timeline={timeline} onRebuild={handleRebuild} rebuilding={rebuilding} />}
        </main>

        <aside>
          <RecentJobs
            jobs={recent}
            activeId={job?.id ?? null}
            onOpen={openJob}
            onRestart={handleRestart}
            onResume={handleResume}
            onDelete={handleDelete}
          />
        </aside>
      </div>
    </div>
  )
}

function Dropzone({ onFile }: { onFile: (f: File) => void }) {
  const [drag, setDrag] = useState(false)
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
      className={
        'block cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition ' +
        (drag ? 'border-violet-400 bg-violet-500/10' : 'border-zinc-700 hover:border-zinc-500')
      }
    >
      <div className="text-lg">Drop a mix here, or click to choose</div>
      <div className="text-xs text-zinc-400 mt-2">.mp3 .wav .flac .m4a .aac .mp4</div>
      <input
        type="file"
        accept=".mp3,.wav,.flac,.m4a,.aac,.mp4,audio/*,video/mp4"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
    </label>
  )
}

function JobStatus({ job, stage }: { job: JobOut; stage: Stage; onReset: () => void }) {
  const label =
    stage === 'uploading' ? 'Uploading…' :
    stage === 'analysing' ? `Analysing — ${(job.progress * 100).toFixed(0)}%` :
    stage === 'done' ? 'Complete' :
    stage === 'error' ? 'Failed' : ''
  // Hide the panel entirely once the timeline is showing — the timeline header
  // already shows file + duration, and the back button is at the top.
  if (stage === 'done') return null
  return (
    <div className="mt-4 p-4 rounded-lg bg-zinc-900 border border-zinc-800">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-zinc-400 font-mono text-xs">job {job.id.slice(0, 8)}</span>
      </div>
      <div className="mt-3 h-2 rounded bg-zinc-800 overflow-hidden">
        <div
          className="h-full bg-violet-500 transition-all"
          style={{ width: `${Math.max(2, job.progress * 100)}%` }}
        />
      </div>
    </div>
  )
}

const STATUS_DOT: Record<string, string> = {
  succeeded: 'bg-emerald-400',
  running:   'bg-sky-400',
  paused:    'bg-amber-400',
  queued:    'bg-zinc-500',
  failed:    'bg-red-400',
  cancelled: 'bg-zinc-500',
}

function RecentJobs({
  jobs,
  activeId,
  onOpen,
  onRestart,
  onResume,
  onDelete,
}: {
  jobs: JobSummary[]
  activeId: string | null
  onOpen: (j: JobSummary) => void
  onRestart: (id: string) => void
  onResume: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="px-3 py-2 border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-400">
        Recent
      </div>
      {jobs.length === 0 ? (
        <div className="p-3 text-xs text-zinc-500">No jobs yet.</div>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {jobs.map((j) => (
            <RecentJobRow
              key={j.id}
              job={j}
              active={j.id === activeId}
              onOpen={onOpen}
              onRestart={onRestart}
              onResume={onResume}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function RecentJobRow({
  job: j,
  active,
  onOpen,
  onRestart,
  onResume,
  onDelete,
}: {
  job: JobSummary
  active: boolean
  onOpen: (j: JobSummary) => void
  onRestart: (id: string) => void
  onResume: (id: string) => void
  onDelete: (id: string) => void
}) {
  const canRestart = j.status === 'failed' || j.status === 'cancelled'
  const canResume = j.status === 'paused'
  // Two-click delete (no popup): first click arms, second click confirms.
  // Auto-disarms after 2.5s so a stale armed state can't bite.
  const [armed, setArmed] = useState(false)
  const armTimeout = useRef<number | null>(null)
  useEffect(() => () => { if (armTimeout.current) window.clearTimeout(armTimeout.current) }, [])
  function arm() {
    setArmed(true)
    if (armTimeout.current) window.clearTimeout(armTimeout.current)
    armTimeout.current = window.setTimeout(() => setArmed(false), 2500)
  }
  return (
    <li className={'group relative ' + (active ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/50')}>
      <button onClick={() => onOpen(j)} className="w-full text-left p-3 pr-20">
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[j.status] ?? 'bg-zinc-500'}`} />
          <span className="text-zinc-400 capitalize">{j.status}</span>
          {j.status === 'running' && (
            <span className="text-zinc-500">{(j.progress * 100).toFixed(0)}%</span>
          )}
          <span className="ml-auto text-zinc-600">
            {new Date(j.created_at).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        <div className="mt-1 truncate text-sm">{j.media_filename}</div>
      </button>
      <div
        className={
          'absolute top-2 right-2 flex items-center gap-1 transition ' +
          (armed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')
        }
      >
        {canResume && !armed && (
          <button
            onClick={(e) => { e.stopPropagation(); onResume(j.id) }}
            title="Resume from where it stopped"
            aria-label="Resume"
            className="w-7 h-7 rounded inline-flex items-center justify-center text-emerald-300 hover:text-emerald-100 hover:bg-zinc-700"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 4l14 8-14 8z" />
            </svg>
          </button>
        )}
        {canRestart && !armed && (
          <button
            onClick={(e) => { e.stopPropagation(); onRestart(j.id) }}
            title="Restart this job"
            aria-label="Restart"
            className="w-7 h-7 rounded inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-700"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" />
            </svg>
          </button>
        )}
        {armed ? (
          <button
            onClick={(e) => { e.stopPropagation(); setArmed(false); onDelete(j.id) }}
            onMouseLeave={() => setArmed(false)}
            autoFocus
            className="px-2 py-1 rounded text-[11px] font-medium bg-red-600 hover:bg-red-500 text-white"
          >
            Confirm delete
          </button>
        ) : (
        <button
          onClick={(e) => { e.stopPropagation(); arm() }}
          title="Delete this job"
          aria-label="Delete"
          className="w-7 h-7 rounded inline-flex items-center justify-center text-zinc-400 hover:text-red-300 hover:bg-zinc-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
          </svg>
        </button>
        )}
      </div>
    </li>
  )
}
