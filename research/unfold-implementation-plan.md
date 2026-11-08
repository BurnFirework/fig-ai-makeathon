# Unfold hackathon MVP: tldraw implementation plan

Source inspection: November 7, 2026. This is a plan, not an implemented or tested application. Project requirements come from `/Users/olegbezr/Downloads/Unfold — концепция хакатона.docx`; the document was read as project context. No application scaffold, dependencies, accounts, or deployments were changed.

Implementation update: the user subsequently supplied `Unfold — концепция хакатона-2.docx` and requested a local subscription-backed CLI setup inspired by T3 Code. The implementation therefore uses a local Node server with Claude Code/Codex adapters instead of the proposed API-key Worker backend. See the repository README for implemented behavior and verification; the original design/source analysis below is retained as planning context.

## Decision

Use **Branching Chat as the canvas foundation**, with a small Unfold-specific agent service informed by **Agent starter patterns**. Do not combine both complete applications or assume that Agent supplies the project’s multi-agent workflow.

Inspecting source rather than the overview materially changes the reuse estimate: Branching Chat has a good interactive graph shell, but its message model and AI request handling need replacement. Agent has useful typed tools, context assembly, request lifecycle and activity-display patterns, but its defaults operate general drawing shapes rather than Unfold’s semantic nodes.

