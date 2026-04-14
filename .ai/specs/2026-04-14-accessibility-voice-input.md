# Accessibility & Voice Input

## TLDR

**Key Points:**
- Dodanie sterowania głosowego do AI Assistant (Command Palette / Dockable Chat) z Web Speech API oraz systematyczny audyt i naprawa dostępności (WCAG 2.1 AA) w backoffice.
- Cel: umożliwienie korzystania z aplikacji osobom z niepełnosprawnościami ruchowymi, wzrokowymi i motorycznymi.

**Scope:**
- **Phase A** — Voice input do Command Palette i chatu AI: `useVoiceInput` hook + `VoiceMicButton` komponent; `WebSpeechProvider` (domyślny) + `WhisperProvider` (OpenAI Whisper-1, gdy `OPENAI_API_KEY` ustawiony); `useVoiceProvider` hook auto-selektujący najlepszy provider; serwer proxy `POST /api/ai_assistant/transcribe`; language autodetect z `navigator.language`; pełny lifecycle edge-case handling
- **Phase B** — WCAG 2.1 AA: dwa workstreamy — (B-shell) `AppShell` landmarks + skip-to-content + `FlashMessages` live region; (B-audit) audyt icon-only buttonów z tabelą current-state/gap/change
- **Phase C** — Visual settings per-user: high contrast (tryb jasny i ciemny), font size (S/M/L/XL), reduced motion; rozszerza istniejący `PUT /api/auth/profile` i command `auth.users.update`; JSON column `accessibility_preferences` na tabeli `users`; CSS variables na `<html>`; dedykowana strona `/backend/profile/accessibility`; wpis w sidebarze profilu i profile dropdown

**Out of scope (nadal):**
- Voice input w formularzach CrudForm i wyszukiwarce (po walidacji Phase A)
- Dyslexia font, colorblind palettes

**Placement:** Core modification — `packages/ai-assistant` (voice), `packages/ui` (a11y audit + AppShell), `packages/core/src/modules/auth` (visual settings + profile API + command)

## Implementation Status

- **Phase A**: Implemented in `packages/ai-assistant` and verified with package-local Jest coverage.
- **Phase B**: Implemented in `packages/ui` and verified with targeted Jest coverage for `AppShell`, `FlashMessages`, topbar labels, and `AccessibilityProvider`.
- **Phase C**: Implemented in `packages/core/src/modules/auth`, including persistence, command undo support, widget injection, and migration `Migration20260414130740.ts`.
- **Generated artifacts**: Refreshed with `yarn generate` (this repo does not expose `npm run modules:prepare`).
- **Integration coverage**: Added `packages/core/src/modules/auth/__integration__/TC-AUTH-024.spec.ts` and `packages/enterprise/src/modules/security/__integration__/TC-SEC-009.spec.ts`.
- **Execution note**: Full Playwright execution could not be completed because `yarn test:integration:ephemeral:start` currently fails during unrelated app bootstrap in `packages/core/dist/modules/attachments/lib/ocrService.js` with a module resolution error.

---

## Overview

Platforma Open Mercato jest używana przez operatorów backoffice przez kilka godzin dziennie. Brak dostępności wyklucza osoby z dysfunkcjami ruchowymi rąk, słabym wzrokiem lub korzystające z czytników ekranu. Sterowanie głosowe pozwoli wydawać polecenia AI Assistantowi bez użycia klawiatury — szczególnie użyteczne przy nawigacji CRM i zarządzaniu klientami/zamówieniami.

> **Market Reference**: Salesforce Lightning Design System (WCAG 2.1 AA, aria-live patterns), Raycast (macOS native STT w command palette), Linear.app (keyboard-first design, focus management). Przyjęto: Web Speech API + provider abstraction (jak Raycast) zamiast natywnego STT. Odrzucono: react-aria (zbyt duża zależność, Radix UI już dostarcza a11y primitives).

## Problem Statement

1. Użytkownicy z ograniczeniami motorycznymi nie mogą efektywnie korzystać z aplikacji — brak keyboard-only navigation, niewidoczne focus ringi, pułapki focusu w dialogach.
2. Czytniki ekranu (NVDA, VoiceOver) nie otrzymują powiadomień o dynamicznych zmianach UI — `FlashMessages` (brak `aria-live`), stany ładowania są "nieme" dla screen readera.
3. Sterowanie głosem do AI Assistanta jest niemożliwe — jedyną ścieżką jest Cmd+K i wpisywanie tekstu.
4. Brak opcji wizualnych dla osób słabowidzących — nie ma high contrast mode, skali czcionek, ani trybu reduced motion.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Web Speech API jako provider Phase A | Zero dependency, bezpłatny, działa offline w Chrome/Edge; ~95% accuracy dla EN/PL |
| `VoiceTranscriptionProvider` interface | Swap na Whisper bez zmiany UI — dependency inversion |
| `navigator.language` autodetect | Brak konfiguracji po stronie usera; przeglądarka zna już język systemu |
| Extend `PUT /api/auth/profile` + `auth.users.update` | Istniejący endpoint i command już obsługuje profil; nowy endpoint byłby równoległym kontraktem profilu — łamie spójność i duplikuje audit trail |
| `accessibility_preferences` jako JSON column na `users` (nie `user_sidebar_preferences`) | `UserSidebarPreference` jest scoped przez `(user, tenantId, organizationId, locale)` — to preferencje widoku sidebar per-tenant per-locale. Accessibility preferences są **globalne** dla użytkownika niezależnie od tenant/org/locale (font size działa wszędzie tak samo). Dlatego JSON column bezpośrednio na `User` — tak samo jak `name`, `isConfirmed`. |
| CSS custom properties na `<html>` | Brak rerenderów React — jednorazowy zapis zmiennej; wszystkie komponenty dziedziczą |
| Skip-to-content + `<main id>` w `AppShell.tsx` | `Page.tsx` to wrapper `<div>` — realny `<main>` landmark siedzi w `AppShell.tsx:1497`. Umieszczenie skip link w złym komponencie spowodowałoby że `href="#main-content"` nie trafia do właściwego elementu |
| `AxeDevBootstrap` w `AppShell.tsx` (nie `AppProviders.tsx`) | `AppProviders.tsx` owija cały app tree przez `FrontendLayout` — odpaliłoby axe na frontend i portal. `AppShell.tsx` jest backoffice-only; to właściwy host. `layout.tsx` jest Server Component — nie dotykać. |
| Voice input **replace** (nie append) w obu inputach | Append generuje niespójny tekst gdy user mówi kilka razy; replace jest przewidywalny i pozwala poprawić całość |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Nowy endpoint `PATCH /api/auth/users/me` dla preferencji | Tworzy drugi kontrakt profilu — duplikuje audit trail, undo, i logikę permission check; narusza zasadę jednego źródła prawdy dla edycji użytkownika |
| `user_sidebar_preferences` dla accessibility settings | Tabela jest scoped per-tenant/org/locale — accessibility preferences są globalne; złe scoping = potencjalne niespójności między tenantami |
| Skip-to-content w `Page.tsx` | `Page.tsx` to `<div>` bez `id="main-content"` — skip link by nie trafiał do żadnego elementu |
| `require('@axe-core/react')` w `layout.tsx` | Server Component — crashuje w Node.js (brak DOM) |

## User Stories / Use Cases

- **Operator z dysfunkcją rąk** chce kliknąć ikonę mikrofonu w Command Palette i powiedzieć "znajdź klienta Kowalski", żeby nie musieć pisać na klawiaturze.
- **Użytkownik z słabym wzrokiem** chce ustawić większą czcionkę i wysoki kontrast w profilu, żeby czytać interfejs bez zewnętrznego narzędzia.
- **Użytkownik VoiceOver/NVDA** chce słyszeć powiadomienia o nowych flash messages, żeby wiedzieć co się dzieje bez patrzenia na ekran.
- **Użytkownik keyboard-only** chce nacisnąć Tab po załadowaniu strony i zobaczyć skip-to-content link, który przenosi go prosto do głównej treści.

