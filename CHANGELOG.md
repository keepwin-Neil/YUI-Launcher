# Changelog

All notable changes to this project are documented here.

## 0.1.0-beta.1

- Added the custom YUI-style startup console and CONNECT sequence.
- Added automatic fullscreen startup.
- Added a pausable two-minute session timer that relaunches the app on expiry.
- Made the right sidebar and chat panel start collapsed without flashing open.
- Set recognition output to `ERROR` and confidence to `0%`.
- Added an independent launcher data directory so N.E.K.O memory is never
  packaged with or stored under the launcher identity.
- Replaced the developer-specific backend path with automatic discovery and a
  first-run N.E.K.O folder selector.
- Added release documentation, legal notices, privacy verification, and a
  clean GitHub Actions macOS release build.
