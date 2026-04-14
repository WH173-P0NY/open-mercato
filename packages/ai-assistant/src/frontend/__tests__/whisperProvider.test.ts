/** @jest-environment jsdom */

import { WhisperProvider } from '../lib/voice-transcription'

type MockRecorderState = 'inactive' | 'recording' | 'paused'

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported(_: string): boolean {
    return true
  }

  state: MockRecorderState = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(public stream: MediaStream, public options?: MediaRecorderOptions) {
    FakeMediaRecorder.instances.push(this)
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.onstop?.()
  }

  emitData(data: Blob): void {
    this.ondataavailable?.({ data })
  }
}

class FakeTrack {
  stopped = false
  stop(): void {
    this.stopped = true
  }
}

class FakeStream {
  tracks: FakeTrack[] = [new FakeTrack()]
  getTracks(): FakeTrack[] {
    return this.tracks
  }
}

function installFakeMedia(stream: FakeStream) {
  ;(window as unknown as { MediaRecorder: unknown }).MediaRecorder =
    FakeMediaRecorder as unknown
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue(stream as unknown as MediaStream),
    },
  })
}

describe('WhisperProvider — stop-and-send flow', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    FakeMediaRecorder.instances = []
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.resetAllMocks()
  })

  it('uploads captured chunks to /api/ai_assistant/transcribe after stopListening', async () => {
    const stream = new FakeStream()
    installFakeMedia(stream)

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ transcript: 'hello world' }),
      text: async () => JSON.stringify({ transcript: 'hello world' }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new WhisperProvider()
    const finalListener = jest.fn()
    provider.onFinal(finalListener)

    provider.startListening({ lang: 'en-US' })
    await Promise.resolve()
    await Promise.resolve()

    const recorder = FakeMediaRecorder.instances[0]!
    recorder.emitData(new Blob(['audio-bytes'], { type: 'audio/webm' }))

    provider.stopListening()

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/ai_assistant/transcribe')
    expect((init as RequestInit)?.method).toBe('POST')
    expect((init as RequestInit)?.body).toBeInstanceOf(FormData)

    expect(finalListener).toHaveBeenCalledWith('hello world')
    expect(stream.tracks[0]!.stopped).toBe(true)
  })

  it('does not call fetch when stopListening fires before startListening resolved (abort path)', async () => {
    const stream = new FakeStream()
    let resolveStream: (s: FakeStream) => void = () => {}
    const pending = new Promise<FakeStream>((resolve) => {
      resolveStream = resolve
    })
    ;(window as unknown as { MediaRecorder: unknown }).MediaRecorder =
      FakeMediaRecorder as unknown
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn().mockReturnValue(pending) },
    })

    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new WhisperProvider()
    provider.startListening({ lang: 'en-US' })
    provider.stopListening()

    resolveStream(stream)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(stream.tracks[0]!.stopped).toBe(true)
  })
})
