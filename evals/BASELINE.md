# Rule Triage Baseline

- Dataset version: 1.0.0; 100 synthetic, author-written scenarios.
- Split: stratified random split by expected threat level, seed 20261110, 70/30 dev/test; assignments are stored per scenario in the dataset file.
- Method: single deterministic inference per scenario using the current rule engine. No training; the pre-change snapshot was captured before modifying the rules.
- The test split is held out from rule changes. It is reported only as aggregate metrics; no test scenarios or individual test errors are printed.

## Before and after

| Split | Version | N | Accuracy | LOW precision | LOW recall | ELEVATED precision | ELEVATED recall | CRITICAL precision | CRITICAL recall |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dev | Before | 70 | 64.3% | 100.0% | 25.0% | 37.8% | 100.0% | 92.3% | 85.7% |
| dev | After | 70 | 70.0% | 100.0% | 25.0% | 42.4% | 100.0% | 93.3% | 100.0% |
| test | Before | 30 | 66.7% | 100.0% | 58.3% | 40.0% | 100.0% | 87.5% | 58.3% |
| test | After | 30 | 83.3% | 100.0% | 58.3% | 60.0% | 100.0% | 92.3% | 100.0% |

## Dev confusion matrix after changes

Rows are expected labels; columns are predicted labels.

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 7 | 19 | 2 |
| ELEVATED | 0 | 14 | 0 |
| CRITICAL | 0 | 0 | 28 |

## Test confusion matrix after changes (aggregate only)

| Expected \ Predicted | LOW | ELEVATED | CRITICAL |
|---|---:|---:|---:|
| LOW | 7 | 4 | 1 |
| ELEVATED | 0 | 6 | 0 |
| CRITICAL | 0 | 0 | 12 |

## Dev false negatives (0)

Listed for development error analysis only. No scenario-level test results are included.

- None.

## Limitations

The dataset is small, synthetic, author-written, and not representative of real incident reports. Scores measure agreement with these labels only; they do not establish real-world safety, calibration, robustness, or fairness.
