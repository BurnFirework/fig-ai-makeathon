# FIG AI Design Makeathon 2026 — Track 1 reference

This is the development reference for Unfold's hackathon brief, judging and submission requirements. Track focus: **Agentic Workflow**.

## Evidence and freshness

These notes reconstruct the organizer pages read in Safari on **November 7, 2026**, and the follow-up research in the original “Review Hackathon Track Details” chat. They are paraphrases, not a verbatim handbook copy. The official site was not accessible through the web research tool during the subsequent documentation review, so this document does not claim a fresh organizer verification.

Keep organizer requirements, our interpretation and Unfold's implementation decisions distinct. Recheck time-sensitive details on the official pages before submission. Update the relevant section and verification date when new evidence resolves a question.

| Official source | What to check |
| --- | --- |
| [Event overview](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026) | Track description, schedule, eligibility, prizes and judging |
| [Track 1 handbook](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026#handbook-1) | Creative brief, optional scenarios and permitted prototype scope |
| [Submission page](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026/submission) | Field limits, demo URL, deadline and finalization behavior |
| [Announcements](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026/people) | Organizer updates; announcements were under the Find a Team area |

## Organizer brief

Build a working prototype that makes **human–AI agent collaboration understandable and controllable**. A team may explore an entire product or focus on one important decision moment.

The earlier handbook review established that:

- Teams may bring their own user problem and scenario.
- Simulated execution is welcome.
- Public tools and synthetic data are permitted.
- A particular app builder was not found as an explicit requirement in the reviewed pages. Treat this as a qualified observation, not an organizer guarantee about every tool or submission policy.

Source: [Track 1 handbook](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026#handbook-1).

### Optional scenarios

These are inspiration, not a checklist requiring all four:

1. **Coordinate agent teams:** delegate work, understand plans, manage handoffs and approve consequential actions.
2. **Resolve conflicting knowledge:** compare sources, reconcile decisions and propagate corrections to agents.
3. **Investigate agent failures:** inspect evidence and timelines, pause runs, correct rules and replay.
4. **Agent Blueprint Challenge:** a visual AI agent/workflow blueprint studio.

The fourth scenario is the explicit canvas suggestion recalled in our early discussion. It describes connecting agents, models, tools, data, decision branches and human approvals. It invites building/testing workflows, exposing permissions and intervention points, and showing agent states, handoffs and data flows. It does not require Unfold to become a generic workflow editor.

Source: [Handbook, including the portfolio-company product scenario](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026#handbook-1).

## Required deliverables

- **Interactive prototype** showing one complete user journey.
- **Brief design rationale** explaining the target user, problem and key interaction choices.
- **Live demo.** The submission form separately accepts a video or live deployment as its demo URL; prepare the presentation and the accessible artifact deliberately.

Source: [Event and handbook](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026).

## Judging rubric

Design judges and non-design judges each contribute **50%** of the result. Each criterion is scored out of five. Do not invent additional criterion weights beyond that split.

| Design judges | Non-design judges |
| --- | --- |
| Problem framing and user value | Problem framing and user value |
| AI-native workflow design | AI-native workflow design |
| Human–agent interaction and control | Functional demonstration |
| Usability and user flow | Real-world applicability |
| Visual and interaction design | Potential impact |

Source: judging sections on the [official event page](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026).

## Submission requirements

| Field | Requirement captured from the form |
| --- | --- |
| Project title | Up to **100 characters** |
| One-sentence summary | Up to **200 characters** |
| Project description | Up to **2,000 characters** |
| Project link | Optional; a Notion page was preferred for collecting the repository, write-up and supporting material. A repository or deployed app also works. |
| Demo URL | **Required** and accessible to judges; a video or live deployment is accepted. |

The form's **final submission closes editing and sends the project to judges**. Draft preparation and final submission are different actions; this document does not authorize submitting anything.

For Unfold, a localhost URL alone does not satisfy judge access. Our browser-local storage and subscription-backed local CLI runtime are project decisions, not organizer requirements. A shareable recording can demonstrate the complete journey without adding hosted board storage. If using a live demo instead, verify how judges will access its required runtime.

Source: [Official submission page](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026/submission). The Unfold access implications above are our engineering interpretation.

## Schedule and unresolved discrepancies

All entries below describe what was observed on November 7, rather than a newly confirmed schedule.

| Item | Captured information | Status |
| --- | --- | --- |
| Build period | November 7–11, 2026 | Overview described November 11 as the final build-and-submit day. |
| Submission deadline | **November 12, 2026, 12:30 AM** in the platform UI | **Timezone was not labeled. Do not silently interpret this as Pacific time.** Confirm the exact cutoff. |
| Winner announcement | November 14, online, in the overview | Relationship to the November 16 event was not clarified. |
| Winner demo and awards | November 16, San Francisco, in prizes/judging sections | May be separate from the online announcement; confirmation needed. |
| Trust/recovery session | November 8, **11 AM PST**: “When AI Gets It Wrong: Designing Trust and Recovery” | Relevant optional session; individual signup was required to reveal its meeting link. |
| Show & Tell | November 7, **1:30 PM PST** | Historical schedule entry. |
| Concept workshop | November 7, **2:15 PM PST**, laptop required | Historical schedule entry. |

The follow-up announcement review on November 7 found no stated changes to the deadline, schedule or submission requirements. That observation does not resolve the deadline timezone or awards-date ambiguity.

Sources: [Event schedule](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026) and [announcements](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026/people).

## Team eligibility and Track 1 prizes

The original organizer-page review recorded:

- Teams of **2–5 members**; solo participation was also allowed.
- **$180,000 total AWS credits across six winning teams**. This is a total pool, not an amount per team.
- Receiving AWS credits requires an incorporated company.
- The top three also receive **$100–$200 in NetMind API credits per team**.
- At least one award is reserved for a team including someone who graduated after November 2024.

These are organizer eligibility/prize descriptions, not confirmation that our team qualifies for a particular award or has received credits. Recheck the applicable terms before relying on them.

Source: eligibility and prize sections of the [event page](https://events.figstudio.vc/e/fig-ai-design-makeathon-2026).

## How Unfold addresses the brief

This section is **our product interpretation**, not an additional official rubric or a promise that every feature is complete.

Unfold helps a person move from visual inspiration to a clarified goal and a small real action. Its core journey is:

**Two images → starred explorations → separate questions and answers → a shared possibility → user acceptance → sourced research → a concrete first step.**

| Rubric concern | Evidence to show in Unfold |
| --- | --- |
| Problem framing and user value | Explain one target user's difficulty moving from inspiration to a feasible action, and why a visual exploration helps. |
| AI-native workflow design | Show distinct branch contexts, an actual research handoff and a connection agent consuming both goals' results. Explain why those roles are useful. |
| Human–agent interaction and control | The user changes direction through answers/comments, stops or retries work, and accepts/rejects/refines a shared proposal. Show one correction affecting what happens next. |
| Usability and user flow | Complete the journey without explaining internal node IDs, prompts or CLI mechanics. Make the next action clear and preserve user decisions. |
| Visual and interaction design | Keep images, questions, confirmed answers, proposals and actions legible and distinguishable; make connections and agent activity understandable. |
| Functional demonstration | Run the complete journey and make loading, failure/retry and saved-board behavior credible. Clearly identify any simulated portion. |
| Real-world applicability | Offer one modest, relevant action with sources and known constraints; do not imply that booking or another external action has already happened. |
| Potential impact | Explain what the user gains over collecting images or chatting in a linear thread. Keep impact claims proportional to demonstrated evidence. |

The project uses tldraw and subscription-backed local AI CLIs. Keep the browser-local architecture and storage policy in the [README](../README.md#data-storage). See the [implementation plan](unfold-implementation-plan.md) for technical scope; this reference does not replace current code or verification evidence.

## Demo and submission preparation

Prepare these materials before finalizing the organizer form:

- [ ] Define one target user, problem and two-image demo scenario.
- [ ] Show the two branches developing separately, including a meaningful user comment.
- [ ] Show the shared proposal and explain the benefit to each goal.
- [ ] Demonstrate user control: rejection/refinement or a correction that changes the next step.
- [ ] Show the research handoff, source links and one practical first action.
- [ ] Prepare a brief rationale covering the interaction choices and the role of AI.
- [ ] Record which portions are live and which, if any, are simulated.
- [ ] Prepare title, summary and description within the form's character limits.
- [ ] Supply a judge-accessible demo URL and supporting project material.
- [ ] Confirm the deadline timezone, any updated tool rules and the relevant event dates.
- [ ] Review the final material before closing editing through final submission.

Open product decisions remain decisions for the team: the precise target audience, final demo scenario, scope of agent autonomy and presentation narrative. Do not treat examples from earlier brainstorming as agreed requirements.
