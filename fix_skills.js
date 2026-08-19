const fs = require('fs');
const path = require('path');

const skills = [
  {
    name: 'backlog-data-quality',
    title: 'Backlog Data Quality Analysis',
    description: 'Analyzes backlog data quality, including missing dates, valid date boundaries, and structural issues like Stories without Tasks.',
    category: 'analysis',
    primary_tools: ['analysis_backlog_quality'],
    supporting_tools: ['ado_get_work_item']
  },
  {
    name: 'schedule-variance-analysis',
    title: 'Schedule Variance Analysis',
    description: 'Analyzes schedule variance, comparing planned vs actual dates to identify delays and schedule risks.',
    category: 'analysis',
    primary_tools: ['analysis_schedule_variance'],
    supporting_tools: ['ado_get_work_item']
  },
  {
    name: 'hierarchy-health-analysis',
    title: 'Hierarchy Health Analysis',
    description: 'Analyzes the structural health of the backlog hierarchy (orphaned work items, empty Epics/Features).',
    category: 'analysis',
    primary_tools: ['analysis_hierarchy_health'],
    supporting_tools: ['ado_get_work_item']
  },
  {
    name: 'dependency-analysis',
    title: 'Dependency Analysis',
    description: 'Analyzes blocked work, dependencies, and their downstream impact.',
    category: 'analysis',
    primary_tools: ['ado_get_blocked_items'],
    supporting_tools: ['ado_get_work_item']
  },
  {
    name: 'stale-work-analysis',
    title: 'Stale Work Analysis',
    description: 'Analyzes active work items with no recent activity.',
    category: 'analysis',
    primary_tools: ['analysis_stale_work'],
    supporting_tools: ['ado_get_work_item']
  },
  {
    name: 'delivery-forecast',
    title: 'Delivery Forecast',
    description: 'Estimates delivery dates based on current completion pace, planned dates, and historical variance.',
    category: 'analysis',
    primary_tools: ['analysis_schedule_variance', 'analysis_team_delivery_metrics'],
    supporting_tools: ['ado_get_project_overview']
  }
];

const template = (skill) => `---
name: ${skill.name}
title: ${skill.title}
description: ${skill.description}
version: 1.0.0
category: ${skill.category}
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
${skill.primary_tools.map(t => `  - ${t}`).join('\n')}
supporting_tools:
${skill.supporting_tools.map(t => `  - ${t}`).join('\n')}
missing_capabilities:
  - "Cannot automatically fix missing dates."
triggers:
  - run ${skill.name}
  - check ${skill.name.replace(/-/g, ' ')}
---

# ${skill.title}

## Purpose
${skill.description}

## When to Use
Use this when the Team Lead wants to analyze ${skill.title.toLowerCase()}.

## Required Inputs
None

## Data Sources
Tools: ${skill.primary_tools.join(', ')}

## Workflow
1. Use the primary tools to gather data.
2. Filter and categorize findings.
3. Present the findings using the Visual Response Format.

## Analysis Rules
Highlight the most critical issues.
Group the issues logically.

## Output Format
Follow the standard Dashboard format with status indicators.
Present a summary and actionable recommendations.

## Edge Cases
- No data found: report that the backlog is clean in this regard.

## Safety Rules
- Read-only: never modify items.

## Example Requests
- "Run ${skill.name.replace(/-/g, ' ')}"
`;

skills.forEach(skill => {
  const p = path.join(__dirname, 'skills', skill.name, 'SKILL.md');
  console.log('Writing', p);
  fs.writeFileSync(p, template(skill));
});
