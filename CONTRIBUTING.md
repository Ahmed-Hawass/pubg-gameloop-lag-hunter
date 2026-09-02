# Contributing 

Thanks for wanting to help.

This project is small on purpose — the codebase should stay readable in one sitting.

## Ground Rules

### 🧠 One brain

All decisions live in `src-tauri/src/engine`.

The UI (`src/`) displays state and sends commands — nothing else.

If you find yourself putting logic in a component, move it to the engine.

### 📏 No fabricated numbers

If it can't be measured honestly, it isn't shown.

A `--` is worth more than a guess.

### 🔒 Read-only on the user's system

The tool never modifies Windows settings.

New "checks" point to the right page; they never flip switches.

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
cd src-tauri && cargo test # the engine test suite — must stay green
npx tsc                    # frontend typecheck — zero errors tolerated
```

---

## Before You Open a PR

Make sure:

* `cargo test` passes (**42+ tests**)
* `npx tsc` is clean
* New user-facing strings exist in **both** locales
* New IPC commands are added to `capabilities/default.json` **only if the UI truly needs them**
