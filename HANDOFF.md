# K4K Team Lead Assistant — Implementation Handoff

> **Purpose of this document.** It describes what this project is, what has been built and verified so far, and exactly what remains. It is written to be handed to another coding agent as the sole source of context. Read the "Rules you must not break" section before changing any code.

- **Repository root:** `d:\Bhuvan\Kaar\K4K\Yeager`
- **Package name:** `k4k-team-lead-assistant` (v1.0.0, private)
- **Last verified:** typecheck clean, 181/181 tests passing, server boots over stdio and registers 76 tools (75 read-only), 23 resources, 10 prompts and 12 skills.
- **Host environment:** Windows 10, PowerShell. Node >= 22.5 required (uses the built-in `node:sqlite`).

---

## 1. What this project is

A **single-user MCP (Model Context Protocol) server** that turns Claude Desktop / Claude Code into a Team Lead assistant for the **K4K Platform** team. It is *not* a web app and has no UI.

It does two things:

1. **Read-only intelligence over Azure DevOps.** Project, team, members, sprints, work items, hierarchy, history, comments, plus analysis layered on top: workload, deadline risk, dependencies, project health, delivery indicators and assignment recommendations.
2. **Confirmation-gated email** via Microsoft Graph. This is the server's *only* outbound side effect, and it cannot happen without an explicit confirmation from the Team Lead.

### Fixed operating context

Resolved dynamically at runtime from environment variables — no IDs are hard-coded anywhere:

| Setting | Default | Notes |
| --- | --- | --- |
| `ADO_ORGANIZATION` | `KEBS4KAAR` | |
| `ADO_PROJECT` | `K4K` | project id resolved via REST |
| `ADO_TEAM` | `Platform` | team id, area paths and iterations resolved via REST |

Claude never passes organization, project or team to a tool.

### Technology