---

## Architecture

### Phase A — Voice Input

```
packages/ai-assistant/src/
├── frontend/
│   ├── lib/
│   │   └── voice-transcription.ts      # VoiceTranscriptionProvider interface + WebSpeechProvider + WhisperProvider
│   ├── hooks/
│   │   ├── useVoiceInput.ts            # state machine + lifecycle management
│   │   └── useVoiceProvider.ts         # auto-selects Whisper (gdy provider dostępny) lub WebSpeech
│   └── components/
│       ├── CommandPalette/
│       │   ├── VoiceMicButton.tsx       # mic button z animacją i ARIA (shared)
│       │   ├── CommandInput.tsx         # ← VoiceMicButton + voiceProvider prop (idle phase)
│       │   └── CommandPalette.tsx       # ← useVoiceProvider() + VoiceMicButton w chat form
│       └── DockableChat/
│           └── DockableChat.tsx         # ← useVoiceProvider() + VoiceMicButton w obu formach (floating + docked)
└── modules/ai_assistant/
    ├── lib/
    │   └── transcription-provider.ts   # resolveProvider() — logika wyboru providera (env vars, priorytety)
    ├── api/
    │   └── transcribe/
    │       └── route.ts                # GET (availability + provider name) + POST (proxy multi-provider)
    └── components/
        └── AiAssistantSettingsPageClient.tsx
            └── + Voice Transcription status row (kafelka w Connections section)
```

#### VoiceTranscriptionProvider Interface

```typescript
// packages/ai-assistant/src/frontend/lib/voice-transcription.ts

export interface VoiceTranscriptionProvider {
  readonly isSupported: boolean
  startListening(options: { lang: string }): void
  stopListening(): void
  onInterim(callback: (text: string) => void): () => void  // returns cleanup
  onFinal(callback: (transcript: string) => void): () => void
  onError(callback: (error: VoiceInputError) => void): () => void
}

export type VoiceInputError =
  | 'permission_denied'   // user odmówił dostępu do mikrofonu
  | 'mic_busy'            // mikrofon zajęty przez inną aplikację/zakładkę
  | 'not_supported'       // przeglądarka nie obsługuje Web Speech API
  | 'network'             // błąd sieciowy (dla cloud-based STT)
  | 'aborted'             // nagrywanie przerwane (np. przez zmianę fazy)
  | 'unknown'

export class WebSpeechProvider implements VoiceTranscriptionProvider {
  readonly isSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  // ... implementacja
}
```

#### useVoiceInput Hook — State Machine + Lifecycle

```typescript
// hooks/useVoiceInput.ts

type VoiceState = 'idle' | 'listening' | 'error' | 'unsupported'

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void   // replace semantics — nie append
  disabled?: boolean                     // np. isStreaming w AI chat
}

export function useVoiceInput(options: UseVoiceInputOptions): {
  state: VoiceState
  errorCode: VoiceInputError | null
  toggle: () => void
  stop: () => void   // stop bez wywołania onTranscript
}
```

**Lifecycle edge cases — wszystkie muszą być obsłużone:**

| Zdarzenie | Stan wejściowy | Akcja | Stan wyjściowy |
|-----------|---------------|-------|----------------|
| User kliknie mic | `idle` | `startListening()` | `listening` |
| Mowa skończona | `listening` | `onFinal(transcript)` → `onTranscript(text)`, `stop()` | `idle` |
| `permission_denied` | `listening` | `onError('permission_denied')`, pokaż komunikat | `error` |
| Mikrofon zajęty | `listening` | `onError('mic_busy')` | `error` |
| User kliknie mic ponownie | `listening` | `stopListening()` bez wyniku | `idle` |
| Partial transcript przy `stop()` | `listening` | odrzucony — `onTranscript` NIE wywoływany | `idle` |
| Phase zmienia się (idle→chatting) | `listening` | `stop()` wywoływany przez `useEffect` cleanup | `idle` |
| Command Palette zamknięty | `listening` | `stop()` wywoływany przez destruktor hooka | `idle` |
| `disabled=true` (isStreaming) | dowolny | mic button disabled, `startListening()` zablokowany | bez zmian |
| Brak Web Speech API | — | `state='unsupported'`, button ukryty | `unsupported` |

#### Data Flow

```
User kliknie VoiceMicButton
        │
        ▼
useVoiceInput.toggle()
        │
        ├── VoiceState → 'listening'
        ├── WebSpeechProvider.startListening({ lang: navigator.language || 'en-US' })
        │       │
        │       ├── onInterim(text) → live preview [opcjonalnie w UI]
        │       └── onFinal(text) → onTranscript(text) [REPLACE semantics]
        │
        └── on error → VoiceState → 'error', errorCode ustawiony

CommandInput (idle):  onTranscript → onValueChange(transcript)     // replace
Chat form (chatting): onTranscript → setChatInput(transcript)      // replace
                      disabled gdy isStreaming=true
```

### Phase B — WCAG 2.1 AA (dwa workstreamy)

**B-shell — AppShell landmarks i live regions:**

```
packages/ui/src/backend/AppShell.tsx
    ├── + skip-to-content link PRZED <header> (widoczny tylko :focus-visible)
    ├── + id="main-content" na istniejącym <main> (linia 1497)
    └── FlashMessages.tsx
            └── + role="status" aria-live="polite" na wrapper <div>
```

**B-audit — Audyt icon-only buttonów:**

| Komponent | Stan obecny | Gap | Wymagana zmiana |
|-----------|-------------|-----|-----------------|
| `ErrorMessage.tsx` | `role="alert"` ✓ | Brak | Brak |
| `IntegrationsButton.tsx` | `aria-label` via i18n ✓ | Brak | Brak |
| `RowActions.tsx` | `aria-haspopup`, `aria-expanded`, `<span className="sr-only">` ✓ | Brak | Brak |
| `UserMenu.tsx` | `aria-expanded`, `aria-haspopup`, `aria-controls`, `aria-labelledby` ✓ | Trigger ma `title` ale brak `aria-label` | Dodać `aria-label={email \|\| t(...)}` |
| `ProfileDropdown.tsx` | `aria-expanded`, `aria-haspopup` ✓ | Trigger ma `title` ale brak `aria-label` | Dodać `aria-label={email \|\| t(...)}` |
| `SettingsButton.tsx` | Tylko `title` — brak `aria-label` | `aria-label` missing | Dodać `aria-label={t('backend.nav.settings', 'Settings')}` |
| `FlashMessages.tsx` | Brak ARIA | Brak `aria-live`, `role` | Dodać `role="status" aria-live="polite"` |

**B-dev — axe-core bootstrap:**

`AxeDevBootstrap` — osobny client component montowany w `AppShell.tsx` (backoffice-only). Implementacja i uzasadnienie wyboru hosta w kroku B-dev 5 Implementation Plan.

### Phase C — Visual Settings

