import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type VoiceTranscriptionBackend = 'webspeech' | 'whisper'

export type VoiceInputError =
  | 'permission_denied'
  | 'mic_busy'
  | 'not_supported'
  | 'network'
  | 'aborted'
  | 'unknown'

type SpeechRecognitionAlternativeLike = {
  transcript: string
}

type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal: boolean
}

type SpeechRecognitionEventLike = Event & {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionErrorEventLike = Event & {
  error?: string
}

type SpeechRecognitionInstance = EventTarget & {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: ((event: Event) => void) | null
  start: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

export interface VoiceTranscriptionProvider {
  readonly isSupported: boolean
  startListening(options: { lang: string }): void
  stopListening(): void
  onInterim(callback: (text: string) => void): () => void
  onFinal(callback: (transcript: string) => void): () => void
  onError(callback: (error: VoiceInputError) => void): () => void
}

function resolveSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function mapSpeechRecognitionError(code?: string): VoiceInputError {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission_denied'
    case 'audio-capture':
      return 'mic_busy'
    case 'network':
      return 'network'
    case 'aborted':
      return 'aborted'
    case 'language-not-supported':
      return 'not_supported'
    default:
      return 'unknown'
  }
}

export class WebSpeechProvider implements VoiceTranscriptionProvider {
  private readonly interimListeners = new Set<(text: string) => void>()
  private readonly finalListeners = new Set<(text: string) => void>()
  private readonly errorListeners = new Set<(error: VoiceInputError) => void>()
  private recognition: SpeechRecognitionInstance | null = null
  private abortRequested = false

  get isSupported(): boolean {
    return resolveSpeechRecognitionCtor() !== null
  }

  startListening(options: { lang: string }): void {
    const RecognitionCtor = resolveSpeechRecognitionCtor()
    if (!RecognitionCtor) {
      this.emitError('not_supported')
      return
    }

    this.abortRequested = false
    const recognition = new RecognitionCtor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = options.lang
    recognition.onresult = (event) => {
      let interim = ''
      let final = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript?.trim() ?? ''
        if (!transcript) continue
        if (result.isFinal) {
          final += `${transcript} `
        } else {
          interim += `${transcript} `
        }
      }

      const nextInterim = interim.trim()
      if (nextInterim) {
        this.emitInterim(nextInterim)
      }

      const nextFinal = final.trim()
      if (nextFinal) {
        this.emitFinal(nextFinal)
      }
    }
    recognition.onerror = (event) => {
      const mappedError = mapSpeechRecognitionError(event.error)
      if (this.abortRequested && mappedError === 'aborted') {
        return
      }
      this.emitError(mappedError)
    }
    recognition.onend = () => {
      this.recognition = null
      this.abortRequested = false
    }

    this.recognition = recognition

    try {
      recognition.start()
    } catch (error) {
      this.recognition = null
      this.abortRequested = false
      const name = error instanceof Error ? error.name : ''
      if (name === 'NotAllowedError') {
        this.emitError('permission_denied')
        return
      }
      if (name === 'InvalidStateError') {
        this.emitError('mic_busy')
        return
      }
      this.emitError('unknown')
    }
  }

  stopListening(): void {
    if (!this.recognition) return
    this.abortRequested = true
    this.recognition.abort()
    this.recognition = null
  }

  onInterim(callback: (text: string) => void): () => void {
    this.interimListeners.add(callback)
    return () => {
      this.interimListeners.delete(callback)
    }
  }

  onFinal(callback: (transcript: string) => void): () => void {
    this.finalListeners.add(callback)
    return () => {
      this.finalListeners.delete(callback)
    }
  }

  onError(callback: (error: VoiceInputError) => void): () => void {
    this.errorListeners.add(callback)
    return () => {
      this.errorListeners.delete(callback)
    }
  }

  private emitInterim(text: string): void {
    for (const listener of this.interimListeners) {
      listener(text)
    }
  }

  private emitFinal(text: string): void {
    for (const listener of this.finalListeners) {
      listener(text)
    }
  }

  private emitError(error: VoiceInputError): void {
    for (const listener of this.errorListeners) {
      listener(error)
    }
  }
}

function resolveRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

/**
 * WhisperProvider — records audio via MediaRecorder and transcribes via
 * the server-side proxy at POST /api/ai_assistant/transcribe (OpenAI Whisper-1).
 *
 * Interim results are not supported; only a final transcript is emitted.
 */
export class WhisperProvider implements VoiceTranscriptionProvider {
  private readonly interimListeners = new Set<(text: string) => void>()
  private readonly finalListeners = new Set<(transcript: string) => void>()
  private readonly errorListeners = new Set<(error: VoiceInputError) => void>()
  private mediaRecorder: MediaRecorder | null = null
  private pendingStream: Promise<MediaStream> | null = null
  private chunks: Blob[] = []
  private mimeType: string = ''
  private abortRequested = false

  get isSupported(): boolean {
    return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined'
  }

  startListening(options: { lang: string }): void {
    if (!this.isSupported) {
      this.emitError('not_supported')
      return
    }

    this.abortRequested = false
    this.mimeType = resolveRecordingMimeType()

    const streamPromise = navigator.mediaDevices.getUserMedia({ audio: true })
    this.pendingStream = streamPromise

    streamPromise.then((stream) => {
      if (this.abortRequested) {
        stream.getTracks().forEach((t) => t.stop())
        this.pendingStream = null
        return
      }

      this.chunks = []
      const recorder = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined)

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const aborted = this.abortRequested
        const chunksToSend = this.chunks
        this.mediaRecorder = null
        this.pendingStream = null
        this.chunks = []
        this.abortRequested = false
        if (!aborted) {
          void this.sendToWhisper(chunksToSend, options.lang)
        }
      }

      recorder.start()
      this.mediaRecorder = recorder
      this.pendingStream = null
    }).catch((err: unknown) => {
      this.pendingStream = null
      if (this.abortRequested) {
        this.abortRequested = false
        return
      }
      const name = err instanceof Error ? err.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        this.emitError('permission_denied')
      } else if (name === 'NotReadableError') {
        this.emitError('mic_busy')
      } else {
        this.emitError('unknown')
      }
    })
  }

  stopListening(): void {
    this.abortRequested = true
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop()
      return
    }
    this.mediaRecorder = null
  }

  onInterim(callback: (text: string) => void): () => void {
    this.interimListeners.add(callback)
    return () => { this.interimListeners.delete(callback) }
  }

  onFinal(callback: (transcript: string) => void): () => void {
    this.finalListeners.add(callback)
    return () => { this.finalListeners.delete(callback) }
  }

  onError(callback: (error: VoiceInputError) => void): () => void {
    this.errorListeners.add(callback)
    return () => { this.errorListeners.delete(callback) }
  }

  private async sendToWhisper(chunks: Blob[], lang: string): Promise<void> {
    if (chunks.length === 0) return

    const audioBlob = new Blob(chunks, { type: this.mimeType || 'audio/webm' })
    const body = new FormData()
    body.append('audio', audioBlob, 'recording.webm')

    const languageCode = lang.split('-')[0]
    if (languageCode) body.append('language', languageCode)

    try {
      const call = await apiCall<{ transcript?: string }>('/api/ai_assistant/transcribe', {
        method: 'POST',
        body,
      }, {
        parse: async (res) => {
          try {
            return (await res.json()) as { transcript?: string }
          } catch {
            return null
          }
        },
      })

      if (!call.ok) {
        this.emitError(call.status === 503 ? 'not_supported' : 'network')
        return
      }

      const transcript = call.result?.transcript?.trim() ?? ''
      if (transcript) {
        this.emitFinal(transcript)
      }
    } catch {
      this.emitError('network')
    }
  }

  private emitFinal(transcript: string): void {
    for (const listener of this.finalListeners) listener(transcript)
  }

  private emitError(error: VoiceInputError): void {
    for (const listener of this.errorListeners) listener(error)
  }
}
