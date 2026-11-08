# AI infinite canvas research

Checked November 7, 2026. Editorial shortlist based on official documentation and repositories; no hands-on comparative testing. Includes knowledge canvases, collaborative whiteboards, UI design canvases, and visual generative workflows.

## Ten products to study

| Product | Focus | Distinctive behavior and source |
| --- | --- | --- |
| Flowith | General AI work | Branching multimodal work on a shared canvas; external agents can contribute through Canvas Cowork. [Official guide](https://flowith.io/blog/canvas-cowork-skill/). Older Neo slogans should not be treated as current specifications: [current product clarification](https://flowith.io/blog/meet-agent-neo/). |
| FLORA | Creative workflows | Connect text, image, video and audio nodes into reusable production workflows. [Product](https://flora.ai/product-canvas). |
| Heptabase | Research and knowledge | Cards, PDFs, whiteboards, and an AI agent; MCP can read, write, organize and lay out knowledge. [MCP documentation](https://support.heptabase.com/en/articles/12679581-heptabase-mcp). |
| Lovart | Agent-led visual design | ChatCanvas combines direct editing with a design agent; Lovart 2.0 adds Arti memory, research, review and delegated tasks. [Official overview](https://www.lovart.ai/topics/lovart-2-0). |
| Figma Weave | Repeatable visual production | Formerly Weavy; connected generation and editing nodes, branching variations and reusable tools. [Official explanation](https://www.figma.com/blog/the-tldr-on-figma-weave/). |
| Miro | Team collaboration | AI Sidekicks and Flows on a collaborative board. Feature availability depends on plan and rollout. [Official announcements](https://miro.com/blog/whats-new-may-2026/). |
| Google Stitch | UI design | AI-native infinite canvas, design agent, parallel directions, voice interaction and design-system interchange. [March 18 announcement](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/). |
| Poppy AI | Content research and creation | Source videos, ads, websites, PDFs and transcripts on a visual board; generate scripts, campaigns and images from selected context. [Product](https://getpoppy.ai/), [image editor documentation](https://intercom.help/poppy-ai/en/articles/12111710-image-generation-and-the-image-editor-in-poppy). |
| MagicPath | UI prototypes | Shared infinite canvas for designs, sketches, images and working prototypes, with project-level agent chat. [2.0 announcement, May 1](https://www.magicpath.ai/documentation/changelog/magicpath-2), [canvas docs](https://www.magicpath.ai/documentation/features/canvas). |
| Adobe Firefly Boards | Moodboards and storyboards | Mix references and generated visuals, develop pitch material and continue editing in Photoshop. [Boards documentation](https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards/about-firefly-boards.html), [Photoshop integration](https://community.adobe.com/announcements-698/firefly-boards-now-integrated-with-photoshop-desktop-1557089). |

## Recent developments

- November 5, 2026: FLORA shipped 39 task-specific agent skills, including mood boards, storyboards, relighting and product shots. [Release](https://flora.ai/updates/skills-for-every-job-2026-11-05).
- November 3, 2026: Heptabase shipped creating/organizing whiteboards through MCP and opening/editing boards inside ChatGPT, Codex and Claude Code. [Dated roadmap](https://wiki.heptabase.com/roadmap).
- Lovart 2.0's Arti adds persistent preferences, design research, review and scheduled delegation. Verified current product, but exact launch date not established. [Overview](https://www.lovart.ai/topics/lovart-2-0).
- ComfyArt's first stable v1.0.0 release was October 23, 2026. [Release](https://github.com/jtydhr88/ComfyArt/releases/tag/v1.0.0).

## Other relevant products

- [Freepik / Magnific Spaces](https://www.freepik.com/spaces): collaborative node-based image/video workflows and upscaling.
- [Krea Nodes](https://www.krea.ai/nodes): connect tools and models into automated pipelines.
- [Albus](https://albus.org/canvas): multimodal research and idea exploration with document, image and audio insights.
- [Google Mixboard](https://blog.google/innovation-and-ai/models-and-research/google-labs/mixboard/): experimental open concepting board, launched September 23, 2025; not a new November 2026 launch.

## Licensing and availability checks

- [Excalidraw MCP](https://github.com/excalidraw/excalidraw-mcp): MIT; interactive diagram generation and editing through MCP Apps.
- [tldraw SDK](https://github.com/tldraw/tldraw/blob/main/LICENSE.md): public source under a custom license; production requires a separate license. Do not categorize current SDK as unrestricted MIT software.
- [Kosmik sunset notice](https://launchpad.kosmik.app/): sunset May 31, 2026.
- [Cove transition notice](https://cove.ai/blog/an-exciting-next-chapter): product wound down April 1, 2026 after the team joined Microsoft.

Separate repository investigation covers ComfyUI, AFFiNE, ComfyArt, Banana Canvas, and Infinite Canvas, with component licensing caveats.

---

# Open-source AI infinite canvas projects

Research snapshot: November 7, 2026. Primary repository/readme/license evidence; functionality is maintainer-described, not independently run. These are non-archived repositories at inspection time. No launch date inferred from copyright years or indexing dates.

| Project | Canvas + AI functionality | Verified license / caveat | Assessment |
| --- | --- | --- | --- |
| [ComfyArt](https://github.com/jtydhr88/ComfyArt) | Freeform design/artboard canvas with an agent that sees and edits the canvas through tools/MCP; local ComfyUI image/video/audio/3D generation, editing, storyboards, layers, exports. | [Own code MIT](https://github.com/jtydhr88/ComfyArt/blob/main/LICENSE). README explicitly says bundled **tldraw SDK is separately licensed**, not MIT, and production licensing applies. Requires ComfyUI/models/hardware for local generation. | Strongest recent design-canvas example. [First stable release October 23, 2026](https://github.com/jtydhr88/ComfyArt/releases/tag/v1.0.0), [v1.2.0 October 31](https://github.com/jtydhr88/ComfyArt/releases). |
| [tigerowo/infinite-canvas](https://github.com/tigerowo/infinite-canvas) | Connected image/video nodes; agent reasons over selected/upstream nodes and inserts generated results; reusable creative workflows; panorama generation and a 3D director stage with camera shots returned to canvas. Docker/self-hosting. | [AGPL-3.0](https://raw.githubusercontent.com/tigerowo/infinite-canvas/main/LICENSE). Maintainer warns storage schemas and historical data compatibility can change during development. OpenAI-compatible services supported. | Strong, directly relevant generative-media workflow reference. |
| [Banana Canvas](https://github.com/Mr-banananana/Banana_canvas) | Local-first node canvas connects text prompts and image/video reference assets; generation via Agnes or a custom multimodal API; browser persistence; Windows/macOS launchers. | [MIT](https://raw.githubusercontent.com/Mr-banananana/Banana_canvas/main/LICENSE). Local interface/storage does **not** imply local inference: generation depends on chosen AI API. | Direct fit, simpler/early project; nine stars when checked, so maturity should not be assumed. |
| [Franklin Canvas](https://github.com/BlockRunAI/franklin-canvas) | Node-based image/video/music workflows; Media Agent can storyboard, generate, edit, upscale and stitch a short film; side-by-side video model comparison. | [Apache-2.0](https://raw.githubusercontent.com/BlockRunAI/franklin-canvas/main/LICENSE). Generation uses paid BlockRun credits or USDC/x402; open source app is not free model inference. | Useful agentic media-canvas reference; young/small repo. |
| [OpenCanvas by ashark-ai-05](https://github.com/ashark-ai-05/opencanvas) | LLM calls a typed `place_widget` tool to arrange charts, tables, kanbans, code and timers on a persistent infinite canvas; MCP connections, memory, local Ollama support, REST API for agents. | [Own code MIT](https://raw.githubusercontent.com/ashark-ai-05/opencanvas/main/LICENSE); built with tldraw, so underlying SDK terms merit checking for deployment. README explicitly identifies some demo footage as scripted rather than live model output. | Strong conceptual fit for spatial agent output beyond media. **Distinct from LangChain's Open Canvas.** |
| [Knowledge Canvas](https://github.com/LaplaceYoung/knowledge-canvas) | Spatial branching chat anchored to selected source passages; PDF/Markdown/text nodes and OCR; BYOK/local models; web nodes bind to real provider tabs using an extension. | README and GitHub identify [MIT](https://github.com/LaplaceYoung/knowledge-canvas#license); direct license endpoint did not load. Agent ACP support is **preflight groundwork, not a functioning chat backend**, per README. | Relevant thinking/research canvas, very early (one star, 18 commits observed); provider-tab integration adds moving parts. |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Pan/zoom visual node graph builds reusable image, video, audio, 3D and text workflows; local execution, API, templates/subgraphs and extensive custom-node ecosystem. | [GPL-3.0](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/LICENSE). Models and optional remote services have their own licenses/costs. | Established workflow-canvas baseline, less like a freeform collaborative whiteboard. |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | Edgeless workspace merges documents, sticky notes, shapes, linked pages, databases and slides; multimodal AI creates writing, slides, mind maps and prototypes. | **Mixed/open-core.** [Root license](https://github.com/toeverything/AFFiNE/blob/canary/LICENSE) gives MIT outside backend/native carveouts. [Backend license](https://raw.githubusercontent.com/toeverything/AFFiNE/canary/packages/backend/server/LICENSE) uses commercial EE terms, with CE/client-side portions covered by MPL-2.0. README's blanket CE MIT wording is less precise than actual files. | Strong mature spatial knowledge-work benchmark; do not describe entire repository as unrestricted MIT. |

Important exclusion: [Shotloom](https://github.com/AstralFoundry/shotloom#-许可证) advertises an open-source AI infinite canvas, but its own README says there is currently no LICENSE and all rights are reserved. Public code alone does not qualify it as verified OSS.

Another exclusion: [lianggebanjuzi/infinite-canvas](https://github.com/lianggebanjuzi/infinite-canvas) is archived (September 11, 2026).

Recommended short list for direct product inspiration: ComfyArt, tigerowo/infinite-canvas, OpenCanvas, Franklin Canvas. Add AFFiNE for mixed docs/whiteboard and ComfyUI for mature node-workflow mechanics. Banana Canvas and Knowledge Canvas are promising small examples rather than evidence of established adoption.

Additional requested benchmark: [Official Excalidraw MCP App](https://github.com/excalidraw/excalidraw-mcp) streams hand-drawn diagrams into MCP Apps clients with viewport/camera control and interactive fullscreen editing. Remote endpoint at `https://mcp.excalidraw.com`, or build/run locally. README declares **MIT**, although there is no standalone LICENSE in the root listing inspected. This is an official agent-to-whiteboard bridge, not a full generative-media workflow product. Source: [README / license declaration](https://github.com/excalidraw/excalidraw-mcp#license).
