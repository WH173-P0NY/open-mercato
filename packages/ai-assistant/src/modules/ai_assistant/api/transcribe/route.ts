import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProvider } from '../../lib/transcription-provider'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

/**
 * GET /api/ai_assistant/transcribe
 *
 * Returns whether server-side transcription is available and which provider is active.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = resolveProvider()
  if (!provider) {
    return NextResponse.json({ available: false })
  }

  return NextResponse.json({ available: true, provider: provider.name })
}

/**
 * POST /api/ai_assistant/transcribe
 *
 * Accepts a multipart form with an `audio` file and optional `language` (ISO-639-1, e.g. "pl").
 * Proxies to the configured transcription provider and returns { transcript: string }.
 *
 * Supported providers (auto-detected from env):
 *   - Self-hosted OpenAI-compatible (WHISPER_API_URL)  — LocalAI, Faster-Whisper, whisper.cpp
 *   - Groq (GROQ_API_KEY)
 *   - OpenAI (OPENAI_API_KEY)
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = resolveProvider()
  if (!provider) {
    return NextResponse.json(
      { error: 'Transcription not configured — set WHISPER_API_URL, GROQ_API_KEY, or OPENAI_API_KEY' },
      { status: 503 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const audio = formData.get('audio')
  if (!audio || typeof audio === 'string') {
    return NextResponse.json({ error: 'Missing audio file' }, { status: 400 })
  }

  const language = formData.get('language')

  const body = new FormData()
  body.append('file', audio, 'recording.webm')
  body.append('model', provider.model)
  if (typeof language === 'string' && language.trim()) {
    body.append('language', language.trim())
  }

  let response: Response
  try {
    response = await fetch(provider.url, {
      method: 'POST',
      headers: provider.headers,
      body,
    })
  } catch {
    return NextResponse.json({ error: `Failed to reach transcription provider (${provider.name})` }, { status: 502 })
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown')
    console.error(`[AI Transcribe] ${provider.name} error:`, response.status, errorText)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 502 })
  }

  const data = await response.json() as { text?: string }
  const transcript = data.text?.trim() ?? ''

  return NextResponse.json({ transcript })
}

const availabilitySchema = z.object({
  available: z.boolean(),
  provider: z.enum(['self-hosted', 'groq', 'openai']).optional().describe('Active transcription provider when available'),
})

const transcriptSchema = z.object({
  transcript: z.string().describe('Transcribed text from the uploaded audio'),
})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  summary: 'Voice transcription',
  description: 'Reports transcription availability and proxies audio uploads to the configured provider (self-hosted Whisper, Groq, or OpenAI).',
  methods: {
    GET: {
      summary: 'Check transcription availability',
      description: 'Returns whether server-side transcription is configured and which provider is active.',
      responses: [
        { status: 200, description: 'Availability status', schema: availabilitySchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Transcribe audio',
      description: 'Accepts a multipart form with an `audio` file and optional `language` (ISO-639-1). Proxies to the configured provider.',
      requestBody: {
        contentType: 'multipart/form-data',
        description: 'Audio payload and optional ISO-639-1 language code',
        schema: z.object({
          audio: z.any().describe('Audio file to transcribe'),
          language: z.string().optional().describe('Optional ISO-639-1 language code (e.g. "pl")'),
        }),
      },
      responses: [
        { status: 200, description: 'Transcription result', schema: transcriptSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid form data or missing audio', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 502, description: 'Provider error', schema: errorSchema },
        { status: 503, description: 'Transcription not configured', schema: errorSchema },
      ],
    },
  },
}
