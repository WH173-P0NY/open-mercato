/** @jest-environment jsdom */

import * as React from 'react'
import '@testing-library/jest-dom'
import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { CommandInput } from '../components/CommandPalette/CommandInput'
import { VoiceMicButton } from '../components/CommandPalette/VoiceMicButton'
import type { VoiceInputError, VoiceTranscriptionProvider } from '../lib/voice-transcription'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => ((key: string, fallback?: string) => fallback ?? key),
}))

jest.mock('cmdk', () => ({
  Command: {
    Input: ({
      value,
      onValueChange,
      placeholder,
      className,
      autoFocus,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      placeholder?: string
      className?: string
      autoFocus?: boolean
    }) => (
      <input
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
        placeholder={placeholder}
        className={className}
        autoFocus={autoFocus}
      />
    ),
  },
}))

class MockVoiceProvider implements VoiceTranscriptionProvider {
  isSupported = true
  startCalls: Array<{ lang: string }> = []
  stopCalls = 0
  private finalListeners = new Set<(text: string) => void>()

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

  onError(_callback: (error: VoiceInputError) => void): () => void {
    return () => {}
  }

  emitFinal(text: string): void {
    for (const listener of this.finalListeners) {
      listener(text)
    }
  }
}

describe('voice input UI', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'language', {
      value: 'en-US',
      configurable: true,
    })
  })

  it('replaces the command input value with the final transcript', () => {
    const provider = new MockVoiceProvider()

    function Harness() {
      const [value, setValue] = React.useState('')
      return (
        <CommandInput
          value={value}
          onValueChange={setValue}
          mode="commands"
          onVoiceTranscript={setValue}
          voiceProvider={provider}
        />
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }))

    act(() => {
      provider.emitFinal('find customer Kowalski')
    })

    expect(screen.getByRole('textbox')).toHaveValue('find customer Kowalski')
  })

  it('disables the voice button when the host blocks input', () => {
    const provider = new MockVoiceProvider()

    render(
      <VoiceMicButton
        onTranscript={() => {}}
        disabled
        provider={provider}
      />,
    )

    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeDisabled()
  })

  it('hides the voice button when speech recognition is unsupported', () => {
    const provider: VoiceTranscriptionProvider = {
      isSupported: false,
      startListening: () => {},
      stopListening: () => {},
      onInterim: () => () => {},
      onFinal: () => () => {},
      onError: (_callback: (error: VoiceInputError) => void) => () => {},
    }

    render(
      <VoiceMicButton
        onTranscript={() => {}}
        provider={provider}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Start voice input' })).not.toBeInTheDocument()
  })
})