```
packages/core/src/modules/auth/
├── data/entities.ts
│   └── User → + accessibilityPreferences: AccessibilityPreferences | null
├── data/validators.ts
│   └── + AccessibilityPreferencesSchema (zod)
│   └── updateSchema (commands/users.ts) → + accessibilityPreferences optional
├── api/profile/route.ts
│   └── updateSchemaBase → + accessibilityPreferences optional
│   └── walidacja: relaxed — wystarczy ONE OF (email | password | accessibilityPreferences)
├── backend/profile/accessibility/
│   ├── page.tsx     → AccessibilitySection standalone (OSS only)
│   └── page.meta.ts → requireAuth guard
└── lib/profile-sections.tsx
    └── + pozycja 'accessibility' w grupie 'account' (order 2, AccessibilityIcon, href /backend/profile/accessibility)
    [backend/profile/change-password/page.tsx — bez AccessibilitySection, tylko formularz hasła]
    [backend/profile/page.tsx — tylko redirect, nie dotykać]
    [backend/profile/ProfileNav.tsx — usunięty; nawigacja przez sidebar]

packages/ui/src/backend/
├── AppShell.tsx → + AccessibilityProvider + AxeDevBootstrap (oba backoffice-only)
├── AccessibilityProvider.tsx (nowy client component)
└── ProfileDropdown.tsx
    └── + { id: 'accessibility' } po 'change-password' w builtInMenuItems
        → link do /backend/profile/accessibility z ikoną Accessibility (lucide)

packages/enterprise/src/modules/security/  [NIE modyfikować bezpośrednio]
└── backend/profile/security/page.tsx ma InjectionSpot "security.profile.sections"
    → AccessibilitySection trafia przez widget injection (core auth rejestruje widget)

apps/mercato/src/app/layout.tsx  [Server Component — NIE dotykać]
```

#### Applied CSS (Phase C)

Zmienne CSS i klasy ustawiane przez `AccessibilityProvider`. Zaimplementowane w `apps/mercato/src/app/globals.css` i `packages/create-app/template/src/app/globals.css` (oba pliki muszą być zsynchronizowane).

```css
/* Font scaling */
html {
  font-size: calc(1rem * var(--font-scale, 1));
}

/* High contrast — tryb JASNY (brak klasy .dark) */
html.high-contrast:not(.dark) {
  color-scheme: light;
  --background: oklch(1 0 0);
  --foreground: oklch(0 0 0);
  --primary: oklch(0 0 0);
  --primary-foreground: oklch(1 0 0);
  --muted-foreground: oklch(0.18 0 0);
  --border: oklch(0 0 0 / 40%);
  --input: oklch(0 0 0 / 15%);
  --ring: oklch(0 0 0);
  /* + card, popover, secondary, muted, accent, sidebar — all white/black */
}

/* High contrast — tryb CIEMNY (klasa .dark obecna) */
html.high-contrast.dark {
  color-scheme: dark;
  --background: oklch(0 0 0);
  --foreground: oklch(1 0 0);
  --primary: oklch(1 0 0);
  --primary-foreground: oklch(0 0 0);
  --muted-foreground: oklch(0.97 0 0);
  --border: oklch(1 0 0 / 35%);
  --input: oklch(1 0 0 / 20%);
  --ring: oklch(1 0 0);
  /* + card, popover, secondary, muted, accent, sidebar — all black/white */
}

/* Reduced motion */
html.reduce-motion *,
html.reduce-motion *::before,
html.reduce-motion *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}
```

> **Implementacja**: Selektor `.high-contrast` świadomie rozdzielono na `:not(.dark)` i `.dark` — zapewnia poprawne działanie zarówno w jasnym jak i ciemnym motywie. Klasa `.dark` jest zarządzana przez system motywów (nie przez `AccessibilityProvider`).

---

## Data Models

### User.accessibilityPreferences

```typescript
// packages/core/src/modules/auth/data/validators.ts

export const AccessibilityPreferencesSchema = z.object({
  highContrast: z.boolean().default(false),
  fontSize: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
  reducedMotion: z.boolean().default(false),
}).partial()  // wszystkie pola opcjonalne — PATCH semantics

export type AccessibilityPreferences = z.infer<typeof AccessibilityPreferencesSchema>
```

```typescript
// packages/core/src/modules/auth/data/entities.ts (User entity, fragment)
@Property({ name: 'accessibility_preferences', type: 'json', nullable: true })
accessibilityPreferences?: AccessibilityPreferences | null
```

Wartość `null` interpretowana jako wszystkie defaults. Brak osobnej encji — preferencja globalna użytkownika.

### Snapshot (SerializedUser w commands/users.ts)

```typescript
// Typ SerializedUser (linia ~40) musi być rozszerzony:
type SerializedUser = {
  // ... istniejące pola ...
  accessibilityPreferences?: AccessibilityPreferences | null  // dla undo
}
```

---

## API Contracts

### Phase C — GET /api/auth/profile (rozszerzone dla hydration)

```
GET /api/auth/profile
Auth: requireAuth
Response 200 (rozszerzone addytywnie):
  {
    email: string    // istniejące pole
    roles: string[]  // istniejące pole
    accessibilityPreferences: AccessibilityPreferences | null  // NOWE — null gdy nie ustawione
  }
```

Rozszerzenie addytywne — istniejące callers nie otrzymają błędu, ignorują nowe pole.

### Phase C — PUT /api/auth/profile (rozszerzone ciało, response bez zmian)

```
PUT /api/auth/profile
Auth: requireAuth (własny profil, nie cudzy)
Body (rozszerzony):
  {
    email?: string                                       // istniejące pole
    currentPassword?: string                             // istniejące pole
    password?: string                                    // istniejące pole
    accessibilityPreferences?: AccessibilityPreferences  // NOWE, opcjonalne
  }
Walidacja: ONE OF (email | password | accessibilityPreferences) musi być obecny
Response 200: { ok: true, email: string }
  ↑ kształt ZACHOWANY bez zmian — preferencje są persystowane w DB, nie echowane w response.
  JWT refresh (cookie) emitowany normalnie gdy email/password się zmieniło.
Errors:
  400 — Invalid schema
  401 — Not authenticated
```

Istniejący `openApi` export w `route.ts` wymaga rozszerzenia body schema.

### Phase A — Transcription proxy (zaimplementowane, multi-provider)

```
GET /api/ai_assistant/transcribe
Auth: requireAuth, requireFeatures(['ai_assistant.view'])
Response 200: { available: boolean, provider?: 'self-hosted' | 'groq' | 'openai' }
  available = true gdy co najmniej jeden provider skonfigurowany

POST /api/ai_assistant/transcribe
Auth: requireAuth, requireFeatures(['ai_assistant.view'])
Body: FormData { audio: Blob (webm/ogg/mp4), language?: string (ISO-639-1) }
Response 200: { transcript: string }
Response 503: gdy żaden provider nie skonfigurowany
```

Proxy wykrywa aktywny provider z env vars i wysyła audio do kompatybilnego endpointu OpenAI `/v1/audio/transcriptions`. Brak buforowania — każde żądanie proxy-owane bezpośrednio.

**Priorytety providerów (od najwyższego):**

| Priorytet | Env var | Provider | Domyślny model |
|-----------|---------|----------|----------------|
| 1 | `WHISPER_API_URL` | Self-hosted (LocalAI, Faster-Whisper, whisper.cpp) | `whisper-1` |
| 2 | `GROQ_API_KEY` | Groq cloud | `whisper-large-v3-turbo` |
| 3 | `OPENAI_API_KEY` | OpenAI | `whisper-1` |
| — | brak | WebSpeech (przeglądarka) | — |

**Opcjonalne env:**
- `WHISPER_API_KEY` — token auth dla self-hosted endpointu (gdy wymaga)
- `WHISPER_MODEL` — override modelu dla self-hosted i Groq (np. `whisper-large-v3`, `distil-whisper-large-v3-en`)
- `VOICE_TRANSCRIPTION_DISABLED` — truthy (`1`, `true`, `yes`) wymusza browserowy WebSpeech fallback i wyłącza wszystkie server-side providery, nawet gdy klucze/env są ustawione dla innych feature'ów

