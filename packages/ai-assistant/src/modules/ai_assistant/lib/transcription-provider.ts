/**
 * Transcription provider resolution.
 *
 * Reads environment variables and returns the first configured provider,
 * in priority order:
 *   1. WHISPER_API_URL  — self-hosted OpenAI-compatible endpoint
 *   2. GROQ_API_KEY     — Groq cloud (whisper-large-v3-turbo)
 *   3. OPENAI_API_KEY   — OpenAI (whisper-1)
 *
 * Optional env vars:
 *   WHISPER_API_KEY   — Bearer token for self-hosted (if required)
 *   WHISPER_MODEL     — Model override for self-hosted and Groq providers
 */

export type TranscriptionProvider = {
  url: string
  headers: Record<string, string>
  model: string
  name: 'self-hosted' | 'groq' | 'openai'
}

export function resolveProvider(): TranscriptionProvider | null {
  const customUrl = process.env.WHISPER_API_URL?.trim()
  if (customUrl) {
    const apiKey = process.env.WHISPER_API_KEY?.trim()
    return {
      url: customUrl,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      model: process.env.WHISPER_MODEL?.trim() || 'whisper-1',
      name: 'self-hosted',
    }
  }

  const groqKey = process.env.GROQ_API_KEY?.trim()
  if (groqKey) {
    return {
      url: 'https://api.groq.com/openai/v1/audio/transcriptions',
      headers: { Authorization: `Bearer ${groqKey}` },
      model: process.env.WHISPER_MODEL?.trim() || 'whisper-large-v3-turbo',
      name: 'groq',
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  if (openaiKey) {
    return {
      url: 'https://api.openai.com/v1/audio/transcriptions',
      headers: { Authorization: `Bearer ${openaiKey}` },
      model: 'whisper-1',
      name: 'openai',
    }
  }

  return null
}
