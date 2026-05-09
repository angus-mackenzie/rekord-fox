import { useEffect, useState } from 'react'
import type { ManualTagInput } from '../types'

function fmtTime(s: number): string {
  s = Math.max(0, s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s - Math.floor(s)) * 10)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${cs}`
    : `${m}:${String(sec).padStart(2, '0')}.${cs}`
}

interface Props {
  startSeconds: number
  endSeconds: number
  onCancel: () => void
  onSave: (input: ManualTagInput) => Promise<void>
}

/**
 * Compact tag-creation modal. Title is the only mandatory input; everything
 * else is optional and will round-trip to ManualCorrection on the backend.
 *
 * The exposed `external_urls` map mirrors what providers populate, so a
 * future LocalLibraryProvider can surface user-tagged links the same way it
 * surfaces Shazam matches in the candidate list.
 */
export function TagModal({ startSeconds, endSeconds, onCancel, onSave }: Props) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [spotify, setSpotify] = useState('')
  const [youtube, setYoutube] = useState('')
  const [soundcloud, setSoundcloud] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Esc to dismiss — focus-trap is overkill for an MVP modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() && !artist.trim()) {
      setError('Add a title or artist (at least one).')
      return
    }
    const external_urls: Record<string, string> = {}
    if (spotify.trim()) external_urls.spotify = spotify.trim()
    if (youtube.trim()) external_urls.youtube = youtube.trim()
    if (soundcloud.trim()) external_urls.soundcloud = soundcloud.trim()

    setSaving(true)
    setError(null)
    try {
      await onSave({
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        title: title.trim() || undefined,
        artist: artist.trim() || undefined,
        notes: notes.trim() || undefined,
        external_urls,
      })
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md mx-4 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl p-5 space-y-3"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-zinc-100">Tag this region</h2>
          <span className="font-mono text-xs text-zinc-400 tabular-nums">
            {fmtTime(startSeconds)}–{fmtTime(endSeconds)}
            <span className="text-zinc-600 ml-1.5">
              ({fmtTime(endSeconds - startSeconds)})
            </span>
          </span>
        </div>

        <Field label="Title">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Funky Q Nice (Edit)"
            className="w-full px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
          />
        </Field>
        <Field label="Artist">
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="e.g. The Trip"
            className="w-full px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
          />
        </Field>

        <details className="group">
          <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200 select-none">
            Add links (optional)
          </summary>
          <div className="mt-2 space-y-2">
            <CompactField label="Spotify" value={spotify} onChange={setSpotify} placeholder="https://open.spotify.com/track/..." />
            <CompactField label="YouTube" value={youtube} onChange={setYoutube} placeholder="https://youtu.be/..." />
            <CompactField label="SoundCloud" value={soundcloud} onChange={setSoundcloud} placeholder="https://soundcloud.com/..." />
          </div>
        </details>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything else worth remembering"
            className="w-full px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-violet-500 resize-none"
          />
        </Field>

        {error && (
          <div className="text-xs text-red-300 bg-red-900/40 border border-red-700 rounded px-2 py-1">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-1.5 rounded text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded text-xs font-medium bg-violet-500 hover:bg-violet-400 text-white transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save tag'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">{label}</span>
      {children}
    </label>
  )
}

function CompactField({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-zinc-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-violet-500"
      />
    </label>
  )
}
