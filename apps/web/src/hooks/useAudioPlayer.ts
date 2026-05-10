import { useEffect, useRef, useState } from 'react'

/**
 * Wraps a hidden HTMLAudioElement and exposes a small reactive surface:
 * current time, playing state, plus seek + togglePlay.
 *
 * The element itself isn't rendered by the consumer — it lives in the DOM
 * via `audioRef`, attached once per src. Update cadence on `currentTime` is
 * throttled to ~30 Hz via requestAnimationFrame so cursor rendering on the
 * waveform stays smooth without flooding React renders.
 */
export function useAudioPlayer(src: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const rafRef = useRef<number | null>(null)

  // Reset playback state on src change using React's "adjust state during
  // render" pattern (https://react.dev/learn/you-might-not-need-an-effect).
  // Doing this in the effect would lint as a synchronous setState-in-effect
  // and incurs an extra render frame; doing it during render is detected by
  // React and folded into the same render cycle.
  const [prevSrc, setPrevSrc] = useState(src)
  if (src !== prevSrc) {
    setPrevSrc(src)
    setCurrentTime(0)
    setIsPlaying(false)
    setDuration(null)
  }

  // Mount/teardown the audio element when src changes.
  useEffect(() => {
    if (!src) {
      audioRef.current = null
      return
    }
    const audio = new Audio(src)
    audio.preload = 'metadata'
    audioRef.current = audio

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)
    const onMeta = () => setDuration(isFinite(audio.duration) ? audio.duration : null)

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('loadedmetadata', onMeta)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.pause()
      audioRef.current = null
    }
  }, [src])

  // RAF-driven currentTime publishing — only while playing, to avoid wasted renders.
  useEffect(() => {
    if (!isPlaying) return
    const tick = () => {
      const a = audioRef.current
      if (a) setCurrentTime(a.currentTime)
      rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
    return () => { if (rafRef.current) window.cancelAnimationFrame(rafRef.current) }
  }, [isPlaying])

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play().catch(() => { /* user gesture required, swallow */ })
    else a.pause()
  }

  function seek(seconds: number) {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, seconds)
    setCurrentTime(a.currentTime)
  }

  return { currentTime, isPlaying, duration, togglePlay, seek }
}
