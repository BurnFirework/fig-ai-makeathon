# Repository instructions

## Hackathon reference

- Read the [Track 1 reference](HACKATHON.md) when making product-scope, interaction, demo or submission decisions. It contains the gathered brief, judging rubric, deliverables and submission requirements.
- Distinguish organizer requirements from our product choices. Preserve the documented verification limits and unresolved deadline timezone; do not assume an ambiguity has been resolved without new source evidence.

## Inspiration references

- For visual hierarchy, canvas composition or tool visibility, read [product inspiration](PRODUCT_INSPIRATION.md).
- For canvas extensions, agent integration or upstream reuse, read [technical inspiration](TECH_INSPIRATION.md). Treat borrowed patterns as references, not additional MVP requirements.

## Architecture

- Share the web and Electron application code. Keep data on the user's device: browser IndexedDB with export/import, and desktop workspace files. Follow the [Electron plan](ARCHITECTURE.md) and [current storage status](README.md#data-storage).
- Keep hosted application backends and hosted persistence services out of scope. Local Node processes may run the AI CLIs; native file access belongs behind the Electron main-process boundary.

## Git workflow

- Work directly on `main` in this repository unless the user explicitly requests another branch.
- Commit completed changes on `main` and push directly to `origin/main` when the user requests a push. This direct-to-main workflow is explicitly authorized by the repository owner.
- Use normal pushes that preserve remote history. Never force-push or bypass branch protections.
