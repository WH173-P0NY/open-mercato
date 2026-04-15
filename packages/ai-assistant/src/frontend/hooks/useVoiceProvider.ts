'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  WebSpeechProvider,
  WhisperProvider,
  type VoiceTranscriptionProvider,
} from '../lib/voice-transcription'

type TranscriptionAvailability = {
  available?: boolean
}

/**
 * Returns the best available voice transcription provider.
 *
 * On mount, checks GET /api/ai_assistant/transcribe to see if Whisper is
 * configured (OPENAI_API_KEY set on server). If yes, returns a WhisperProvider
 * so the mic button records audio and sends it to OpenAI Whisper-1.
 * Otherwise falls back to the browser Web Speech API.
 */
function browserSupportsMediaCapture(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const mediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return false
  const MediaRecorderCtor = (window as typeof window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
  return typeof MediaRecorderCtor === 'function'
}

export function useVoiceProvider(): VoiceTranscriptionProvider {
  const [provider, setProvider] = React.useState<VoiceTranscriptionProvider>(
    () => new WebSpeechProvider(),
  )

  React.useEffect(() => {
    let cancelled = false

    // Guard: WhisperProvider relies on navigator.mediaDevices.getUserMedia and
    // window.MediaRecorder. In browsers where either is missing (older Safari,
    // iOS WebView, missing mic permission before prompt), swapping away from
    // WebSpeechProvider would leave the user with a non-functional mic. Keep
    // the WebSpeech fallback instead.
    if (!browserSupportsMediaCapture()) return

    apiCall<TranscriptionAvailability>('/api/ai_assistant/transcribe', undefined, {
      parse: async (res) => {
        try {
          return (await res.json()) as TranscriptionAvailability
        } catch {
          return null
        }
      },
    })
      .then((call) => {
        if (cancelled) return
        if (call.result?.available === true) {
          setProvider(new WhisperProvider())
        }
      })
      .catch(() => {
        // No Whisper available — keep WebSpeechProvider
      })

    return () => {
      cancelled = true
    }
  }, [])

  return provider
}
