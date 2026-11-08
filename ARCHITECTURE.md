# Shared web and Electron architecture

Status: implemented initial web/macOS version, November 8, 2026. The sections below retain the design contract and reasoning. Current implementation and verification commands are in README.md.

Implementation notes: the browser adapter uses transactional ID/revision comparison to reject stale writers rather than a renewable ownership lease. Archive assets use safe numeric ZIP entry paths with CRC/size verification and byte deduplication; no hash-authenticity claim is made. Native file revisions are session-fenced; recovery is a separate atomically written checkpoint, and Save As works after a failed original save. Packaging currently produces an unsigned local macOS app; public signing/notarization and other-OS distribution are not configured. A static browser runs preview locally; live AI needs the local helper or installed desktop. The independent Sol storage and native reviews found issues that were reproduced, fixed, and rechecked.

## Outcome and scope

One React/tldraw application runs in the browser and in an installed Electron app. Canvas rendering, board actions, agent orchestration, schemas, and portable files share code. Platform adapters own storage, native dialogs, and agent transport.

| Environment | Durable board storage | Moving work between environments | AI execution |
| --- | --- | --- | --- |
| Electron desktop | User-selected `.unfold` workspace file; separate local recovery checkpoint | Open, Save As, export a copy, import boards | Installed provider CLIs through a supervised local Node process |
| Safari or other browser | Application-owned IndexedDB, with migration from current tldraw storage | Download `.unfold` backup; import a selected file locally | Shared preview mode; live providers only through the existing local helper when deliberately running it |

No hosted application backend, account system, hosted board/image storage, or automatic synchronization is introduced. A desktop process is local application code, not a remote service. Web and desktop storage remain independent until the user moves a workspace file between them.

Start with one workspace file containing the whole board library, rather than a file per board or a required folder. Keep the existing board switcher. A workspace can start untitled with local recovery; its first Save opens a native file picker, and subsequent edits autosave to that location. Opening a file makes that file the working workspace. Import adds boards to the current workspace. Export writes a portable copy without changing the working location.

## Current constraints

- `client/App.tsx` currently mounts tldraw with `persistenceKey=catalog.activeId`. `client/boards.ts` stores names, IDs, and selected board in `localStorage` under `unfold-boards-v1`.
- Each board's document and image bytes live in tldraw IndexedDB. The original `unfold-board-v1` key must remain readable.
- `client/StylePicker.tsx` also persists palette, canvas pattern, and canvas tone under `unfold-palette`, `unfold-canvas-pattern`, and `unfold-canvas-tone`. Include appearance metadata in full workspace files/backups. Preserve current appearance on additive board imports; opening/restoring a whole workspace restores its appearance. Treat any first-paint local preference cache as a cache, not a second workspace authority.
- Domain state is nested in `shape.props.node`; custom inspiration images reference `shape.props.node.assetId`. Stock tldraw 5.6.0 file serialization prunes assets by `shape.props.assetId`, so it cannot be used unchanged for our backup format.
- Current image import retains resized JPEGs up to a 1,200px maximum dimension. The archive preserves those stored images; discarded originals cannot be recovered.
- Activity, folded branches, pending requests, retries, and undo history are currently temporary. Keep that policy explicit. Preserve document content, dependency revisions, source links, decisions, completion state, reflections, layout, and selected board. Camera position may be retained as separate per-board view state; it must not trigger whole-file autosaves on every pan.
- There are direct `/api` calls in `client/agentClient.ts`, provider selection in `client/App.tsx`, and configuration loading in `client/unfold.ts`. All belong behind one agent transport.
- The deterministic preview currently lives in `server/agents.ts`; static Safari cannot complete that flow without extracting the preview into shared code.
- The local server assumes a development cwd, `.env`, and `node_modules/.bin/codex`. Packaged desktop discovery must use explicit resource and executable locations instead.

## Usage before implementation details

