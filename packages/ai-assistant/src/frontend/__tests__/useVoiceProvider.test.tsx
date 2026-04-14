/** @jest-environment jsdom */

import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useVoiceProvider } from '../hooks/useVoiceProvider'
import { WebSpeechProvider, WhisperProvider } from '../lib/voice-transcription'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── helpers ──────────────────────────────────────────────────────────────────

type ProviderKind = 'webspeech' | 'whisper' | 'unknown'

function kindOf(p: unknown): ProviderKind {
  if (p instanceof WhisperProvider) return 'whisper'
  if (p instanceof WebSpeechProvider) return 'webspeech'
  return 'unknown'
}

function ProviderHarness({ onKind }: { onKind: (kind: ProviderKind) => void }) {
  const provider = useVoiceProvider()
  React.useEffect(() => {
    onKind(kindOf(provider))
  })
  return null
}

// ── setup ─────────────────────────────────────────────────────────────────────

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

const originalFetch = global.fetch

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  global.fetch = jest.fn()
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  global.fetch = originalFetch
})

// ── tests ─────────────────────────────────────────────────────────────────────

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

it('returns WebSpeechProvider immediately before the availability fetch resolves', async () => {
  // fetch never resolves during this test
  let resolveFetch!: (value: Response) => void
  ;(global.fetch as jest.Mock).mockReturnValue(
    new Promise<Response>((res) => { resolveFetch = res }),
  )

  const kinds: ProviderKind[] = []
  act(() => {
    root.render(<ProviderHarness onKind={(k) => kinds.push(k)} />)
  })

  // Before fetch resolves, provider must already be WebSpeechProvider
  expect(kinds[0]).toBe('webspeech')

  // Resolve pending fetch so async teardown can complete cleanly
  await act(async () => {
    resolveFetch(mockResponse({ available: false }))
  })
})

it('switches to WhisperProvider when server reports available: true', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    mockResponse({ available: true, provider: 'groq' }),
  )

  const kinds: ProviderKind[] = []

  await act(async () => {
    root.render(<ProviderHarness onKind={(k) => kinds.push(k)} />)
  })

  expect(kinds.at(-1)).toBe('whisper')
})

it('keeps WebSpeechProvider when server reports available: false', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(mockResponse({ available: false }))

  const kinds: ProviderKind[] = []

  await act(async () => {
    root.render(<ProviderHarness onKind={(k) => kinds.push(k)} />)
  })

  expect(kinds.at(-1)).toBe('webspeech')
})

it('keeps WebSpeechProvider when the availability fetch throws', async () => {
  (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'))

  const kinds: ProviderKind[] = []

  await act(async () => {
    root.render(<ProviderHarness onKind={(k) => kinds.push(k)} />)
  })

  expect(kinds.at(-1)).toBe('webspeech')
})

it('calls GET /api/ai_assistant/transcribe exactly once on mount', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(mockResponse({ available: false }))

  await act(async () => {
    root.render(<ProviderHarness onKind={() => {}} />)
  })

  expect(global.fetch).toHaveBeenCalledTimes(1)
  const [url] = (global.fetch as jest.Mock).mock.calls[0] as [RequestInfo]
  expect(url).toBe('/api/ai_assistant/transcribe')
})
