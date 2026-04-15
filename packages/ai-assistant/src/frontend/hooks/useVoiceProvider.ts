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
export function useVoiceProvider(): VoiceTranscriptionProvider {
  const [provider, setProvider] = React.useState<VoiceTranscriptionProvider>(
    () => new WebSpeechProvider(),
  )

  React.useEffect(() => {
    let cancelled = false

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
