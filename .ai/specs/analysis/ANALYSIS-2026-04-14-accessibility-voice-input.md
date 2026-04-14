# Pre-Implementation Analysis: Accessibility & Voice Input

## Executive Summary
Spec jest blisko implementowalności, ale nie jest jeszcze w pełni gotowy do wejścia w realizację bez dopowiedzeń podczas kodowania. Nie widzę bezpośrednich, krytycznych naruszeń backward compatibility w aktualnym designie, natomiast są dwa realne blockery: brak kontraktu CSS dla Phase C oraz niedomknięty zakres voice input dla Dockable Chat. Rekomendacja: wprowadzić kilka celowanych poprawek w specu przed implementacją.

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | 7. API route URLs / contracts | Rozszerzenie `GET` i `PUT /api/auth/profile` jest addytywne i BC-safe, ale bezpieczeństwo tego założenia zależy od zachowania niezmienionego response shape `{ ok, email }` oraz od utrzymania enterprise interceptor behavior dla legacy password-change flow. Spec opisuje to częściowo, ale nie wymaga testów non-regression dla obu trybów. | Warning | Dodać jawne testy regresyjne dla `PUT /api/auth/profile`: OSS self-profile update działa addytywnie, enterprise nadal blokuje zmianę hasła i zwraca `redirectTo`, a response shape pozostaje bez zmian. |
| 2 | 1. Auto-discovery file conventions / 6. Widget injection spot IDs | Gałąź enterprise zależy od poprawnego użycia istniejącego spotu `security.profile.sections` i od dodania nowych auth widget files zgodnie z auto-discovery. Spec mówi o injection, ale nie enumeruje dokładnych plików/eksportów ani kroku generatora. Błędna implementacja nie złamie istniejącego kontraktu repo, ale łatwo skończy się cichym brakiem renderowania. | Warning | Dopisać dokładny file map dla widget injection (`widgets/injection/...`, `widgets/injection-table.ts`, export shape) oraz obowiązkowy krok `npm run modules:prepare` po dodaniu plików modułu. |

### Missing BC Section
Sekcja `Migration & Backward Compatibility` istnieje i obejmuje główne addytywne zmiany. Powinna jednak zostać uzupełniona o wyraźne odwołanie do enterprise non-regression tests oraz usunięcie sprzecznych, starszych fragmentów architektury, żeby nie zostawić dwóch różnych ścieżek implementacyjnych.

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| Brak całkowicie pominiętych sekcji wymaganych przez workflow | Niski | Nie ma brakujących sekcji obowiązkowych; problemem są sekcje niekompletne lub niespójne. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Architecture / Proposed Solution | W specu nadal zostały stare, sprzeczne odwołania do `AppProviders.tsx` oraz `backend/profile/page.tsx`, mimo że aktualny plan przenosi host do `AppShell.tsx` i stosuje dual-mode hosting dla profilu. | Usunąć lub przepisać stare fragmenty tak, aby cały dokument wskazywał jedną ścieżkę implementacji. |
| UI/UX (Phase C) | Spec ustawia `--font-scale`, `high-contrast` i `reduce-motion` na `<html>`, ale nie definiuje, gdzie i jak te klasy/zmienne są konsumowane. W repo nie ma dziś takiego kontraktu CSS. | Dodać konkretną sekcję CSS contract: pliki, selektory, tokeny i oczekiwany efekt dla każdej preferencji. |
| Implementation Plan (Phase A) | Zakres TLDR mówi o `Command Palette / Dockable Chat`, ale plan implementacyjny pokrywa tylko `CommandInput.tsx` i `CommandPalette.tsx`. `DockableChat.tsx` ma osobny chat input i nie zostanie pokryty przez samą zmianę w `CommandPalette.tsx`. | Albo zawęzić scope do Command Palette, albo dopisać osobny krok dla `DockableChat.tsx` chat phase oraz odpowiadające testy. |
| Integration Test Coverage | Brakuje jawnych przypadków testowych dla live-update bez reloadu oraz dla enterprise redirect + render przez `security.profile.sections`. | Dopisać scenariusze testowe dla event-driven apply, enterprise redirect i renderu widgetu w security profile. |
| Final Compliance Report | Raport jest merytorycznie spóźniony względem rewizji dokumentu, nie obejmuje wszystkich guide'ów faktycznie użytych przez finalny design i ma niespójny numer rewizji. | Zaktualizować reviewed guides i werdykt do finalnej rewizji speca. |

