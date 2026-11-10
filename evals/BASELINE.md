# Triage Evaluation: Trigger-Time Labels

- Dataset: small, synthetic, and author-written; development N=70.
- The old 30% test split was seen during previous analysis; it is reported as “development test, previously seen” and is not an independent holdout.
- Only holdout_v2 is held out. It was not read in this development-only run.
- Scoring target: trigger_time_label only. final_outcome describes the eventual incident state and is not used in triage metrics.
- Rule engine code is unchanged. Any metric improvement shown below is caused solely by the ground-truth labeling change, not a rule change.

## Before / after relabel metrics

| Split | Labels | N | Accuracy | LOW precision | LOW recall | LOW FPR | ELEVATED precision | ELEVATED recall | ELEVATED FPR | CRITICAL precision | CRITICAL FPR | Alert-load |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Development | Before relabel | 70 | 70.0% | 100.0% | 25.0% | 0.0% | 42.4% | 100.0% | 33.9% | 93.3% | 4.8% | 90.0% |
| Development | After relabel | 70 | 75.7% | 100.0% | 29.2% | 0.0% | 54.5% | 100.0% | 28.8% | 93.3% | 4.8% | 90.0% |
| Development test, previously seen | Before relabel | 30 | 83.3% | 100.0% | 58.3% | 0.0% | 60.0% | 100.0% | 16.7% | 92.3% | 5.6% | 76.7% |
| Development test, previously seen | After relabel | 30 | 86.7% | 100.0% | 63.6% | 0.0% | 70.0% | 100.0% | 13.0% | 92.3% | 5.6% | 76.7% |

Critical precision and per-class false-positive rates are reported directly in the table. Alert-load is the percentage predicted ELEVATED or CRITICAL.

## Judgment-call accuracy

- Label cleanup, 5 of 100 scenarios, all five now agree with the engine. These labels were changed by contextual review; no triage rules changed.
- All scenarios: 74 of 95 excluding judgment calls = 77.9%; judgment-call scenarios: 5 of 5 = 100.0%.
- Dev split: 49 of 66 excluding judgment calls = 74.2%; all dev scenarios = 75.7%.

## Dev operating-point analysis (not applied)

The current CRITICAL cutoff remains score ≥7. Raising only the ELEVATED cutoff changes classifications for the dev split; this is an offline calculation, not a rule change.

| ELEVATED score cutoff | Alert-load | ELEVATED precision | ELEVATED recall | CRITICAL precision | CRITICAL recall |
|---:|---:|---:|---:|---:|---:|
| 3 | 90.0% | 54.5% | 100.0% | 93.3% | 100.0% |
| 4 | 81.4% | 51.9% | 77.8% | 93.3% | 100.0% |
| 5 | 58.6% | 100.0% | 61.1% | 93.3% | 100.0% |

Cutoff 5 is the first tested point under 60% alert-load (58.6%); ELEVATED recall falls from 100.0% to 61.1%, while CRITICAL recall remains 100.0% (no observed critical-recall cost on dev).

### Development confusion matrix after relabel

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 7 | 15 | 2 |
| ELEVATED | 0 | 18 | 0 |
| CRITICAL | 0 | 0 | 28 |

### Development test, previously seen confusion matrix after relabel

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 7 | 3 | 1 |
| ELEVATED | 0 | 7 | 0 |
| CRITICAL | 0 | 0 | 12 |

## Current dev misclassification patterns

Grouped by cause under trigger_time_label; no rule changes were made.

- Button activation adds an urgency floor despite explicit cancellation or reassurance: 15
- Negated emergency wording still matches high-severity vocabulary: 2

## Earlier four development error groups (old labels)

- Benign check-in language containing an isolation cue: 2; those trigger labels were reviewed as ELEVATED.
- Button activation adds an urgency floor despite explicit cancellation or reassurance: 15; retained LOW trigger labels.
- Mild discomfort or ordinary travel concern triggers elevated wording: 2; those trigger labels were reviewed as ELEVATED.
- Negated emergency wording still matches high-severity vocabulary: 2; retained LOW trigger labels.

## holdout_v2

- Not accessed by this development-only run, per the repository rule.

## Method and base-rate caution

Each dev/test scenario is run once through the unchanged deterministic triage engine; only trigger_time_label is scored. Precision and recall use one-vs-rest class counts; FPR is FP/(FP+TN); alert-load is predicted ELEVATED plus CRITICAL divided by N. This synthetic, small, author-written dataset over-represents dangerous cases, so precision overstates likely real-world precision. FPR and alert-load are the main caution metrics.
