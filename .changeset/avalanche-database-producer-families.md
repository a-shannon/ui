---
'@rosen-ui/data-source': patch
'@rosen-ui/rosen-statistics-entity': patch
'@rosen-ui/rosen-statistics': patch
'@rosen-bridge/rosen-app': patch
'@rosen-bridge/rosen-service': patch
'@rosen-bridge/rosen-service2': patch
---

Align database entity and extractor dependencies across Rosen applications and
statistics with current scanner families. Require compatible
legacy scanners so their registered extractors share the current query interface
and database entity constructors.
