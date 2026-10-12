---
name: presentation-data
description: Проверяемая аналитика CSV/XLSX, точные суммы и нативные диаграммы PowerPoint.
---

# Data
Use gamma-presentation_ingest for CSV/XLSX; inspect headers, source units, reporting period and missing values before analysis. Run gamma-presentation_aggregate with the copied originals path, category and numeric value column. It computes Decimal sums and writes data/<id>.json with exact totals and source hashes.
Charts reference dataset IDs; never supply invented numeric arrays. The build recomputes datasets from source before export. XLSX formulas are intentionally rejected: request a values-only export or independently calculate from authoritative inputs, never silently trust stale cached values. CSV accepts UTF-8 with comma, semicolon or tab delimiters.
Use lines for time, bars for comparisons, pie/doughnut only for a meaningful whole with few categories. Always label units, periods and denominator. Do not truncate a bar baseline to exaggerate differences. Distinguish observed facts, forecasts and scenarios.
The built-in aggregate currently supports grouped Decimal sums. For derived metrics not expressible as grouped sums, use supplied values-only data with provenance or disclose that the calculation is unsupported. Never invent a number, calculate business indicators in prose or claim an unexecuted script ran. Reviewer must reconcile every visible numeric claim with exact dataset values and sources, not merely check whether the chart looks plausible.
Table strings and narrative numbers are not automatically numerically verified; explicitly compare them in the reviewer task. The engine does not claim universal fact verification.