**Self-hosted — przykłady kompatybilnych serwerów:**
- **LocalAI**: `WHISPER_API_URL=http://localhost:8080/v1/audio/transcriptions`
- **Faster-Whisper Server** (ahmetoner/whisper-asr-webservice): `WHISPER_API_URL=http://localhost:9000/asr`
- **whisper.cpp server**: `WHISPER_API_URL=http://localhost:8080/inference`

---

## Commands & Events

### Phase C — Rozszerzenie auth.users.update

Istniejący command `auth.users.update` (`commands/users.ts:379`) jest rozszerzany — **nie tworzymy nowego**.

**Zmiany w `updateSchema` (linia 88):**
```typescript
const updateSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  password: passwordSchema.optional(),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.string()).optional(),
  accessibilityPreferences: AccessibilityPreferencesSchema.optional(),  // NOWE
})
```

**Zmiany w `execute`:**
```typescript
if (parsed.accessibilityPreferences !== undefined) {
  entity.accessibilityPreferences = {
    ...(entity.accessibilityPreferences ?? {}),
    ...parsed.accessibilityPreferences,
  }
}
```

**Zmiany w undo:** `SerializedUser` rozszerzony o `accessibilityPreferences` — undo przywraca poprzednią wartość.

**Nie ma nowego eventu** — istniejący `auth.user.updated` jest emitowany przez `emitCrudSideEffects` i wystarczy.

---

## Implementation Plan

### Phase A — Voice Input do AI Assistant

**A1 — `voice-transcription.ts`** (`packages/ai-assistant/src/frontend/lib/`)
- Zdefiniować `VoiceTranscriptionProvider` interface i `VoiceInputError` type
- Zaimplementować `WebSpeechProvider`
- `isSupported`: sprawdzenie `SpeechRecognition || webkitSpeechRecognition`
- `interimResults: true`, `continuous: false`
- Cleanup: wywołać `recognition.abort()` w `stopListening()`
- Mapowanie błędów SpeechRecognition na `VoiceInputError`: `not-allowed` → `permission_denied`, `audio-capture` → `mic_busy`, `aborted` → `aborted`

**A2 — `useVoiceInput` hook** (`packages/ai-assistant/src/frontend/hooks/useVoiceInput.ts`)
- State machine: `idle | listening | error | unsupported`
- `useEffect` cleanup → `provider.stopListening()` przy unmount lub `disabled` change
- `toggle()` — w stanie `listening` → `stop()`, w stanie `idle` → `startListening()`
- Po `onFinal` → wywołaj `onTranscript`, przejdź do `idle`
- Stan `unsupported` ustawiany raz przy mount jeśli `!provider.isSupported`

**A3 — `VoiceMicButton`** (`packages/ai-assistant/src/frontend/components/CommandPalette/VoiceMicButton.tsx`)
- Ikony: `Mic` (idle), `MicOff` (listening/error)
- Pulsing dot `animate-pulse text-red-500` podczas `listening`
- `aria-label` (i18n): `ai_assistant.voice.start` / `ai_assistant.voice.stop`
- `aria-pressed={state === 'listening'}`
- `hidden` gdy `state === 'unsupported'`
- `disabled` gdy `props.disabled === true`
- Error state: `title` z `errorCode` zamiast pulse
- **i18n**: Dodać klucze do `packages/ai-assistant/src/locales/en.json` (i pozostałych aktywnych locale):
  ```json
  "ai_assistant.voice.start": "Start voice input",
  "ai_assistant.voice.stop": "Stop voice input",
  "ai_assistant.voice.error.permission_denied": "Microphone access denied",
  "ai_assistant.voice.error.mic_busy": "Microphone is busy",
  "ai_assistant.voice.error.not_supported": "Voice input not supported",
  "ai_assistant.voice.error.network": "Network error",
  "ai_assistant.voice.error.unknown": "Voice input error"
  ```

**A4 — Integracja z `CommandInput.tsx`**
- Dodać `VoiceMicButton` po prawej stronie; `onTranscript={onValueChange}`

**A5 — Integracja z chat form w `CommandPalette.tsx`**
- Dodać `VoiceMicButton` między inputem a przyciskiem Send
- `onTranscript={(text) => setChatInput(text)}`
- `disabled={isStreaming}`
- `useEffect`: gdy `phase` zmienia się z `chatting` na `idle` (reset), wywołaj `stop()`

**A6 — Integracja z `DockableChat.tsx`** (`packages/ai-assistant/src/frontend/components/DockableChat/DockableChat.tsx`)
- `DockableChat` ma własny `chatInput`/`setChatInput` state oraz `isStreaming` — identyczny pattern jak `CommandPalette`
- Chat form pojawia się **dwa razy** w komponencie (minimized i expanded layout). Dodać `VoiceMicButton` w obu instancjach, między `<input>` a `<Button>` Send/Stop:
  - `onTranscript={(text) => setChatInput(text)}`
  - `disabled={isStreaming}`
- Istniejący `useEffect` (linia ~166) już resetuje `setChatInput('')` gdy `phase === 'idle'` — sprzątanie voice state pokrywa ten cleanup implicitly; wystarczy że `useVoiceInput` cleanup wywoła `stop()` przy unmount
- `VoiceMicButton` można importować z `../CommandPalette/VoiceMicButton` (shared)

---

### Phase B — WCAG 2.1 AA

**B-shell 1 — Skip-to-content link** (`packages/ui/src/backend/AppShell.tsx`)
- Wstawić PRZED `<header>`:
```tsx
<a
  href="#main-content"
  className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-[200] focus-visible:px-4 focus-visible:py-2 focus-visible:bg-background focus-visible:rounded focus-visible:shadow"
>
  {t('common.skip_to_content', 'Skip to content')}
</a>
```
- Dodać `id="main-content"` do istniejącego `<main>` (linia 1497)
- **i18n**: Dodać do `packages/ui/src/locales/en.json`:
  ```json
  "common.skip_to_content": "Skip to content"
  ```

**B-shell 2 — FlashMessages live region** (`packages/ui/src/backend/FlashMessages.tsx`)
- Na wewnętrznym wrapperze każdego flash item (nie zewnętrznym kontenerze listy) ustawić atrybut w zależności od rodzaju:
  - `kind === 'error'` → `role="alert" aria-live="assertive"` (screen reader ogłasza natychmiast, przerywając bieżące czytanie)
  - pozostałe (`success`, `info`, `warning`) → `role="status" aria-live="polite"` (ogłasza po zakończeniu bieżącego czytania)
- Podejście per-item (nie per-kontener) pozwala na prawidłowe re-ogłoszenie przy aktualizacji pojedynczego komunikatu

**B-audit 3 — SettingsButton** (`packages/ui/src/backend/SettingsButton.tsx`)
- Dodać `aria-label={t('backend.nav.settings', 'Settings')}` (i18n key już istnieje w `title`)

**B-audit 4 — UserMenu + ProfileDropdown**
- `UserMenu.tsx`: dodać `aria-label={email || t('ui.userMenu.userFallback', 'User')}` na trigger button
- `ProfileDropdown.tsx`: dodać `aria-label={email || t('ui.userMenu.userFallback', 'User')}` na trigger button

**B-dev 5 — axe-core dev bootstrap** — osobny `AxeDevBootstrap` client component, montowany w `AppShell`

`AppProviders.tsx` owija **cały** app tree (backoffice + frontend + portal) przez `FrontendLayout`. Montaż `AxeDevBootstrap` tam odpaliłby axe również na stronach frontend i portal. `AppShell.tsx` jest komponentem backoffice-only — właściwy host.

