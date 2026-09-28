# ADR 0004: macOS Desktop Packaging

## Status

Accepted

## Context

Rekord-Fox is a local-first web application with a React frontend and FastAPI
backend. A macOS desktop build should preserve those boundaries while giving
users a standalone app bundle that starts the local backend automatically.

## Decision

Use Electron as the macOS desktop shell. Build the Vite frontend as static
assets, package the Python backend with PyInstaller, and include both as
Electron resources. The Electron main process starts the backend on a free
`127.0.0.1` port, stores app data in the macOS application support directory,
loads the local backend URL, and terminates the backend when the app quits.

The FastAPI app accepts `/api/*` aliases and can serve the built frontend when
`REKORD_WEB_DIST_DIR` is configured.

## Consequences

Benefits:

- preserves the existing frontend/backend architecture
- avoids provider-specific UI logic
- keeps all media and database files local to the desktop app data directory
- allows the same API surface to serve web and desktop clients

Tradeoffs:

- Electron adds a Node packaging toolchain
- PyInstaller packaging is platform-specific and must be built on macOS for a
  macOS app
- code signing and notarization are still required before distributing outside
  local development
