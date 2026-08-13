# KaarPulse Skills

Repeatable Team Lead workflows for the KaarPulse MCP server. A skill is a markdown playbook that tells Claude, step by step, which of the server's MCP tools to call for a recurring question, how to interpret what comes back, and what it must never claim.

Skills add no new capability. They orchestrate the tools that already exist, which is what keeps them safe: **a skill cannot change Azure DevOps, because no tool can.**

## Layout

```
skills/
├── README.md                          this file
├── TESTING.md                         manual and automated verification
├── _shared/                           rules every skill inherits
│   ├── data-rules.md                  where facts come from, what "unknown" means
│   ├── analysis-rules.md              how to reason without overstating
│   ├── output-format.md               how output is structured
│   └── safety-rules.md                read-only, confirmation, credentials
├── skill-index/SKILL.md               the router: request → skill, and how to chain
├── team-morning-brief/SKILL.md
├── workload-analysis/SKILL.md
├── deadline-risk-analysis/SKILL.md
├── project-health-analysis/SKILL.md
├── sprint-health-analysis/SKILL.md
├── work-assignment-recommendation/SKILL.md
├── team-productivity-review/SKILL.md
├── tl-productivity-review/SKILL.md
├── team-email-assistant/SKILL.md
├── daily-team-report/SKILL.md
└── weekly-team-review/SKILL.md
```

Directories starting with `_` hold shared material and are not skills.

## The catalogue

| Skill | Category | Answers | Sends email |
| --- | --- | --- | --- |
| `skill-index` | router | "What can you do?", ambiguous and compound requests | no |
| `team-morning-brief` | briefing | "What should I look at today?" | no |
| `daily-team-report` | report | "Prepare my daily report" | no |
| `weekly-team-review` | report | "Give me last week's review" | no |
| `workload-analysis` | analysis | "Who is overloaded?" | no |
| `deadline-risk-analysis` | analysis | "What work is at risk?" | no |
| `project-health-analysis` | analysis | "How is the project doing?" | no |
| `sprint-health-analysis` | analysis | "How is this sprint?" | no |
| `team-productivity-review` | analysis | "How productive is the team?" | no |
| `tl-productivity-review` | analysis | "How am I doing as TL?" | no |
| `work-assignment-recommendation` | recommendation | "Who should take #1234?" | no |
| `team-email-assistant` | communication | "Send reminders about overdue work" | **only after explicit confirmation** |

## How Claude reaches a skill

Skills are discovered from disk at server startup and published two ways, both backed by the same files:

**Tools** — the model can pull a skill on its own initiative:

- `skill_list` — the catalogue with descriptions, trigger phrases and the tools each skill uses. Optional `category` filter.
- `skill_get` — one skill's full instructions plus the shared rules. Takes `name`, and `include_shared_rules` (default `true`).

**Resources** — the Team Lead can attach one deliberately in the client:

- `skill://kaarpulse/index` — the catalogue as JSON
- `skill://kaarpulse/<name>` — one skill as markdown
- `skill://kaarpulse/_shared/rules` — the four shared rule documents

Both are local file reads. Loading a skill contacts nothing and changes nothing; the Azure DevOps calls happen when the model follows the skill's Workflow.

The server's own instructions tell the client to prefer a skill for recurring workflows, so in practice "give me a morning briefing" reaches `team-morning-brief` without the Team Lead naming it.

## Anatomy of a SKILL.md

YAML frontmatter, then eleven required sections in a fixed order.

```yaml
---
name: workload-analysis          # must equal the directory name
title: Workload Analysis
description: One sentence, used for routing.
version: 1.0.0
category: briefing | analysis | recommendation | communication | report | router
mutates_azure_devops: false      # always false; validation rejects true
requires_confirmation: false     # true only where email_send_confirmed is reachable
primary_tools:                   # every name must be a real MCP tool
  - analysis_work_distribution
supporting_tools:
  - analysis_member_workload
missing_capabilities:            # what the skill would want but cannot have
  - "Azure DevOps holds no leave calendar, so absence cannot be accounted for."
triggers:                        # phrases that should route here; unique across the catalogue
  - who is overloaded
---
```

The body must contain, in this order:

`## Purpose` · `## When to Use` · `## Required Inputs` · `## Data Sources` · `## Workflow` · `## Analysis Rules` · `## Output Format` · `## Edge Cases` · `## Safety Rules` · `## Example Requests`

The frontmatter parser is deliberately minimal — flat `key: value` pairs and `- item` lists only. No nesting, no multi-line strings, no anchors. That keeps the files easy to hand-edit and adds no dependency.

## Validation

The catalogue is checked at two points, and a failure is loud in both.

**At server startup**, `assertSkillCatalogueIsValid()` runs after tool registration and aborts the process on any issue. It checks that each skill:

- matches its directory name and is not a duplicate;
- declares `mutates_azure_devops: false`;
- has at least one trigger, and primary tools (except the router);
- has all ten required sections, in order, non-empty;
- **references only tools the server actually exposes** — this is what makes invented tool names impossible;
- declares `requires_confirmation: true` if it can reach `email_send_confirmed`.

**In the test suite**, `tests/skills/skills.test.ts` re-checks all of the above against the live MCP tool list, plus routing coverage, trigger uniqueness, the email confirmation protocol, and that loading a skill issues no Azure DevOps request.

The practical consequence: if a tool is ever renamed or removed, every skill that mentions it fails the build immediately rather than silently instructing Claude to call something that no longer exists.

## Adding a skill

1. Create `skills/<name>/SKILL.md` with the frontmatter and all ten sections.
2. List only real tools. Check against `skill_list`, or `npm run inspector`.
3. Give it triggers that no other skill claims.
4. Add it to the routing table in `skills/skill-index/SKILL.md`.
5. Add its name to `EXPECTED_SKILLS` in `tests/skills/skills.test.ts`.
6. Run `npm run test:skills`.
7. Restart the MCP server — the catalogue is read once per process.

## Editing a skill

Skills are plain markdown with no build step. Edit the file, restart the server, done. `npm run test:skills` is the fastest way to confirm you have not broken the contract.

## Constraints that cannot be edited away

- **Azure DevOps is read-only.** No skill may instruct, imply or claim a change. Recommendations are text.
- **Email needs explicit per-draft confirmation.** Only `team-email-assistant` reaches the send tool, and only after the Team Lead has seen the full draft and said yes to that specific draft.
- **No invented data.** Every id, title, owner, date and count comes from a tool call in the current run.
- **No invented tools.** Validation enforces it.

These live in `_shared/safety-rules.md` and override anything a skill body says.
