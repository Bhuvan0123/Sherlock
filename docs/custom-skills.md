# Custom skills

Custom skills are repeatable analysis workflows stored in SQLite (`custom_skills`). They compose **registered analysis modules**. They cannot run JavaScript, Python, Shell, or arbitrary HTTP. They cannot mutate work items.

They remain organization / project / team independent because execution uses `getConfig()`. They are email-independent. They support `brief`, `verbose`, and `visual`.

## Conversational flow

```text
Preview  →  Confirm  →  Save  →  Execute
```

Example request:

```text
Create a weekly engineering review combining sprint health,
workload, stale work and deadline risk.
```

The server must **preview** (`confirm=false` / preview path) before persist (`confirm=true`). Ambiguous asks such as “give me a management report” are **not** saved until you name the skill and confirm the module list.

## MCP tools

| Tool | Action |
| --- | --- |
| `kaarflow_compose_skill` | Union modules from named skills + extra modules |
| `kaarflow_create_skill` | Create from an explicit definition |
| `kaarflow_list_skills` | List built-in and custom |
| `kaarflow_get_skill` | Get one definition |
| `kaarflow_update_skill` | Update custom only |
| `kaarflow_remove_skill` | Delete custom only |
| `kaarflow_enable_skill` / `kaarflow_disable_skill` | Toggle custom |
| `kaarflow_duplicate_skill` | Clone built-in or custom into a new custom skill |
| `skill_execute` | Run built-in or custom |

Built-in skills cannot be edited, disabled, or deleted. Duplicate them instead.

## Composition

`kaarflow_compose_skill` flattens source skills into a **module union**, deduplicates ids, then one `SkillExecutor` run with a shared `DataAggregator` cache.

Example: `sprint-health-analysis` + `workload-analysis` + `stale-work-analysis` + `deadline-risk-analysis` → modules such as `sprint`, `workload`, `stale-work`, `deadline` (plus required dependencies like `team-capacity`).

**Snapshot behaviour:** the saved skill stores the resolved `analysisModules` list. It is not a live pointer. If source skill A later changes, composed skill C stays as it was at save time.

## Example definition (illustrative)

```json
{
  "id": "custom-weekly-engineering-review",
  "name": "weekly-engineering-review",
  "type": "custom",
  "analysisModules": ["sprint", "workload", "stale-work", "deadline"],
  "defaultMode": "visual",
  "supportedModes": ["brief", "verbose", "visual"],
  "queryEnabled": true,
  "recommendationEnabled": true,
  "navigationEnabled": true
}
```

Execute:

```text
Execute skill weekly-engineering-review in visual mode
```

## Persistence

Custom skills survive MCP restart via SQLite. `npm run doctor` checks database initialization. Do not delete `data/sherlock.sqlite` if you need those skills.

## Security

Validation rejects unknown modules, unknown tools, work-item mutation intent, and code-execution intent. Audit rows use `subject_ref` like `skill:weekly-engineering-review`.
