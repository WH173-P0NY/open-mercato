'use client'

import * as React from 'react'
import {
  WebSpeechProvider,
  type VoiceInputError,
  type VoiceTranscriptionProvider,
} from '../lib/voice-transcription'

type VoiceState = 'idle' | 'listening' | 'error' | 'unsupported'

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void
  disabled?: boolean
  provider?: VoiceTranscriptionProvider
}

type UseVoiceInputResult = {
  state: VoiceState
  errorCode: VoiceInputError | null
  toggle: () => void
  stop: () => void
}

export function useVoiceInput({
  onTranscript,
  disabled = false,
  provider: providedProvider,
}: UseVoiceInputOptions): UseVoiceInputResult {
  const fallbackProviderRef = React.useRef<VoiceTranscriptionProvider | null>(null)
  const [fallbackReady, setFallbackReady] = React.useState(false)

  React.useEffect(() => {
    if (providedProvider) return
    if (fallbackProviderRef.current === null) {
      fallbackProviderRef.current = new WebSpeechProvider()
      setFallbackReady(true)
    }
  }, [providedProvider])

  const provider: VoiceTranscriptionProvider | null =
    providedProvider ?? (fallbackReady ? fallbackProviderRef.current : null)

  const onTranscriptRef = React.useRef(onTranscript)
  React.useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const [state, setState] = React.useState<VoiceState>('idle')
  const [errorCode, setErrorCode] = React.useState<VoiceInputError | null>(null)

  React.useEffect(() => {
    if (!provider) return
    if (!provider.isSupported) {
      setState('unsupported')
      setErrorCode('not_supported')
      return
    }

    setState((current) => (current === 'listening' || current === 'unsupported' ? 'idle' : current))
    setErrorCode((current) => (current === 'not_supported' ? null : current))

    const unsubscribeFinal = provider.onFinal((transcript) => {
      onTranscriptRef.current(transcript)
      setErrorCode(null)
      setState('idle')
    })
    const unsubscribeError = provider.onError((nextError) => {
      setErrorCode(nextError)
      setState(nextError === 'not_supported' ? 'unsupported' : 'error')
    })

    return () => {
      unsubscribeFinal()
      unsubscribeError()
      provider.stopListening()
    }
  }, [provider])

  const stop = React.useCallback(() => {
    if (!provider) return
    provider.stopListening()
    if (provider.isSupported) {
      setErrorCode(null)
      setState('idle')
    }
  }, [provider])

  React.useEffect(() => {
    if (disabled && state === 'listening') {
      stop()
    }
  }, [disabled, state, stop])

  const toggle = React.useCallback(() => {
    if (!provider) return
    if (!provider.isSupported) {
      setErrorCode('not_supported')
      setState('unsupported')
      return
    }
    if (disabled) return
    if (state === 'listening') {
      stop()
      return
    }

    setErrorCode(null)
    setState('listening')
    provider.startListening({
      lang: typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US',
    })
  }, [disabled, provider, state, stop])

  return {
    state,
    errorCode,
    toggle,
    stop,
  }
}