## AGENTS.md Compliance

### Violations
| Rule | Location | Fix |
|------|----------|-----|
| `packages/core/AGENTS.md`: custom write routes that do not use `makeCrudRoute` MUST wire the mutation guard contract (`validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess`) | Phase C, rozszerzenie `PUT /api/auth/profile` | Dodać do speca jawny krok implementacyjny dla mutation guard contract albo uzasadnić, dlaczego endpoint jest z niego wyłączony. |
| `packages/ui/AGENTS.md`: jeśli backend page nie może użyć `CrudForm`, każdy write musi iść przez `useGuardedMutation(...).runMutation(...)` | `AccessibilitySection` w C5 opisuje zapis przez `apiCall` | Zmienić spec tak, aby `AccessibilitySection` była oparta o `CrudForm` albo jawnie używała `useGuardedMutation`. Samo "nie raw fetch, używa apiCall" nie spełnia reguły. |
| Root `AGENTS.md`: run `npm run modules:prepare` after adding/modifying module files | Enterprise path zakłada nowe auth widget files w `widgets/injection/` i `widgets/injection-table.ts` | Dodać obowiązkowy krok generatora do implementation plan i remediation plan. |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Brak kontraktu CSS dla `--font-scale`, `.high-contrast`, `.reduce-motion` | Phase C może "działać" na poziomie API i providerów, ale użytkownik nie zobaczy realnej zmiany UI. To blokuje implementację funkcjonalną, bo preferencje nie mają zdefiniowanego efektu. | Dodać specyfikację stylów: gdzie są wprowadzane reguły, jakie tokeny są nadpisywane i jak ograniczyć blast radius. |
| Scope mismatch dla voice input w Dockable Chat | Feature może zostać wdrożony częściowo: Command Palette będzie wspierał voice input, ale Dockable Chat nie, mimo że jest w zakresie TLDR i Overview. | Dodać osobny krok dla `packages/ai-assistant/src/frontend/components/DockableChat/DockableChat.tsx` lub zawęzić scope w TLDR i planie. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Rozszerzenie `PUT /api/auth/profile` bez mutation guard contract | Endpoint może pozostać poza wspólnym contractem guardów dla custom write routes, co utrudni spójne interception i przyszłe rozszerzenia runtime. | Dopisać guard contract do speca i testów route-level. |
| `AccessibilityProvider` dodaje dodatkowy odczyt `/api/auth/profile` w backoffice shellu | Dochodzi kolejny auth-bound request na mount oraz FOUC zaakceptowany przez spec. Bez explicit policy może to wprowadzić niepotrzebne opóźnienia lub redirect side-effects przy problemach z sesją. | Dopisać oczekiwane zachowanie przy 401/403, ewentualną strategię cache/memoization i kryteria akceptacji dla FOUC. |
| Enterprise render path zależy od auto-discovered auth widget injection | Jeśli implementacja ominie `widgets/injection-table.ts`, złamie export shape albo pominie generator, enterprise users nie zobaczą sekcji mimo poprawnego core API. | Dodać dokładny file map i generator step do planu. |
| Stare, sprzeczne fragmenty dokumentu | Implementator może pójść za nieaktualnym blokiem architektury i wdrożyć złą ścieżkę hostingu. | Ujednolicić dokument przed rozpoczęciem prac. |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| `AccessibilityProvider` przy failed load pozostawia "defaults remain", ale spec nie opisuje resetu klas po poprzednim stanie | W edge-case'ach może zostać stary stan DOM na `<html>`, jeśli provider nie wykona udanego apply nowego zestawu preferencji. | Opisać zachowanie resetujące lub jawne `applyPreferences(null)` przy failed load / logout path. |
| Dev-only `AxeDevBootstrap` w `AppShell` | Może generować dodatkowy szum podczas HMR/debug w deweloperce. | Dodać notkę o expected dev overhead i ograniczyć działanie do `NODE_ENV !== 'production'`. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- Kontrakt CSS dla accessibility preferences: trzeba zdefiniować konkretne reguły w CSS i miejsce ich utrzymania. Sama manipulacja klasami i zmiennymi na `<html>` nie wystarcza.
- Domknięcie zakresu Dockable Chat: trzeba zdecydować, czy voice input obejmuje także docked chat conversation input, czy tylko Command Palette. Obecna wersja speca mówi jedno w scope, a plan implementacji drugie.

