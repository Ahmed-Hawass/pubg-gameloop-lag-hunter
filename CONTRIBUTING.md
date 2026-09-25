# Contributing 

Thanks for wanting to help.

This project is small on purpose, the codebase should stay readable in one sitting.

## Ground Rules

### 🧠 One brain

All decisions live in `src-tauri/src/engine`.

The UI (`src/`) displays state and sends commands, nothing else.

If you find yourself putting logic in a component, move it to the engine.

### 📏 No fabricated numbers

If it can't be measured honestly, it isn't shown.

A `--` is worth more than a guess.

### Changes only by the user's hand

Monitoring and diagnosis never modify Windows settings.

New rows mirror the live state, write explicitly in both directions, verify by re-read, and log. New health cards point at the fix; they never flip switches themselves.

### 🌍 Localization

Every user-facing string lives in:

```text
src/locales/en.ts
src/locales/ar.ts
```

The backend sends machine keys; the UI translates.

**Never hardcode text in a component.**

### 📦 Bounded resources

Anything that samples, caches, or stores must have a cap.

---

## Development

```bash
npx tauri dev              # dev mode
cd src-tauri && cargo test # the engine test suite, must stay green
npm test                   # frontend unit tests (Vitest)
npx tsc                    # frontend typecheck, zero errors tolerated
```

---

## Before You Open a PR

Make sure:

* CI passes, it runs the same things on `windows-latest`: vitest, the frontend
  build (which type-checks the locale bond: `ar.ts` must match `en.ts`
  key-for-key), engine tests, and clippy with `-D warnings`
* New user-facing strings exist in **both** locales (the build enforces this,
  but the copy itself is on you)
* Slow IPC commands are `async` and park blocking work on
  `spawn_blocking`, sync commands run on the IPC dispatcher thread and one
  slow command freezes the window (the original "Not Responding" bug)
* New engine operations log what happened: spawn results, durations
  (`logging::timed`), failures, the log is how we diagnose user machines
* New IPC commands are added to `capabilities/default.json` **only if the UI truly needs them**

## Testing Contract

Every user-facing behavior ships with its test, at the same level as the
existing suite (`src/tests`, run with `npm test -- --coverage`):

* Pure logic: unit test (`errors.test.ts` pattern).
* Component behavior: component test with a mocked `bridge` (`toolsGaming.test.tsx`
  pattern, fixtures in `tests/fixtures.ts`).
* Rust: unit test inside the module (`#[cfg(test)]`).
* Critical contracts (silent UAC refusal, one modal surface, deep-links,
  once-ever advice) get a test named after the contract.
* Coverage thresholds in `vite.config.ts` fail the suite on any drop:
  grow them, never lower them to make a PR pass.
* Deliberately manual (never mocked as covered): real UAC prompts, the real
  backend, and visual appearance. A PR touching those lists its manual
  checklist instead of claiming coverage.
* Stopping line (documented, not accidental): static one-shot screens such
  as `WelcomeView` and pure display branches carry no tests; everything
  behavioral does.
