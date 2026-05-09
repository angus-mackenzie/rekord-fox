import type { ChunkCandidate, JobOut, JobSummary, MediaOut, TimelineOut, WaveformOut } from './types'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) {
    // Prefer FastAPI's `{detail: "..."}` over raw body so the UI shows a
    // human-readable message instead of "{"detail":"..."}".
    let msg = `${r.status} ${r.statusText}`
    try {
      const body = await r.json()
      if (typeof body?.detail === 'string') msg = body.detail
      else if (body?.detail) msg = JSON.stringify(body.detail)
    } catch {
      try { msg = (await r.text()) || msg } catch { /* swallow */ }
    }
    throw new ApiError(r.status, msg)
  }
  return r.json() as Promise<T>
}

export async function uploadMedia(file: File): Promise<MediaOut> {
  const fd = new FormData()
  fd.append('file', file)
  return request<MediaOut>('/media', { method: 'POST', body: fd })
}

export async function createJob(mediaAssetId: string): Promise<JobOut> {
  return request<JobOut>('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_asset_id: mediaAssetId }),
  })
}

export async function getJob(id: string): Promise<JobOut> {
  return request<JobOut>(`/jobs/${id}`)
}

export async function getTimeline(jobId: string): Promise<TimelineOut> {
  return request<TimelineOut>(`/jobs/${jobId}/timeline`)
}

export async function listJobs(limit = 20): Promise<JobSummary[]> {
  return request<JobSummary[]>(`/jobs?limit=${limit}`)
}

export async function getWaveform(mediaId: string, bins = 800): Promise<WaveformOut> {
  return request<WaveformOut>(`/media/${mediaId}/waveform?bins=${bins}`)
}

export async function getJobCandidates(jobId: string): Promise<ChunkCandidate[]> {
  return request<ChunkCandidate[]>(`/jobs/${jobId}/candidates`)
}

export async function restartJob(jobId: string): Promise<JobOut> {
  return request<JobOut>(`/jobs/${jobId}/restart`, { method: 'POST' })
}

export async function pauseJob(jobId: string): Promise<JobOut> {
  return request<JobOut>(`/jobs/${jobId}/pause`, { method: 'POST' })
}

export async function resumeJob(jobId: string): Promise<JobOut> {
  return request<JobOut>(`/jobs/${jobId}/resume`, { method: 'POST' })
}

export async function rebuildTimeline(jobId: string): Promise<JobOut> {
  return request<JobOut>(`/jobs/${jobId}/rebuild-timeline`, { method: 'POST' })
}

export async function deleteJob(jobId: string): Promise<void> {
  const r = await fetch(`${BASE}/jobs/${jobId}`, { method: 'DELETE' })
  if (!r.ok && r.status !== 204) throw new Error(`${r.status} ${r.statusText}`)
}