```tsx
// packages/ui/src/backend/devtools/AxeDevBootstrap.tsx
'use client'
import { useEffect } from 'react'

export function AxeDevBootstrap() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    let cancelled = false
    Promise.all([
      import('@axe-core/react'),
      import('react'),
      import('react-dom'),
    ]).then(([axe, React, ReactDOM]) => {
      if (!cancelled) axe.default(React, ReactDOM, 1000)
    })
    return () => { cancelled = true }
  }, [])
  return null
}
```

Dodać `<AxeDevBootstrap />` w `AppShell.tsx` obok `<FlashMessages />` — backoffice-only, zero wpływu na frontend i portal.

**Zależność**: Dodać `@axe-core/react` do `devDependencies` w `packages/ui/package.json`:
```json
"@axe-core/react": "^4.10.0"
```
Import jest lazy (`import('@axe-core/react')` wewnątrz `useEffect`) — pakiet nie trafia do production bundle.

---

### Phase C — Visual Settings

**C1 — Migracja DB**
- Dodać `@Property({ name: 'accessibility_preferences', type: 'json', nullable: true })` na `User`
- `yarn db:generate` → migration

**C2 — Rozszerzenie `auth.users.update` command**
- Dodać `accessibilityPreferences?: AccessibilityPreferencesSchema` do `updateSchema`
- Dodać merge logic w `execute`
- Dodać `accessibilityPreferences` do `SerializedUser` i undo restore

**C3 — Rozszerzenie `PUT /api/auth/profile`**
- Dodać `accessibilityPreferences` do `updateSchemaBase`
- Zrelaksować walidację: `if (!data.email && !data.password && !data.accessibilityPreferences)`
- Przekazać do command bus jako `input.accessibilityPreferences`
- Rozszerzyć `openApi` body schema
- **Mutation guard**: `PUT /api/auth/profile` jest self-service endpoint (user edytuje własny profil, nie zasób administracyjny) — nie podlega regule `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` z `packages/core/AGENTS.md`, która dotyczy admin CRUD routes zarządzających encjami innych użytkowników. Endpoint pozostaje bez mutation guard (istniejący wzorzec zachowany).

**C4 — `AccessibilityProvider`** (osobny client component, montowany w `AppShell`)

Mechanizm hydration: `AccessibilityProvider` wykonuje `GET /api/auth/profile` w `useEffect` na mount.

**Trade-off FOUC**: przez 1 render cycle przed zakończeniem fetcha aplikacja renderuje domyślne style. Akceptowalne — dotyczy stylu, nie treści.

**Live-update po zapisie**: `AccessibilitySection` po pomyślnym `PUT` dispatchuje `CustomEvent('accessibility-preferences-changed', { detail: prefs })`. `AccessibilityProvider` nasłuchuje tego eventu i natychmiastowo stosuje zmiany — bez re-mount, bez reload. Wzorzec identyczny jak `FlashMessages` i event `flash`.

**Dedupe GET (Rev 11)**: `AccessibilityProvider` utrzymuje module-level store (`useSyncExternalStore`) z memoizowanym `ensureAccessibilityPreferencesLoaded()`. Hook `useAccessibilityPreferences()` eksponuje `{ preferences, loading, error }` dla konsumentów (np. `AccessibilitySection`), którzy NIE powinni wywoływać własnego `GET /api/auth/profile`. Na stronie `/backend/profile/accessibility` Provider i Section renderują się jednocześnie, ale memoizacja promisa gwarantuje jeden request. Poniższy snippet jest ilustracyjny — pełna implementacja w `packages/ui/src/backend/AccessibilityProvider.tsx` zawiera dodatkowo store + hook.

```typescript
// Typ do użycia w AccessibilityProvider i change-password/page.tsx
// Importować AccessibilityPreferences z validators zamiast definiować inline — uniknięcie type drift
import type { AccessibilityPreferences } from '@open-mercato/core/modules/auth/data/validators'

type ProfileResponseWithA11y = {
  email?: string | null
  roles?: string[]
  accessibilityPreferences?: AccessibilityPreferences | null
}
```

```tsx
// packages/ui/src/backend/AccessibilityProvider.tsx
'use client'
import { useEffect } from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const FONT_SCALE: Record<string, string> = {
  sm: '0.875', md: '1', lg: '1.125', xl: '1.25',
}

function applyPreferences(prefs: ProfileResponseWithA11y['accessibilityPreferences']) {
  const root = document.documentElement
  root.style.setProperty('--font-scale', FONT_SCALE[prefs?.fontSize ?? 'md'])
  root.classList.toggle('high-contrast', prefs?.highContrast ?? false)
  const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  root.classList.toggle('reduce-motion', (prefs?.reducedMotion ?? false) || systemReducedMotion)
}

export function AccessibilityProvider() {
  useEffect(() => {
    let cancelled = false
    readApiResultOrThrow<ProfileResponseWithA11y>('/api/auth/profile')
      .then((data) => { if (!cancelled) applyPreferences(data.accessibilityPreferences) })
      .catch(() => {
        // 401/403 (niezalogowany lub brak sesji) → defaults remain, brak side effects
        // Nie logować — oczekiwany stan przy wygaśnięciu sesji i SSR hydration
      })

    const handler = (e: Event) => {
      applyPreferences((e as CustomEvent).detail ?? null)
    }
    window.addEventListener('accessibility-preferences-changed', handler)

    return () => {
      cancelled = true
      window.removeEventListener('accessibility-preferences-changed', handler)
    }
  }, [])
  return null
}
```

Dodać `<AccessibilityProvider />` w `AppShell.tsx` obok `<FlashMessages />`.

**C5 — `AccessibilitySection` — dual-mode hosting (OSS vs Enterprise)**

W zależności od aktywacji enterprise security module, strona profilu jest w innym miejscu:

| Tryb | URL | Host |
|------|-----|------|
| OSS | `/backend/profile/accessibility` | `packages/core/src/modules/auth/backend/profile/accessibility/page.tsx` (dedykowana strona; dostęp przez sidebar i profile dropdown) |
| Enterprise | `/backend/profile/security` | `packages/enterprise/src/modules/security/backend/profile/security/page.tsx` (redirect z `/backend/profile` i `/backend/profile/change-password` przez middleware) |

**OSS**: `<AccessibilitySection />` renderowana na dedykowanej stronie `backend/profile/accessibility/page.tsx`. Strona `change-password/page.tsx` pozostaje bez AccessibilitySection (tylko formularz zmiany hasła). Nawigacja do strony dostępności możliwa przez:
- sidebar profilu (`lib/profile-sections.tsx`, grupa `account`, pozycja `accessibility`, order 2)
- profile dropdown (`ProfileDropdown.tsx` — `{ id: 'accessibility' }` po `change-password`, link `/backend/profile/accessibility`, ikona `Accessibility` z lucide-react)

**Enterprise**: NIE modyfikować `packages/enterprise/` bezpośrednio. Zamiast tego — widget injection na istniejący spot `security.profile.sections` (linia 26 `SecurityProfilePage`). Widget rejestrowany przez moduł `auth` w core:

```
packages/core/src/modules/auth/
├── widgets/
│   └── injection/
│       └── accessibility-section/
│           └── widget.ts          ← InjectionWidgetModule
└── widgets/injection-table.ts     ← mapowanie spotId → widget
```

```typescript
// packages/core/src/modules/auth/widgets/injection/accessibility-section/widget.ts
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'

const module: InjectionWidgetModule = {
  metadata: {
    id: 'auth.accessibility-section',
    title: 'Accessibility Settings',
  },
  component: () => import('./AccessibilitySectionWidget'),
}
export default module
```

```typescript
// packages/core/src/modules/auth/widgets/injection-table.ts (wpis do dodania)
'security.profile.sections': [
  () => import('./injection/accessibility-section/widget'),
],
```

