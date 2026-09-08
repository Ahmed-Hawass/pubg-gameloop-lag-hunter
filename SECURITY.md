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

The tool never requests administrator privileges.

### 🪟 Whitelisted Windows panels

The tool opens only:

```text
sysdm.cpl
powercfg.cpl
```

### 🗂️ Safe session deletion

Session deletion validates IDs against path traversal.

Logs rotate after **7 days**.

### 🔄 Updater

The updater reads the public GitHub releases feed over **HTTPS**.

It never downloads or runs anything itself, it links you to the release page.
