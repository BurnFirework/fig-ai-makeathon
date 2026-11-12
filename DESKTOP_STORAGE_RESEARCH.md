# Desktop storage research

This note records the T3 Code storage reference inspected on November 8, 2026. See [Unfold architecture](ARCHITECTURE.md#workspace-storage) for the implementation in this repository. [Pinned T3 Code commit](https://github.com/pingdotgg/t3code/commit/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607)

## T3 Code

T3 Code keeps server data under `~/.t3/userdata/` by default. That directory includes the conversation database, `statev2.sqlite`. Electron uses a separate `<appData>/t3code-v2/` profile. Agent working directories can point to independent project folders. [Desktop state paths](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopStatePaths.ts#L13-L31) · [Server paths](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/config.ts#L139-L175) · [Electron profile resolver](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/desktop/src/app/DesktopUserData.ts#L34-L59)

On first launch with a V1 database, T3 Code opens the source read-only and copies it through SQLite's backup API. It keeps the original database. The recovery guide documents copying `userdata` while the server is stopped. [Database migration](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/apps/server/src/persistence/initializeV2Database.ts#L46-L89) · [Recovery guide](https://github.com/pingdotgg/t3code/blob/d0f1f7200dce1229f75314b3d9eb1d7ac3abb607/docs/user/thread-migration.md#L39-L45)

## How Unfold stores boards

Electron recommends a dedicated subdirectory of `userData` for application files. Unfold uses `workspaces/` for its managed library and recovery copies. A single portable archive carries the board documents and image bytes together. This lets the app open the library automatically and lets users move boards by exporting a copy. [Electron path documentation](https://www.electronjs.org/docs/latest/api/app#appgetpathname) · [Unfold data storage](README.md#data-storage)

The upstream findings come from source and documentation inspection at the pinned revision. They were not tested in a running T3 Code app.
