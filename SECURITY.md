# Security Policy

## Reporting a Vulnerability

Found something that shouldn't be possible?

Please email **[ahmedmahmoud7awass@gmail.com](mailto:ahmedmahmoud7awass@gmail.com)** or open a private security advisory on GitHub.

When reporting a vulnerability, please include:

* **What you can do** and what you expected to happen
* **Steps to reproduce**
* The log file from `%LOCALAPPDATA%\LagHunter\logs\`, if relevant

We aim to respond within **72 hours**.

---

## Scope

### 👤 Runs as a normal user

The tool runs as a normal user and never requires running the app itself as administrator. Specific writes that Windows restricts (power plan switch, page file settings, storage cleanup of protected locations) use a same-binary elevated helper (`--laghunter-elevated`) with a whitelisted action id per operation and one UAC prompt per action. Refusing the prompt rolls back quietly with no change applied.

### 🪟 Whitelisted Windows panels

The tool opens only:

```text
powercfg.cpl (power plan)
sysdm.cpl,,3 (system performance)
ms-settings:gaming-gamedvr via explorer.exe (background recording)
```

### 🗂️ Safe session deletion

Session deletion validates IDs against path traversal.

Logs rotate after **7 days**.

### 🔄 Updater

The updater reads the public GitHub releases feed over **HTTPS**.

It downloads the release exe only to a location you choose in a save dialog, verifies it against `SHA256SUMS.txt` (64 hex chars, exact asset-name match) before writing, and never auto-installs, replaces itself, or restarts. Integrity is hash-based only (no code signature or TUF): if release assets are compromised, the hash check passes with them, so this is an accepted risk documented here. It never runs the downloaded file itself, it offers to open its folder.
