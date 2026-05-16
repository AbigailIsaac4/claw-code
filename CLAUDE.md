# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- Keep shared defaults in `.claude.json`; reserve `.claude/settings.local.json` for machine-local overrides.
- Do not overwrite existing `CLAUDE.md` content automatically; update it intentionally when repo workflows change.

## Agent Execution Environment & Rules (For Sub-Agents)
The following rules apply specifically to the LLM agent when it is executing tasks within the `claw-code` session workspaces:

- **NO GLOBAL INSTALLS**: You are running in a restricted sandbox as the `agent` user on Ubuntu with NO sudo privileges. Do NOT use `npm install -g` or system-wide `pip install`.
- **PRE-INSTALLED PACKAGES**: Essential dependencies for daily office tasks have been pre-installed in the user's private environment (via `pip --user` and a user-level `npm` prefix). Do NOT attempt to install them again, just use them directly via `require()` or `import`.
  - **Node.js**: `docx`, `exceljs`, `xlsx`, `pdf-lib`, `papaparse`, `axios`, `cheerio`
  - **Python**: `pandas`, `openpyxl`, `python-docx`, `matplotlib`, `seaborn`, `PyPDF2`, `pdfplumber`, `requests`, `beautifulsoup4`
- **LOCAL INSTALLS ONLY**: If you absolutely must install an unlisted dependency, use local installation only (`npm install package_name` without `-g`, or create a local virtualenv for python).