The user-facing desktop actions are New workspace, Open, Save, Save As, Import boards, and Export backup. Existing new-board and rename actions operate inside the workspace. Cmd/Ctrl+S uses the same save queue as autosave. Safari has the same board UI, Import boards, and Export backup, with no installation or native picker requirement.

Sketch of the application's calling code, not code to paste into the repository:

```ts
const platform = createPlatform()
const workspace = await openWorkspace(platform.storage)
root.render(<App workspace={workspace} agents={platform.agents} />)

const detach = workspace.attachEditor(editor)
await workspace.activateBoard(nextBoardId)

await workspace.importCopy(file) // validate, then add boards
await workspace.exportCopy()     // every board plus image bytes
await workspace.flush()          // same boundary used for switching workspace/quit
```

Select the platform at application startup, rather than testing `window` or importing Electron throughout components. React and `unfold.ts` receive the same domain-facing services in either environment.

## Module ownership and type sketch

Keep the current repository layout. A pnpm workspace or wholesale move into `apps/*` is unnecessary for two build targets.

```text
client/
  App.tsx, unfold.ts, nodes/, connection/  shared application and canvas
  workspace.ts                           catalog, editor binding, save revisions
  platform/
    index.ts                             select browser or desktop capabilities
    browser-storage.ts                   IndexedDB transactions, import/download
    legacy-storage.ts                    one-time current-tldraw migration bridge
    desktop.ts                           typed native bridge adapter
  agentClient.ts                         common agent API and browser HTTP adapter
shared/
  schema.ts, context.ts                   existing domain contracts
  workspace-format.ts                    versioned portable document/archive
  desktop-contract.ts                    fixed serializable IPC schemas
  preview.ts                             deterministic preview without Node imports
server/
  agents.ts, cli.ts                       shared local agent implementation
  runtime.ts                             config, validation, request lifecycle
  index.ts                               existing local HTTP adapter
desktop/
  main.ts, preload.ts                     shell and constrained native API
  workspace-files.ts                     file commits, fingerprints, recovery
  agent-host.ts, agent-entry.ts           supervised local child and message adapter
  protocol.ts                            bundled renderer/assets at unfold://app
```

These are ownership boundaries, not a requirement for a framework of one-line wrappers. Consolidate small implementations where their invariants remain obvious.

```ts
type SaveState =
  | { kind: 'untitled'; recoveryRevision: number | null }
  | { kind: 'dirty' | 'saving'; revision: number }
  | { kind: 'saved'; revision: number; savedAt: number }
  | { kind: 'failed' | 'conflict'; revision: number; message: string }

interface WorkspaceController {
  getSnapshot(): WorkspaceView
  subscribe(listener: () => void): () => void
  attachEditor(editor: Editor): () => void
  activateBoard(id: BoardId): Promise<void>
  createBoard(name: string): Promise<void>
  renameBoard(name: string): void
  importCopy(file: File): Promise<void>
  exportCopy(): Promise<void>
  flush(): Promise<void>
}

interface AgentClient {
  config(): Promise<AgentConfig>
  selectProvider(provider: ProviderId): Promise<AgentConfig>
  run(request: AgentRequest, signal: AbortSignal,
      onActivity: (event: AgentActivity) => void): Promise<AgentResult>
}
```

Derive concrete document types from tldraw snapshots and existing Zod schemas. Brand IDs/revisions only where they prevent mixing different identities. The private storage interface loads validated workspace data, reads asset bytes, and commits a complete revision with an expected prior revision. It does not expose generic paths or filesystem methods to the UI.

The controller owns current edits, inactive board snapshots, asset references, and save scheduling. Each adapter owns durable commits. Electron main alone owns the selected path and its write authority. Scope snapshots, commits, and acknowledgments by a unique workspace-session generation as well as revision. Open/New/Save As drain or invalidate the previous queue before changing handles; reject late messages from an old session. This hides migration, asset hydration, queued saves, import collisions, and platform-specific persistence behind a small application interface.

