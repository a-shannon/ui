---
'@rosen-ui/rosen-statistics-entity': patch
---

Resolve bridge metrics token joins and locked-asset lookups through registered
entity names. This allows Rosen Service2's asset aggregator and the App's asset
calculator to supply their own constructors while preserving token decimals,
event range filters, locked amounts, token relations and table prefixes.
