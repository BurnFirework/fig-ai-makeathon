# Unfold

A vision board that grows into a practical first step: images → attached conversations → meaningful outcomes → a sourced first step, all on one canvas. Built with React, TypeScript and tldraw, using the official Branching Chat template's node, port and binding foundation.

For the hackathon brief, judging rubric, submission checklist and open organizer questions, read the [Track 1 reference](HACKATHON.md). It separates organizer requirements from Unfold's product decisions and records the source links and verification limits.

## Run locally

Requires Node 22.14+ and pnpm 10.33.1 (pinned in `package.json`).

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. The frontend proxies to the local agent server on port 3001. The server intentionally listens on loopback only.

## Bring your own subscription

No API key is required. Unfold launches **Claude Code** or **Codex CLI** on the same computer as its server, using the CLI's existing sign-in. It does not extract, copy or send login tokens to the browser. Provider subscription limits and CLI availability still apply.

- **Codex:** the official CLI is a project dependency. Run `pnpm exec codex login` if needed; verify with `pnpm exec codex login status`.
- **Claude Code:** install the official CLI using [Anthropic's instructions](https://code.claude.com/docs/en/overview), run `claude auth login`, and make `claude` available on the server's PATH.
- Choose a provider in **Board settings**. Automatic startup prefers an installed Claude CLI, then Codex. A CLI that is installed but signed out is listed as unavailable with the command to sign in. If neither CLI works, the app uses clearly labeled preview agents. A live authentication or search failure is shown as an error, never silently replaced with sample research.
- Provider status checks establish that the binary works, not that subscription usage is available. The first real request verifies authentication and model access.

Optional server configuration: copy `.env.example` to `.env`, set `UNFOLD_PROVIDER=claude`, `codex`, `auto` or `demo`, and restart. `UNFOLD_CLAUDE_BIN` / `UNFOLD_CODEX_BIN` accept executable paths, not shell commands. `UNFOLD_MODEL` overrides the CLI's default model.

The provider pattern is inspired by [T3 Code](https://github.com/pingdotgg/t3code): local server, installed agent runtimes, existing provider authentication and normalized events. This MVP uses short-lived `claude -p` / `codex exec` processes rather than T3's full persistent session infrastructure.

## Try the journey

1. Add PNG/JPEG/WebP images, or load the sample illustrations.
2. Edit an inspiration's title to describe your goal, then choose **Explore** to open its attached chat.
3. The default **Focus** view shows the source content above the conversation. Switch to **Board & chat** to browse the same canvas alongside the chat. Switching views preserves the conversation and unsent draft.
4. Answer suggestions or type freely. **New conversation** in the chat opens a separate, empty exploration: start with your own request, such as “Make a moodboard using the materials photo,” or choose **Suggest directions** to let the agents begin. Use **Add card** in the chat to share the same conversation with another card.
5. **What the agents know** (above the messages) shows the conversation's memory: confirmed intentions and conditions, AI assumptions kept apart, declined ideas and a history of changes. Each item links to the message it came from. Questions and unsure replies are not saved as facts. A correction such as “now the budget is $30 instead of $100” replaces the active condition and keeps the old one as history; proposals that relied on the old value must be updated before they can be added. Existing cards retain their content without stale badges.
6. A request to create a note or moodboard produces a proposal; choose **Add to canvas** to create it and its links. The agent can ask for more detail first. Dashed links mark reused references. One Undo reverses the card and link edits in a turn. For a sourced next step, choose **Add to canvas**.
7. **Links between goals.** Once each of two inspirations has a clear intention in its own chat (a confirmed answer or condition), the board quietly checks whether they share something useful, a few seconds after your last change. It never interrupts: the open chat stays open, the camera stays put, and nothing is drawn on the canvas. If there is no useful overlap, nothing appears. If there is, a small link entry appears under both cards (for example *Link · decide* or *Link ready*); open it to see the shared conversation. There the agents' progress reads as short states: overlap found, checking both goals, researching a real option, conflict found, your decision needed, proposal ready. Expand *How the agents got here* for each handoff.
   When a confirmed condition blocks the idea, for example a real class costs more than your budget, the agents ask you instead of choosing for you. You see which condition blocks it, what the checks and research found (with sources) and what each answer would change. Your answer updates that conversation's conditions and steers the next search. **Connect goals** (or selecting two nodes from different inspirations) runs the same coordination on demand. Then decide: **Accept** creates one shared card linked to both sources and keeps the research sources (a later accepted revision updates that same card), **Refine** sends your comment for a revised version that needs a new decision, and **Decline** records an optional reason; agents won't develop it or suggest it again without saying what changed. Removing a card does not decline the idea. Opening the accepted card proposes a concrete first step, starting from the sources found while connecting the goals.
8. Under each reply, **How the agents got here** lists the real task requests and results behind it: who asked for work, what had to be checked, what came back and how it shaped the reply. **Agent activity** shows the same handoffs for the board. Stop and retry controls appear in the chat while work runs or after an error.

Use the board name menu to create, switch or rename mood boards. Each board keeps its own canvas, images and conversations on this device. Switching boards stops its running requests. **Style** (the color dot in the header) picks the main color (lavender, rose or sage), the canvas pattern (dots, grid, lined, gingham or plain) and the canvas color; the choice is saved with the workspace and travels with exports.

Older question and answer cards are folded into an **Earlier exploration** chat. Embedded chats migrate into separate conversation records in the same local board document. Their messages, decisions, IDs and source references travel with backups. Editing a source invalidates dependent proposals; subsequent exploration uses the revised source and conditions.

## Explore board

Open **Explore board** to investigate your cards. Every meaningful card starts selected, including notes, previous findings and generated ideas; there is no four-card selection cap. Uncheck cards to narrow a run, including down to one. Each row shows the search scope. **Edit** opens its phrase, city, schedule, dates, budget or remote region. Confirmed conversation conditions constrain the search; preferences rank options rather than becoming hard requirements. Choose **Find options**.

Each selected card has its own investigation owner. It receives a snapshot of the whole board, images, conversations and relationships, chooses research tools and develops that card independently. Results arrive and save per card while other investigations continue. Useful suggestions, plans, questions and comparisons can become nearby cards; external factual claims require fetched primary evidence and a final support check. Expand **Source evidence** on a generated card to read its citations and quotations.

Concrete options still use the primary-page verifier. City, day, time, price and other approved conditions must hold for the same option on its organizer, venue, employer or applicant-tracking page. Search snippets, calendars and listing pages only lead to those pages. Unknown facts remain incomplete; contradicted conditions are rejected. A published schedule does not establish seats or checkout availability. The investigation cannot replace verified wording, prices or dates with its own claims.

The results panel shows additions, existing results or an actionable empty/error outcome. **Card outcomes** and **Agent activity** disclose individual results and progress. Failed cards can be retried; corrected inherited scope is refreshed while explicit scope edits are preserved. **Stop** retains already saved results and prevents late replies from adding cards. Source changes invalidate replies based on the earlier snapshot. Dependencies record the cards and conversation conditions actually used. Rerunning preserves dismissed findings and earlier check dates for options not checked again. Identical generated ideas are reused with refreshed provenance; materially different variants remain separate. There is no mandatory synthesis. A supported common option may offer an optional shared step, created only after **Add to board**.

Live independent exploration requires a signed-in Claude Code or Codex CLI and the local runtime; static preview does not simulate live research. Public web search and page reading use Parallel's public MCP endpoint without an application key, with the signed-in CLI's web search as a search fallback. Optional dynamic research tools use a Composio session: set `COMPOSIO_API_KEY` in the ignored `.env` file (or export it for Electron). The [key permissions](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions) must include **Session management Read/Write** and **Session tool execution Write** permissions. `COMPOSIO_USER_ID` optionally identifies the connection owner; its default is `unfold-explore`. Discovery is scoped to read-only tools, with create/update/destructive tools, proxy execution and workbench disabled. Tools are discovered for the task, their input schemas are checked before execution, and account selection/connection links are surfaced when needed. Connection failures remain visible while other available research can continue. Explore does not authorize purchases, applications, messages or changes to external records.

Browser regression tests use explicitly simulated agent responses to cover streaming additions, stop/late-response protection, source edits and refreshed retry, single-card runs, more than four independent owners, generated-card eligibility, per-owner result counts, and persistence. These tests do not establish live model or authenticated Composio execution. Primary-page verifier tests separately exercise evidence and condition checks.

## Data storage

The web and Electron desktop app share the same React/tldraw interface and board logic. Data stays on your device. There is no hosted board backend, account system, or automatic cloud sync.

- **Browser:** boards, images, attached conversations, decisions, source links, and reflections save in IndexedDB. Existing tldraw boards are migrated through the editor's public loading path; their original databases and catalog are retained. A stale tab cannot overwrite a newer committed workspace.
- **Desktop:** Unfold creates and reopens one local board library automatically. Edits autosave without a location picker, and quitting waits for pending saves. The packaged macOS app stores the library at `~/Library/Application Support/Unfold/workspaces/default.unfold`, resolved through Electron’s `userData` path. **Board menu → Show data folder** reveals the location. Development uses a separate `Unfold Development` profile; `UNFOLD_DESKTOP_USER_DATA` overrides the profile for isolated runs.

Browser saves flush when the page is backgrounded; leaving with pending or failed saves triggers the browser's unsaved-changes warning. Browser/OS termination can still interrupt asynchronous IndexedDB writes.

Both web and desktop bundle the SDK's fonts, icons, and translations instead of requiring its asset CDN.

- **Web → desktop:** **Board menu → Export** downloads a `.unfold` ZIP containing every board and its stored image bytes. Desktop’s **Board menu → Import** copies those boards into its library without replacing existing boards or changing the imported file. Web exposes Export only; Safari uses an ordinary download.
- **Desktop backups and recovery:** **Board menu → Export backup** creates a portable copy without changing where edits save. The app also keeps a local recovery checkpoint and a best-effort previous revision, which are not substitutes for a backup on another device. Save failures keep edits available for export and offer Retry save. Differing saved/recovery versions require a choice; damaged libraries offer backup restoration and access to the data folder instead of silently creating empty boards.
- **Existing desktop data:** the previous `workspace-recovery.json` is migrated into the managed library once. If it differs from its original `.unfold` file, Unfold asks which version to keep. Original files and legacy recovery remain unchanged. Subsequent edits save in Unfold; old external files remain copies. Other `.unfold` files can be imported manually.
- Running processes, the open chat/view mode, and undo history are temporary. Backups preserve stored resized images, not discarded full-resolution originals.

Browser data belongs to its profile and site origin; clearing site data removes it. Export before clearing it to keep a portable copy. Web-to-desktop transfer is manual; browser and desktop libraries do not synchronize automatically.

Static web builds can run preview conversations locally. Live AI requires the desktop app or the existing localhost helper and the selected CLI's sign-in; model inputs still go to that provider. The desktop runs its local agent process separately so agent failure does not disable file saving.

See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership, save/recovery semantics, T3 Code source references, and accepted limits.

## Run the desktop app (macOS or Linux)

```sh
pnpm desktop:dev
pnpm desktop:package
```

Web and desktop builds share the temporary public trial key in `client/tldraw-license.ts`, which expires on **2027-02-17**. Replace it before expiry, or set `VITE_TLDRAW_LICENSE_KEY=your-key` in `.env.local` before building to override it. The same key covers the legacy browser-board migration canvases. A replacement key must cover the desktop origin `unfold://app` and any hosted web domain. See [tldraw license setup](https://tldraw.dev/sdk-features/license-key). The desktop smoke check waits beyond tldraw's five-second license gate so an initial paint cannot hide a licensing failure.

The first desktop run or packaging build downloads the Electron runtime and requires an internet connection. Packaging targets the current operating system and architecture: `output/desktop/mac-arm64/Unfold.app` on Apple Silicon, `output/desktop/mac/Unfold.app` on Intel macOS, and `output/desktop/linux-unpacked/unfold` on x64 Linux. The initial packaging script creates an unsigned local app; signing/notarization for public distribution is not configured. Development settings/recovery use a separate profile from the packaged app. No Vite server or project-local Node installation is required to run the packaged app. Linux needs a graphical session and Electron's system libraries; NixOS must supply those libraries in its runtime environment. Install/sign in to Claude Code or Codex separately for live AI.

## Agents and source evidence

- The coordinator is program logic that dispatches typed tasks (`shared/coordinator.ts`). A branch agent chooses to ask, request research, or propose a sourced step. After research it evaluates the finding: propose, ask what could change, or request one narrower search. Research returns a finding with sources and what it could not verify, or no suitable result.
- Connections (automatic or Connect goals) use one path. The connection agent first decides whether the goals overlap at all (“none” is a valid answer) and drafts a candidate. Each branch agent then checks that exact version against only its own goal and conditions, and can flag a condition that needs real data. Next the connection agent chooses one step: research (with a brief that differs from earlier searches in the conversation), a revision, a question for you, a proposal, or none. Any changed version, including one built on research, is checked again by both goals; a check of an earlier version never counts. A version a branch reports as conflicting is never proposed: the user gets a decision with the blocking condition, the basis and one effect per option.
- Automatic checks (`shared/links.ts`) start only after your own actions in a branch: a message, a goal edit, or confirming or forgetting a memory item. Moving cards, typing and the app's own writes never start them. They wait for a quiet moment and for that branch's own reply. They compare a signature of each goal and its confirmed conditions, skip pairs whose last check (saved on the board) had the same signature, and skip pairs whose shared conversation waits on you or holds an accepted direction. At most two pairs are checked per action, one at a time, most recently active first. A result is set aside if a goal or condition changed meanwhile (the pair is then checked again), if a goal was removed, or if the board was switched. Agent replies never start a check, and a declined idea is considered by the next check rather than returned to you.
- Each request is bounded: at most 10 model calls, 2 searches, 2 connection revisions and 8 minutes (a search may take up to about 3 minutes, since it opens pages). When the chain can't finish, it pauses with one question instead of inventing a result. Only the agents a step needs are called.
- Memory is stored per conversation and inherited along its lineage: derived and shared chats get what their sources knew, plus later corrections of those facts, never sibling explorations. Agent-proposed memory counts as confirmed only when it cites one of your messages; otherwise it stays an assumption. Older saved chats derive their memory from their messages when loaded.
- Invalid agent replies (for example a question with fewer than two options) get at most one correction with the validation problem, and that correction counts as a call in the request's budget. A second failure, or no calls left, shows a plain retry message, never raw validation output.
- Research has three distinct outcomes: a suitable option with sources, a search that ran but found nothing suitable (an honest “none”, which may lead to a decision about a condition), and a technical failure. A technical failure is an unreadable reply, a CLI error, a CLI that stopped at its step limit, or a timeout. It stops the request with a clear message and Retry; it is never reported as “nothing fits” and never leads to changing a condition. An unreadable research reply gets one correction that restates the same reply without searching again, and its sources are still checked against the search's own tool events. A failed automatic link check is saved on the board as paused, with its reason. The card's *Link paused* entry retries it with the latest conditions, also after a reload, without creating duplicate conversations or cards. A chat message the agents never answered (for example after a reload) offers Retry in the chat.
- Claude runs with only web search/fetch tools enabled for research and no built-in tools for question/synthesis calls. Project hooks and MCP servers are not loaded.
- Codex runs ephemerally in a temporary directory, with a read-only sandbox, shell tools/hooks disabled and live search enabled only for research.
- Uploaded images are resized locally and passed to the CLI for image understanding. Temporary files are removed after the process exits. The CLI still sends model inputs to its provider.
- Complete agent replies can carry typed board edits. The UI and the agent use the same edit handler. It checks the full batch against the current board and the revisions the agent saw before applying changes. New cards record the originating message and the versions of the cards and memory they used. Partial events report activity.
- Research must execute a web-search tool and return sources also visible in tool events. Unsupported URLs are rejected. Those URLs are passed to the branch agent, and its final citations must match them. This establishes tool provenance, not a guarantee that every organizer fact is correct; the user still checks price/availability on the linked page.
- Process cancellation propagates to the local provider process group. Subscription/provider processing may already have begun when cancellation happens.

Preview mode is deliberately deterministic and text-based. It demonstrates the interactions but does not interpret images or perform live research; cards and the header identify it as preview. Use a signed-in CLI for the actual hackathon demo and alternate-image testing.

## UI foundation

The React UI uses local shadcn/ui **Base UI / Vega** components in `client/components/ui`, backed by `@base-ui/react`, Tailwind CSS 4 and shared theme tokens in `client/index.css`. This follows tutor-platform's local component, shared utility and token structure while keeping the React/Vite setup. tldraw continues to own the canvas and drawing interactions.

`components.json` and the `@/*` alias configure the official shadcn registry. Add components with `pnpm dlx shadcn@latest add <component>`. Use the shared Button, Input, Textarea, Select, Dialog and DropdownMenu components for application controls. Button variants own action styling, including selected states; compact, text and pill sizes serve canvas controls. Global resets live in the base layer, tldraw styles in a vendor layer, and app layout in the component layer so Tailwind utilities retain precedence. The neutral canvas keeps image proportions intact. Card actions appear on hover, selection or keyboard focus, and stay visible on touch devices. Provider settings live in Board settings; history and fit commands live in the canvas actions menu. Focus view places source content beside its conversation on wide screens and above it on narrow screens.

## Checks and production build

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm start
```

Platform regressions: `pnpm test:web` runs Chromium and WebKit checks; `pnpm desktop:package && pnpm test:desktop` checks the current platform's packaged app in an isolated profile. Chromium uses installed Google Chrome by default; to use another Chromium binary, run `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(command -v chromium)" pnpm test:web --project=chromium`. WebKit requires Playwright's browser installation and its system dependencies. Add `UNFOLD_SMOKE_LIVE=1` to the desktop test command for one synthetic signed-in Codex request. `UNFOLD_SMOKE_EXECUTABLE` overrides the packaged executable; `UNFOLD_SMOKE_NO_SANDBOX=1` disables Chromium's sandbox only for the isolated desktop smoke in containers that require it. Normal desktop launches retain their sandbox. Node tests register their cases before awaiting them and use `--test-force-exit` because importing tldraw retains a scheduler MessagePort. Failed tests still exit nonzero.

TypeScript checks are selected from `~/Code/tutor-platform/tsconfig.base.json` and its typed ESLint configuration. Unfold enforces strict indexed access, exact optional properties, type-only imports, checked external values, safe assertions, handled promises and exhaustive switches across `.ts` and `.tsx`, including starter-derived code. The adapted `local/array-emptiness` rule requires `isEmpty` / `isNotEmpty` from `shared/arrays.ts` for array emptiness checks, including JSX conditions; numeric counts and string lengths remain allowed. Only the helper implementation is exempt. Svelte, application-specific and formatting rules are not imported. The owning configurations are `tsconfig.json` and `eslint.config.js`.

`pnpm start` serves the built frontend and agent routes at **http://127.0.0.1:3001**. A hosted browser-only deployment cannot launch your local CLI; subscription mode requires this local Node server (or an equivalent trusted server running an authenticated CLI). Before sharing a production build, confirm that the bundled trial key is still active and suitable for the deployment, or override it with `VITE_TLDRAW_LICENSE_KEY` and rebuild. [tldraw licensing](https://tldraw.dev/community/license).

The focused tests cover chat isolation and inheritance, legacy-message migration, breadcrumbs, outcome publication rules, dependency invalidation, stale responses, CLI source-evidence parsing and fragmented response streams. Browser smoke testing covers the user journey separately.

## Source and scope

- [Hackathon brief, judging and submission](HACKATHON.md)
- [Product inspiration: PureRef, Apple Freeform and Allume](PRODUCT_INSPIRATION.md)
- [Technical inspiration: T3Code, tldraw, dim0 and Excalidraw](TECH_INSPIRATION.md)
- [Web and Electron architecture plan](ARCHITECTURE.md)
- Starter source: [tldraw templates at commit 69f43954](https://github.com/tldraw/tldraw/tree/69f43954f15a171b3a6edb45134d27b71560de02/templates). Template-derived code is covered by `LICENSE.starter.md`; the tldraw SDK has its own license.
- Agent starter patterns adapted here: typed actions, structured context, complete/partial event separation and explicit request lifecycle. Its generic drawing assistant and drawing-diff approval UI are not included.
- Sample SVG illustrations are original to this project. No external photo service is required.

This is a local single-user hackathon MVP. Cross-device synchronization, multi-user accounts, autonomous background execution and external calendar/booking actions are outside its scope.

## Verification in this workspace

The attached-chat implementation passes TypeScript checking, lint, all 16 unit tests, and the production build. The isolated production-browser preview flow exercised both chat views with draft preservation, five messages without additional nodes, explicit outcome publication with undo/redo, source breadcrumbs, separate chats, shared outcomes and research follow-up, request failure/retry and stop, saved chats/images after reload, and a narrow focused layout. A legacy fixture preserved its outcome, question and answer across migration and subsequent reloads. The repeatable browser flow is in [tests/attached-chats.smoke.js](tests/attached-chats.smoke.js).

Live CLI calls were not repeated for this UI/context change. Earlier Codex verification with the existing ChatGPT sign-in produced an image-based question and a practical action citing official web pages observed in tool events; that verification predates attached chats. Claude Code was not installed for the earlier live check.

## Web and desktop verification — November 8, 2026

- `pnpm check`, `pnpm lint`, `pnpm test`, and production web/desktop packaging pass; the Node suite has 33 passing tests.
- Six Chromium/WebKit checks cover existing two-board migration, appearance and image preservation, reload, complete export/additive import, fresh image upload, static preview chats, invalid storage, and stale-tab protection. WebKit's legacy fixture uses supported inline images because old tldraw File-to-IndexedDB upload aborts before migration in that engine; Chromium covers binary legacy IndexedDB assets. New image upload and persistence pass in both. WebKit coverage is not a claim of testing every Safari version.
- The packaged Apple Silicon macOS app passes native save, two-board/image archive, local agent process, quit, and reopen checks. A separate live smoke discovered the installed Codex CLI and completed a synthetic request outside the project cwd. Claude Code was not live-tested.
- Independent Sol storage and native reviewers reproduced the reported failure cases, verified their fixes, and approved their scoped reviews with no unresolved findings. No public distribution signing/notarization was performed.

## Agent memory, decisions and coordination — November 8, 2026

- `pnpm check`, `pnpm lint`, `pnpm test` (52 + 47 Node tests) and `pnpm build` pass. `tests/agents.test.ts` covers the corrected budget reaching every participating agent, isolated conversations, declined ideas not returning without a stated change, refinement, per-branch fit checks, failed search leading to a question, stop/deadline/condition changes blocking late results, persistence after reload, grounding of agent memory, and the retry-once parsing of invalid replies.
- Preview mode, in the browser without a local helper: questions, budget correction with history and stale marking, sourced step with its handoff trace, Connect goals, Refine, Accept (one card, updated in place on a later accepted revision), card removal keeping the decision, Decline with a reason, and memory/decisions after reload.
- Live Codex CLI, through the local API: a connect request (connection agent → both branch agents in parallel → proposal, using the corrected $30 budget) and a research request (real web search found nothing within $30, so the branch agent asked which condition could change and returned a memory update grounded in a user message). The live path was not driven through the browser UI.
- `pnpm test:web`: the Chromium legacy-migration test fails identically on the unmodified commit (it waits for a hover-only Explore button); WebKit was not installed in this environment.

## Collaborating agents — November 10, 2026

- `pnpm check`, `pnpm lint`, `pnpm test` (52 + 71 Node tests) and `pnpm build` pass. `tests/links.test.ts` covers: when a pair is checked (intent in both goals, a changed signature, two pairs per action, waiting and accepted links left alone); a found overlap versus an honest “none”; each branch's own conditions changing the outcome; a user decision changing the next search and no repeated searches; re-checking a changed version; never proposing over a conflict; a declined link not returning; and reload of link checks, decisions and conflict details. `tests/agents.test.ts` case 5 now asserts that an idea changed after the checks is checked again.
- Preview (`pnpm test:web --project=chromium`, deterministic agents in the browser): `tests/collaboration.browser.spec.ts` covers the whole journey through the interface. Two goals develop with no overlap and nothing appears. After the branches gain conditions a link appears without Connect goals, while the open chat and the camera stay put. It then covers the conflict decision with condition, basis, source and effects; raising the budget leading to a search within $45 and a sourced proposal; Accept creating one card and Connect goals reopening the same conversation; reload; and the first step built on the accepted sources. It also covers keeping the budget leading to a different (free) search, a declined idea not returning, and board switching or a condition change setting late results aside. The removal-confirmation and folded-answer updates to the older browser checks pass in Chromium. WebKit is not installed in this environment. `tests/attached-chats.smoke.js` was updated and passes against a preview helper.
- Live Codex CLI, driven through the browser UI on a local helper (`tests/live-collaboration.browser.spec.ts`, opt-in with `UNFOLD_LIVE_URL`). The sample board's two goals each got one typed answer: a pottery class in San Francisco on Saturdays under $25, and meeting people there on Saturday afternoons in a small group. Without Connect goals, the link appeared under both cards about 90 seconds later.
  - The branch checks and real searches flagged the small-group condition: a library event gave no group size or price. The user got a decision showing that condition, the basis and the effect of each option.
  - The next search kept the conditions and asked whether to allow larger groups. Allowing them led to a free Saturday collage workshop at SF Main Library, citing sfpl.org.
  - Accepting created one shared card. Opening it proposed a dated, free first step that built on the carried source.
  - An earlier live run surfaced two problems, both fixed and rechecked by that second run. “Blocked by” had named the whole idea rather than the condition. A vague “Raise budget” led to a follow-up question about the amount; the prompt now asks for concrete options.
  - Claude Code was not live-tested for this flow. Live results vary by run; nothing in the scenario is scripted into the product.

## Live research failure — November 10, 2026

- **Symptom (live Claude Code, through the interface):** after the agents checked a pottery idea for two goals, the activity read “No suitable verified option. The research reply could not be read.” Then the connection agent searched again, and the card ended with *Link paused* and no result or reason.
- **Cause, reproduced live:** six synthetic research calls were made through `callCli` with Claude Code 2.1.183. In three, the reply was valid JSON but longer than the reply schema allows: a `summary` of about 1,700 and 2,000 characters against a maximum of 1,500, or `limits` over 600. The prompt stated no limits. `liveRuntime().research` turned that validation error into `status: 'none'`, so the coordinator treated a technical failure as an honest empty search. In one more run, Claude Code ended with an error result and no text: research used 9–11 tool calls against `--max-turns 8`. The user saw a generic message. An automatic link check's error was shown only as *Link paused*, without its reason, and it was gone after a reload.
- **Fix:** the research prompt now states length limits and a search budget, and a research call gets 170 seconds and 14 turns. An unreadable reply gets one correction that restates the same reply without searching (counted as a call in the request's budget); otherwise the step fails as a technical error. The CLI layer reports timeouts, turn limits, empty replies and CLI errors as typed failures. A failed search ends the request with a `failed` step and a clear message. It is never shown as “no suitable option” and never leads to a condition change. The request deadline is now 8 minutes, so two searches fit. Sources found earlier in a shared conversation, such as the basis of the decision the user just made, are passed to the next turn as citable. They are not counted as new research. A failed automatic check is saved on the board with its reason; the card's *Link paused* entry and a toast offer Retry, also after a reload.
- **Checks:** `tests/research-failures.test.ts` uses a test double for the Claude Code binary. It reproduces the measured over-long reply and covers:
  - the single correction, which spends from the budget and uses no search tools;
  - a reply that stays unreadable, and no calls left to correct it, both becoming technical failures;
  - an honest “none” staying a finding;
  - a reply wrapped in prose still being read;
  - turn limit and timeout errors;
  - a failed search never becoming a conflict, compared with an honest empty search that may;
  - carried sources;
  - the saved paused check.

  `tests/research-failure.browser.spec.ts` runs the real local helper and interface with that test double. The automatic check pauses with the reason and Retry; the paused state survives a reload. Retry then leads to one shared idea with its source. Connect goals after a pause leaves no stale entry and one conversation. The opt-in live spec now fails on any technical error and has no early return.
- **Live Claude Code after the fix, through the interface** (opt-in `tests/live-collaboration.browser.spec.ts`, isolated Playwright profile on the sample board):
  - **Run 1:** the link appeared without Connect goals about 70 seconds after the second answer, as a decision based on real prices. The research reply was read. After a follow-up, the shared idea “Saturday drop-in pottery session” was proposed with no source, although the decision before it had cited rubysclaystudio.org. The strict test failed on that, which led to passing earlier sources to the next turn.
  - **Run 2 passed:** seven real searches across three turns, every reply read, no technical failure. The run ended with a justified decision. Verified Saturday-morning classes cost $89 (SMAart) and $90 (Pottery-SF), above the $80 budget the run had chosen, citing pottery-sf.com.
  - The test's automatic answers chose “keep the budget, search again”, so this run did not reach an accepted card. Live results vary by run.

## Automatic desktop storage verification — November 8, 2026

- TypeScript checking, lint, the full Node suites (52 lint-rule tests and 60 application tests), production web build, and macOS packaging pass.
- Native/controller tests cover automatic saves, legacy migration without altering source files, both recovery choices, failed migration retry, corrupt data and safe restoration, external changes, stale sessions, failed writes, and edits remaining exportable after a failed close.
- The packaged macOS smoke passes automatic save, menu-only import/export, preservation of imported backup files, quit/reopen without a location picker, stored image decoding, and startup restoration after damaged library/recovery files.
- One Chromium smoke passes legacy board/image migration, reload, conversation preservation, web Export, absence of web Import, and fresh-image persistence. Windows/Linux, WebKit, and live AI were not repeated for this storage/menu change.

## Linux verification — November 11, 2026

- On NixOS x64 with Node 22.20.0 and pnpm 10.33.1: type checking, lint, 52 lint-rule tests, 98 application tests, and production web/desktop builds pass.
- All 15 non-live Chromium browser tests pass using the system Chromium executable. They cover board edits, conversations, automatic collaboration and decisions, Explore approval/retry/dismissal, seven-worker progress and shared-plan persistence, research-failure recovery, legacy migration/images/export, unsaved-change protection, damaged storage, and stale tabs. The shared-plan test now waits for the save indicator before reloading; its focused check also passed three consecutive runs.
- Packaging now selects the host platform instead of always targeting macOS. The packaged Linux app passes the isolated desktop smoke: automatic saves, two-board image archive, additive import without changing the backup, generated card/conversation, local preview agent process, quit/reopen, and restoration after damaged library/recovery files. The test used a graphical session, supplied Electron libraries, and the explicit test-only sandbox opt-out required by this container.
- Manual testing in the visible Linux Chromium browser exercised preview conversations, note creation, reload persistence, Explore's missing-credentials error/retry controls, and the 390px focused chat layout without document overflow. No page errors were reported. An automated WCAG A/AA scan of the board reported no violations; contrast checks remained incomplete because of overlapping canvas layers.
- Live Claude/Codex and external event/job search were not verified: neither CLI was signed in, and the search runtime had no provider keys. The opt-in live browser test was skipped. Playwright's WebKit download succeeded, but its Ubuntu fallback could not launch with the system libraries available on this NixOS machine. Windows and macOS were not rerun in this environment.
