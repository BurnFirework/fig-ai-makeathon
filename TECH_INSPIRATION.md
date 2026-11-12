# Technical inspiration

These notes reflect the upstream sources inspected on November 7, 2026. For the code in this repository, see [Unfold architecture](ARCHITECTURE.md).

- **T3 Code** shows how a local service can run a user's signed-in CLI and stream events to a browser or Electron app. Unfold applies that pattern to bounded requests about board content. [T3 Code source at the inspected revision](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/AGENTS.md) · [Desktop storage research](DESKTOP_STORAGE_RESEARCH.md)
- **tldraw** provides the editor, custom shapes, bindings, and history. Unfold reuses nodes and ports from the Branching Chat template and borrows typed actions and streamed activity from the Agent starter. Unfold validates board edits before applying them. The starter and SDK have separate licenses. [Pinned template source](https://github.com/tldraw/tldraw/tree/69f43954f15a171b3a6edb45134d27b71560de02/templates) · [Starter license](LICENSE.starter.md) · [SDK license](https://tldraw.dev/community/license)
- **dim0** is a reference for board-aware agent context and editable output on the canvas. Its inspected board uses `@canvas-harness/react`. [Board canvas source](https://github.com/vcmf/dim0/blob/main/webui/src/features/board/harness/canvas/harness-canvas.tsx)
- **Excalidraw** is a reference for selection, arrow binding, undo, export, and a compact toolbar. [Excalidraw source](https://github.com/excalidraw/excalidraw) · [React integration](https://plus.excalidraw.com/docs/sdk)
