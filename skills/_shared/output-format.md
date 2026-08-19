# Shared Output Format: KaarPulse Decision Support

Every skill must produce output that acts as a Team Lead decision-support dashboard, not a raw Azure DevOps dump.

## Pipeline

Follow `_shared/query-workflow.md`:

FETCH → ANALYSE → GROUP → COUNT → IDENTIFY SIGNIFICANT CATEGORIES → CREATE ADO QUERY → RETURN QUERY URL → VISUALIZE → EXPLAIN INSIGHTS → RECOMMEND ACTIONS → SUPPORT TEAM LEAD DECISION

Do not list hundreds of work items. Group them. If a category has more than 3 items, create a saved Azure DevOps query and link it. If a category has 3 or fewer items, list those items directly.

## Principles

- **Lead with what needs attention.** The Team Lead should understand the situation within 30–60 seconds.
- **Visual over text.** Use headings, compact tables, status indicators and progress bars. Avoid long paragraphs.
- **Separate fact from judgement.** Facts come from Azure DevOps tools. Insights and recommendations are generated and labelled as such.
- **Actionable.** Finish with what the Team Lead should do next, and distinguish what KaarPulse can do (create a saved query, draft email) from what the TL must do in Azure DevOps.
- **Work items stay read-only.** KaarPulse never creates, updates, assigns or closes work items. Creating a saved query via `create_ado_query` is the only permitted Azure DevOps write.
- **Auditable.** Every insight traces to work-item ids, a saved query, or named tool output. Prefer `Evidence: [🔗 Open Query](url)` when a query exists.

## Status Indicators

- 🟢 Healthy / On Track / Low Risk
- 🟡 Attention / Medium Risk
- 🟠 At Risk / Elevated Risk
- 🔴 Critical / High Risk / Blocked
- 🔵 Informational / Recommendation Only
- ⚪ Unknown / Not Available / Missing Data

## Standard response architecture

```markdown
# 📊 KaarPulse — <Analysis Name>

> 🟢 / 🟡 / 🟠 / 🔴 **Executive Summary:** one concise explanation of the current situation.

**Project / Team** | `<timestamp>` | `Azure DevOps Live Data`

---

## 📌 At a Glance
KPI table. Never invent a value.

## 🚨 What Needs Attention
Highest-impact findings only. Do not dump every item.

## 🔎 Key Findings
Each finding: What, Count, Why it matters, Impact.
If count > 3, a saved query must exist for that category.

## 🔗 Azure DevOps Queries

| Title | Description | Count | Navigate |
|---|---|---:|---|
| Platform - Overdue Work | Open items past planned end | 8 | [🔗 Open Query](ACTUAL_SAVED_QUERY_URL) |

Only rows for queries `create_ado_query` actually created or reused.

## 🧠 Insights
Patterns, trends, risks, schedule / workload / governance implications.
Do not merely repeat the table. Percentages only when the denominator was measured.

## ⚠️ Risks

| Risk | Severity | Evidence | Impact |
|---|---|---|---|

## 💡 Recommendations

### 🔴 Recommendation 1

**Action:** ...
**Why:** ...
**Expected impact:** ...
**When:** Today / This week / Optional
**Evidence:** [🔗 Open Query](...) when a query exists
**Confidence:** High / Medium / Low

## 🧭 TL Decision Support

### Situation
...

### Option A
Pros / Cons

### Option B
Pros / Cons

### KaarPulse Recommendation
The Team Lead remains the final decision maker.

## 🎯 Recommended Actions

### 🔴 Today
1. ...

### 🟠 This Week
2. ...

### 🔵 Optional
3. ...

## ⚠️ Data Quality / Limitations
Missing fields, truncated lists, mapping gaps, query-folder failures.

---
**Source:** Live Azure DevOps
**Project:** <from tool>
**Team:** <from tool>
**ADO Work Items Modified:** No
```

A skill may omit Decision Support when no real choice exists. A skill may add a domain section (workload bars, sprint progress, hierarchy, forecast) **before** Insights, but must not skip At a Glance, What Needs Attention, Insights, Recommendations, Actions, or Data Quality on a major analysis.

## Visualisation

Use visual Markdown when the underlying data supports the metric. Never invent percentages.

Sprint:

`██████████████░░░░░░ 70%`

Workload (scale bars to the highest measured load in this response):

```
Arun     ████████████████ 🔴 High
Rahul    ██████████       🟡 Moderate
Karthik  █████            🟢 Low
```

Schedule (only when planned vs actual figures were returned):

```
Planned  ███████████████░░░ 75%
Actual   ████████████░░░░░░ 60%
```

Issue distribution (only with real category counts):

```
Missing Dates       ████████████████ 8 🔴
Missing Estimates   ████████         4 🟠
```

Build bars with `█` and `░`. State the measured value next to the bar.

## Work-item references

When listing 3 or fewer items, render each as:

`#1234 — "Exact title from Azure DevOps"` (Type, State, Assignee)

Never paraphrase titles. Use `—` for not applicable and `unknown` for missing values. Never invent data.

## Query links

The "Open Query" text must be a markdown link to the URL returned by `create_ado_query` (`savedQueryUrl` preferred, else `navigationUrl`). Never construct a query URL. Never use a placeholder.

## Stating what was not done

Every skill that recommends a work-item change must state that **no work items were modified**. Saved-query creation, when it happened, is reported separately with the real URL.