`AccessibilitySectionWidget` to cienki wrapper eksportujący `<AccessibilitySection />` jako `InjectionWidgetComponent` (props: `context`, `data`, `onDataChange`, `disabled`).

**Generator step**: Po dodaniu plików `widgets/injection/accessibility-section/` i aktualizacji `widgets/injection-table.ts` uruchomić:
```bash
yarn generate
```
Wymagane przez root AGENTS.md po każdej modyfikacji plików modułu — rejestruje nowe widget paths w runtime. W tym repo `npm run modules:prepare` nie istnieje; równoważnym krokiem jest `yarn generate`.

Zawartość `AccessibilitySection`:
- Toggle high contrast
- Select font size (S/M/L/XL) jako segmented control
- Toggle reduced motion z wyjaśnieniem ("respects your system preference")
- Wszystkie stringi przez i18n (`auth.accessibility.*`)
- **Submit path**: `AccessibilitySection` nie używa `CrudForm` (brak standardowych pól CRUD). Zamiast tego — `useGuardedMutation` z `@open-mercato/ui/backend/injection/useGuardedMutation`:
  ```tsx
  const { runMutation } = useGuardedMutation({
    retryLastMutation: () => handleSave(lastPrefs),
  })

  const handleSave = (prefs: AccessibilityPreferences) => {
    runMutation({
      operation: 'update',
      context: { entityType: 'user-profile', entityId: 'me' },
      mutationPayload: prefs,
      execute: async () => {
        await apiCallOrThrow('PUT', '/api/auth/profile', { accessibilityPreferences: prefs })
        window.dispatchEvent(new CustomEvent('accessibility-preferences-changed', { detail: prefs }))
      },
    })
  }
  ```
- `retryLastMutation` dostarczone w injection context — wymagane przez `useGuardedMutation`
- **i18n**: Dodać do `packages/core/src/modules/auth/locales/en.json`:
  ```json
  "auth.accessibility.section_title": "Accessibility",
  "auth.accessibility.high_contrast": "High contrast",
  "auth.accessibility.high_contrast_description": "Increases contrast for better readability",
  "auth.accessibility.font_size": "Font size",
  "auth.accessibility.font_size_sm": "S",
  "auth.accessibility.font_size_md": "M",
  "auth.accessibility.font_size_lg": "L",
  "auth.accessibility.font_size_xl": "XL",
  "auth.accessibility.reduced_motion": "Reduce motion",
  "auth.accessibility.reduced_motion_description": "Disables animations and transitions. Activates automatically if your OS has reduced motion enabled.",
  "auth.accessibility.save_success": "Accessibility preferences saved"
  ```

---

## Enterprise Coexistence

### Konflikty z SPEC-ENT-001 (Security Module / MFA)

`SPEC-ENT-001` zakłada, że `/backend/profile`, `/backend/profile/change-password` i `/api/auth/profile` "remain unchanged". Niniejszy spec modyfikuje te surface'y — poniżej uzgodnienie:

| Surface | Zmiana | Zgodność |
|---------|--------|----------|
| `GET /api/auth/profile` response | Addytywne pole `accessibilityPreferences` | Backward compatible — istniejące callers ignorują nowe pole; brak zmiany kształtu |
| `PUT /api/auth/profile` body | Addytywne opcjonalne pole w body schema | Backward compatible — istniejące wywołania bez nowego pola działają bez zmian |
| `PUT /api/auth/profile` response | Bez zmian — `{ ok: true, email }` | Fully compliant z "remain unchanged" |
| `/backend/profile/change-password` page | Dodanie `<AccessibilitySection />` | W enterprise ten URL jest **niedostępny** (middleware redirect do `/backend/profile/security`) — zmiana dotyczy wyłącznie OSS |
| `/backend/profile/security` page | Brak bezpośredniej modyfikacji | AccessibilitySection trafia przez `security.profile.sections` injection spot — enterprise page.tsx niezmieniony |

### UI w trybie enterprise

`AccessibilitySection` jest renderowana jako injection widget w `security.profile.sections`. W OSS jest renderowana bezpośrednio w `change-password/page.tsx`. Preferencje są persystowane i dostępne w obu trybach przez `GET /api/auth/profile` — ten endpoint jest identyczny niezależnie od trybu.

### Pokrycie testowe dla obu trybów

| Test | OSS | Enterprise |
|------|-----|------------|
| `AccessibilitySection` renderuje się na stronie profilu | `accessibility` page (`/backend/profile/accessibility`) | `security.profile.sections` injection spot |
| `PUT /api/auth/profile` z `accessibilityPreferences` → 200 | Integration | Integration |
| `GET /api/auth/profile` → zawiera `accessibilityPreferences` | Integration | Integration |

---

## Risks & Impact Review

| Ryzyko | Prawdop. | Severity | Mitigation |
|--------|----------|----------|------------|
| Web Speech API niedostępne (Firefox, Safari iOS) | Wysokie | Niskie | Graceful degradation — button ukryty gdy `!isSupported`; żadna degradacja core |
| Partial transcript po `stop()` daje niespójny tekst | Średnie | Niskie | `stop()` → wywołuje `abort()` → `onFinal` NIE jest wywoływany; bezpieczne |
| Relaxowanie walidacji `PUT /api/auth/profile` łamie istniejące testy | Niskie | Średnie | Sprawdzić testy profilu — walidacja `superRefine` rozszerzana, nie zmieniana |
| CSS variables dla font-scale psują istniejące layouty | Niskie | Średnie | Tylko dla komponentów używających `rem`; testy wizualne przed merge |
| `@axe-core/react` spowalnia dev reload | Średnie | Niskie | Import lazy z 1000ms debounce — nie blokuje render |
| Undo `auth.users.update` z accessibility_preferences — snapshot niekompletny | Niskie | Średnie | `SerializedUser` rozszerzony o nowe pole; brak snapshotu = null = no-op przy undo |

---

## Migration & Backward Compatibility

- **Phase A**: Czysto addytywna — nowe pliki w `packages/ai-assistant`, brak zmian exportów
- **Phase B**: Addytywna — ARIA atrybuty, klasy CSS, `id` na `<main>` nie naruszają żadnego contract surface
- **Phase C**:
  - Nowa nullable JSON column z domyślem `null` — brak breaking migration
  - `PUT /api/auth/profile` body rozszerzony o opcjonalne pole — backward compatible
  - `auth.users.update` schema rozszerzona o opcjonalne pole — backward compatible; istniejące callers (admin user edit) niezmienione

---

## Integration Coverage

