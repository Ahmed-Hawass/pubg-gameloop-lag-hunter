# Security Policy

## Reporting a vulnerability

Found something that shouldn't be possible? Email **ahmedmahmoud7awass@gmail.com** (or open a private security advisory on GitHub). Please include:

- What you can do and what you expected
- Steps to reproduce
- The log file from `%LOCALAPPDATA%\LagHunter\logs` if relevant

We respond within 72 hours.

## Scope

- The tool runs as a normal user — it never requests administrator privileges.
- It opens only whitelisted Windows panels (`sysdm.cpl`, `powercfg.cpl`).
- Session deletion validates IDs against path traversal; the logs rotate after 7 days.
- The updater reads the public GitHub releases feed over HTTPS and never downloads or runs anything itself — it links you to the release page.
