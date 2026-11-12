# Unfold

Unfold is a vision board with AI conversations attached to cards. Add an image, talk through what it represents, and turn the conversation into notes or next steps. Agents can suggest links between goals and research options that fit the conditions you confirm.

[Watch the demo](https://www.youtube.com/watch?v=hJiJUeoXvxE), [try the browser preview](https://unfold.bezr.dev/app/), or [find desktop downloads](https://unfold.bezr.dev/).

| Where you run Unfold | Agent features |
| --- | --- |
| Hosted browser preview | Sample conversations and a working canvas. Live AI and Explore board are unavailable. |
| Local web app | Live AI and research through the local server and your signed-in Claude Code or Codex CLI. |
| Electron desktop app | The same live features through an agent process managed by Electron. |

## Run locally

Use Node.js 22.14+ and the pnpm version pinned in [package.json](package.json). Run commands from the repository root.

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite forwards agent requests to the loopback server on port 3001. For a production build on your machine, run `pnpm build` followed by `pnpm start` and open `http://127.0.0.1:3001`.

### Enable live AI

- For **Codex** in the source checkout, run `pnpm --filter unfold exec codex login`. The shortcut `pnpm helper` installs dependencies, checks your Codex sign-in, and starts the local web app. Open the local URL it prints.
- For **Claude Code**, install the CLI and run `claude auth login`. Make sure Unfold can find `claude` on your PATH. [Claude Code setup](https://code.claude.com/docs/en/overview)
- For a downloaded **desktop app**, install and sign in to a CLI on the same machine. Choose the provider in **Board settings**. Unfold offers preview mode when a live provider is unavailable.

The CLI uses your existing sign-in and sends prompts and selected images to its provider. For local web settings, copy [.env.example](.env.example) to `.env` and restart. Electron reads overrides from its launch environment.

## Use the board

1. Add a PNG, JPEG, or WebP image, or start with the sample illustrations. Give the card a goal and open **Explore** to start its conversation.
2. Confirm or correct details such as budget and location. The chat shows which conditions the agents took from your replies. Use **Add to canvas** to keep a proposed note, moodboard, or step.
3. Use **Connect goals** to look for a shared direction. You can accept, refine, or decline a proposal. When a condition blocks an option, the agents can ask you what to change.
4. With live AI, open **Explore board**, choose the cards to investigate, review their search scope, and select **Find options**. Results arrive by card. Use **Source evidence** to inspect citations and **By card** to review results, edit a search, or retry a failed card.

Live Explore uses Parallel for public web search and page reading, with CLI web search as a fallback. It also uses Composio for dynamic read-only research tools.

> [!NOTE]
> Unfold ships with a **shared Composio demo key with a limited balance**, so the hackathon demo works without setup. Everyone who runs the app shares this key, and it may run out or be revoked at any time. For regular use, set `COMPOSIO_API_KEY` to your own key with session management read/write and session tool execution write access. The hosted preview has no connection to a visitor's local CLI or the demo key. [Composio key permissions](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions)

Explore checks claims about concrete options against primary pages such as a venue or employer site. A published schedule or listing can establish the stated details. Confirm current availability with the provider.

## Privacy

Unfold has no account system, usage analytics, or session replay. Your board library is stored on your device, and you can export a copy.

Live AI sends prompts, board context, and relevant images to the model provider you sign in to. Live research can send search queries, page URLs, and tool inputs to services such as Parallel and Composio. Those services process requests under their own policies. The hosted browser preview uses sample conversations.

## Data storage

Boards, stored images, conversations, and decisions save on your device. Browser and desktop libraries are independent.

- **Browser.** IndexedDB stores the library per site and browser profile. Use **Board menu → Export** before clearing site data or moving to another device.
- **Desktop.** The library saves automatically at `workspaces/default.unfold` under Electron's `userData` directory. Use **Board menu → Show data folder** to find it. Development uses a separate profile.
- **Backups.** Desktop **Import** adds boards from a `.unfold` file, including exports from the browser. **Export backup** saves a portable copy. If the desktop library cannot open, use **Restore backup** on the recovery screen.

Backups include the images stored on the board. Unfold resizes uploads before saving them.

## Run the desktop app

```sh
pnpm desktop:dev
pnpm desktop:package
```

The package command creates an unpacked app under `output/desktop/` for the build machine. For public macOS and Linux installers, see [hosting and releases](UNFOLD_HOSTING_RESEARCH.md#desktop-releases).

The bundled tldraw trial key expires on February 17, 2027. To override it, set `VITE_TLDRAW_LICENSE_KEY` in the repository's `.env.local` before building. Use a key that covers the deployed web domain and the Electron origin `unfold://app`. [tldraw license setup](https://tldraw.dev/sdk-features/license-key)

## Checks

```sh
pnpm check
pnpm lint
pnpm test
```

Run `pnpm test:web` for Chromium and WebKit browser tests. To smoke-test the packaged desktop app, run `pnpm desktop:package` followed by `pnpm test:desktop`. Live provider checks require a signed-in CLI. The desktop smoke test can opt into one Codex request with `UNFOLD_SMOKE_LIVE=1`.

## Project references

- [Architecture and code map](ARCHITECTURE.md)
- [Hosting, deployment, and desktop releases](UNFOLD_HOSTING_RESEARCH.md)
- [Hackathon Track 1 brief and submission reference](HACKATHON.md)
- [Product inspiration](PRODUCT_INSPIRATION.md) and [technical inspiration](TECH_INSPIRATION.md)
- [tldraw starter source](https://github.com/tldraw/tldraw/tree/69f43954f15a171b3a6edb45134d27b71560de02/templates) and [starter license](LICENSE.starter.md)

## License

Unfold is released under the [MIT License](LICENSE). It builds on the tldraw SDK, which has [its own license](https://tldraw.dev/community/license), and on the tldraw starter templates, which keep their [MIT notice](LICENSE.starter.md).
