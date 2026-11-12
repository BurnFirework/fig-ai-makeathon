# Unfold architecture

The browser and Electron builds share the React and tldraw application in `apps/unfold`. The static landing page lives in `apps/landing`. The repository root owns the pnpm workspace and build scripts.

## Code map

Paths are relative to `apps/unfold`.

| Path | Owns |
| --- | --- |
| `client/App.tsx`, `client/unfold.ts`, `client/nodes/`, `client/connection/` | Board UI, canvas interactions, and application of agent results |
| `client/workspace-bootstrap.tsx`, `client/workspace.ts` | Workspace loading, board switching, and save coordination |
| `client/platform/browser-storage.ts` | Browser IndexedDB storage |
| `client/agentClient.ts` | Preview, local HTTP, and Electron agent transport |
| `shared/schema.ts`, `shared/coordinator.ts`, `shared/board-edits.ts` | Domain contracts, task routing, and board edit validation |
| `shared/workspace-format.ts`, `shared/desktop-contract.ts` | Portable archive and native bridge contracts |
| `server/index.ts`, `server/runtime.ts`, `server/cli.ts` | Local HTTP API, request lifecycle, and provider CLI adapters |
| `server/explore-cards.ts`, `server/explore-tools.ts` | Per-card research and Composio session calls |
| `desktop/main.ts`, `desktop/preload.ts`, `desktop/workspace-files.ts` | Electron shell, native bridge, dialogs, and file persistence |
| `desktop/agent-host.ts`, `desktop/agent-entry.ts` | Supervision and messaging for the desktop agent process |

## Workspace storage

The workspace holds the board catalog, active board, canvas appearance, board documents, and image assets. The portable `.unfold` ZIP stores a manifest, board documents, and image bytes. The reader validates entry names, contents, and size limits. See [workspace-format.ts](apps/unfold/shared/workspace-format.ts).

The browser saves to an application-owned IndexedDB database. Each write checks the stored revision so a stale tab cannot overwrite newer work. On first load, the app can copy legacy boards through tldraw's public loading API. The legacy databases remain available.

Electron keeps one managed library at `userData/workspaces/default.unfold`. It serializes writes and atomically replaces the library. A fingerprint check detects external changes. If the saved library and the recovery checkpoint disagree, the app asks which version to use and preserves the other copy. The same recovery flow handles legacy workspace data. See [workspace-files.ts](apps/unfold/desktop/workspace-files.ts) and [desktop storage research](DESKTOP_STORAGE_RESEARCH.md).

The renderer requests file operations through the preload bridge. Electron's main process owns native dialogs and file access. Desktop import adds boards to the managed library. A restore can replace the managed library when startup recovery is required. Export writes a portable copy.

## Agent runtime

The hosted browser app runs deterministic preview conversations in the browser. The local web build uses same-origin HTTP routes served by or proxied to the loopback Node server. Electron calls the same runtime through a supervised utility process so agent failure leaves file saving available.

The runtime validates requests and launches short-lived Codex or Claude Code processes using the user's existing CLI sign-in. Claude's built-in tools are limited to web search and fetch for research calls. Codex uses a read-only sandbox with shell tools disabled. Request cancellation propagates to the local process. Model input goes to the chosen provider, and research queries go to the relevant tool service.

The coordinator dispatches typed tasks and streams activity separately from complete results. Board edits pass through application validation before they apply. The app checks the revisions the agent read and discards replies for changed sources or a board the user has left.

Explore gives each selected card a research task with board context. The runtime uses Parallel, CLI web search, and Composio session tools. Composio uses a bundled, shared demo key with a limited balance by default and accepts an environment override. The local runtime limits dynamic discovery to read-only tools. It checks sources for concrete claims before publishing findings.
