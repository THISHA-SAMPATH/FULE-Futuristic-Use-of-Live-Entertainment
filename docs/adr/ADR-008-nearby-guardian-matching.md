# ADR-008: Nearby guardian matching and delayed exact-location reveal

## Decision

Guardians explicitly opt into on-duty location sharing. Persist coordinate and coarse-area records with freshness timestamps, shortlist using a PostgreSQL bounding box, and rank by Haversine distance. Offer payloads contain threat level, approximate area, priority, and safety guidance only. Store offers so an authenticated acceptance can atomically claim one of a configured capped number; only accepted responders get the full incident payload.

## Consequences

No GIS extension is required for the current responder scale. The 400 m radius and 5 accepted guardians are configurable. Location records are excluded after 15 minutes and removed by cleanup; exact guardian coordinates are stored only for matching and never put in the offer event. A future high-volume network may replace the bounding-box query with PostGIS/geohash indexes.
