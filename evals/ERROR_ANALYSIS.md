# Triage Error Analysis

## Prior critical false negatives

The original full-set baseline reported nine expected-CRITICAL cases as ELEVATED. They fall into two recurring failure patterns:

| Pattern | Count | Why the previous rules missed it |
|---|---:|---|
| Violence or escape language expressed in an unrecognized word form | 4 | The rules used a few exact word forms. Related forms such as an ongoing harm action, a person described as an attacker, and inability to leave did not reliably match those literal alternatives. |
| Quiet duress signal | 5 | The engine treated the event like an ordinary button alert. Silence and elevated user risk yielded only ELEVATED during daytime, and the duress source itself had no score. |

## Rule changes and data boundary

Changes were selected from the **dev split only**. Its four pre-change critical false negatives comprised two violence/escape language cases and two quiet-duress cases. The held-out test examples were not inspected individually or used to change rules.

- Replaced narrow violence word forms with broader morphological stems and a general inability-to-leave/escape pattern. This targets the linguistic pattern rather than memorizing an example sentence.
- Added a strong score contribution for explicit duress source metadata. The ordinary silence, time-of-day, and user-risk signals remain in place.
- Did not add a repeated-trigger heuristic: no dev-set failure established that as the cause of an error, and event-repeat metadata is not currently part of the triage input contract.

## Observed effect

On dev, critical recall increased from 85.7% to 100.0%, and overall accuracy increased from 64.3% to 70.0%. The aggregate test scores also changed, but the test split is small and synthetic; that result is not evidence of generalization. Full metrics and aggregate-only test confusion matrix are in `BASELINE.md`.

## Limits

These are author-written synthetic cases, not reports from people experiencing emergencies. The error categories reflect this dataset's wording and labels, not the full range of language, dialects, disability-related communication, or real incident context. Human responders must remain responsible for decisions.
