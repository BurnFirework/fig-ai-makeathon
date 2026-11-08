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
4. Answer suggestions or type freely. Questions, answers and proposed outcomes stay inside the chat. **New conversation** starts a separate exploration from the same node.
5. Choose **Add to canvas** on a useful outcome to create one connected card. Open that card's chat to build on it. Breadcrumbs focus source nodes on the same canvas; there are no nested boards.
6. Choose **Connect goals** (or select two nodes from different inspiration branches) to explore a shared direction in a chat. Add the result when ready, then explore it for a sourced first step.
7. Open **Agent activity** to inspect branch, research and connection handoffs. Stop and retry controls appear in the chat while work runs or after an error.

Use the board name menu to create, switch or rename mood boards. Each board keeps its own canvas, images and conversations on this device. Switching boards stops its running requests. **Style** controls the existing color and canvas preferences.

Older question and answer cards are folded into an **Earlier exploration** chat on their inspiration. Existing outcome cards and their connections are preserved. Editing a source goal marks dependent outcomes for review and prevents older replies from being added. Nothing books a class or takes the real-world step for you.

## Data storage

The web and Electron desktop app share the same React/tldraw interface and board logic. Data stays on your device. There is no hosted board backend, account system, or automatic cloud sync.

- **Browser:** boards, images, attached conversations, decisions, source links, and reflections save in IndexedDB. Existing tldraw boards are migrated through the editor's public loading path; their original databases and catalog are retained. A stale tab cannot overwrite a newer committed workspace.
- **Desktop:** use **Workspace files** or the native File menu to Open, Save, and Save As. Once you choose a `.unfold` file, edits autosave there. Unsaved work also has a local recovery checkpoint. Conflicting external file edits stop overwriting and can be recovered with Save As.
- **Backup/restore:** **Export all boards** creates one `.unfold` ZIP containing every board and its actual stored image bytes. **Import boards** adds them without replacing your current boards. Safari uses ordinary download/file-input APIs, with no installation or native browser filesystem API required.
- Running processes, the open chat/view mode, and undo history are temporary. Backups preserve stored resized images, not discarded full-resolution originals.

Browser data belongs to its profile and site origin; clearing site data removes it. Export a backup to keep a portable copy. Desktop and browser workspaces move through explicit export/import rather than synchronizing automatically.

Static web builds can run preview conversations locally. Live AI requires the desktop app or the existing localhost helper and the selected CLI's sign-in; model inputs still go to that provider. The desktop runs its local agent process separately so agent failure does not disable file saving.

See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership, save/recovery semantics, T3 Code source references, and accepted limits.

## Run the macOS desktop app

```sh
pnpm desktop:dev
pnpm desktop:package
```

The local packaged app is written to `output/desktop/mac-arm64/Unfold.app` on Apple Silicon. The initial packaging script creates an unsigned local app; signing/notarization for public distribution is not configured. Development settings/recovery use a separate profile from the packaged app. No Vite server or project-local Node installation is required to run the packaged app. Install/sign in to Claude Code or Codex separately for live AI.

## Agents and source evidence

- The coordinator routes bounded role calls. Each branch has separate explicit context; synthesis gets both contexts and the selected shared direction.
- Claude runs with only web search/fetch tools enabled for research and no built-in tools for question/synthesis calls. Project hooks and MCP servers are not loaded.
- Codex runs ephemerally in a temporary directory, with a read-only sandbox, shell tools/hooks disabled and live search enabled only for research.
- Uploaded images are resized locally and passed to the CLI for image understanding. Temporary files are removed after the process exits. The CLI still sends model inputs to its provider.
- Model proposals are validated against Zod schemas. Only complete results enter chats; adding an outcome to the canvas is an explicit user action. Partial events are activity. Results carry dependency revisions so late responses cannot overwrite edited/deleted sources.
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

Platform regressions: `pnpm test:web` runs Chromium and WebKit migration/export/import checks; `pnpm desktop:package && pnpm test:desktop` checks the packaged macOS app in an isolated profile. Add `UNFOLD_SMOKE_LIVE=1` to the desktop test command for one synthetic signed-in Codex request. Node tests register their cases before awaiting them and use `--test-force-exit` because importing tldraw retains a scheduler MessagePort. Failed tests still exit nonzero.

TypeScript checks are selected from `~/Code/tutor-platform/tsconfig.base.json` and its typed ESLint configuration. Unfold enforces strict indexed access, exact optional properties, type-only imports, checked external values, safe assertions, handled promises and exhaustive switches across `.ts` and `.tsx`, including starter-derived code. Svelte, application-specific and formatting rules are not imported. The owning configurations are `tsconfig.json` and `eslint.config.js`.

`pnpm start` serves the built frontend and agent routes at **http://127.0.0.1:3001**. A hosted browser-only deployment cannot launch your local CLI; subscription mode requires this local Node server (or an equivalent trusted server running an authenticated CLI). Before sharing a production build, set `VITE_TLDRAW_LICENSE_KEY` to an active trial or other suitable key and rebuild. [tldraw licensing](https://tldraw.dev/community/license).

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
