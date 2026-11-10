# Rule Triage Baseline

- Dataset version: 1.0.0
- Dataset size: 100 synthetic scenarios
- Engine: rule-based
- Method: one pass per scenario using createRuleBasedTriage().analyze(input); expected labels are hand-authored in the versioned synthetic dataset. No training or tuning was performed during evaluation.
- Accuracy: 65/100 (65.0%)

## Per-class metrics

| Threat level | Precision | Recall | Support | TP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| LOW | 100.0% | 35.0% | 40 | 14 | 0 | 26 |
| ELEVATED | 38.5% | 100.0% | 20 | 20 | 32 | 0 |
| CRITICAL | 91.2% | 77.5% | 40 | 31 | 3 | 9 |

## Confusion matrix

Rows are expected labels; columns are predicted labels.

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 14 | 23 | 3 |
| ELEVATED | 0 | 20 | 0 |
| CRITICAL | 0 | 9 | 31 |

## False negatives (9)

False negative means the engine predicted a lower threat level than the scenario label.

- explicit_help-005 (explicit_help): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"Someone is hurting me right now.","source":"button","local_hour":1,"risk_level":"standard"}
- explicit_help-008 (explicit_help): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"I was assaulted near the station.","source":"button","local_hour":23,"risk_level":"standard"}
- explicit_help-015 (explicit_help): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"An attacker is outside and will not leave.","source":"button","local_hour":17,"risk_level":"elevated"}
- explicit_help-019 (explicit_help): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"I cannot leave and need someone immediately.","source":"button","local_hour":17,"risk_level":"elevated"}
- quiet_duress-003 (quiet_duress): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"","source":"duress_pin","local_hour":17,"risk_level":"elevated"}
- quiet_duress-007 (quiet_duress): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"","source":"duress_pin","local_hour":17,"risk_level":"elevated"}
- quiet_duress-011 (quiet_duress): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"","source":"duress_pin","local_hour":17,"risk_level":"elevated"}
- quiet_duress-015 (quiet_duress): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"","source":"duress_pin","local_hour":17,"risk_level":"elevated"}
- quiet_duress-019 (quiet_duress): expected CRITICAL, predicted ELEVATED; input: {"audio_transcript_snippet":"","source":"duress_pin","local_hour":17,"risk_level":"elevated"}

## Interpretation

This is a small synthetic diagnostic set, not evidence of real-world safety performance. It measures agreement with authored labels only; it does not establish calibration, robustness, demographic fairness, or suitability for dispatch decisions.
