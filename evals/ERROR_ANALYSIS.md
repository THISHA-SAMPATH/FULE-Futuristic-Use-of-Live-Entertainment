# Development Error Analysis

The pre-fix dev evaluation had 17 mismatches against `trigger_time_label`. The first group below has been addressed by general negation handling; the second group remains a separate button-trigger policy issue. These are synthetic, author-written development scenarios; previously seen test examples are excluded.

| Cause and prediction before negation fix | Scenario IDs | Count | Assessment / status |
|---|---|---:|---|
| Benign accidental/test/cancel wording remained ELEVATED because button source adds an urgency floor | `false_alarm-001`, `false_alarm-002`, `false_alarm-003`, `false_alarm-004`, `false_alarm-005`, `false_alarm-006`, `false_alarm-008`, `false_alarm-009`, `false_alarm-011`, `false_alarm-012`, `false_alarm-013`, `false_alarm-015`, `false_alarm-016`, `false_alarm-017`, `false_alarm-020` | 15 | Rule gap: the raw triage score still treats a button press as an elevated cue even when supplied text says the activation was accidental or unnecessary. Runtime button delivery is now protected by the separate CRITICAL floor. |
| Negated emergency language was matched as CRITICAL | `false_alarm-007`, `false_alarm-014` | 2 | Rule gap, fixed: general negation scope suppresses contradicted danger signals without adding scenario-specific phrases. |

The two negation cases now score LOW in the raw triage engine and no longer count as dev false positives. For actual button incidents, delivery policy still holds the active event at CRITICAL until it is cancelled; context triage evaluation excludes button/redeem sources to measure contextual classification separately.

## Measurement boundary

The `context_triage` / `trigger_policy` split was made after seeing the 15 button-floor errors. It is a post-hoc measurement change, not a model improvement. The 15 low-severity contextual labels are retained as given; this analysis does not tune rules or use the previously seen test split for changes.

## Tiered delivery

With `FULE_TIERED_DELIVERY=true`, CRITICAL incidents interrupt guardians, ELEVATED incidents notify the trusted circle with a check-in prompt then escalate if unanswered, and LOW incidents are logged. The flag defaults to off; the existing route remains in effect unless explicitly enabled.
