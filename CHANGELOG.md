# Changelog

All notable changes to this project are documented here.

## 0.2.0-beta.1

- Imported the local camera-enabled launcher, including its startup console and HUD.
- Added the isolated Python vision service for OpenSeeFace face tracking and
  MediaPipe pose and hand gesture recognition on loopback port 48913.
- Added camera enable/disable, preview visibility, and AI Scan controls.
- Packaged only the vision service source and requirements; Python environments,
  model downloads, camera recordings, and personal runtime data remain local.
- This camera snapshot uses NEKO_PROJECT_DIR (default: ~/Projects/N.E.K.O) and
  NEKO_VISION_PYTHON rather than the previous release's folder selector.

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
