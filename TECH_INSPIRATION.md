# Technical inspiration

These are the selected technical references for Unfold. tldraw is our canvas foundation; the other projects supply patterns to study. They are not dependencies or plans to fork their complete applications.

This consolidates source inspection from November 7, 2026. Upstream behavior and licensing describe that research snapshot, not a fresh verification. The [README](README.md) describes the implementation; [ARCHITECTURE.md](ARCHITECTURE.md) records the proposed web/Electron implementation.

## T3Code — local subscription-backed agents

Sources: [repository](https://github.com/pingdotgg/t3code), [architecture at the inspected revision](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/AGENTS.md), [desktop manifest](https://github.com/pingdotgg/t3code/blob/09a54f01bc0ae83865347a965ced50f8c8ec2953/apps/desktop/package.json).

T3Code provides a reference for a browser interface talking to a local Node service that controls installed coding-agent CLIs. Its inspected desktop shell uses Electron and supervises a separate backend process.

**Borrow:** use the user's existing provider sign-in; normalize provider output behind adapters; expose run status, cancellation and errors; separate the UI from process supervision. Keep provider credentials out of browser application state.

**Unfold boundary:** use installed Claude Code or Codex for bounded domain requests. Our canvas, branch context and approval model belong to Unfold. A full coding workspace, terminal and repository-management stack would add unrelated scope. Desktop packaging is a separate planned step, not something this reference proves is implemented.

## tldraw — canvas foundation and starter patterns

Sources: [SDK documentation](https://tldraw.dev/), [Branching Chat starter](https://tldraw.dev/starter-kits/branching-chat), [Agent starter](https://tldraw.dev/starter-kits/agent), [inspected template source](https://github.com/tldraw/tldraw/tree/69f43954f15a171b3a6edb45134d27b71560de02/templates).

The React/TypeScript SDK supplies the editor, custom shapes, selection, camera, bindings, store and history. React-rendered custom shapes let us put image, question, proposal and action interfaces directly on the board.

**Branching Chat:** reuse node shape utilities, the node registry, ports, connection geometry, binding cleanup and persistence patterns. Its original combined user/assistant card and generic history traversal do not define Unfold's domain. Keep questions and answers explicit, build branch-specific context, and give synthesis distinct inputs for the two explorations.

**Agent starter:** borrow typed actions, structured context, complete versus partial stream events, and explicit request lifecycle. Its generic drawing converters do not understand Unfold's custom nodes or image semantics. Multiple agent instances are not a coordinator; post-application drawing-diff review is not approval of a proposed shared direction.

**Unfold boundary:** agents propose validated domain changes; application code owns graph mutation. Partial output is activity, not a completed graph update. Cancellation and dependency revisions must prevent late responses from applying to edited or removed context. These are design principles, not a claim that every edge case is already covered.

The starter license and SDK license are separate. Retain `LICENSE.starter.md`; consult [SDK licensing](https://tldraw.dev/community/license) before distributing a build. Do not infer a blanket hackathon exemption.

## dim0 — an agent-aware spatial workspace

Sources: [repository](https://github.com/vcmf/dim0), [board canvas implementation](https://github.com/vcmf/dim0/blob/main/webui/src/features/board/harness/canvas/harness-canvas.tsx), [architecture notes](https://github.com/vcmf/dim0/blob/main/docs/architecture.md).

The inspected main board uses `@canvas-harness/react`, including its canvas/provider/store and persistence integration. The presence of a React Flow dependency elsewhere does not establish that it powers the main canvas. Its broader application includes a Python backend and workspace features beyond our MVP.

**Borrow:** an explicit bridge between agent operations and board mutations; board-aware agent context; editable outputs that remain useful objects in the workspace.

**Unfold boundary:** keep tldraw and our local runtime/storage policy. dim0 is an orchestration and interaction reference, not a reason to introduce another canvas engine or copy its backend. Its architecture notes describe an ongoing transition, so verify a specific source path before adapting a pattern.

## Excalidraw — direct manipulation and approachable tools

Sources: [repository](https://github.com/excalidraw/excalidraw), [React SDK documentation](https://plus.excalidraw.com/docs/sdk), [render extension points](https://plus.excalidraw.com/docs/sdk/excalidraw/api/props/render-props).

Excalidraw is an MIT-licensed editor reference for selection, arrow binding, undo, export and a compact tool surface. Its React integration can render custom embedded content; it is not limited to static drawings.

**Borrow:** predictable canvas interactions, clear selection and editing states, understandable connection behavior, and accessible import/export affordances.

**Unfold boundary:** use the product references in [PRODUCT_INSPIRATION.md](PRODUCT_INSPIRATION.md) for visual direction. Excalidraw's sketch aesthetic is not a requirement. Moving to its editor would still require our domain shapes, branching context and agent lifecycle; it is not a parallel implementation target.