| Path | Type |
|------|------|
| `VoiceMicButton` hidden gdy Web Speech API niedostępne | Unit |
| `useVoiceInput` — `onTranscript` wywoływany po final z replace semantics | Unit |
| `useVoiceInput` — `stop()` po `permission_denied`, state → `error` | Unit |
| `useVoiceInput` — cleanup przy unmount → `stopListening()` | Unit |
| `useVoiceInput` — `disabled=true` blokuje `startListening()` | Unit |
| `CommandInput` z mic button — transcript zastępuje wartość inputa | Unit |
| Chat form (CommandPalette) z mic button — disabled gdy `isStreaming=true` | Unit |
| Chat form (DockableChat) z mic button — transcript zastępuje wartość inputa | Unit |
| Chat form (DockableChat) z mic button — disabled gdy `isStreaming=true` | Unit |
| `PUT /api/auth/profile` z `accessibilityPreferences` — zwraca `{ ok: true, email }`, preferencje persystowane w DB | Integration |
| `PUT /api/auth/profile` z samym `accessibilityPreferences` (bez email/password) — 200, nie 400 | Integration |
| `GET /api/auth/profile` — zwraca `accessibilityPreferences` po zapisaniu | Integration |
| `auth.users.update` undo — przywraca poprzednie `accessibilityPreferences` | Unit |
| `AccessibilityProvider` — po mount fetcha GET /api/auth/profile, ustawia CSS vars i klasy na `<html>` | Integration |
| `AccessibilityProvider` — przy `accessibilityPreferences: null` używa defaults (brak klas, `--font-scale: 1`) | Unit |
| `AccessibilityProvider` — `reduce-motion` ustawiony gdy system `prefers-reduced-motion` niezależnie od prefs | Unit |
| Skip-to-content link widoczny po focus, focus przenosi się na `#main-content` | Playwright |
| `FlashMessages` ogłaszany przez screen reader — `aria-live="polite"` | Playwright |
| `SettingsButton`, `UserMenu`, `ProfileDropdown` mają `aria-label` | Unit |
| `AccessibilitySection` save → `CustomEvent('accessibility-preferences-changed')` → `high-contrast`/`--font-scale` zmieniają się na `<html>` bez reload | Unit |
| `AccessibilityProvider` — przy 401/403 z GET /api/auth/profile nie rzuca błędu, defaults remain, brak side effects na DOM | Unit |
| `PUT /api/auth/profile` — response shape `{ ok: true, email }` zachowany (no-regression) | Integration |
| Enterprise: `GET /backend/profile/change-password` → redirect 302 → `/backend/profile/security` + `AccessibilitySection` obecna w injected content przez `security.profile.sections` | Playwright (enterprise) |
| `resolveProvider` — zwraca `null` gdy żaden env var nie ustawiony | Unit |
| `resolveProvider` — zwraca `self-hosted` gdy `WHISPER_API_URL` ustawiony; `headers: {}` bez `WHISPER_API_KEY`; `Authorization: Bearer` z `WHISPER_API_KEY` | Unit |
| `resolveProvider` — `WHISPER_MODEL` override dla self-hosted i Groq; brak override dla OpenAI (zawsze `whisper-1`) | Unit |
| `resolveProvider` — priorytety: `WHISPER_API_URL` > `GROQ_API_KEY` > `OPENAI_API_KEY` | Unit |
| `resolveProvider` — ignoruje whitespace-only env vars i schodzi do kolejnego providera | Unit |
| `resolveProvider` — zwraca `null` gdy `VOICE_TRANSCRIPTION_DISABLED` jest truthy, niezależnie od ustawionych provider env vars | Unit |
| `useVoiceProvider` — zwraca `WebSpeechProvider` natychmiast przed zakończeniem fetcha | Unit |
| `useVoiceProvider` — przełącza na `WhisperProvider` gdy GET `/api/ai_assistant/transcribe` zwraca `available: true` | Unit |
| `useVoiceProvider` — pozostaje przy `WebSpeechProvider` gdy `available: false` | Unit |
| `useVoiceProvider` — pozostaje przy `WebSpeechProvider` gdy fetch rzuca błąd | Unit |
| `useVoiceProvider` — wywołuje `GET /api/ai_assistant/transcribe` dokładnie raz przy mount | Unit |

---