TypeScript (ESM, `NodeNext`) · Node >= 22.5 · `@modelcontextprotocol/sdk` ^1.30 · Azure DevOps REST API 7.1 (direct `fetch`, **not** Microsoft's ADO MCP server) · Microsoft Graph (OAuth2 client credentials) · `node:sqlite` (no native build step) · Zod ^4 · Vitest ^4 · `@modelcontextprotocol/inspector` ^2.2.

---

## 2. Rules you must not break

These are product requirements, enforced by code and by tests. Violating any of them breaks the build.

1. **Azure DevOps is strictly read-only.** No tool may create, update, delete or assign work items; change state, priority, area or iteration; add or remove comments; or modify backlogs, sprints, teams, repositories, pipelines, releases or permissions. No such method exists on the client and no such tool may be registered.
2. **Never add a generic HTTP tool.** No tool may accept `method`, `url`, `endpoint`, `path`, `headers`, a request payload, or credentials. `src/security/read-only-policy.ts` will refuse to register it and the server will fail to start.
3. **Only one POST to Azure DevOps is permitted:** `_apis/wit/wiql`, the WIQL query endpoint, whose body is validated as a single read-only `SELECT`. Everything else is `GET`.
4. **Email requires explicit confirmation.** `email_send_confirmed` is the only non-read-only tool. It takes only a draft id, `confirmation: true` and an optional integrity fingerprint — never a recipient, subject or body, so the confirmed content is necessarily the sent content.
5. **Never log or return secrets.** The PAT, Graph client secret and access tokens must never appear in tool output, logs, errors or resources. `src/utils/redact.ts` handles this; keep new code going through the logger and `AppError`.
6. **Never write to stdout.** Stdout carries the JSON-RPC stream. All diagnostics go to stderr via `createLogger`. A stray `console.log` corrupts the protocol.
7. **Never fabricate Azure DevOps data.** Measured data goes in `facts`; anything generated goes in `observations` / `concerns` / `recommendations` with the thresholds stated in `methodology`. If a value could not be measured, say so rather than estimating.

---

## 3. Repository layout (actual, current)

```
├── package.json                     scripts, deps (see §7)
├── tsconfig.json / tsconfig.build.json
├── vitest.config.ts                 pool: 'forks' for per-file isolation
├── mcp-inspector.config.json        two servers: tsx source, and built dist
├── .env.example                     every variable, documented
├── .gitignore                       ignores .env, dist/, data/, *.sqlite
├── src
│   ├── index.ts                     stdio entrypoint, signal handling
│   ├── server.ts                    buildServer(): registration + startup audit
│   ├── config/env.ts                Zod-validated config, memoised
│   ├── security/read-only-policy.ts THE enforcement module (read this first)
│   ├── utils
│   │   ├── redact.ts                secret redaction + summarise()
│   │   ├── logger.ts                stderr-only structured logger
│   │   ├── errors.ts                AppError, ADO HTTP status mapping
│   │   ├── cache.ts                 TTL cache with read-through getOrLoad
│   │   └── dates.ts                 day/week maths, business days
│   ├── services
│   │   ├── azure-devops
│   │   │   ├── client.ts            AzureDevOpsReadClient (GET-only + WIQL)
│   │   │   ├── context.ts           project/team/field/state-category resolution
│   │   │   ├── fields.ts            field + relation reference names
│   │   │   ├── types.ts             ADO response types, normalised WorkItem
│   │   │   ├── wiql.ts              escaped SELECT-only query builder
│   │   │   ├── work-item.service.ts reads, filters, blocked detection, hierarchy
│   │   │   ├── team.service.ts      teams, members, fuzzy member resolution
│   │   │   ├── sprint.service.ts    iterations, progress, carry-over, milestones
│   │   │   ├── project.service.ts   overview / details
│   │   │   └── analytics.service.ts throughput, cycle/lead time, reopened
│   │   ├── analysis
│   │   │   ├── types.ts             AnalysisEnvelope + buildEnvelope
│   │   │   ├── workload.service.ts  member/team workload, distribution
│   │   │   ├── deadline.service.ts  risk rating with reasons
│   │   │   ├── dependency.service.ts blocked, dependency chains, cross-team
│   │   │   ├── project-analysis.service.ts health dimensions
│   │   │   ├── productivity.service.ts delivery indicators, sprint trends
│   │   │   ├── assignment.service.ts candidate scoring, recommendations
│   │   │   └── review.service.ts    daily team review
│   │   ├── email
│   │   │   ├── graph.service.ts     token cache + sendMail
│   │   │   ├── email.service.ts     draft → confirm → send → log
│   │   │   └── templates.service.ts reminder / overdue / daily summary drafts
│   │   └── teamlead
│   │       ├── activity.service.ts  audit trail writes + analysis
│   │       └── review.service.ts    TL productivity, work management, weekly
│   ├── database
│   │   ├── connection.ts            node:sqlite wrapper + migrations
│   │   ├── schema/schema.ts         tl_activity, email_drafts, email_send_log
│   │   └── repository/{activity,email}.repository.ts
│   ├── skills/loader.ts             SKILL.md discovery, parsing and validation
│   └── mcp
│       ├── tool-registry.ts         registerTool(): audit + auditing + errors
│       ├── tools/{ado,analysis,teamlead,email,skills}/*.tools.ts
│       ├── resources/index.ts       9 read-only resources
│       ├── resources/skills.ts      skill catalogue + per-skill resources
│       └── prompts/index.ts         10 prompts
├── skills                           12 markdown workflows + _shared rules
│   ├── README.md, TESTING.md
│   ├── _shared/{data,analysis,safety}-rules.md, output-format.md
│   └── <skill-name>/SKILL.md        one per skill
└── tests
    ├── helpers
    │   ├── ado-fixture.ts           fake ADO REST layer (incl. WIQL evaluator)
    │   ├── harness.ts               env + in-memory DB + fixture client wiring
    │   └── mcp-client.ts            real MCP client over in-memory transport
    ├── security/read-only-policy.test.ts
    ├── security/tool-surface.test.ts   ← the critical security proof
    ├── ado/reads.test.ts
    ├── analysis/analysis.test.ts
    ├── email/confirmation.test.ts
    ├── skills/skills.test.ts        catalogue, routing, tool mapping, safety
    └── skills/degraded-data.test.ts empty/missing-data behaviour
```

---

## 4. What is implemented

### 4.1 Read-only enforcement (three independent layers)

`src/security/read-only-policy.ts` is the single enforcement point. Understand it before touching anything else.

| Layer | Mechanism |
| --- | --- |
| Type surface | `AzureDevOpsReadClient` has named read methods only — no `post`/`put`/`patch`/`delete`/`request`, no `createWorkItem`/`updateWorkItem`/`deleteWorkItem`. |
| Request chokepoint | Every outbound call passes `assertReadOnlyRequest(method, url)`: GET only, plus POST to `_apis/wit/wiql`. Forbidden path fragments (work-item creation, recycle bin, pushes, refs, pull requests, builds, pipelines, releases, ACLs, memberships, hooks, tokens) are blocked for *any* method, and percent-encoded evasion is decoded before matching. WIQL bodies are validated by `validateWiqlQuery` (single statement, `SELECT`-only, no mutation keywords, literals stripped before keyword scanning). |
| Tool-surface audit | `auditToolSurface` runs per tool at registration *and* over the whole surface in `assertReadOnlyToolSurface()` during `buildServer`. It rejects mutation-shaped tool names and forbidden parameters. Startup aborts on violation. |

Notable detail: forbidden parameters are split into a **universal** list (`method`, `url`, `endpoint`, `path`, `headers`, `pat`, `token`, `api_version`, …) and a **payload** list (`body`, `payload`, `patch_document`, `operations`, …). The payload list is waived for exactly one case — `body` on the `email_*` drafting surface, which is an email body and cannot reach Azure DevOps. Tool-name patterns use explicit `(^|[_-])` boundaries because `\b` does not work in snake_case.

### 4.2 Azure DevOps read layer

- **Client** (`client.ts`): PAT basic auth, `api-version` injection, 6-way concurrency semaphore, exponential backoff with `Retry-After` for 429/5xx, 30 s timeout, batched work-item GET chunked at ADO's 200-id limit with `errorPolicy=omit`, non-JSON 200 detected as a sign-in redirect (invalid PAT), request stats for diagnostics, `buildWorkItemWebUrl` for browser links.
- **Context** (`context.ts`): resolves and caches project, team, the project's real field catalogue (so queries never reference a field the process lacks) and per-type state → category maps. Falls back to `GET workitemtypes/{type}/states` when the types payload omits inline states. Selective cache invalidation drives `ado_refresh_project_context`.
- **Work items** (`work-item.service.ts`): normalisation to a single `WorkItem` shape; filters by type/state/assignee/sprint; due today / this week / overdue; unassigned; high priority; recently changed; history; comments (HTML stripped); relations; parent; children; full hierarchy via a recursive `WorkItemLinks` WIQL query using real relation links. **Blocked detection** uses four real signals — state name, the CMMI `Blocked` field, tags (`blocked`/`impediment`/`waiting`), and unfinished predecessor links — and returns the evidence for each match.
- **Teams / sprints / analytics**: fuzzy member resolution (display name, email, partial); sprint resolution (`current`, `next`, `previous`, name, partial); sprint progress with story points, capacity and **carry-over evidence read from revision history**; delivery metrics with throughput, cycle time, lead time and reopen detection (which inspects both completed work *and* currently-open items that were once completed, found with WIQL `EVER`).

### 4.3 Analysis layer

Every analysis tool returns an `AnalysisEnvelope`:

```
{ kind, generatedAt, dataSource, facts, observations[], concerns[], recommendations[], methodology[], disclaimer? }
```

`facts` is measured Azure DevOps data. The other fields are generated by published heuristics, and every tool's text summary is prefixed `[AI-GENERATED ANALYSIS]` or `[AI-GENERATED RECOMMENDATION]`. Implemented: project health (7 rated dimensions, each with reasons), full project analysis, deadline risk (Low/Medium/High with the rules that fired — no invented probabilities), at-risk items, deadline overview, team and member workload, work distribution with imbalance thresholds, available members, blocked items, dependency edges and chains, cross-team dependencies, release blockers, delivery indicators (deliberately **no** single productivity score), member sprint history, assignment recommendations (capacity + demonstrated familiarity from completed type/area/tags, restating `actionRequired: READ_ONLY_REFUSAL_MESSAGE`), and the daily team review.

### 4.4 Team Lead audit trail

SQLite (`tl_activity`), written by `tool-registry.ts` for **every** tool call: timestamp, category, action, tool, redacted parameter summary, redacted result summary, outcome (`success` / `error` / `rejected`), error code, duration, subject reference and confirmation status. Credentials, tokens and email bodies are never stored. Tools: `tl_get_activity`, `tl_get_activity_summary`, `tl_analyze_activity`, `tl_analyze_productivity`, `tl_analyze_work_management`, `tl_get_weekly_review`, `tl_purge_activity`. The analysis explicitly states it covers actions taken *through this server*, not actions taken directly in the Azure DevOps UI.

### 4.5 Email (the only mutation)

Flow: `email_draft*` → preview (recipients, subject, full body, SHA-256 fingerprint) → Team Lead confirms → `email_send_confirmed` → Graph `sendMail` → send log.

Guarantees implemented and tested: `confirmation !== true` is refused before any network call; drafts expire (`EMAIL_DRAFT_TTL_MINUTES`); a draft cannot be sent twice; a cancelled or expired draft cannot be sent; the stored draft is re-fingerprinted at send time so post-confirmation tampering is refused; an optional `expected_body_sha256` lets the client bind the confirmation to what it displayed; recipients are re-validated against `EMAIL_ALLOWED_RECIPIENTS` at send time; the send log stores recipients, subject, timestamp, draft id, confirmation flag and body fingerprint but **has no column for the body**, and draft bodies are scrubbed once closed.

### 4.6 Skills

`skills/` holds twelve markdown playbooks that orchestrate the tools above into repeatable Team Lead workflows: `team-morning-brief`, `workload-analysis`, `deadline-risk-analysis`, `project-health-analysis`, `sprint-health-analysis`, `work-assignment-recommendation`, `team-productivity-review`, `tl-productivity-review`, `team-email-assistant`, `daily-team-report`, `weekly-team-review`, and the `skill-index` router. Four documents in `skills/_shared/` carry the data, analysis, output and safety rules every skill inherits.

Each `SKILL.md` is YAML frontmatter plus ten fixed sections. `src/skills/loader.ts` discovers them at startup, parses them with a deliberately minimal frontmatter reader (no YAML dependency), and `assertSkillCatalogueIsValid()` aborts startup unless every skill is fully specified, declares itself non-mutating, and **references only tools the server actually exposes**. That last check is what makes an invented tool name impossible: renaming a tool breaks the build rather than silently producing a skill that tells Claude to call something imaginary.

Skills reach the client two ways, both backed by the same files: the `skill_list` and `skill_get` tools (so the model can route on its own), and `skill://kaarpulse/*` resources (so the Team Lead can attach one deliberately). Loading a skill is a local file read and issues no Azure DevOps request — a test asserts this. See `skills/README.md`.

### 4.7 MCP surface

- **76 tools**, 75 read-only. The single non-read-only tool is `email_send_confirmed`. Annotations (`readOnlyHint`, `destructiveHint: false`) are set on every tool so clients display the boundary.
- **9 resources:** `project://k4k/overview`, `/platform/team`, `/current-sprint`, `/deadlines`, `/risks`, `/workload`, `/recent-changes`, `/blocked`, and `policy://k4k/access-mode` (states the read-only policy and the confirmation requirement).
- **10 prompts:** `daily_team_review`, `sprint_review`, `project_health_review`, `deadline_review`, `team_workload_review`, `work_assignment_analysis`, `overdue_followup_review`, `blocked_work_review`, `tl_weekly_review`, `member_review`.
- **Server instructions** (in `src/server.ts`) tell the model the scope, the read-only boundary, the facts-vs-analysis distinction, the confirmation rule and where to start for common questions.

<details>
<summary>Full tool list (74)</summary>

**Azure DevOps — project (15):** `ado_get_project_overview`, `ado_get_project_details`, `ado_get_project_teams`, `ado_get_platform_team`, `ado_get_team_members`, `ado_get_project_members`, `ado_get_team_iterations`, `ado_get_current_sprint`, `ado_get_upcoming_sprints`, `ado_get_sprint_progress`, `ado_get_project_milestones`, `ado_get_backlogs`, `ado_get_work_item_types`, `ado_refresh_project_context`, `ado_get_connection_status`

**Azure DevOps — work items (20):** `ado_get_work_item`, `ado_get_work_items`, `ado_search_work_items`, `ado_get_work_items_by_type`, `ado_get_work_items_by_state`, `ado_get_work_items_by_assignee`, `ado_get_work_items_by_sprint`, `ado_get_work_items_due_today`, `ado_get_work_items_due_this_week`, `ado_get_overdue_items`, `ado_get_blocked_items`, `ado_get_unassigned_items`, `ado_get_high_priority_items`, `ado_get_recently_changed_items`, `ado_get_work_item_history`, `ado_get_work_item_comments`, `ado_get_related_work_items`, `ado_get_parent_work_item`, `ado_get_child_work_items`, `ado_get_work_item_hierarchy`

**Analysis (22):** `analysis_project_health`, `analysis_project`, `analysis_team_productivity`, `analysis_team_delivery_metrics`, `analysis_deadline_risk`, `analysis_at_risk_items`, `analysis_deadlines`, `analysis_team_workload`, `analysis_work_distribution`, `analysis_available_team_members`, `analysis_member_workload`, `analysis_member_work`, `analysis_member_completed_work`, `analysis_member_sprint_history`, `analysis_assignment_recommendation`, `analysis_assignment_recommendations`, `analysis_blocked_items`, `analysis_dependencies`, `analysis_cross_team_dependencies`, `analysis_items_blocking_release`, `analysis_critical_dependencies`, `analysis_daily_team_review`

**Team Lead (7):** `tl_get_activity`, `tl_get_activity_summary`, `tl_analyze_activity`, `tl_analyze_productivity`, `tl_analyze_work_management`, `tl_get_weekly_review`, `tl_purge_activity`

**Email (10):** `email_get_team_contacts`, `email_get_configuration`, `email_draft`, `email_draft_deadline_reminder`, `email_draft_overdue_work`, `email_draft_daily_team_summary`, `email_list_drafts`, `email_cancel_draft`, `email_send_confirmed` *(the only non-read-only tool)*, `email_get_send_log`

</details>

---

## 5. Current status

### Verified

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **181 passed / 181**, 7 files |
| Server boot over stdio | starts, warns clearly when `ADO_PAT` or Graph credentials are absent, logs `tools: 76, readOnlyTools: 75, skills: 12` |
| Startup read-only audit | passes; only `email_send_confirmed` is non-read-only |
| Security proof | no mutation-named tool, no HTTP/credential parameter, no payload parameter outside `email_draft`, attempts to call `ado_update_work_item` &co. fail as unknown tools |
| Email gate | drafting never calls Graph; sending without `confirmation: true` is refused; tampered, expired, cancelled and already-sent drafts are refused; the send is logged without the body |

### Test suite composition

| File | Tests | Covers |
| --- | --- | --- |
| `tests/security/tool-surface.test.ts` | 14 | the critical "no ADO mutation tool exists" proof, via a real MCP client |
| `tests/security/read-only-policy.test.ts` | 45 | method policy, forbidden paths, WIQL validation, client surface, PAT never exposed |
| `tests/ado/reads.test.ts` | 30 | project, teams, members, sprints, work items, hierarchy, history, comments, overdue/blocked/unassigned, 401/403/404/429/503 handling |
| `tests/analysis/analysis.test.ts` | 24 | envelopes, workload, deadlines, dependencies, health, productivity, assignment, daily review |
| `tests/email/confirmation.test.ts` | 19 | drafting, the confirmation gate, allowlist, logging, audit rows |
| `tests/skills/skills.test.ts` | 35 | skill discovery, structure, routing, trigger uniqueness, tool mapping, safety contract, MCP exposure |
| `tests/skills/degraded-data.test.ts` | 14 | empty team, empty backlog, no sprint, no due dates, unassigned work, overloaded team, missing fields |

### How the tests work (important)

Tests exercise the **real** service graph. `tests/helpers/harness.ts` sets a deterministic environment, an in-memory SQLite database and a fixture-backed `AzureDevOpsReadClient`; every service takes its collaborators by constructor injection with a lazy singleton default, so replacing the shared client before first use is enough. `tests/helpers/ado-fixture.ts` is a fake Azure DevOps REST layer with realistic 7.1 payload shapes and a small WIQL evaluator (AND/OR/parentheses, `IN`, `CONTAINS`, `UNDER`, `EVER`, `@Today ± N`, day-granular date comparison, and recursive `WorkItemLinks` tree queries). Tool-surface assertions go through a real MCP client over the SDK's in-memory transport, so they check what Claude Desktop would actually see.

This is a test double for the API, not mock data served to the user — the server itself never fabricates Azure DevOps data. Live verification against the real KEBS4KAAR organization is a separate, explicitly-run script (still to be written, see §6).

---

## 6. Remaining work

Ordered. Items 1–3 are required for the acceptance criteria; 4–6 are polish.

### 1. Tests for the Team Lead audit trail, resources and prompts

Two test files are missing (the skill suites are complete). Follow the existing patterns exactly (`setupHarness` + `connectTestClient`).

- **`tests/teamlead/activity.test.ts`**
  - Every tool call writes exactly one `tl_activity` row: assert category, action, tool, outcome, `duration_ms` present, `subject_ref` (e.g. `work-item:1111`) and `confirmation_status`.
  - A failing tool records `outcome = 'error'` with the error code; a refused email records `outcome = 'rejected'`.
  - Parameter and result summaries are **redacted and truncated** — assert no PAT/secret substring ever appears in `tl_activity`.
  - `tl_get_activity` filters by `days`, `category`, `tool`, `outcome`, `limit`.
  - `tl_get_activity_summary` aggregates by category/tool/outcome/day, counts confirmations, drafts created and emails sent, and lists repeated subjects.
  - `tl_analyze_activity` on an empty trail returns the "fresh installation" observation and no concerns; after drafting an email without sending, it raises the "drafts prepared but none sent" concern; after two look-ups of the same still-open item, it raises the repeated-subject concern.
  - `tl_analyze_productivity` / `tl_analyze_work_management` / `tl_get_weekly_review` return envelopes whose `facts` combine local activity with live ADO state, and whose methodology states the trail covers only actions taken through this server.
  - `tl_purge_activity` deletes only rows older than the cutoff.
- **`tests/mcp/surface.test.ts`**
  - All 9 resources are listed and readable; each returns JSON (or text for the policy resource); `policy://k4k/access-mode` states the read-only rule and the confirmation requirement.
  - All 10 prompts are listed; each returns at least one message; arguments (e.g. `member_review`'s member, `sprint_review`'s sprint) are substituted into the text; prompt text reinforces the read-only boundary and the facts-vs-analysis split.
  - Server instructions are non-empty and mention read-only Azure DevOps and email confirmation.

### 2. Live verification scripts (referenced by `package.json` but not yet created)

- **`scripts/verify-live.ts`** (`npm run verify:live`) — connects to the **real** KEBS4KAAR / K4K / Platform project with the PAT from `.env` and prints a human-readable checklist: project resolved, teams listed, Platform team resolved, members listed, current sprint resolved, a work-item search returning real ids, a hierarchy walk from a real Epic, history read for one item, overdue/blocked counts, and the client's request stats. It must **exit non-zero** on any failure, print nothing secret, and make no write of any kind. This is what proves acceptance criteria against real data.
- **`scripts/verify-readonly.ts`** (`npm run verify:readonly`) — a standalone guard that boots the server, lists the tool surface and fails loudly if any tool is mutation-shaped or non-read-only beyond `email_send_confirmed`. Duplicates the security test deliberately so it can run in CI or a pre-commit hook without the test runner.

### 3. Documentation

- **`README.md`** (root, does not exist yet): what the server does; architecture diagram (Claude → MCP server → read-only ADO service → REST API); installation from a clean environment (Node >= 22.5, `npm ci`, `cp .env.example .env`); every environment variable; **Azure DevOps PAT setup with least-privilege scopes** (Work Items Read, Project and Team Read, Identity Read, Analytics Read, Graph Read — explicitly no write scopes); **Microsoft Graph app registration** (application permission `Mail.Send`, admin consent, client secret); Claude Desktop setup (`claude_desktop_config.json` example using `node dist/index.js` with `cwd`, secrets left in `.env`, not in the client config); Claude Code setup (`claude mcp add`); the tool/resource/prompt catalogue; the read-only security model; the email confirmation workflow; troubleshooting (401/403/404/429, "server not appearing in Claude", stdout corruption, Node version, empty results because a field is missing from the process); development and testing.
- **`docs/architecture.md`** — layers, dependency direction, caching, concurrency and retry behaviour, why WIQL POST is safe, why `node:sqlite`.
- **`docs/tools.md`** — every tool with parameters, return shape and when to use it.
- **`docs/security.md`** — the three enforcement layers, the forbidden lists, the email gate, secret handling and redaction, the audit trail, threat cases (prompt-injected "update this item", tampered draft, arbitrary HTTP attempt) and how each is refused.
- **`docs/azure-devops.md`** — PAT creation and scopes, the REST endpoints used, field/state-category discovery, the blocked-work signals, hierarchy traversal, rate limits.
- **`docs/email.md`** — Graph app registration, least-privilege permissions, the draft/confirm/send/log flow, the allowlist, draft expiry, what is and is not stored.
- **`docs/skills.md`** — or simply link `skills/README.md` from the root README rather than duplicating it. Cover what a skill is, the catalogue, how `skill_list` / `skill_get` and the `skill://kaarpulse/*` resources expose them, the frontmatter contract, startup validation, and how to add one.
- **`docs/claude-setup.md`** — Desktop and Code configuration, verifying the connection, example conversations for the main workflows.
- **`docs/mcp-inspector.md`** — installation (already a devDependency), starting the server, `npm run inspector` and `npm run inspector:build`, connecting, inspecting tool schemas, executing tools, testing resources and prompts, error-handling checks, and the **acceptance checklist that the Inspector shows no create/update/delete/assign/state/comment/sprint/backlog tool**. Verify the exact CLI flags against the installed `@modelcontextprotocol/inspector` version before documenting them — do not invent flags.

### 4. MCP Inspector acceptance pass (manual)

Run `npm run inspector`, then confirm: all four tool categories appear; schemas render; a handful of tools execute against the real project; resources and prompts load; an error case (e.g. a non-existent work-item id) returns a clean message with no stack trace or PAT; and `email_send_confirmed` visibly requires `confirmation`. Record the outcome in `docs/mcp-inspector.md`.

### 5. Optional hardening / nice-to-have

- Cache metrics on `ado_get_connection_status` (hit rate, entry count) for diagnosing staleness.
- A pre-commit hook running `npm run typecheck && npm run test:security`.
- CI workflow (typecheck + full test run on Node 22 and 24).
- Cross-team dependency detection currently keys off the configured team's area paths; consider also resolving the *other* team's name for a friendlier message.
- `analysis_member_work` and `analysis_member_workload` overlap somewhat; consider consolidating if the tool count needs trimming.

### 6. Known minor gaps

- Cycle-time and lead-time distributions are only measured for items where the relevant dates exist; the count of measured items is reported, but the README should say plainly that a process not using `ActivatedDate` yields no cycle time.
- Reopen detection and carry-over inspection are bounded (60 items / documented limits) and report their coverage; that is intentional, not a bug.
- `EMAIL_ALLOWED_RECIPIENTS` is optional. Recommend setting it in the README, since without it any valid address can be drafted to.

---

## 7. Working on this repo

### Commands

```bash
npm ci                    # install (Node >= 22.5)
npm run typecheck         # tsc --noEmit
npm run test              # vitest run  (132 tests today)
npm run test:security     # the read-only proofs only
npm run dev               # tsx watch src/index.ts (stdio; logs to stderr)
npm run build             # tsc -p tsconfig.build.json -> dist/
npm start                 # node dist/index.js
npm run inspector         # MCP Inspector against the tsx source server
npm run inspector:build   # build, then Inspector against dist/
npm run verify:live       # TO BE WRITTEN (§6.2)
npm run verify:readonly   # TO BE WRITTEN (§6.2)
```

A quick boot smoke test on Windows PowerShell:

```powershell
$env:DATABASE_URL=":memory:"; npx tsx src/index.ts
```

It should log `MCP server ready` with `tools: 74, readOnlyTools: 73`, then wait on stdin.

### Conventions to follow

- **Adding a tool:** define it through `registerTool` in the right `src/mcp/tools/**` file. Provide `name` (`ado_get_*` / `analysis_*` / `tl_*` / `email_*`), `title`, a description that says what the data is and when to use it, a Zod `inputSchema` with `.describe()` on every field, an `audit` block, and a `summarise` when the default headline would be unhelpful. Registration itself enforces the naming and parameter policy.
- **Adding an ADO read:** add a named method to `AzureDevOpsReadClient`. Never bypass the private `execute`.
- **New analysis:** return `buildEnvelope(...)`; keep measured values in `facts`; state thresholds in `methodology`.
- **Errors:** throw `AppError` with a `code`, a user-facing `message` and an actionable `hint`. `mapAdoHttpError` already handles 401/403/404/429/5xx wording.
- **Comments:** explain constraints and non-obvious intent only. Do not narrate the code.
- **PowerShell:** this is a Windows host — Unix-isms like `ls -la`, `head` and `cat` are unavailable in the default shell.

### Debugging tip

To inspect a tool's real response shape while writing tests, write a temporary script under `tests/helpers/` that uses `setupHarness()` + `connectTestClient()`, call the tool and print the payload, then delete the script. (One such scratch helper was used during development and has been removed.)

---

## 8. Acceptance criteria — where each stands

| Criterion | Status |
| --- | --- |
| Claude connects to the MCP server | Boots and serves over stdio; connection verified via a real in-memory MCP client. **Manual Claude Desktop check outstanding** (§6.4) |
| Data comes from the real KEBS4KAAR / K4K / Platform context | Implemented, resolved dynamically. **Live run outstanding** (§6.2) |
| All Azure DevOps tools read-only; no mutation tools exist | Done and proven by tests |
| Work-item hierarchy | Done (recursive `WorkItemLinks`, real relation links) |
| Team/member, sprint, deadline, health, workload analysis | Done |
| Assignment recommendations | Done (recommend-only, restates the read-only boundary) |
| TL activity tracking | Implemented; **dedicated tests outstanding** (§6.1) |
| Email drafting; sending requires explicit confirmation | Done and proven by tests |
| PAT and Graph credentials never exposed | Done (redaction + assertions) |
| Tests pass | 132/132 today; two more test files planned |
| README setup instructions work from a clean environment | **Outstanding** (§6.3) |
| MCP Inspector shows only read operations | Config in place; **manual pass outstanding** (§6.4) |
