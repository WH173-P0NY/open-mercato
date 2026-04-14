import { resolveProvider } from '../transcription-provider'

describe('resolveProvider', () => {
  const savedEnv = process.env

  beforeEach(() => {
    process.env = { ...savedEnv }
    delete process.env.WHISPER_API_URL
    delete process.env.WHISPER_API_KEY
    delete process.env.WHISPER_MODEL
    delete process.env.GROQ_API_KEY
    delete process.env.OPENAI_API_KEY
  })

  afterAll(() => {
    process.env = savedEnv
  })

  // ── null when nothing configured ──────────────────────────────────────────

  it('returns null when no provider env var is set', () => {
    expect(resolveProvider()).toBeNull()
  })

  // ── self-hosted ───────────────────────────────────────────────────────────

  it('returns self-hosted when WHISPER_API_URL is set', () => {
    process.env.WHISPER_API_URL = 'http://localhost:9000/asr'
    const p = resolveProvider()
    expect(p?.name).toBe('self-hosted')
    expect(p?.url).toBe('http://localhost:9000/asr')
    expect(p?.model).toBe('whisper-1')
    expect(p?.headers).toEqual({})
  })

  it('adds Authorization header when WHISPER_API_KEY is set', () => {
    process.env.WHISPER_API_URL = 'http://localhost:9000/asr'
    process.env.WHISPER_API_KEY = 'mysecret'
    expect(resolveProvider()?.headers).toEqual({ Authorization: 'Bearer mysecret' })
  })

  it('omits Authorization header when WHISPER_API_KEY is empty string', () => {
    process.env.WHISPER_API_URL = 'http://localhost:9000/asr'
    process.env.WHISPER_API_KEY = '   '
    expect(resolveProvider()?.headers).toEqual({})
  })

  it('overrides self-hosted model with WHISPER_MODEL', () => {
    process.env.WHISPER_API_URL = 'http://localhost:9000/asr'
    process.env.WHISPER_MODEL = 'large-v3'
    expect(resolveProvider()?.model).toBe('large-v3')
  })

  // ── groq ──────────────────────────────────────────────────────────────────

  it('returns groq when GROQ_API_KEY is set', () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    const p = resolveProvider()
    expect(p?.name).toBe('groq')
    expect(p?.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(p?.model).toBe('whisper-large-v3-turbo')
    expect(p?.headers).toEqual({ Authorization: 'Bearer gsk_test' })
  })

  it('overrides Groq default model with WHISPER_MODEL', () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    process.env.WHISPER_MODEL = 'whisper-large-v3'
    expect(resolveProvider()?.model).toBe('whisper-large-v3')
  })

  // ── openai ────────────────────────────────────────────────────────────────

  it('returns openai when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    const p = resolveProvider()
    expect(p?.name).toBe('openai')
    expect(p?.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(p?.model).toBe('whisper-1')
    expect(p?.headers).toEqual({ Authorization: 'Bearer sk-test' })
  })

  it('ignores WHISPER_MODEL for OpenAI (model is always whisper-1)', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.WHISPER_MODEL = 'something-else'
    expect(resolveProvider()?.model).toBe('whisper-1')
  })

  // ── priority ──────────────────────────────────────────────────────────────

  it('WHISPER_API_URL takes priority over GROQ_API_KEY', () => {
    process.env.WHISPER_API_URL = 'http://localhost:9000/asr'
    process.env.GROQ_API_KEY = 'gsk_test'
    expect(resolveProvider()?.name).toBe('self-hosted')
  })

  it('GROQ_API_KEY takes priority over OPENAI_API_KEY', () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    process.env.OPENAI_API_KEY = 'sk-test'
    expect(resolveProvider()?.name).toBe('groq')
  })

  it('WHISPER_API_URL takes priority when all three keys are set', () => {
    process.env.WHISPER_API_URL = 'http://localhost:9000/asr'
    process.env.GROQ_API_KEY = 'gsk_test'
    process.env.OPENAI_API_KEY = 'sk-test'
    expect(resolveProvider()?.name).toBe('self-hosted')
  })

  // ── whitespace trimming ───────────────────────────────────────────────────

  it('ignores whitespace-only WHISPER_API_URL and falls through to Groq', () => {
    process.env.WHISPER_API_URL = '   '
    process.env.GROQ_API_KEY = 'gsk_test'
    expect(resolveProvider()?.name).toBe('groq')
  })

  it('ignores whitespace-only GROQ_API_KEY and falls through to OpenAI', () => {
    process.env.GROQ_API_KEY = '   '
    process.env.OPENAI_API_KEY = 'sk-test'
    expect(resolveProvider()?.name).toBe('openai')
  })

  // ── VOICE_TRANSCRIPTION_DISABLED short-circuit ────────────────────────────

  it('returns null when VOICE_TRANSCRIPTION_DISABLED=1, even if OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.VOICE_TRANSCRIPTION_DISABLED = '1'
    expect(resolveProvider()).toBeNull()
  })

  it('returns null when VOICE_TRANSCRIPTION_DISABLED=true (case-insensitive)', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.VOICE_TRANSCRIPTION_DISABLED = 'TRUE'
    expect(resolveProvider()).toBeNull()
  })

  it('does not disable when VOICE_TRANSCRIPTION_DISABLED is empty or falsy', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.VOICE_TRANSCRIPTION_DISABLED = '0'
    expect(resolveProvider()?.name).toBe('openai')
    process.env.VOICE_TRANSCRIPTION_DISABLED = ''
    expect(resolveProvider()?.name).toBe('openai')
  })
})