## Final Compliance Report — 2026-04-14 (rev 6)

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/ai-assistant/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/core/AGENTS.md` (widget injection, API routes, command pattern, mutation guard contract)
- `packages/core/src/modules/auth/AGENTS.md`
- `SPEC-ENT-001` (enterprise security module — surface conflict review)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `AccessibilityPreferences` to pole na User, brak cross-module FK |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | Preferencje scoped do User (nie osobna encja tenant-scoped) |
| root AGENTS.md | Validate all inputs with zod | Compliant | `AccessibilityPreferencesSchema` w validators.ts |
| root AGENTS.md | Write operations via Command pattern | Compliant | Rozszerzamy istniejący `auth.users.update` |
| root AGENTS.md | API routes MUST export `openApi` | Compliant | Oba `GET` i `PUT /api/auth/profile` mają `openApi`; spec wskazuje addytywne rozszerzenie obu |
| root AGENTS.md | i18n — no hard-coded user-facing strings | Compliant | `ai_assistant.voice.*`, `auth.accessibility.*`, `common.skip_to_content` |
| root AGENTS.md | `requireAuth` guard | Compliant | `PUT /api/auth/profile` już wymaga auth |
| root AGENTS.md | Hash passwords bcryptjs cost>=10 | N/A | Phase A/B nie dotyczą haseł; Phase C nie zmienia logiki haseł |
| ai-assistant AGENTS.md | Voice input nie ingeruje w SSE chat pipeline | Compliant | Voice input działa wyłącznie po stronie frontend przed `POST /api/chat` |
| ai-assistant AGENTS.md | MCP tools MUST set `requiredFeatures` | N/A | Brak nowych MCP tools |
| packages/ui AGENTS.md | Use `@radix-ui/react-visually-hidden` | Compliant | Już w deps; `sr-only` Tailwind używamy dla skip-to-content |
| packages/ui AGENTS.md | Backend page write ops bez CrudForm → `useGuardedMutation` | Compliant | `AccessibilitySection` używa `useGuardedMutation` z `retryLastMutation` |
| packages/core/AGENTS.md | Mutation guard contract dla custom write routes | Compliant (N/A) | `PUT /api/auth/profile` to self-service endpoint — nie admin CRUD resource; mutation guard nie dotyczy |
| root AGENTS.md | `npm run modules:prepare` po dodaniu plików modułu | Compliant | Krok C5 Enterprise wymaga uruchomienia po dodaniu widget injection files |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `AccessibilityPreferencesSchema` używana zarówno w encji jak i walidacji API |
| API contracts match UI section | Pass | `GET /api/auth/profile` zasila `AccessibilityProvider`; `PUT /api/auth/profile` odpowiada `AccessibilitySection`; response shape `{ ok, email }` zachowany |
| Risks cover all write operations | Pass | Relaxowanie walidacji profilu, undo snapshot — oba uwzględnione |
| Commands defined for all mutations | Pass | Rozszerzony `auth.users.update` pokrywa jedyną mutację |
| Cache strategy | N/A | Preferencje czytane z user session — brak oddzielnego cache |
| Phase A — brak mutacji | Pass | Voice input to client-side only; brak write operations |
| Voice lifecycle edge cases | Pass | Wszystkie 10 scenariuszy zdefiniowanych w tabeli lifecycle |
| B-audit: rzeczy already-done zidentyfikowane | Pass | Tabela current-state/gap/change dla 7 komponentów |
| Enterprise coexistence | Pass | Widget injection na `security.profile.sections`; PUT/GET addytywne; SPEC-ENT-001 nie złamany |
| Live-update po zapisie | Pass | CustomEvent + listener w AccessibilityProvider; coverage test dodany |
| Dockable Chat scope | Pass | A6 krok dodany; DockableChat pokryty przez tę samą `VoiceMicButton` co CommandPalette |
| AccessibilitySection write path | Pass | `useGuardedMutation` zamiast bare `apiCall`; `retryLastMutation` w injection context |

### Non-Compliant Items

Brak. Wszystkie reguły spełnione lub N/A.

### Verdict

**Fully compliant** — Approved, ready for implementation. (Rev 6: Dockable Chat scope domknięty; `useGuardedMutation` dla AccessibilitySection; mutation guard justification; `modules:prepare` step; 401/403 behavior; test coverage rozszerzone.)

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-14 | WH173-P0NY | Szkielet spec z Open Questions |
| 2026-04-14 | WH173-P0NY | Pełna specyfikacja po rozwiązaniu Q1(c) Q2(c) Q3(b) Q4(a) |
| 2026-04-14 | WH173-P0NY | Rev 2: poprawki po code review — Phase C przepisana na `PUT /api/auth/profile` + `auth.users.update`; skip-to-content przeniesiony do `AppShell.tsx`; axe-core przeniesiony do `AppProviders.tsx`; voice lifecycle edge cases dodane; storage justification dodana; B-audit jako tabela current-state/gap/change; compliance report skorygowany |
| 2026-04-14 | WH173-P0NY | Rev 3: PUT response contract naprawiony na `{ ok: true, email }` (zachowany, bez zmian); GET /api/auth/profile rozszerzone o `accessibilityPreferences` jako mechanizm initial hydration; FOUC trade-off udokumentowany; axe-core snippet przepisany jako `AxeDevBootstrap` z `useEffect` i explicit importami |
| 2026-04-14 | WH173-P0NY | Rev 4: C5 host naprawiony — OSS: `change-password/page.tsx`; Enterprise: widget injection na `security.profile.sections` spot; dodana sekcja "Enterprise Coexistence" z uzgodnieniem konfliktu SPEC-ENT-001; axe-core przeniesiony do `AppShell.tsx` (backoffice-only, nie `AppProviders`); `AccessibilityProvider` przepisany na `readApiResultOrThrow` z `ProfileResponseWithA11y`, bez `as any`; dodany live-update przez `CustomEvent('accessibility-preferences-changed')` |
| 2026-04-14 | WH173-P0NY | Rev 5: zamknięcie luk z pre-implementation analysis — usunięto stary snippet `AppProviders.tsx` z Architecture B-dev; dodano sekcję "Applied CSS" z regułami konsumującymi `--font-scale`, `.high-contrast`, `.reduce-motion`; zadeklarowano devDependency `@axe-core/react` w B-dev 5; uściślono B-shell 2 (`role="alert" aria-live="assertive"` dla error vs `role="status" aria-live="polite"` dla pozostałych); dodano i18n steps do A3/B-shell 1/C5; rozwinięto C5 Enterprise o pełną strukturę widget injection (`widget.ts`, `injection-table.ts`, wrapper); zastąpiono inline `ProfileResponseWithA11y` importem `AccessibilityPreferences` z validators |
| 2026-04-14 | WH173-P0NY | Rev 6: zamknięcie luk z drugiej rundy analysis — dodano A6 krok dla DockableChat (zakres TLDR domknięty); Architecture tree rozszerzone o DockableChat; `AccessibilitySection` submit path zmieniony z bare `apiCall` na `useGuardedMutation` z `retryLastMutation`; dodano mutation guard justification dla `PUT /api/auth/profile` (self-service, nie CRUD resource); dodano `npm run modules:prepare` po widget injection files; dodano 401/403 behavior note w `AccessibilityProvider`; rozszerzono Integration Coverage o DockableChat testy, 401/403 test i PUT response no-regression; Final Compliance Report zaktualizowany do rev 6 |
| 2026-04-14 | Agent | Rev 7: implementacja zakończona — Phase A/B/C zakodowane, `yarn generate` uruchomione, wygenerowano migrację `Migration20260414130740.ts`, dodano integration specs `TC-AUTH-024` i `TC-SEC-009`, a sekcja statusu uzupełniona o bieżący blocker QA (`test:integration:ephemeral:start` failuje w niepowiązanym build path `attachments/ocrService`) |
| 2026-04-14 | WH173-P0NY | Rev 11: post-review follow-ups — (1) `AccessibilityProvider` rozbudowany o wewnętrzny module-level store (`useSyncExternalStore` + memoizowany `ensureAccessibilityPreferencesLoaded()` + hook `useAccessibilityPreferences()`); `AccessibilitySection` czyta prefs przez hook zamiast własnego `readApiResultOrThrow('/api/auth/profile')` — jedno GET na sesję, kontrakt spec C4 ("GET zasila AccessibilityProvider") utrzymany; `CustomEvent('accessibility-preferences-changed')` flow bez zmian; `__resetAccessibilityStoreForTests()` dodany dla izolacji Jest. (2) `useVoiceInput` — `new WebSpeechProvider()` przeniesiony z render body do `useEffect` gated na stan `fallbackReady`; downstream null-checks (`stop`, `toggle`, subscription effect) dodane — eliminuje tranzytywną instancję w React strict mode double-render. Weryfikacja: `packages/ui` backend 87/87 pass, `packages/ai-assistant` frontend 13/13 pass, `yarn typecheck` clean (18 pakietów) |
| 2026-04-14 | Agent | Rev 12: follow-up po review — test `transcription-provider.test.ts` czyści `VOICE_TRANSCRIPTION_DISABLED` w `beforeEach`, spec dokumentuje nowy env i coverage dla ścieżki force-disabled, `.env.example` doprecyzowuje że flaga wyłącza wszystkie server-side providery i wymusza WebSpeech fallback |
| 2026-04-14 | WH173-P0NY | Rev 10: testy + refaktor — `resolveProvider()` wyciągnięty do `lib/transcription-provider.ts` (testowalny bez Next.js); 16 nowych testów jednostkowych (`transcription-provider.test.ts` × 13, `useVoiceProvider.test.tsx` × 5); status voice transcription dodany do AI settings page (`AiAssistantSettingsPageClient`); spec Integration Coverage rozszerzone |
| 2026-04-14 | WH173-P0NY | Rev 9: multi-provider transcription — `route.ts` rozbudowane o self-hosted (WHISPER_API_URL + WHISPER_API_KEY), Groq (GROQ_API_KEY), OpenAI (OPENAI_API_KEY) z priorytetyzacją; WHISPER_MODEL override dla self-hosted i Groq; GET zwraca aktywny provider name; spec API Contracts zaktualizowane |
| 2026-04-14 | WH173-P0NY | Rev 8: post-impl UX refactor — (1) ProfileNav usunięty (`backend/profile/ProfileNav.tsx` skasowany); AccessibilitySection przeniesiona z zakładki na dedykowaną stronę `/backend/profile/accessibility`; nawigacja przez sidebar (`profile-sections.tsx`, grupa `account`, pozycja `accessibility`, order 2) oraz profile dropdown (nowy link `accessibility` po `change-password`); (2) High contrast rozszerzony o tryb jasny — selektor `html.high-contrast` rozbity na `html.high-contrast:not(.dark)` (white/black, `color-scheme: light`) i `html.high-contrast.dark` (black/white, bez zmian); oba pliki `globals.css` zaktualizowane; (3) `Accessibility` dodany do `ProfileDropdown.tsx` (ikona `Accessibility` lucide-react); (4) `reduced_motion_description` zaktualizowany we wszystkich 4 locale (EN/PL/DE/ES) — konkretny opis mechanizmu zamiast ogólnego "respects system preference"; (5) OpenAI Whisper provider zaimplementowany — `WhisperProvider`, `useVoiceProvider`, route `POST /api/ai_assistant/transcribe`; auto-selekcja Whisper gdy `OPENAI_API_KEY` ustawiony, fallback WebSpeech |

### Review — 2026-04-14 (rev 4)
- **Reviewer**: Agent (na podstawie code review)
- **Security**: Passed — brak nowych attack surfaces; PUT/GET addytywne; widget injection nie modyfikuje enterprise package
- **Performance**: Passed — CSS variables bez rerenderów; live-update przez CustomEvent (zero re-renders); axe-core lazy w AppShell
- **Cache**: N/A
- **Commands**: Passed — `auth.users.update` rozszerzony, undo zaktualizowany
- **Risks**: Passed — enterprise coexistence wyjaśnione; SPEC-ENT-001 nie złamany (PUT/GET response backward compatible); OSS change-password nieosiągalny w enterprise
- **Verdict**: Approved
