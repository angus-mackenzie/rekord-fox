export type JobStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled'
export type SegmentState = 'confirmed' | 'likely' | 'uncertain' | 'unresolved'

export interface MediaOut {
  id: string
  original_filename: string
  content_type: string
  duration_seconds: number | null
  created_at: string
}

export interface JobOut {
  id: string
  media_asset_id: string
  status: JobStatus
  progress: number
  error_code: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface SegmentCandidate {
  provider: string
  title: string
  artist: string
  confidence: number
  external_urls: Record<string, string>
  album?: string | null
  artwork_url?: string | null
  provider_track_id?: string | null
}

export interface SegmentOut {
  id: string
  start_seconds: number
  end_seconds: number
  state: SegmentState
  confidence: number
  title: string | null
  artist: string | null
  candidates: SegmentCandidate[]
  notes: string | null
}

export interface ManualTag {
  id: string
  analysis_job_id: string
  action: 'add'
  start_seconds: number
  end_seconds: number
  title: string | null
  artist: string | null
  notes: string | null
  external_urls: Record<string, string>
  created_at: string
}

export interface ManualTagInput {
  start_seconds: number
  end_seconds: number
  title?: string
  artist?: string
  notes?: string
  external_urls?: Record<string, string>
}

export interface TimelineOut {
  job: JobOut
  media: MediaOut
  segments: SegmentOut[]
  manual_tags: ManualTag[]
  candidate_count: number
}

export interface WaveformOut {
  peaks: number[]
  duration_seconds: number
  bins: number
}

export interface ChunkCandidate {
  id: string
  provider: string
  chunk_start_seconds: number
  chunk_end_seconds: number
  title: string
  artist: string
  confidence: number
  album: string | null
  artwork_url: string | null
  external_urls: Record<string, string>
  provider_track_id: string | null
}

export interface JobSummary {
  id: string
  media_asset_id: string
  status: JobStatus
  progress: number
  created_at: string
  finished_at: string | null
  media_filename: string
  duration_seconds: number | null
}