## One portable workspace format

Use a versioned ZIP container with a `.unfold` extension. Its contents are:

```text
manifest.json              format version, workspace ID, commit ID, catalog, appearance
boards/<board-id>.json      tldraw document/schema plus optional view state
assets/<content-hash>       actual stored image bytes
```

Keep board IDs and per-board record IDs distinct. Normalize asset sources to portable IDs and resolve them through the asset adapter, never persist blob URLs or IndexedDB-only URLs as the sole image representation. Deduplicate identical image bytes. Traverse our nested custom references explicitly, and include every board, including inactive ones.

Use one small browser-compatible ZIP dependency, selected and pinned during implementation. Do not write a ZIP implementation. Avoid recompressing JPEGs or regenerating images during saves. Native reads and IPC payloads have explicit byte limits. Import validates entry counts, total expanded bytes, safe names, duplicates, hashes, schema versions, and all document/asset references before acceptance. Do not extract arbitrary archive paths onto disk. Reject a newer unsupported format without touching current data; migrate older supported formats through explicit version steps, including custom shape migrations.

Export captures one coherent workspace revision. Missing images make export fail with a useful error rather than producing a purportedly complete backup. Import assigns fresh board IDs and fresh asset identities as necessary, rewrites references consistently, and publishes the resulting catalog only after data is committed. Preserve board-internal record IDs when their board isolation makes that safe. Canceled or invalid imports leave existing work unchanged.

## Desktop file saves and recovery

The selected workspace file is the durable working document. Electron IndexedDB is not a second board authority. Keep a clearly labeled recovery checkpoint under the app's user-data directory for untitled work and save failures; it is never silently promoted over an existing file. Atomically replace recovery checkpoints too, recording workspace ID, source-file identity/fingerprint, base commit ID, session, and recovery revision. Match that lineage before offering recovery, rather than treating a later timestamp as proof. Save As updates recovery lineage only after the destination commits successfully.

1. Document/catalog changes allocate a monotonic workspace revision and enter one serialized queue. Start with a short debounce and a bounded maximum wait, so continuous editing cannot postpone every save indefinitely. Keep assets in their original stored bytes.
2. Capture an immutable revision covering catalog, every board, and its image closure. Coalesce queued revisions, but never lose changes from another board. Capture the outgoing editor before board unmount; preserve existing cancellation on board switches.
3. Main validates the sender, workspace handle, request, expected commit ID, and size. Only the native picker grants a working file path; renderer requests use an opaque handle.
4. Compare the file fingerprint with the last accepted checkpoint. A mismatch or deletion stops autosave and offers Reopen or Save As. Do not overwrite an externally changed file silently.
5. Encode/write a temporary sibling file, flush and close it, retain the previous validated checkpoint, and replace the target. Sync the containing directory where supported. Validate platform-specific replacement behavior rather than promising universal power-loss durability.
6. Acknowledge the committed revision. The UI marks that revision saved only after acknowledgment; later edits remain dirty. Recovery-copy success is reported separately from saving the chosen file.

Use one desktop application instance and one editing window initially. Main serializes all writes. This prevents competing Unfold windows, but a fingerprint check does not eliminate a race with unrelated external software. Automatic merging, simultaneous independent writers, and network-filesystem guarantees are outside the initial version.

On workspace replacement or quit, stop new edits, capture the latest snapshot, and await flush before teardown. If saving fails, keep work available and offer Retry, Save As, or Cancel close; discarding is explicit. An edited untitled workspace needs a successful Save As or an explicit Keep recovery and close action that waits for the recovery commit acknowledgment. Canceling its picker leaves the window open. An untouched empty workspace can close immediately. Save on ordinary edits, not just shutdown. After a crash, offer a validated newer recovery checkpoint and explain its relationship to the file. Edits not yet checkpointed can still be lost; do not describe autosave as lossless.

