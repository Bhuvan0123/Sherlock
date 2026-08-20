# Custom Skills

Custom skills can be created conversationally and persisted in SQLite.

Example request:

```text
Create a weekly engineering review combining sprint health, workload, stale work and deadline risk.
```

Flow:

```text
Preview -> Confirm -> Save -> Execute
```

Supported operations include create, update, remove, list, get, enable, disable, duplicate, compose and execute. Custom skills remain organization, project and team independent because they use centralized configuration at runtime.
# Custom Skill Creator & Registry

KaarFlow supports conversational creation of Custom Skills. Team Leads can create their own repeatable analysis workflows using natural language prompts to Claude, which are then parsed and stored as structured `SkillDefinition` objects inside the local SQLite database.

## What are Custom Skills?

Unlike the built-in skills (which are hardcoded and loaded via `SKILL.md` playbooks and TypeScript executors), custom skills:
- Can be created, edited, disabled, duplicated, and deleted entirely through natural language.
- Do not execute arbitrary code or shell commands (for security).
- Are composed of existing, robust `AnalysisModule`s like `workload`, `sprint`, `deadline`, and `stale-work`.
- Are persisted locally in the `custom_skills` table of the SQLite audit database.

## How to Create Custom Skills

You can instruct KaarFlow directly from your chat window.

**Example Prompt**:
> "Create a skill called \`weekly-platform-review\`. Every week analyse the Platform team's workload, check for approaching deadlines, and verify backlog health. Generate recommendations and queries. Make the default mode visual."

Behind the scenes, KaarFlow's MCP tools translate this intent into a structured JSON `SkillDefinition`:
```json
{
    "id": "custom-weekly-platform-review",
    "name": "weekly-platform-review",
    "type": "custom",
    "analysisModules": ["workload", "deadline", "backlog"],
    "requiredData": ["workload", "deadlines"],
    "defaultMode": "visual",
    "supportedModes": ["brief", "verbose", "visual"],
    "queryEnabled": true,
    "recommendationEnabled": true
}
```

### Confirmation Flow
KaarFlow will NEVER save a new skill silently. It will respond with a **Preview**, asking for your confirmation. Once you confirm ("Yes, save it"), the skill is persisted and immediately available for execution via `/weekly-platform-review`.

## Available Analysis Modules

Custom skills can be composed of any combination of these registered modules:
- `review`: Comprehensive sprint and assignment review.
- `workload`: Active and open item distribution across team members.
- `deadline`: Approaches deadlines and overdue items.
- `sprint`: Sprint progress and completion tracking.
- `backlog`: Analysis of hierarchy and data quality.
- `date`: State transitions vs. dates.
- `hierarchy`: Epic/Feature linking.
- `stale-work`: Items untouched for too long.
- `team-capacity`: Capacity vs assignment.

*(Attempting to request a module that does not exist will fail validation automatically.)*

## Output Modes

Custom skills support three output modes that control response verbosity:
1. **Brief**: High-level KPIs, top 3 findings, top 3 recommendations, and query links.
2. **Verbose**: Detailed lists, all evidence, full recommendation reasoning.
3. **Visual**: Clean Markdown tables for easy scanning.

You can specify the mode when executing:
`/weekly-platform-review visual`

## Query Generation & Navigation

If your custom skill has `queryEnabled: true`, KaarFlow will automatically aggregate findings. If any finding exceeds 3 items, KaarFlow will use the internal `QueryEngine` to generate or reuse an ADO Query, providing you with a direct navigation URL instead of flooding your chat context.

## Managing Custom Skills

You can use natural language to manage your skills:
- **List**: "Show me my skills" -> Lists all Built-in and Custom skills.
- **Show**: "Show the definition of weekly-platform-review" -> Displays the configuration.
- **Edit**: "Edit weekly-platform-review to also include the stale-work module" -> Previews changes before saving.
- **Disable/Enable**: "Disable weekly-platform-review" -> Prevents execution without deleting.
- **Duplicate**: "Duplicate the workload-analysis skill and call it my-workload" -> Clones an existing definition.
- **Delete**: "Delete weekly-platform-review" -> Removes it permanently (requires confirmation).

*Note: Built-in skills cannot be edited, disabled, or deleted. They can be duplicated into a custom skill.*

## Composition

`kaarflow_compose_skill` unions modules from named skills (and optional extra modules). Example: `sprint-health-analysis` + `workload-analysis` + `backlog-data-quality` + `deadline-risk-analysis` → modules such as `sprint`, `workload`, `backlog`, `deadline`, `risk` (plus required dependencies like `team-capacity`), each executed **once**.

### Snapshot behaviour

The saved custom skill stores the resolved module list. It is **not** a live pointer to the source skills. If you later change a source custom skill, already-composed skills keep their original modules.

## Ambiguous requests

Phrases such as "give me a management report" are **not** saved as a skill. KaarFlow asks which area to analyse, or offers a conservative recommendation (for example for a slipping sprint) without persisting until you confirm a named composition.

## Security

Custom skills cannot reference unknown modules, unknown skills, unknown tools, arbitrary code, arbitrary HTTP, or work-item mutation. Validation runs before persistence.
