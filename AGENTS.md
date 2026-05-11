# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Detected stack
- Languages: Rust, TypeScript.
- Frameworks: Next.js (frontend), Axum (backend).

## Verification
- Run Rust verification from repo root: `scripts/fmt.sh --check`; for formatting use `scripts/fmt.sh`. Run Rust clippy/tests from `rust/`: `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`
- Frontend build: `cd frontend && npm run build`

## Repository shape
- `rust/` contains the Rust workspace: `claw` CLI binary + `api-server` web backend.
- `frontend/` contains the Next.js web frontend with chat UI, SSE streaming, and workspace management.
- `scripts/` contains deployment, user initialization, and formatting scripts.

## Working agreement
- Prefer small, reviewable changes and keep generated bootstrap files aligned with actual repo workflows.
- Keep shared defaults in `.Codex.json`; reserve `.Codex/settings.local.json` for machine-local overrides.
- Do not overwrite existing `AGENTS.md` content automatically; update it intentionally when repo workflows change.