A whole-workspace file rewrites image bytes and needs temporary disk space. That cost is accepted for the initial small vision-board library. A folder becomes a separate future storage decision only if real workspace sizes make this problematic; no size or speed claim has been measured.

## Browser storage and existing-data migration

New browser persistence uses an app-owned IndexedDB repository for the same workspace model. Store catalog, board documents, and asset blobs in separate object stores; commit a coherent revision in one transaction and report success on transaction completion. Reuse unchanged assets. Do not leave both `persistenceKey` and this repository writing normal app data.

The move is needed for complete all-board backups, transactional import, and observable save failures. Current tldraw hydration status is not proof that the latest save flushed.

Migration must first be proven against the installed tldraw version:

1. Inventory `unfold-boards-v1` and every board key, including `unfold-board-v1`.
   Also capture the existing palette, pattern, and tone preferences before publishing the new workspace.
2. Open each legacy board through an isolated tldraw loader using the supported `Tldraw` persistence path. Resolve snapshots and actual custom image bytes through editor APIs. Do not depend on tldraw's private IndexedDB tables or internal write acknowledgments.
3. Require older editing tabs to close before migration; stage a complete validated workspace in the new IndexedDB repository, then commit the migration marker/catalog together. Re-running migration after interruption must not duplicate boards.
4. Keep all legacy storage intact through rollout. Missing data or unreadable images block a false-success migration and provide recovery/export options. Do not initialize an empty replacement over damaged data.

For multiple browser tabs, use an IndexedDB-transactional writer ownership token plus revision checks. Another tab can explain that the workspace is open elsewhere and offer takeover after ownership expires or is explicitly released. Every commit verifies current ownership; BroadcastChannel is notification, not the authority. Preserve the prior committed revision on quota/write failure and keep the current in-memory workspace exportable.

Browser import/export uses a file input and Blob download, including Safari. Native File System Access APIs are not required. Requesting persistent browser storage can reduce eviction risk if granted, but it is not a backup and cannot prevent the user clearing site data. Native/browser workspaces do not synchronize automatically. Optional Chrome/Edge linked-file saving is deferred because desktop file saving and universal backups already satisfy this scope.

## Share agent behavior, adapt transport

Extract common runtime configuration, semantic request validation, timeout/cancellation ownership, and provider selection from the HTTP entrypoint. Both HTTP and desktop messages call the existing `runAgents` and CLI adapters. Preserve branch isolation, source-evidence validation, stale-response guards, temporary-file cleanup, and provider sign-in boundaries.

For desktop, use a supervised Node-capable Electron child. Prefer `utilityProcess.fork` with messages for this small implementation; T3's separate Node-host pattern is the architectural reference, rather than requiring an identical launcher. No desktop HTTP port is needed. Main owns child readiness, bounded startup timeout, exit diagnostics, and stopping. Associate every run/cancel/event with its request ID and workspace session; late events cannot mutate a reopened board. A failed child leaves editing and file saving usable. Never automatically replay an interrupted AI run.

The child reuses `server/agents.ts` and `server/cli.ts`; the renderer has no direct Node or subprocess access. Cancel on request stop, relevant edits/deletions, board/workspace switches, renderer destruction, and app quit. Shutdown must stop owned CLI descendants, with a bounded grace period and forced termination fallback appropriate to each supported OS.

On macOS, Finder-launched apps often have a different PATH from terminal sessions. Adapt bounded shell-environment discovery, explicit executable paths, provider refresh, and useful diagnostics. Use packaged resource paths instead of cwd. Initially discover installed CLIs; if distributing a bundled Codex executable, stage its actual platform binary outside ASAR and verify packaging/license requirements separately. Finding an executable is not proof that authentication or subscription usage works. Keep provider credentials with their CLI; exclude credentials and raw prompts from workspace files and diagnostics.

The browser HTTP adapter keeps the existing localhost development/helper mode. Static browser mode runs the extracted pure preview locally and describes live AI availability honestly; a hosted static page cannot launch a local CLI or safely be assumed able to call the helper. A selected live-provider failure remains an error, never an automatic switch to simulated results. No remote inference gateway is introduced.

