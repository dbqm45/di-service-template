# Wersje i wydania

Usługa ma jeden numer wersji wg [SemVer 2.0.0](https://semver.org/) w `package.json` i `package-lock.json`. Wydanie
to tag `vX.Y.Z` z GitHub Release, którego treścią jest wpis z `CHANGELOG.md`. Działa tak samo jak w ShipScope.

## Commity: Conventional Commits

Tytuł PR staje się commitem na `main` (scalanie squash) i decyduje o następnej wersji.

| Typ | Kiedy | Wersja (od 1.0.0) | Wersja w 0.y.z |
|---|---|---|---|
| `feat` | nowa funkcja | MINOR | PATCH |
| `fix`, `perf` | poprawka, przyspieszenie | PATCH | PATCH |
| `refactor`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert` | bez zmiany widocznej dla użytkownika | brak | brak |
| `!` po typie albo stopka `BREAKING CHANGE:` | zmiana niezgodna wstecz | MAJOR | MINOR |

Sprawdzenie: CI odrzuca tytuł PR niezgodny z formatem; lokalnie `npm run hooks:install` włącza hook `commit-msg`,
a `npm run lint:commit -- "feat(api): …"` sprawdza jeden tytuł.

## Jak powstaje wydanie

Po każdym scaleniu do `main` workflow Release liczy wersję z commitów od ostatniego tagu, dopisuje wpis do
`CHANGELOG.md`, zapisuje commit `chore(release): X.Y.Z`, uruchamia testy na tym commicie i dopiero wtedy tworzy tag
i GitHub Release. Pierwsza wersja (`0.1.0` z `package.json`, bez tagu) jest wydawana tak, jak jest.

**1.0.0** wydaje się świadomie (`npm run release -- 1.0.0` na gałęzi i PR), gdy ktoś zależy od API usługi. Tag
wydanej wersji nigdy się nie przesuwa ani nie jest używany ponownie.
