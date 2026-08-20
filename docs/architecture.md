# Architecture

S.H.E.R.L.O.C.K. preserves the existing MCP-first architecture:

```text
Claude / Cursor / Kiro / MCP Inspector
        |
       MCP
        |
MCP Tool Layer
        |
Skill Executor
        |
Analysis Module Registry
        |
Data Aggregator + Cache
        |
Azure DevOps Layer
        |
Azure DevOps REST API / WIQL
```

Supporting services include the Query Engine for controlled saved-query creation/reuse, Navigation Engine for dynamic Azure DevOps URLs, Recommendation Engine for advisory output, Response Formatter for `brief`/`verbose`/`visual` modes, Custom Skill Registry, SQLite persistence, telemetry and token optimization.

Azure DevOps work items are read-only. The only Azure DevOps mutation is controlled saved-query creation/reuse. New queries are stored under `My Queries/{ADO_TEAM}`, so switching the configured team changes query storage automatically.
# Architecture Overview

KaarPulse implements a tiered, token-optimized architecture designed to prevent duplicate data retrieval and safely encapsulate Azure DevOps interaction.

## Architecture Layers

### 1. Tool Layer (`src/mcp/tools/`)
This is the outer interface exposed to the MCP client (Claude). Tools here are thin orchestrators. They don't perform direct Azure DevOps API calls or heavy logic. They parse user intent, construct a `Context`, and call the **Core Layer**.

### 2. Core Layer (`src/core/`)
The middle tier that enforces optimizations and data consistency.
- **Context Manager (`context-manager.ts`)**: Initializes request-scoped state (e.g. current team, organization, sprint).
- **Data Aggregator (`data-aggregator.ts`)**: Pulls shared snapshots of ADO data upfront and caches it for the lifetime of the request, eliminating duplicate REST calls.
- **Query Engine (`query-engine.ts`)**: Safely parses inputs into structured Azure DevOps WIQL queries.
- **Analysis Engine (`analysis-engine.ts`)**: Executes deterministic business logic (workload, bottlenecks, project health) independent of the LLM.
- **Recommendation Engine (`recommendation-engine.ts`)**: Analyzes the findings from the Analysis Engine to recommend safe, actionable items.
- **Skill Executor (`skill-executor.ts`)**: Handles the orchestration of Custom and Built-In skills.

### 3. Azure DevOps Layer (`src/azure-devops/`)
The foundational layer handling all physical networking and Azure DevOps REST interactions.
- Returns stripped, compact Data Transfer Objects (DTOs) based on strict `field-profiles`, ensuring minimal token overhead.
- Telemetry injected when `TOKEN_DEBUG` is active (`adoApiCalls`, ID queries, body retrievals, cache hits/misses).

## Skill Registry

- **Built-in skills** are registered in `InternalSkillRegistry` and documented under `skills/<name>/SKILL.md`. They cannot be edited, disabled, or deleted. They can be duplicated into a custom skill.
- **Custom skills** are declarative `SkillDefinition` rows in SQLite (`custom_skills`). They may only reference registered analysis modules and known MCP tool names. No JavaScript, Python, Shell, or arbitrary HTTP.
- **Composition** flattens source skills into a **module union**, then one `SkillExecutor` run with shared `DataAggregator` cache. Duplicate module ids are removed. Findings and recommendations are merged so the same work-item set is not reported twice.
- **Snapshot behaviour:** a composed skill stores the resolved `analysisModules` list. It does not re-read source skills at execution time. If skill A later gains or loses modules, skill C (composed from A) stays as it was at save time.

## Execution modes

`skill_execute` supports `brief` (KPI summary, at most three findings and three recommendations, important query links), `verbose` (module-level evidence and navigation), and `visual` (tables with severity and query links).

## Query behaviour

Findings with count **> 3** create or reuse a saved query under `My Queries/KaarFlow` in project **K4K** (Platform team scope where the WIQL requires it). Count **≤ 3** lists items directly. Re-running a skill reuses the same query title.

## Permissions and confirmation

Work item CREATE / UPDATE / DELETE / ASSIGN are forbidden. Query creation is allowed. Email send requires `email_send_confirmed` with `confirmation=true`. Custom skill create/update/delete require `confirm=true` after a preview.

## Persistence and audit

Custom skills persist across MCP restarts via SQLite. Disable/enable is stored on the row. Audit (`tl_activity`) records skill create, update, delete, enable, disable, duplicate, compose, and execute with `subject_ref` like `skill:weekly-management-review`, timestamp, action, and outcome. Credentials are never stored.

## Overdue definitions

Deadline analysis keeps **Due Date**, **Planned End**, **Sprint overdue**, and **Historical overdue** as separate counts. They are never combined into a single unlabeled overdue number.
