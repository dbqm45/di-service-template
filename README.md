# di-service-template

Szablon repozytorium usługi Delivery Intelligence Suite (krok 13a planu budowy suity, `dbqm45/pdi`
`docs/plan-budowy-suity.md`). To nie jest produkt: każda nowa usługa suity (pierwsza: `di-identity`, krok 14) powstaje
z tego repo i dostaje od razu to, co wspólne.

Stos wg decyzji DA4 (`dbqm45/pdi` `docs/decyzje.md`): **TypeScript + Fastify + Postgres**, wzorce z ShipScope;
Node uruchamia TypeScript wprost (type stripping, Node ≥ 22.18), bez kroku budowania. Hosting: jedna maszyna
Hetzner Cloud z Docker Compose i Caddy (TLS).

## Co jest w szablonie

| Część | Pliki | Co daje |
|---|---|---|
| Logowanie suity | `src/auth/oidc.ts` | weryfikacja tokenu z usługi tożsamości suity (Keycloak, ADR 17): RS256, klucze z JWKS przez OpenID discovery, `iss`, `aud`, `exp`; tożsamość: `sub`, nazwa, organizacje, role tej aplikacji, e-mail tylko gdy token go niesie (DI3) |
| Ochrona tras | `src/app.ts`: `requireIdentity`, `requireRole` | trasa tylko dla zalogowanych albo tylko dla ról tej aplikacji |
| Zdarzenia suity | `src/events/` | odbiór `POST /api/events` z podpisem `X-DI-Signature` (ten sam schemat co pdi, ShipScope i DI Channels), sprawdzenie koperty wg przypiętego kontraktu, zapis z deduplikacją po `id`; wysyłka `sendEvent` |
| Baza | `src/db/`, `migrations/` | pula połączeń, migracje SQL `NNN_opis.sql` w transakcjach pod blokadą (wzorzec ShipScope) |
| Kontrakt | `contract/`, `tools/contract-pin.json`, `tools/sync-contract.ts` | przypięta kopia `dbqm45/di-contract` (dziś 0.16.0), sprawdzana bajt w bajt w CI |
| CI | `.github/workflows/ci.yml` | tytuł PR (Conventional Commits), typy, testy z Postgresem, kopia kontraktu, budowa obrazu |
| Wydania | `.github/workflows/release.yml`, `scripts/` | wersja z Conventional Commits po każdym scaleniu, `CHANGELOG.md`, tag `vX.Y.Z`, GitHub Release (RELEASING.md) |
| Wdrożenie | `Dockerfile`, `compose.yaml`, `Caddyfile` | usługa, Postgres i Caddy na jednej maszynie |
| Instrukcje dla agentów | `CLAUDE.md` | zasady pracy w repo usługi |

Trasy szablonu: `GET /health` (wersja i stan bazy), `GET /api/me` (zalogowana osoba), `POST /api/events`.

## Nowa usługa z szablonu

1. Utwórz repo z szablonu (GitHub: „Use this template”; repo szablonu musi mieć włączone „Template repository”
   w ustawieniach) z nazwą `di-<nazwa>`.
2. W `package.json`: `name`, `description`, `version` `0.1.0`; w `CHANGELOG.md` pierwszy wpis tej usługi.
3. W usłudze tożsamości: klient OIDC o identyfikatorze usługi (np. `di-release`) z mapperem audience, żeby token
   miał ten identyfikator w `aud`; role aplikacji jako role klienta. Ten identyfikator wpisz w `OIDC_AUDIENCE`.
4. Jeśli usługa wysyła zdarzenia: dopisz ją do `source` w `contract/event.schema.json` **w `di-contract`** (nowa
   wersja kontraktu), potem podnieś przypięcie tutaj (`tools/contract-pin.json`, `npm run contract:sync`).
5. Dopisz usługę do `suite.yaml` w `di-contract` (wersja z `package.json`, przypięcie `tools/contract-pin.json`,
   rodzaj `json-version`).
6. Usuń z `src/app.ts` trasy, których usługa nie potrzebuje, i dopisz własne; nowe tabele jako kolejne migracje.

## Uruchomienie lokalne

```sh
npm ci
cp .env.example .env          # uzupełnij DI_EVENTS_SECRET; OIDC_ISSUER na lokalny Keycloak
docker run -d --name pg -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -p 5432:5432 postgres:16-alpine
npm start                     # migracje przy starcie, potem http://127.0.0.1:3000/health
```

Testy: `npm test` (test bazy uruchamia się, gdy ustawione jest `TEST_DATABASE_URL`), typy: `npm run typecheck`.

## Wdrożenie (Hetzner Cloud)

Na maszynie z Dockerem: sklonuj repo usługi, utwórz `.env` z `.env.example` (`SERVICE_DOMAIN`, `POSTGRES_PASSWORD`,
`OIDC_*`, `DI_EVENTS_SECRET`), skieruj domenę na adres maszyny i uruchom `docker compose up -d --build`. Caddy
pobiera certyfikat TLS sam. Kopie zapasowe bazy, aktualizacje systemu i monitoring są po naszej stronie (ADR 17 §5);
procedura dla pierwszej usługi powstanie w kroku 14.

## Czego szablon nie robi (świadomie)

- Nie waliduje treści (`payload`) zdarzeń: każda usługa sprawdza typy, które obsługuje, wg `$defs` schematu.
- Nie ma interfejsu użytkownika ani sesji w przeglądarce: logowanie w przeglądarce (przekierowanie do Keycloak)
  dochodzi w usłudze, która ma UI.
- Nie wybiera kanału dostarczania zdarzeń z kolejką i ponowieniami: `sendEvent` wysyła raz, a odbiorca
  deduplikuje po `id`, więc ponowienie po stronie nadawcy jest bezpieczne.