Both templates were inspected at [tldraw commit `69f43954f15a171b3a6edb45134d27b71560de02`](https://github.com/tldraw/tldraw/tree/69f43954f15a171b3a6edb45134d27b71560de02/templates), committed November 7, 2026. Local source downloads were placed under `/tmp` and not executed. Use permalinks below for the inspected behavior; overview pages and main-branch files may differ.

## MVP contract

One board, one demo journey:

1. Import two inspiration images. A star starts an exploration for each image.
2. Each branch asks one useful question at a time. Yes/no and a short comment create a separate answer node and affect the next question or step.
3. Agents clarify necessary time, budget, location or priority constraints without producing a whole plan at once.
4. A research role returns actual opportunities with source links.
5. A connection role consumes results from both branches and proposes one shared opportunity, explaining the benefit to each goal.
6. The user accepts, rejects or refines the proposal. Acceptance creates a shared branch with a small, concrete action and sources.
7. The user can stop, retry, remove an unwanted option, move/collapse branches, and record an action’s outcome/impressions.
8. Editing a goal/answer marks dependent suggestions as needing refresh. Board, images and decisions survive reload.

Suggested demo hypothesis, not a decided target audience: someone exploring a creative practice and a wish for more social connection. The shared opportunity could be a real local beginner workshop, constrained by the user’s actual location, budget and availability. Select the exact pair before prompt/UI work; do not invent current event availability for the demo.

## Branching Chat: what the source actually supplies

Paths below are relative to `templates/branching-chat/` at the inspected commit.

| Source | Observed behavior | Reuse decision |
| --- | --- | --- |
| [`client/App.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/App.tsx) | Registers node/connection shapes, bindings, overlays and a custom port tool. Uses browser persistence with key `workflow`; starts with a message node. | Keep editor wiring and persistence; use an Unfold key, image-oriented empty state and tailored controls. Remove default message seed. |
| [`client/nodes/NodeShapeUtil.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/nodes/NodeShapeUtil.tsx) | HTML node body, geometry and ports. Disables resize/rotation and uses a fixed-width selection indicator. | Keep architecture; adapt geometry and sizing for images and several card types. |
| [`client/nodes/nodeTypes.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/nodes/nodeTypes.tsx), [`types/shared.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/nodes/types/shared.tsx) | Validated node-definition registry, rendering, dimension and port hooks. Only `message` is registered. | Extend to Unfold’s node types. Retain the validator/definition pattern, without copying loose casts into new domain code. |
| [`client/nodes/types/MessageNode.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/nodes/types/MessageNode.tsx) | One node contains both user message and assistant response. Send gathers connected message nodes, reverses their traversal order and streams text into that same node. | Reuse event-handling and text-sizing examples. Replace the combined card, context assembly and request lifecycle. |
| [`client/connection/ConnectionShapeUtil.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/connection/ConnectionShapeUtil.tsx) | Curved SVG connections, draggable ends, interactive cycle prevention, one connection per input port and multiple output connections. Dragging into empty space creates a message node. | Keep rendering/binding interaction; add relation types, approved node creation and domain validation. Opportunity gets two named input ports. |
| [`client/connection/ConnectionBindingUtil.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/connection/ConnectionBindingUtil.tsx) | Connections stay attached; deletion of a bound node deletes its connection. | Reuse. Add semantic invalidation when deleting/reconnecting dependencies; automatic connection cleanup alone does not update decisions. |
| [`client/nodes/nodePorts.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/nodes/nodePorts.tsx) | Cached port/connection queries and a cycle-safe breadth-first traversal returning a set. | Keep queries. Replace prompt ordering with an explicit chronological branch context; reversed breadth-first order is insufficient for merged histories. |
| [`client/ports/PointingPort.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/ports/PointingPort.tsx) | Port drag behavior and click-to-create-next-message. Clicking an already-connected output does nothing. | Keep gesture mechanics; adapt to next-step generation, alternate options and connection proposals. |
| [`client/connection/insertNodeWithinConnection.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/connection/insertNodeWithinConnection.tsx) | Inserts a message and nudges downstream nodes to make room. | Useful layout reference, not a general tree layout engine. Defer arbitrary insertion UI; implement bounded placement of new Unfold nodes. |
| [`client/components/WorkflowToolbar.tsx`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/client/components/WorkflowToolbar.tsx) | Generic drawing toolbar plus message creation and asset item. | Replace with import, select/pan, connect goals and fit-board controls. |
| [`worker/worker.ts`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/branching-chat/worker/worker.ts) | Stateless `/generate` and `/stream` model calls; plain-text streaming. No research tools or role orchestration. | Keep Worker/AI SDK scaffolding; replace payloads and response protocol with validated Unfold requests/results. |

### Specific gaps that affect the build

- **Two-parent opportunities:** retain one connection per input but give the opportunity `goal-a` and `goal-b` ports. This is smaller than changing cardinality throughout `ConnectionShapeUtil`, `PointingPort` and `Port`. Keep historical question/answer links distinct from cross-goal synthesis links.
- **Context:** current traversal only includes message nodes; it does not send inspiration image bytes or understand confirmed goals versus AI assumptions. Build a purpose-specific serializer.
- **Requests:** `MessageNode` does not check `response.ok`, cancel requests, prevent duplicate sends, or reject older results after edits. Its raw-chunk/SSE heuristic is not a reusable structured event protocol.
- **History:** streaming repeatedly updates a persisted node. For Unfold, keep transient progress outside committed domain state and commit a validated result as one user-understandable operation.
- **Configuration:** current source uses `GOOGLE_API_KEY` or `OPENROUTER_API_KEY`; the overview page’s key name differs. The inspected README mentions Durable Objects, but this template’s Worker and Wrangler configuration do not declare that architecture.
- **Template compatibility:** monorepo source declares `tldraw: workspace:*`. Scaffold a standalone supported template and pin its resolved SDK version; do not copy the monorepo package manifest verbatim. The source-inspection commit is evidence, not a claim that it exactly matches the latest published scaffold.

## Agent starter: how to use it

The companion [Agent inspection](./unfold-agent-starter-inspection.md) contains the detailed source audit. Intended reuse is selective:

| Agent facility | Value to Unfold | MVP decision |
| --- | --- | --- |
| Action schemas and action implementations | A clear boundary between a model’s proposal and application code changing the board | Borrow this pattern for a small set of Unfold commands; validate ownership, IDs and revisions before committing. |
| Prompt-part/context assembly | Combine selected goals, user constraints and relevant previous results deliberately | Serialize Unfold semantics directly. Send the source image for visual interpretation; screenshots are optional visual context. |
| Streaming request lifecycle and tool-result followups | Model can request information, receive results and continue | Reuse patterns with the existing AI SDK; define one explicit protocol and bounded role handoffs. |
| Chat/activity history presentation | Show research and connection work, errors, and where results came from | Build a compact activity strip tied to goal/opportunity IDs. Show concise task/result provenance, not hidden chain-of-thought. |
| Multiple-agent registry | Can host multiple agent instances | Does not provide our coordinator, research agent or cross-goal negotiation. Use branch-scoped jobs with distinct role calls. |
| General shape manipulation, drawing, view movement, todo modes | Useful for a general canvas assistant | Defer. Our app decides node placement and permitted changes. |

A full-kit integration is possible later: register Unfold shapes/bindings in one editor; add Unfold prompt parts and action schemas/utils; define a restricted mode; replace the default shape serializer; adapt persistence, cancellation and user-change handling. That is an integration project, not a drop-in addition. The default focused-shape converter represents unrecognized custom shapes as `unknown`, so mounting the Agent UI does not teach it our card contents or relationships.

The current runtime is concrete: [`worker/do/AgentService.ts`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/agent/worker/do/AgentService.ts) exposes Zod-backed native AI SDK tools, streams their arguments, and leaves tool execution to client action utilities. [`client/agent/TldrawAgent.ts`](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/agent/client/agent/TldrawAgent.ts) applies actions and sends results on follow-up requests. This is a useful action loop, but Unfold research should execute server-side. The SDK already used by Branching Chat means we can adopt that distinction without importing all drawing managers.

Two details should not be mistaken for completed Unfold features: the Agent kit’s [accept/reject UI](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/agent/client/components/chat-history/ChatHistoryGroupWithDiff.tsx) reverses/reapplies already-executed drawing diffs; our opportunity acceptance is a separate domain decision. Its [user-action tracker](https://github.com/tldraw/tldraw/blob/69f43954f15a171b3a6edb45134d27b71560de02/templates/agent/client/agent/managers/AgentUserActionTracker.ts) supplies changes to later prompts; it does not invalidate dependent results. Client cancellation also does not establish reliable cancellation of provider/tool work in the inspected implementation.

## Proposed implementation architecture

### State and canvas

For this single-board MVP, keep **committed semantic data in validated custom shape props**, with meaningful relation metadata on connections. Use the tldraw document as the single persisted source; derive prompt context and graph indexes from it. Avoid maintaining a second mutable graph that must be synchronized with undo/redo and deletion.

- `inspiration`: managed image asset reference, user-confirmed goal, constraints, separately labeled AI assumptions, branch ID and semantic revision.
- `question`: text, question purpose and answer options.
- `answer`: selected option/comment, referenced question and sequence order.
- `opportunity`: two source branches, source revisions, benefit to each, evidence, and proposed/accepted/rejected/stale status.
- `action`: small practical step, source references and completion/impressions.

Use discriminated schemas for node/result variants. Reuse shape IDs as domain references where possible. Derived artifacts record the input revisions used to generate them. Branch membership and derivation links are distinct from visual grouping.

Keep requests, abort controllers and partial text in a transient job map. Reload restores committed nodes; it does not pretend that an interrupted network request is still running. Image import uses the SDK asset pipeline and creates a port-bearing inspiration node; a normal image alone is not compatible with the starter’s node-only port helpers. Send actual image content/resolvable data to the backend, not browser-only blob URLs.

### Agent execution

Use a small application coordinator, with separate role prompts and model calls where work is independent:

1. **Branch role:** consume one image, confirmed intent, constraints and ordered answers; return the nearest useful question, a research request or a small action proposal.
2. **Research role:** receive a concrete brief; execute a server-side search/retrieval tool and return candidates with source IDs, URLs and supporting facts. Treat fetched text as evidence rather than instructions. Model text alone does not establish that a source was visited or an event is available.
3. **Connection role:** consume both branch summaries plus research results; propose one opportunity, benefits to both goals and unresolved constraints. It may request one focused follow-up search.
4. **Coordinator:** route those requests/results and enforce a small handoff/call budget. It need not be another LLM. Pause for the user at consequential choices.

Both branch agents may use the same model with distinct context. Make their information exchange real: record the branch outputs and research result IDs consumed by the connection role. Display those handoffs in the activity UI.

Model output proposes semantic operations such as `askQuestion`, `requestResearch`, `proposeOpportunity` and `suggestAction`. Application code creates shapes, positions them and changes decisions. Accept/reject, user answers, deletion and completion are user commands, not unrestricted model actions.

Use validated requests/results with request ID, branch IDs and input revisions. Before applying a result, verify the request is current, referenced nodes exist and revisions still match. Stop aborts the browser request and propagates cancellation server-side where supported; obsolete results must still be rejected even if upstream cancellation fails. Retry is explicit and does not duplicate already committed nodes.

### Planned code ownership

These are proposed modules, not existing files. Keep the starter’s canvas machinery and add only the product boundaries required by the journey.

| Location | Responsibility |
| --- | --- |
| `shared/unfoldSchemas.ts` | Node/result/request schemas, role outputs, source references and revision dependencies. |
| `client/nodes/types/` | Inspiration, Question, Answer, Opportunity and Action definitions using the starter’s registry. |
| `client/unfold/readContext.ts` | Derive ordered branch facts and explicit two-goal synthesis context from document records. |
| `client/unfold/applyCommand.ts` | Validate semantic commands against current document state, then commit nodes/connections/decisions together. |
| `client/unfold/branchOperations.ts` | Membership, visibility, movement and dependency invalidation. |
| `client/unfold/placeNodes.ts` | Incremental placement using measured bounds; preserve user positioning. |
| `client/unfold/jobs.ts` | Active request IDs/revisions, cancellation, supersession, progress and retry. No second persisted domain graph. |
| `client/components/AgentActivity.tsx` | Concise role status and actual task/result handoffs linked to relevant cards. |
| `worker/unfold/coordinator.ts` | Route bounded branch/research/connection work; enforce role capabilities and request schemas on the server. |
| `worker/unfold/roles.ts` | Role-specific prompts and output schemas using one model configuration. |
| `worker/unfold/research.ts` | Search/retrieval adapter, source records and explicit failures. |

Keep one provider configuration and one stream protocol. The proposed module boundaries may be combined where a separate file would add indirection without independent behavior.

### Layout, branching and persistence

- Two image roots occupy separate lanes. Add each next node below its parent using measured card bounds and a small collision check. Place shared opportunities between the lanes. Do not globally re-layout user-arranged cards after every response.
- Keep the starter’s connection rendering and interactive cycle check, plus command-boundary graph checks for programmatic writes.
- Moving a branch moves its owned nodes. Shared nodes remain independent. Collapse changes visibility, not underlying data or prompt meaning; shared opportunities stay reachable from the other visible source, using a compact source anchor when necessary.
- Start with browser persistence for board, assets and decisions. Clearly distinguish this from cross-device sharing. Add a portable board export/import only if required for judging handoff; cloud sync is outside the initial slice.
- Semantic goal/answer edits bump revisions and mark derived/shared results stale. Moving, panning or collapsing does not. Refresh on request rather than silently discarding accepted decisions.

## Build sequence and acceptance checkpoints

Each phase ends in a working vertical slice. Establish the two-image journey before optional general canvas-agent behavior.

| Phase | Deliverable | Reused foundation | Acceptance checkpoint |
| --- | --- | --- | --- |
| 0. Compatible scaffold | Standalone Branching Chat app, pinned SDK, chosen model/provider, local dev and preview build | Vite/Worker setup | Resolve workspace dependencies and actual env names; smoke one request; confirm deployment configuration and trial-key path. |
| 1. Board and image roots | Import two images; move, select and reload them; star creates the initial branch | Editor, persistence, node registry, assets | Images remain attached to the right roots after reload; star does not create duplicate jobs. |
| 2. One complete branch | Question → separate answer → context-sensitive next question/action; stop/retry | Node/connection primitives and input event handling | A budget/time comment changes the next result; one step is generated at a time. |
| 3. Research with evidence | Branch hands a brief to research; sourced opportunity/action appears | Worker and AI SDK; Agent tool/context patterns | Links originate in search results; failure is visible and retryable; unsupported claims are not presented as verified. |
| 4. Two-branch synthesis | Independent branch results feed connection role; one proposed opportunity with two inputs; accept/reject/refine | Port/binding system, two named inputs | Both benefits are visible; accepted proposal creates shared action; rejected proposal does not continue. Manual connect asks for synthesis rather than merging histories blindly. |
| 5. User control and durability | Collapse/move, remove option, edit and refresh stale results, record impressions, reload decisions | Editor history/persistence and graph queries | Collapse/move one branch preserves the shared opportunity and the other branch; old in-flight responses cannot overwrite an edited goal. |
| 6. Demo finish | Unfold visual treatment, concise status/provenance, empty/loading/error states and reliable seeded reset | Editor UI overrides | Run the exact two-image journey on the judging deployment, including user correction and one actual agent handoff. |

Phases are sequencing units, not measured duration estimates. Work can overlap on card styling and Worker behavior once shared node/result schemas are agreed. Do not have concurrent implementations invent separate graph or command formats.

## Focused verification when implementation starts

Required build/type checks from the scaffold, plus focused behavior tests for:

1. Context order and isolation: branch A never accidentally inherits branch B’s unrelated answers; synthesis deliberately includes both sources.
2. Result application: an edited/deleted source, cancellation, or superseding request prevents a late response from being committed; retries do not duplicate nodes.
3. Shared graph behavior: two-parent opportunity, collapse/move ownership, invalidation of both-source dependencies and accepted/rejected state transitions.
4. One browser smoke journey: import two images → star → answer/comment → research → shared proposal → accept → action → reload. Include typing-versus-dragging and image persistence in that same journey.

Use a deterministic provider fixture for repeatable lifecycle tests; separately verify one real model/search handoff on the demo deployment. No broad cross-browser/performance suite is justified by this MVP. Starter source was inspected, not installed or run, so these checks have not yet occurred.

## Deliberately deferred

Multiplayer/accounts, a general autonomous drawing assistant, arbitrary model-driven movement/deletion, broad agent negotiation, a global graph-layout engine, external calendar/purchase actions and cross-device sync. All can distract from the agreed two-image-to-first-action journey.

## Outstanding product choices

Pick the exact target user/two-image demo pair; choose a model and real search provider available to the team; decide whether judges need a shared saved board or can start the demo themselves. Recommended autonomy default: perform bounded research/synthesis after an explicit start, wait for answers and proposal acceptance, and never execute the real-world action automatically.
