'use client'

import { Mic, MicOff } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import type { VoiceInputError, VoiceTranscriptionProvider } from '../../lib/voice-transcription'

type VoiceMicButtonProps = {
  onTranscript: (text: string) => void
  disabled?: boolean
  className?: string
  provider?: VoiceTranscriptionProvider
}

function resolveErrorTitle(
  t: (key: string, fallback?: string) => string,
  errorCode: VoiceInputError | null,
): string | undefined {
  if (!errorCode) return undefined
  switch (errorCode) {
    case 'permission_denied':
      return t('ai_assistant.voice.error.permission_denied', 'Microphone access denied')
    case 'mic_busy':
      return t('ai_assistant.voice.error.mic_busy', 'Microphone is busy')
    case 'not_supported':
      return t('ai_assistant.voice.error.not_supported', 'Voice input not supported')
    case 'network':
      return t('ai_assistant.voice.error.network', 'Network error')
    case 'aborted':
      return t('ai_assistant.voice.error.aborted', 'Voice input stopped')
    default:
      return t('ai_assistant.voice.error.unknown', 'Voice input error')
  }
}

export function VoiceMicButton({
  onTranscript,
  disabled = false,
  className,
  provider,
}: VoiceMicButtonProps) {
  const t = useT()
  const { state, errorCode, toggle } = useVoiceInput({
    onTranscript,
    disabled,
    provider,
  })

  if (state === 'unsupported') {
    return null
  }

  const isListening = state === 'listening'
  const isError = state === 'error'
  const ariaLabel = isListening
    ? t('ai_assistant.voice.stop', 'Stop voice input')
    : t('ai_assistant.voice.start', 'Start voice input')
  const title = isError ? resolveErrorTitle(t, errorCode) : ariaLabel

  return (
    <IconButton
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'relative shrink-0',
        isListening && 'text-red-600 hover:text-red-700',
        isError && 'text-amber-600 hover:text-amber-700',
        className,
      )}
      onClick={toggle}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={isListening}
      title={title}
    >
      {isListening || isError ? (
        <MicOff className="size-4" />
      ) : (
        <Mic className="size-4" />
      )}
      {isListening ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 size-1.5 rounded-full bg-red-500 animate-pulse"
        />
      ) : null}
    </IconButton>
  )
}
