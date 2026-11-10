# Triage Evaluation Report

- The development dataset is small, synthetic, and author-written.
- The original 30% test split was seen during prior analysis; it is labeled “development test, previously seen” and is not a holdout.
- Only holdout_v2 is designated held out. Its score is meaningful as a frozen evaluation only after the populated file is included in its first Git commit; subsequent history or working-copy changes make evaluation fail closed.
- Engine: rule-based. No rules were changed for this evaluation update.
- Holdout Git status: not yet committed; placeholder permitted.

### Development split

- N: 70; accuracy: 70.0%; critical precision: 93.3%; alert-load (predicted ELEVATED or CRITICAL): 90.0%.
- Expected counts: LOW 28, ELEVATED 14, CRITICAL 28.
- Predicted counts: LOW 7, ELEVATED 33, CRITICAL 30.

| Class | Precision | Recall | False-positive rate | Support | Predicted | FP | FN |
|---|---:|---:|---:|---:|---:|---:|---:|
| LOW | 100.0% | 25.0% | 0.0% | 28 | 7 | 0 | 21 |
| ELEVATED | 42.4% | 100.0% | 33.9% | 14 | 33 | 19 | 0 |
| CRITICAL | 93.3% | 100.0% | 4.8% | 28 | 30 | 2 | 0 |

Confusion matrix (rows = expected, columns = predicted):

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 7 | 19 | 2 |
| ELEVATED | 0 | 14 | 0 |
| CRITICAL | 0 | 0 | 28 |

### Development test, previously seen

- N: 30; accuracy: 83.3%; critical precision: 92.3%; alert-load (predicted ELEVATED or CRITICAL): 76.7%.
- Expected counts: LOW 12, ELEVATED 6, CRITICAL 12.
- Predicted counts: LOW 7, ELEVATED 10, CRITICAL 13.

| Class | Precision | Recall | False-positive rate | Support | Predicted | FP | FN |
|---|---:|---:|---:|---:|---:|---:|---:|
| LOW | 100.0% | 58.3% | 0.0% | 12 | 7 | 0 | 5 |
| ELEVATED | 60.0% | 100.0% | 16.7% | 6 | 10 | 4 | 0 |
| CRITICAL | 92.3% | 100.0% | 5.6% | 12 | 13 | 1 | 0 |

Confusion matrix (rows = expected, columns = predicted):

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 7 | 4 | 1 |
| ELEVATED | 0 | 6 | 0 |
| CRITICAL | 0 | 0 | 12 |

### holdout_v2

- Status: pending; holdout_v2 is a placeholder with no labels yet.
- N: 0; precision, recall, false-positive rates, alert-load, and confusion matrix: N/A.

## Remaining development ELEVATED/LOW misclassification patterns

Grouped by cause; no rule changes were made. This section includes development examples only.

- Benign check-in language containing an isolation cue: 2
- Button activation adds an urgency floor despite explicit cancellation or reassurance: 15
- Mild discomfort or ordinary travel concern triggers elevated wording: 2
- Negated emergency wording still matches high-severity vocabulary: 2

## Method and limitations

Each scenario is evaluated once with the current deterministic rule engine. Precision, recall, and one-vs-rest false-positive rate are calculated per class. Alert-load is the fraction predicted ELEVATED or CRITICAL. The author-written dataset is small and synthetic; only the frozen holdout_v2 may be described as held out, and even it does not establish real-world safety performance.
