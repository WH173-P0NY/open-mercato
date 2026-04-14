/** @jest-environment jsdom */

import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useVoiceInput } from '../hooks/useVoiceInput'
import type { VoiceInputError, VoiceTranscriptionProvider } from '../lib/voice-transcription'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class MockVoiceProvider implements VoiceTranscriptionProvider {
  isSupported = true
  startCalls: Array<{ lang: string }> = []
  stopCalls = 0
  private finalListeners = new Set<(text: string) => void>()
  private errorListeners = new Set<(error: VoiceInputError) => void>()

  startListening(options: { lang: string }): void {
    this.startCalls.push(options)
  }

  stopListening(): void {
    this.stopCalls += 1
  }

  onInterim(): () => void {
    return () => {}
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

  emitFinal(text: string): void {
    for (const listener of this.finalListeners) {
      listener(text)
    }
  }

  emitError(error: VoiceInputError): void {
    for (const listener of this.errorListeners) {
      listener(error)
    }
  }
}

function VoiceHarness({
  provider,
  disabled = false,
  onTranscript,
}: {
  provider: VoiceTranscriptionProvider
  disabled?: boolean
  onTranscript: (value: string) => void
}) {
  const { state, errorCode, toggle, stop } = useVoiceInput({
    provider,
    disabled,
    onTranscript,
  })

  return (
    <div>
      <div data-testid="state">{state}</div>
      <div data-testid="error">{errorCode ?? 'none'}</div>
      <button type="button" data-testid="toggle" onClick={toggle}>toggle</button>
      <button type="button" data-testid="stop" onClick={stop}>stop</button>
    </div>
  )
}

describe('useVoiceInput', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(window.navigator, 'language', {
      value: 'pl-PL',
      configurable: true,
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  function getState(): string | null {
    return container.querySelector('[data-testid="state"]')?.textContent ?? null
  }

  function getError(): string | null {
    return container.querySelector('[data-testid="error"]')?.textContent ?? null
  }

  function click(testId: string): void {
    const element = container.querySelector(`[data-testid="${testId}"]`)
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`Missing button: ${testId}`)
    }
    act(() => {
      element.click()
    })
  }

  it('calls onTranscript on final transcript and returns to idle state', () => {
    const provider = new MockVoiceProvider()
    const onTranscript = jest.fn()

    act(() => {
      root.render(<VoiceHarness provider={provider} onTranscript={onTranscript} />)
    })

    click('toggle')
    expect(getState()).toBe('listening')
    expect(provider.startCalls).toEqual([{ lang: 'pl-PL' }])

    act(() => {
      provider.emitFinal('znajdz klienta Kowalski')
    })

    expect(onTranscript).toHaveBeenCalledWith('znajdz klienta Kowalski')
    expect(getState()).toBe('idle')
    expect(getError()).toBe('none')
  })

  it('enters error state when microphone permission is denied', () => {
    const provider = new MockVoiceProvider()

    act(() => {
      root.render(<VoiceHarness provider={provider} onTranscript={jest.fn()} />)
    })

    click('toggle')

    act(() => {
      provider.emitError('permission_denied')
    })

    expect(getState()).toBe('error')
    expect(getError()).toBe('permission_denied')
  })

  it('stops listening when disabled flips to true', () => {
    const provider = new MockVoiceProvider()

    act(() => {
      root.render(<VoiceHarness provider={provider} onTranscript={jest.fn()} />)
    })

    click('toggle')
    expect(getState()).toBe('listening')

    act(() => {
      root.render(<VoiceHarness provider={provider} disabled onTranscript={jest.fn()} />)
    })

    expect(provider.stopCalls).toBeGreaterThan(0)
    expect(getState()).toBe('idle')
  })

  it('stops listening during unmount cleanup', () => {
    const provider = new MockVoiceProvider()

    act(() => {
      root.render(<VoiceHarness provider={provider} onTranscript={jest.fn()} />)
    })

    click('toggle')

    act(() => {
      root.unmount()
    })

    expect(provider.stopCalls).toBeGreaterThan(0)
  })

  it('starts in unsupported state when provider support is missing', () => {
    const provider = new MockVoiceProvider()
    provider.isSupported = false

    act(() => {
      root.render(<VoiceHarness provider={provider} onTranscript={jest.fn()} />)
    })

    expect(getState()).toBe('unsupported')
    expect(getError()).toBe('not_supported')
  })
})
