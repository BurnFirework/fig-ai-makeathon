# Unfold

A vision board that grows into a practical first step: two images → separate question/answer branches → a shared possibility → a sourced action. Built with React, TypeScript and tldraw, using the official Branching Chat template's node, port and binding foundation.

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
- Choose a provider in the app's header. Automatic startup prefers an installed Claude CLI, then Codex. If neither executable works, the app uses clearly labeled preview agents. A live authentication or search failure is shown as an error, never silently replaced with sample research.
- Provider status checks establish that the binary works, not that subscription usage is available. The first real request verifies authentication and model access.

Optional server configuration: copy `.env.example` to `.env`, set `UNFOLD_PROVIDER=claude`, `codex`, `auto` or `demo`, and restart. `UNFOLD_CLAUDE_BIN` / `UNFOLD_CODEX_BIN` accept executable paths, not shell commands. `UNFOLD_MODEL` overrides the CLI's default model.

The provider pattern is inspired by [T3 Code](https://github.com/pingdotgg/t3code): local server, installed agent runtimes, existing provider authentication and normalized events. This MVP uses short-lived `claude -p` / `codex exec` processes rather than T3's full persistent session infrastructure.

## Try the journey

1. Add two PNG/JPEG/WebP images, or load the original sample illustrations.
2. Edit each inspiration's title to describe your goal. Click its heart.
3. Answer a question and add a short comment. Answers become their own connected cards. Continue one step at a time.
4. After both branches have answers, agents can suggest a shared direction. You can also click **Connect goals**, select two nodes and connect them, or drag a port from one branch to the other inspiration's top port.
5. Accept a shared direction to request real web research and a small action, reject it to leave other paths open, or provide a refinement.
6. Open **Agent activity** to inspect actual branch → research → branch and connection handoffs.

Use **New board** in the header to create a mood board. Open the board name menu to switch boards or rename the current one. Each board saves its own canvas, images and decisions on this device; the selected board reopens after a reload. Use **Style** in the header to pick the main color (lavender, rose or sage), the canvas pattern and the canvas color; these preferences are saved in this browser. Existing boards are preserved automatically. Switching boards stops requests running on the previous board.

Use Fold/Expand and Move branch to manage the board. Editing goals/answers marks dependent suggestions for review. Stop and retry are available during a request or after an error. Completed action cards accept a reflection. Board records, image assets and decisions persist in this browser's IndexedDB; activity and active processes are transient. Nothing books a class or takes the real-world step for you.

## Agents and source evidence

- The coordinator routes bounded role calls. Each branch has separate explicit context; synthesis gets both contexts and the selected shared direction.
- Claude runs with only web search/fetch tools enabled for research and no built-in tools for question/synthesis calls. Project hooks and MCP servers are not loaded.
- Codex runs ephemerally in a temporary directory, with a read-only sandbox, shell tools/hooks disabled and live search enabled only for research.
- Uploaded images are resized locally and passed to the CLI for image understanding. Temporary files are removed after the process exits. The CLI still sends model inputs to its provider.
- Model proposals are validated against Zod schemas. Only complete results change the graph; partial events are activity. Results carry dependency revisions so late responses cannot overwrite edited/deleted sources.
- Research must execute a web-search tool and return sources also visible in tool events. Unsupported URLs are rejected. Those URLs are passed to the branch agent, and its final citations must match them. This establishes tool provenance, not a guarantee that every organizer fact is correct; the user still checks price/availability on the linked page.
- Process cancellation propagates to the local provider process group. Subscription/provider processing may already have begun when cancellation happens.

Preview mode is deliberately deterministic and text-based. It demonstrates the interactions but does not interpret images or perform live research; cards and the header identify it as preview. Use a signed-in CLI for the actual hackathon demo and alternate-image testing.

## UI foundation

The React UI uses local shadcn/ui **Base UI / Vega** components in `client/components/ui`, backed by `@base-ui/react`, Tailwind CSS 4 and shared theme tokens in `client/index.css`. This follows tutor-platform's local component, shared utility and token structure while keeping the React/Vite setup. tldraw continues to own the canvas and drawing interactions.

`components.json` and the `@/*` alias configure the official shadcn registry. Add components with `pnpm dlx shadcn@latest add <component>`. Use the shared Button, Input, Textarea, Select, Dialog and DropdownMenu components for application controls. Button variants own action styling, including selected states; compact, text and pill sizes serve canvas controls. Global resets live in the base layer, tldraw styles in a vendor layer, and app layout in the component layer so Tailwind utilities retain precedence. The header uses two rows below 850px to keep every control reachable.

## Checks and production build

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm start
```

TypeScript checks are selected from `~/Code/tutor-platform/tsconfig.base.json` and its typed ESLint configuration. Unfold enforces strict indexed access, exact optional properties, type-only imports, checked external values, safe assertions, handled promises and exhaustive switches across `.ts` and `.tsx`, including starter-derived code. Svelte, application-specific and formatting rules are not imported. The owning configurations are `tsconfig.json` and `eslint.config.js`.

`pnpm start` serves the built frontend and agent routes at **http://127.0.0.1:3001**. A hosted browser-only deployment cannot launch your local CLI; subscription mode requires this local Node server (or an equivalent trusted server running an authenticated CLI). Before sharing a production build, set `VITE_TLDRAW_LICENSE_KEY` to an active trial or other suitable key and rebuild. [tldraw licensing](https://tldraw.dev/community/license).

The focused tests cover branch isolation, dependency invalidation, stale responses, CLI source-evidence parsing and fragmented response streams. Browser smoke testing covers the user journey separately.

## Source and scope

- [Detailed implementation plan](research/unfold-implementation-plan.md)
- [Agent starter inspection](research/unfold-agent-starter-inspection.md)
- Starter source: [tldraw templates at commit 69f43954](https://github.com/tldraw/tldraw/tree/69f43954f15a171b3a6edb45134d27b71560de02/templates). Template-derived code is covered by `LICENSE.starter.md`; the tldraw SDK has its own license.
- Agent starter patterns adapted here: typed actions, structured context, complete/partial event separation and explicit request lifecycle. Its generic drawing assistant and drawing-diff approval UI are not included.
- Sample SVG illustrations are original to this project. No external photo service is required.

This is a local single-user hackathon MVP. Cross-device synchronization, multi-user accounts, autonomous background execution and external calendar/booking actions are outside its scope.

## Verification in this workspace

The production build and all five focused tests passed. An isolated browser exercised sample-image import, separate answers/comments, automatic and button-triggered connection proposals, rejection, acceptance, and restoration after reload. Both persisted images decoded successfully after reload. Codex CLI was tested with the existing ChatGPT sign-in: a real image-based branch produced a context-sensitive question, and an accepted shared direction produced a practical action citing official web pages whose URLs appeared in tool events. Claude Code is not installed here, so its adapter was inspected against official CLI documentation but not live-tested.
