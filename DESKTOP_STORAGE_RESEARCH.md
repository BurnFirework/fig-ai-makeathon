# Desktop storage research

Researched November 8, 2026 (America/Los_Angeles). This records the investigation before implementation. The user accepted automatic desktop storage, web Export, and desktop Import plus Export backup. The implementation is documented in [README.md](README.md#data-storage) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Source snapshot

The reference is [pingdotgg/t3code](https://github.com/pingdotgg/t3code), as already recorded in [TECH_INSPIRATION.md](TECH_INSPIRATION.md). GitHub's API resolved `main` to [commit `d0f1f7200dce1229f75314b3d9eb1d7ac3abb607`](https://github.com/pingdotgg/t3code/commit/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607), committed November 9, 2026 at 02:25:03 UTC (November 8 locally). The claims below use files downloaded at that immutable commit. This supersedes the earlier inspiration snapshot for these storage claims only.

## Verified T3 Code implementation

### Two separate storage roots

T3 Code distinguishes its application/server data from its Electron browser profile:

| Purpose | Normal desktop default | Evidence |
| --- | --- | --- |
| Application/server state | `~/.t3/userdata/` | [DesktopStatePaths.ts, lines 13–31](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopStatePaths.ts#L13-L31) |
| Conversation database | `~/.t3/userdata/statev2.sqlite` | [server config.ts, lines 139–175](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/config.ts#L139-L175) |
| Chromium/Electron profile | `<appData>/t3code-v2/` | [DesktopUserData.ts, lines 34–59](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopUserData.ts#L34-L59) |

The desktop computes `appData` as `~/Library/Application Support` on macOS, `%APPDATA%` (falling back to `~/AppData/Roaming`) on Windows, and `$XDG_CONFIG_HOME` or `~/.config` on Linux. Therefore its ordinary macOS profile is `~/Library/Application Support/t3code-v2`, while its conversation database remains under `~/.t3`. [DesktopEnvironment.ts, lines 143–180](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopEnvironment.ts#L143-L180)

Application settings, themes, attachments, logs, secrets, and runtime identity derive from the application data root. Managed worktrees are `<baseDir>/worktrees`; caches are `<baseDir>/caches`. Desktop settings and client settings are also under the server state directory. [Server paths](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/config.ts#L139-L175), [desktop paths](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopEnvironment.ts#L199-L206)

### Creation, overrides, and development isolation

The server creates state, log, attachment, worktree, cache, and configuration-parent directories recursively. SQLite setup also creates the database parent before opening it. These are application-managed paths; this startup code does not ask the user to choose a save location. [Directory initialization](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/config.ts#L177-L208), [SQLite opening](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/persistence/Sqlite.ts#L47-L63)

`T3CODE_HOME` relocates the application root. Desktop development defaults to `~/.t3/dev`; an explicit nonempty `T3CODE_HOME` selects `<override>/userdata`. The server CLI documents `--base-dir` as equivalent to `T3CODE_HOME`. These settings do not feed the Electron profile resolver. [Desktop configuration](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopConfig.ts#L36-L44), [desktop root logic](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopStatePaths.ts#L5-L31), [CLI flag](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/cli/config.ts#L44-L49), [profile resolver](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopUserData.ts#L34-L59)

The development Chromium profile is `t3code-dev`, or the legacy `T3 Code (Dev)` profile when present. Desktop startup explicitly sets Electron's `userData` path. [Profile naming](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopUserData.ts#L42-L59), [startup assignment](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopApp.ts#L323-L326)

### Application state versus project folders

The application state root is distinct from an agent's working directory. The CLI exposes a separate working-directory setting for provider sessions. Workspace path handling accepts a supplied root, expands `~`, resolves it, validates that it is a directory, and optionally creates it. This supports project folders at independent filesystem locations; it does not make each project the owner of the global conversation database. [CLI working directory](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/cli/config.ts#L227-L238), [workspace root validation](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/workspace/WorkspacePaths.ts#L133-L175), [global database derivation](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/config.ts#L139-L161)

### Migration and portability

The V1-to-V2 database migration is a one-time copy: if `statev2.sqlite` does not exist and `state.sqlite` does, T3 opens the source read-only, uses SQLite's backup API into a temporary snapshot, then publishes the complete snapshot without replacing an existing destination. The original database remains intact. [initializeV2Database.ts, lines 46–89](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/persistence/initializeV2Database.ts#L46-L89)

The official migration guide says later changes in either version do not synchronize; settings, attachments, and workspace files remain shared. V2 uses a separate browser profile. It also documents first-launch import of stashed prompts, unsent drafts, layout, and theme, while browser cookies and caches do not carry over. [Migration guide, lines 3–15](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/docs/user/thread-migration.md#L3-L15)

The inspected desktop import implementation reads the newest V1 profile's Local Storage directory, marks completion, and retries on read failure. This is separate from the SQLite migration. Windows also has a separate `Local State` copy for safeStorage keys; it deliberately does not copy locked Chromium databases. [Local Storage importer](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopLegacyLocalStorage.ts#L23-L101), [Windows profile initialization](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopUserData.ts#L58-L96)

The guide explicitly says there is no whole-thread export command. Its recovery procedure is to stop the server and copy `userdata` to a safe location. This is not evidence for a polished general workspace import/export facility. [Recovery guidance, lines 39–45](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/docs/user/thread-migration.md#L39-L45)

## Official Electron guidance

Electron defines `userData` as `appData` plus the application name. Its default parent locations are `%APPDATA%` on Windows, `$XDG_CONFIG_HOME` or `~/.config` on Linux, and `~/Library/Application Support` on macOS. It recommends placing application-specific files inside a subdirectory of `userData` to avoid collisions with Chromium directories. It discourages large files there because some environments back up the directory to cloud storage. [Electron app.getPath](https://www.electronjs.org/docs/latest/api/app#appgetpathname)

Electron's `sessionData` defaults to `userData` and contains localStorage, cookies, caches, and other Chromium data. A custom `app.setPath` directory must already exist, and a custom `sessionData` location must be set before `ready`. This means a design must distinguish durable application data from browser caches rather than assume every item under `userData` is disposable. [Electron path definitions](https://www.electronjs.org/docs/latest/api/app#appgetpathname), [Electron app.setPath](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path)

## Interpretation for Unfold

T3 Code demonstrates that the application can choose and manage its durable storage location automatically while project folders remain separate. Its exact `~/.t3` layout and SQLite/event architecture are product choices, not Electron requirements. The evidence does not require Unfold to adopt SQLite or T3 Code's folder names. An application-managed subdirectory under Electron `userData` is consistent with Electron's own guidance. Decisions about Unfold's canonical workspace, external `.unfold` files, import/export, and migration belong to our product design.

Apple explicitly permits user data managed on the user's behalf in `Application Support`, and distinguishes that directory from regenerable caches. A private dot-directory is possible, but the native macOS Application Support location already serves the intended purpose. [Apple macOS Library Directory Details](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/MacOSXDirectories/MacOSXDirectories.html)

### Current Unfold behavior

Local source inspected at `f1fd701f539d2068aeb0f884540859aa65c88d2c`:

- [Desktop startup](apps/unfold/desktop/main.ts) already stores `workspace-recovery.json` beneath Electron `userData`, isolates development as `Unfold Development`, and supports `UNFOLD_DESKTOP_USER_DATA` for an explicit override.
- [Native persistence](apps/unfold/desktop/workspace-files.ts) writes a versioned `.unfold` archive to a chosen working file and a separate JSON recovery checkpoint containing the archive bytes. It already has serialized writes, atomic replacement, revision/session checks, external-change detection, and a best-effort previous checkpoint.
- [Workspace controller](apps/unfold/client/workspace.ts) treats an unnamed workspace as recovery-only. `prepareClose`, Open, and New invoke Save As when no working filename exists. This directly explains the location-selection friction, even though background recovery already persists edits.
- [Workspace controls](apps/unfold/client/workspace-controls.tsx) and the native File menu expose document operations on the entire board library. Import is additive; export creates a copy. [README](README.md#data-storage) and [ARCHITECTURE.md](ARCHITECTURE.md) explicitly describe this earlier document model.

### Accepted product decision

Use one application-managed board library. On first launch, create it automatically; on later launches, reopen it automatically. Retain the board switcher and New board. Show a quiet Saved on this device status; report a write failure visibly and keep unsaved work available for export. Normal quit flushes pending changes without asking for a filename.

Suggested canonical path: `path.join(app.getPath('userData'), 'workspaces', 'default.unfold')`. For the packaged app named Unfold, the expected macOS location is `~/Library/Application Support/Unfold/workspaces/default.unfold`. Resolve this through Electron rather than hard-coding it, and keep the storage identity stable across releases. Preserve the separate development profile and existing override. This layout is now implemented.

Remove New workspace, Open workspace, Save, and Save As from the normal library workflow. Keep Import boards and Export backup; imports copy content into the managed library and never establish an external live save destination. Cmd/Ctrl+S may simply flush. An optional Show data folder action can provide transparency without making folder selection part of setup. Multiple managed libraries or editable external workspace files would be separate features; neither is necessary to address this request.

Keep the portable archive and native persistence boundary initially. Changing who chooses the destination does not require SQLite. Whole-library rewrites and image copying remain the existing size/cost limitation; this investigation did not measure them. Revisit separate asset files or a database only with evidence that normal libraries require it. Keep recovery/previous checkpoints separate from the canonical file, and do not describe a second copy on the same disk as a complete backup strategy.

### Migration and failure behavior

1. If the managed library exists, validate and load it. A corrupt or unreadable library must lead to recovery options, never a silent empty replacement.
2. If absent, inspect the existing legacy checkpoint and its source-file relationship. The checkpoint may contain newer unsaved work than the external file. Preserve both; resolve conflicting alternatives explicitly instead of picking by timestamp.
3. Copy the accepted validated workspace into the managed location atomically, then confirm it can be decoded before declaring migration complete. Do not delete legacy recovery or alter the external `.unfold` source. Repeated startup must not reimport or replace a library already created successfully.
4. Explain once that subsequent edits save in Unfold and that the old external file remains a copy. Other external workspaces can be imported manually; there is no complete discovery mechanism in the current implementation.
5. With no managed library or legacy data, create a fresh library automatically. Browser IndexedDB remains independent, with explicit import/export for moving boards.

README and ARCHITECTURE now describe this product model. Native/controller tests cover managed creation/relaunch, preserved migration with explicit version choices, failed migration retry, invalid-file recovery, and save failure. The packaged desktop smoke covers the no-picker lifecycle, menu import/export, images after restart, and backup restoration. A focused Chromium smoke covers web export without an Import control. Cross-platform and live-provider checks were not repeated for this storage-only change.

## Verification limits

- Static inspection of the pinned public source and official documentation; no T3 Code installation or platform smoke tests were run.
- Live `main` HTML/search results showed inconsistent cached revisions, so implementation claims use one API-resolved commit and immutable source links instead.
- The renderer-side Local Storage merge and complete migration pipeline were not exhaustively audited. The claims above distinguish the published migration guide from the inspected importer.
- No claim that changing `T3CODE_HOME` automatically moves existing data; the verified code chooses paths. No general export/import audit beyond the documented whole-thread export limitation.
- This research describes the November 8 source snapshot, not every released build or future behavior.
