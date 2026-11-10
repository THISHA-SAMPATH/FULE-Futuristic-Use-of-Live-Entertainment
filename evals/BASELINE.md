# Triage Evaluation: Trigger-Time Labels

- Dataset: small, synthetic, and author-written; development N=70.
- The old 30% test split was seen during previous analysis; it is reported as “development test, previously seen” and is not an independent holdout.
- Only holdout_v2 is held out. It was not read in this development-only run.
- Scoring target: trigger_time_label only. final_outcome describes the eventual incident state and is not used in triage metrics.
- The historical label-cleanup comparison isolates that label change. This run also includes a general negation-handling rule fix; its dev-only effect is reported separately below.

## Before / after relabel metrics

| Split | Labels | N | Accuracy | LOW precision | LOW recall | LOW FPR | ELEVATED precision | ELEVATED recall | ELEVATED FPR | CRITICAL precision | CRITICAL FPR | Alert-load |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Development | Before relabel | 70 | 70.0% | 100.0% | 25.0% | 0.0% | 42.4% | 100.0% | 33.9% | 93.3% | 4.8% | 90.0% |
| Development | After label cleanup, before negation fix | 70 | 75.7% | 100.0% | 29.2% | 0.0% | 54.5% | 100.0% | 28.8% | 93.3% | 4.8% | 90.0% |
| Development test, previously seen | Before relabel | 30 | 83.3% | 100.0% | 58.3% | 0.0% | 60.0% | 100.0% | 16.7% | 92.3% | 5.6% | 76.7% |
| Development test, previously seen | After label cleanup, before negation fix | 30 | 86.7% | 100.0% | 63.6% | 0.0% | 70.0% | 100.0% | 13.0% | 92.3% | 5.6% | 76.7% |

Critical precision and per-class false-positive rates are reported directly in the table. Alert-load is the percentage predicted ELEVATED or CRITICAL.

## context_triage suite

Includes dev/test scenarios whose source is not button or redeem. Metrics are engine scores, before trigger-policy delivery floors.

| Split | Measurement | N | Accuracy | LOW precision / recall | LOW FPR | ELEVATED precision / recall | ELEVATED FPR | CRITICAL precision / recall | CRITICAL FPR | Alert-load |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Dev | Before split / negation change | 38 | 100.0% | 100.0% / 100.0% | 0.0% | 100.0% / 100.0% | 0.0% | 100.0% / 100.0% | 0.0% | 81.6% |
| Dev | After | 38 | 100.0% | 100.0% / 100.0% | 0.0% | 100.0% / 100.0% | 0.0% | 100.0% / 100.0% | 0.0% | 81.6% |
| Previously seen test | Before split / negation change | 22 | 95.5% | 100.0% / 87.5% | 0.0% | 87.5% / 100.0% | 6.7% | 100.0% / 100.0% | 0.0% | 68.2% |
| Previously seen test | After | 22 | 95.5% | 100.0% / 87.5% | 0.0% | 87.5% / 100.0% | 6.7% | 100.0% / 100.0% | 0.0% | 68.2% |

## trigger_policy suite

Explicit pass/fail assertions over button-source scenarios: active button SOS must remain CRITICAL until cancelled.

| Split | Measurement | N | Pass | Fail | Pass rate |
|---|---|---:|---:|---:|---:|
| Dev | Before trigger policy | 32 | 17 | 15 | 53.1% |
| Dev | After trigger policy | 32 | 32 | 0 | 100.0% |
| Previously seen test | Before trigger policy | 8 | 6 | 2 | 75.0% |
| Previously seen test | After trigger policy | 8 | 8 | 0 | 100.0% |

## Negation fix: dev-only engine comparison

This comparison uses all dev scenarios before delivery policy is applied. General negation scope suppresses contradicted danger signals; no scenario-specific phrases were added.

| Engine version | N | Accuracy | CRITICAL false positives | Alert-load |
|---|---:|---:|---:|---:|
| Before general negation handling | 70 | 75.7% | 2 | 90.0% |
| After general negation handling | 70 | 78.6% | 0 | 87.1% |

## Judgment-call accuracy

- Label cleanup, 5 of 100 scenarios, all five now agree with the engine. The label change itself did not change rules; this later run reports the separate negation-rule fix above.
- All scenarios: 77 of 95 excluding judgment calls = 81.1%; judgment-call scenarios: 5 of 5 = 100.0%.
- Dev split: 51 of 66 excluding judgment calls = 77.3%; all dev scenarios = 78.6%.

## Dev operating-point analysis (not applied)

The current CRITICAL cutoff remains score ≥7. Raising only the ELEVATED cutoff changes classifications for the dev split; this is an offline calculation, not a rule change.

| ELEVATED score cutoff | Alert-load | ELEVATED precision | ELEVATED recall | CRITICAL precision | CRITICAL recall |
|---:|---:|---:|---:|---:|---:|
| 3 | 87.1% | 54.5% | 100.0% | 100.0% | 100.0% |
| 4 | 78.6% | 51.9% | 77.8% | 100.0% | 100.0% |
| 5 | 55.7% | 100.0% | 61.1% | 100.0% | 100.0% |

Cutoff 5 is the first tested point under 60% alert-load (55.7%); ELEVATED recall falls from 100.0% to 61.1%, while CRITICAL recall remains 100.0% (no observed critical-recall cost on dev).

### Development confusion matrix after relabel

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 9 | 15 | 0 |
| ELEVATED | 0 | 18 | 0 |
| CRITICAL | 0 | 0 | 28 |

### Development test, previously seen confusion matrix after relabel

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 8 | 3 | 0 |
| ELEVATED | 0 | 7 | 0 |
| CRITICAL | 0 | 0 | 12 |

## Current dev misclassification patterns

Grouped by cause after the negation fix; the remaining button-floor cases are handled separately by trigger_policy.

- Button activation adds an urgency floor despite explicit cancellation or reassurance: 15

## Earlier four development error groups (old labels, before negation fix)

- Benign check-in language containing an isolation cue: 2; those trigger labels were reviewed as ELEVATED.
- Button activation adds an urgency floor despite explicit cancellation or reassurance: 15; retained LOW trigger labels.
- Mild discomfort or ordinary travel concern triggers elevated wording: 2; those trigger labels were reviewed as ELEVATED.
- Negated emergency wording still matches high-severity vocabulary: 2; retained LOW trigger labels.

## holdout_v2

- Not accessed by this development-only run, per the repository rule.

## Method and base-rate caution

Each development/test scenario is scored against trigger_time_label. context_triage evaluates the raw deterministic engine on sources other than button/redeem; trigger_policy evaluates the separate active-button delivery floor. Precision and recall use one-vs-rest class counts; FPR is FP/(FP+TN); alert-load is predicted ELEVATED plus CRITICAL divided by N. The historical label-cleanup rows are pre-negation-change metrics; the separate dev-only negation table measures the later rule change. This synthetic, small, author-written dataset over-represents dangerous cases, so precision overstates likely real-world precision. FPR and alert-load are the main caution metrics.