## T3 Code ideas to adapt

Inspected snapshot: `09a54f01bc0ae83865347a965ced50f8c8ec2953`. These are observed T3 patterns and proposed Unfold adaptations; T3 does not supply our workspace file implementation.

| Verified T3 source | Adaptation for Unfold |
| --- | --- |
| [Typed preload](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/preload.ts#L77) and [sandboxed window](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/window/DesktopWindow.ts#L411) | Fixed native operations, context isolation, sandbox on, renderer Node integration off, unsubscribe on teardown |
| [IPC validation](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/ipc/DesktopIpc.ts#L214) | Reuse our Zod contracts for runtime payload/result validation; add sender/frame authorization for privileged calls |
| [Web platform composition](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/web/src/connection/platform.ts#L327) | Compose browser/native storage and agent capabilities once at startup |
| [Custom protocol](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/electron/ElectronProtocol.ts#L110) | Serve bundled UI, fonts, sample images, and assets under `unfold://app`; validate host/method/path containment, set restrictive CSP; no dev-server dependency in packaged builds |
| [Backend configuration](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/backend/DesktopBackendConfiguration.ts#L523) and [supervision](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/backend/DesktopBackendManager.ts#L306) | Separate local agent process, explicit readiness and failure, bounded lifecycle; adapt to messages rather than copying their full server setup |
| [Shell environment](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/shell/DesktopShellEnvironment.ts#L416) | Find signed-in user CLIs from a GUI launch without assuming the development PATH |
| [Development user data](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/app/DesktopUserData.ts#L42) and [quit coordination](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/app/DesktopLifecycle.ts#L143) | Separate dev/prod settings and recovery; flush Unfold documents before stopping owned processes and quitting |
| [Preload bundle verification](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/scripts/verify-preload-bundle.mjs#L26) and [bounded logs](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/src/app/DesktopObservability.ts#L39) | Self-contained preload build, focused packaged-app verification, rotating local diagnostics without board content |

Use a narrow bridge, never expose raw `ipcRenderer`, arbitrary filesystem access, or arbitrary shell execution to web content. External source links open in the system browser after HTTP(S) validation; block unexpected renderer navigation/new windows. Dev URLs are permitted only in development. Follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [custom protocol documentation](https://www.electronjs.org/docs/latest/api/protocol). The chosen child API is documented in [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process).

Keep our existing stack instead of copying T3's Effect service framework, relay, accounts, remote environments, SSH/WSL setup, worktrees, or chat event sourcing. Its [MIT license](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/LICENSE) permits reuse with notices. If copying source or substantial portions, record the pinned files and retain T3 Tools' copyright/permission notice in distributed third-party notices. Architectural inspiration and copied source are different obligations.

## Implementation slices and acceptance

Each slice ends with working behavior and focused checks. Keep current browser persistence until its replacement passes migration verification.

| Slice | Concrete deliverable | Smallest relevant verification |
| --- | --- | --- |
| 1. Complete portable data | Versioned workspace format and archive converter, proved against current boards/assets | Two-board round trip with nested custom images, accepted/rejected decisions, sources and reflection; inactive board included; missing/corrupt asset and unsupported-version rejection; prove legacy public extraction works |
| 2. Shared controller and browser | Controlled tldraw stores/asset adapter, app-owned IndexedDB, non-destructive legacy migration, import/export UI, truthful save state | Original-key migration and interrupted retry without duplication; canceled/invalid import preserves existing work; quota error; stale-writer rejection; one actual Safari export/import/reload smoke with images |
| 3. Electron files | Bundled shared UI, restricted preload, native Open/Save/Save As, autosave/recovery, single editing window, shortcuts and quit coordination | Temporary-file failure leaves old file valid; stale acknowledgment/session cannot mark newer work saved; mismatched recovery lineage rejected; external edit stops overwrite; canceled/failed untitled close retains work; unauthorized IPC rejected |
| 4. Shared AI runtime | Transport injection for all config/provider/run calls; local preview; supervised child and packaged CLI discovery | Shared request validation/cancellation checks; child failure preserves canvas; packaged GUI-launch provider discovery; owned subprocesses stop on quit |
| 5. Distributable app | pnpm desktop dev/build/package scripts, pinned supported Electron/tooling, bundled resources and native binary staging if needed | Packaged macOS smoke without Vite/server/node_modules present: create/save/reopen two boards with images, source links, and one targeted live provider run/cancel; production web build still works |

Use Electron Builder for initial packaging, matching T3's tooling family, with a small explicit build for main/preload/agent entry. Keep browser assets reusable; do not ship secrets or development `.env`. An official shared desktop build cannot rely on a user disabling Gatekeeper: plan macOS signing/notarization and Windows signing for the platforms actually distributed. Sign/update distribution is distinct from board storage. Start with macOS; add target-OS file/process/package checks when distributing Windows/Linux rather than claiming support from compilation alone. Automatic update infrastructure is not required for the first build.

Run required `pnpm check`, `pnpm lint`, `pnpm test`, and `pnpm build` after relevant implementation. Use one packaged desktop smoke and one Safari smoke to cover the new platform behavior; broaden only for a concrete failure or a newly supported platform. No unrelated visual/performance/browser matrix is prescribed.

## Design comparison and synthesis

Two independent candidate sketches were reviewed against shared behavior, durable ownership, browser compatibility, native/runtime boundaries, and implementation scope. The skill's external default model families were unavailable; both candidates used the available inherited model. Cross-family judging was skipped; the parent compared both designs and screened the design red flags.

| Criterion, 0–2 | One workspace file | Manifest/documents/assets folder |
| --- | --- | --- |
| Shared UI/domain with bounded adapters | 2 | 2 |
| Clear durable commits and failure ownership | 2 | 2 |
| Browser migration and complete portable restore | 2 | 2 |
| Typed native boundary and packaged CLI lifecycle | 2 | 2 |
| Scope appropriate to this small board app | 2 | 1 |

The file candidate is the base: one portable working file, simpler moving/restoring, and fewer user-managed pieces. Its accepted cost is whole-file replacement. The folder candidate contributed no desktop HTTP listener, explicit flush semantics, and a single commit point; it was rejected as the initial storage shape because immutable document generations, manifest heads, folder locks, and orphan cleanup are unnecessary for the present board scope. Both candidates independently identified browser migration, source-of-truth ownership, and static preview as required work.

Keeping tldraw IndexedDB as a desktop authority and mirroring it to a file was rejected because two durable writers make save status and recovery ambiguous. A generic native filesystem API was rejected because callers would need to coordinate paths, permissions, and commits themselves. Do not split the UI or introduce a full backend framework to implement these adapters.

## Risks and assumptions to carry into implementation

- Complete legacy extraction through the public tldraw path is the first technical gate. If it cannot resolve every image, stop that migration and keep old data readable; do not fall back to private schema assumptions.
- This plan preserves stored images and document decisions. Should original-resolution uploads or activity history become durable requirements, change the data model and format explicitly.
- Whole-file writes, temporary disk space, and uncheckpointed edits are accepted initial limits. No benchmark or crash-durability claim has been made.
- Local files plus browser import/export provide portability, not automatic sync or simultaneous editing.
- Installed CLI sign-in and usage are still required for live AI. A desktop build does not grant provider access or make inference offline.

The first implementation step is the two-board archive round trip and legacy-image extraction fixture. No Electron dependency or live persistence change is needed to prove that data boundary first.

Verification record: implementation checks and platform smoke results are recorded in README.md and the accompanying test scripts. Do not interpret the original planning acceptance table as proof of untested platform or distribution capabilities.
