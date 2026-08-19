# Query fields

Saved queries must include the columns the Team Lead needs to continue in Azure DevOps without returning to Claude. Field **reference names** are never assumed.

## Discovery

1. Call `ado_get_field_mapping` for canonical Planned Start / Planned End / Actual Start / Actual End.
2. Only include date fields marked `available: true`.
3. Use `ado_get_work_item_types` / `ado_get_work_item_fields` when type-specific fields (effort vs story points) are in doubt.
4. Pass chosen reference names as WIQL `SELECT` columns or as `columns` on `create_ado_query`.

Unknown or unmapped fields are omitted and called out under Data Quality.

## Common projections

Always consider (when they exist): ID, Title, Work Item Type, State, Assigned To, Priority, Area Path, Iteration Path, Tags, Created Date, Changed Date, Parent.

| Query purpose | Emphasise |
| --- | --- |
| Missing dates | Planned Start/End, Actual Start/End, Changed Date, Area, Iteration |
| Overdue | Priority, Planned End, Actual End, Iteration, Changed Date |
| Workload | Assigned To, Effort or Story Points, Priority, planned/actual dates, Iteration |
| Stale | Changed Date, Priority, Iteration, Planned End |
| Dependencies | Assigned To, Priority, Iteration, Parent, Planned End |

WIQL cannot project relation *rows*. Dependency queries still list the item set; blocker → downstream is shown in the skill response from `analysis_dependencies` / `ado_get_related_work_items`.

## Mapping vs WIQL builder

`ado_query_work_items` uses process field constants in `src/services/azure-devops/fields.ts` (StartDate, TargetDate, FinishDate, etc.). Custom K4K names must come from `ado_get_field_mapping`. When building WIQL for `create_ado_query`, prefer the discovered `adoFields` reference names so the saved query matches what the Team Lead sees on the form.

## Completeness rule

The query is complete when opening it in Azure DevOps is enough to investigate that category (ids, owners, dates, iteration). Do not request unused fields.