### Important Gaps (Should Address)
- Mutation guard contract dla `PUT /api/auth/profile`: brak jawnego kroku implementacyjnego mimo wymogu z `packages/core/AGENTS.md`.
- Forma zapisu `AccessibilitySection`: spec powinien jasno wybrać `CrudForm` albo `useGuardedMutation`, zamiast kończyć na `apiCall`.
- Generator step po dodaniu widget injection files: brak `npm run modules:prepare`.
- Testy dla live-update bez reloadu: spec opisuje event-driven update, ale nie wymaga testu dla tego zachowania.
- Testy dla enterprise redirect + injection render: obecny test matrix nie gwarantuje, że użytkownik enterprise faktycznie zobaczy sekcję w security profile po redirect.

### Nice-to-Have Gaps
- Dodać policy note, czy accessibility preferences mają być stosowane także poza backoffice, jeśli w przyszłości portal zacznie współdzielić część shell/theme tokens.
- Dodać krótką checklistę aktualizacji dokumentacji modułów po wdrożeniu, zwłaszcza `packages/ai-assistant/AGENTS.md`, jeśli feature stanie się częścią publicznego UX modułu.

## Remediation Plan

### Before Implementation (Must Do)
1. Ujednolicić dokument: usunąć stare fragmenty wskazujące `AppProviders.tsx` i `backend/profile/page.tsx`, zostawić jedną wersję architektury.
2. Dopisać kontrakt CSS dla Phase C: określić plik, selektory, tokeny i kryteria wizualne dla `fontScale`, `highContrast`, `reducedMotion`.
3. Zamknąć zakres voice input: albo dodać Dockable Chat do implementation plan i testów, albo usunąć go ze scope/TLDR.
4. Dodać do speca mutation guard contract dla `PUT /api/auth/profile`.

### During Implementation (Add to Spec)
1. Doprecyzować `AccessibilitySection` submit path: `CrudForm` lub `useGuardedMutation`, nie samo `apiCall`.
2. Dodać krok `npm run modules:prepare` po dodaniu widget injection files i po zmianach modułowych.
3. Rozszerzyć test matrix o live-update bez reloadu i enterprise redirect + injection render.

### Post-Implementation (Follow Up)
1. Zaktualizować Final Compliance Report do finalnej rewizji speca i pełnej listy reviewed guides.
2. Uzupełnić changelog speca o finalne decyzje dotyczące CSS contract i Dockable Chat coverage.
3. Zaktualizować odpowiednie AGENTS/module docs, jeśli wdrożenie zmieni utrwalone wzorce modułu AI Assistant lub auth profile UX.

## Recommendation
Needs spec updates first.

To nie jest major revision. Wystarczą celowane poprawki: ujednolicenie dokumentu, dopisanie CSS contract, domknięcie scope dla Dockable Chat oraz doprecyzowanie write-path/mutation-guard dla Phase C. Po tych poprawkach spec powinien być gotowy do implementacji.
