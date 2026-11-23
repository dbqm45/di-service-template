# CLAUDE.md

Szablon repozytorium usługi Delivery Intelligence Suite (opis w `README.md`, po polsku). Usługi tworzone z szablonu
dziedziczą te zasady; poprawka wspólna dla wszystkich usług trafia najpierw tutaj.

- Kod po angielsku, TypeScript `strict`, uruchamiany przez Node bez kompilacji (type stripping): tylko składnia
  wymazywalna (`erasableSyntaxOnly`), importy względne z rozszerzeniem `.ts`.
- Zależności w czasie działania: tylko `fastify` i `pg`; nowa zależność tylko z uzasadnieniem w treści commita.
  Kryptografia (JWT, HMAC) na `node:crypto`.
- Każda trasa z danymi: `requireIdentity` (token z usługi tożsamości suity), a gdzie trzeba `requireRole`. Każde
  zdarzenie od innej usługi: najpierw podpis `X-DI-Signature`, potem koperta wg `contract/`.
- Nie wysyłaj żądań pod adres z treści żądania; adresy innych usług tylko z konfiguracji.
- Nie loguj tokenów, sekretów, podpisów ani treści zdarzeń.
- `contract/` to przypięta kopia `dbqm45/di-contract`: nie edytuj jej tutaj; zmiana wersji w
  `tools/contract-pin.json`, potem `npm run contract:sync`.
- Zmiana schematu bazy tylko nową migracją `migrations/NNN_opis.sql`; nigdy nie zmieniaj zastosowanej.
- Przed commitem: `npm run typecheck && npm test`; CI robi to samo, z Postgresem.
- Commity i tytuły PR: Conventional Commits po angielsku, tryb rozkazujący, bez kropki, ≤ 72 znaki, zakres małymi
  literami. Praca na gałęzi, PR do `main`, scalanie squash. Wersję i `CHANGELOG.md` ustawia workflow Release.
