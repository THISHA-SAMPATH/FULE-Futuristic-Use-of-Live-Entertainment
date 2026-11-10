# Development Error Analysis

This analysis covers the 17 development-split mismatches against `trigger_time_label` after the five judgment-call relabels. The triage rules were not changed. All IDs below are from the dev split of the synthetic, author-written dataset; the previously seen test split is excluded.

| Cause and prediction | Scenario IDs | Count | Assessment |
|---|---|---:|---|
| Benign accidental/test/cancel wording remains ELEVATED because button source adds an urgency floor | `false_alarm-001`, `false_alarm-002`, `false_alarm-003`, `false_alarm-004`, `false_alarm-005`, `false_alarm-006`, `false_alarm-008`, `false_alarm-009`, `false_alarm-011`, `false_alarm-012`, `false_alarm-013`, `false_alarm-015`, `false_alarm-016`, `false_alarm-017`, `false_alarm-020` | 15 | Rule gap: the current scoring adds button urgency without discounting clear accidental activation or reassurance in the provided first-report text. |
| Negated emergency language is still matched as CRITICAL | `false_alarm-007`, `false_alarm-014` | 2 | Rule gap: keyword matching does not account for negation around “emergency.” |

There are no cases in these 17 that we classified as ambiguous labels or label errors: each input contains explicit benign/negated wording in the transcript supplied to triage, and the expected first-report label is LOW. The `false_alarm` final outcome was not used to change the trigger-time label. That distinction matters: a later false-alarm resolution alone would not justify a LOW label at initial report.

## Judgment-call labels

The separate five `judgment_call` scenarios were reviewed against first-report context, not their eventual outcomes. Their updated labels now agree with the unchanged engine. Those relabels account for the reported accuracy increase; they do not resolve the 17 dev rule-gap cases listed above.

## Fixed operating point (analysis only)

On dev, setting the ELEVATED score cutoff to 5 while keeping CRITICAL at 7 yields 58.6% alert-load, 100.0% ELEVATED precision, 61.1% ELEVATED recall, and 100.0% CRITICAL recall. This is reported for comparison only and is not applied to production rules. The observed dev sample therefore shows no CRITICAL recall cost at that point, while ELEVATED recall drops by 38.9 percentage points.

These findings are limited to a small, synthetic, author-written dataset whose dangerous-case base rate is intentionally high. Precision is likely optimistic; FPR and alert-load remain the main caution measures.
