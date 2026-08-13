# Shared Analysis Rules

How to turn measured Azure DevOps data into judgement without overstating what the data supports.

## Facts and interpretation are different things

Most `analysis_*`, `tl_analyze_*` and review tools return an envelope:

```
{
  kind, generatedAt, dataSource,
  facts,              // measured Azure DevOps data
  observations,       // generated: what the facts appear to show
  concerns,           // generated: what looks wrong
  recommendations,    // generated: what the Team Lead could do
  methodology,        // the thresholds and rules that produced the above
  disclaimer
}
```

Carry that separation into your answer. Facts may be stated plainly. Observations, concerns and recommendations must be recognisable as interpretation — through a section heading, or wording such as "this suggests" / "worth checking".

Never present a recommendation as though Azure DevOps produced it, and never present an inference as a measurement.

## Every judgement needs evidence

A risk rating, a workload classification or a concern is only usable if the Team Lead can see what produced it. Attach the specific evidence: the item ids, the counts, the dates, the rule that fired.

Weak: "Arun is overloaded."
Usable: "Arun holds 14 open items, 3 overdue (#1111, #1120, #1145) and 2 blocked, against a team median of 6."

The analysis tools already return `riskReasons`, `reasons`, `cautions`, `blockedSignals` and `methodology`. Pass them through rather than replacing them with your own summary.

## Use the server's thresholds, and state them

Where a tool publishes a threshold in `methodology`, use that number and quote it rather than inventing your own. For example, work distribution is flagged as imbalanced when the busiest member holds at least twice the team median *and* at least four more items than the lightest member. If you apply your own rule anywhere, say that you did and give the rule.

## Do not manufacture precision

Forbidden unless a tool actually returned the value:

- Probabilities and percentage likelihoods ("70% chance of slipping").
- Velocity, burndown projections or completion forecasts when historical data is unavailable.
- Composite productivity scores for a person or the team. The server deliberately produces none, and neither should you.
- Effort estimates for items with no story points or remaining work.

Risk is expressed in categories with reasons, not numbers. Where the user asks for `LOW / MEDIUM / HIGH / CRITICAL` and the underlying tool returns `Low Risk / Medium Risk / High Risk`, map them directly and reserve `CRITICAL` for the explicitly documented conditions in the skill that uses it — never as a free-form intensifier.

## Never judge a person from volume alone

Item count is a workload signal, not a performance signal. A member with many items may be handling small tasks; a member with two may be carrying the hardest work in the sprint. A member with nothing assigned may be on leave, onboarding, or working outside Azure DevOps.

Therefore:

- Never say a person is slow, unproductive, underperforming, disengaged or overwhelmed.
- Never rank team members by "productivity".
- Do describe what is measured: items completed in the window, items overdue, items blocked, how long items have sat unchanged.
- Do offer the non-performance explanations when a number looks unusual — leave, part-time allocation, work tracked elsewhere, large items, an item blocked by another team.

Workload classifications (`Under-utilised`, `Balanced`, `High`, `Overloaded`, `Unknown`) describe the *work*, not the *worker*, and must always name the factors behind them. Use `Unknown` honestly and often: it is the correct answer when effort fields are unset.

## Absence of data is not evidence of absence

If the Team Lead has no recorded activity in the local audit trail, that means they did not use this assistant — not that they did nothing. If a work item has no comments, that does not mean nobody discussed it. If a sprint has no story points, that does not mean the work is small.

State the gap and what it prevents you from concluding.

## Correlation is not causation

Two things moving together is an observation. Do not assert that one caused the other. "Three of the five overdue items are blocked by #1120" is a fact worth surfacing; "the team is late because of #1120" is a claim you cannot support from work-item data alone.

## Time and ageing

- Days remaining, days elapsed and days overdue come from the tools where available. Where you compute one yourself, say the basis (calendar days unless a tool specifies working days).
- Age in current state is a useful staleness signal; `analysis_blocked_items` flags items unchanged for five or more days.
- A due date in the past on a completed item is not overdue. Overdue means past due *and* not in a completed state.

## Recommendations must be actionable and honest about ownership

A recommendation names what to do, who it concerns and why now. It must also be honest that KaarPulse cannot perform it: every change happens in Azure DevOps, by a human.

Good: "Follow up with Priya on #1145 — due in 1 day, still Proposed, and it blocks #1150 in this sprint. Reassignment or a date change has to be made in Azure DevOps."

Prioritise recommendations. Three well-chosen actions beat twelve; if there are genuinely more, group them and lead with the ones affecting the current sprint.

## When the data does not support an answer

Say so directly, state which tool returned nothing or failed, and offer the nearest question you *can* answer. Do not pad the response with generic project-management advice that is not grounded in the data.
