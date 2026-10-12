# Input contract

gamma-wb_analyse accepts files [{path, kind?, columns?}], start/end (inclusive ISO dates), scenario, leadDays, safetyDays, chart (optional SVG daily revenue chart). Paths are project-relative. Optional columns maps original CSV/XLSX headers to canonical names. UTF-8 CSV comma/semicolon/tab, first XLSX sheet (values only), or JSON row array. Exports from gamma-wb_read are normalized for sales/orders/cards/inventory/finance/advertising_stats where documented fields are present; unsupported formats fail explicitly.

Each normalized row has kind, nmID or vendorCode or barcode. Prefer nmID and variant barcode; do not merge different shops. Optional shop and currency (only RUB). Transactions require date ISO YYYY-MM-DD, explicit positive amounts, optional unique id. Do not round IDs; preserve barcode strings. All money in RUB.

- sale/return: quantity, revenue; commission, logistics, advertising, storage, acquiring, other, tax when known. Returns are positive amounts; kind controls sign of revenue. resalable=true restores returned inventory cost; absent means no COGS restoration.
- order/payout: not counted as realized revenue; retained for source audit.
- cost: cost per unit; nmID or matching exact vendorCode/barcode. Example CSV: `vendorCode,cost` then `SKU-001,350.00`. Supply period-valid costs; conflicting costs fail.
- stock: stock, date (one snapshot), optional warehouse, barcode and average_stock (period mean for turnover). leadDays/safetyDays are planning assumptions. No implied arrivals.
- fee: dated financial expenses without realized revenue, optional signed expense credits. Unmapped financial postings remain limitations.
- ad: advertising, campaign, attributed_revenue if known, date. Do not repeat the same spend in sale rows.
- card: title, description, brand, characteristics. Required subject attributes not verified by this basic audit.

Missing expense cells remain unknown; explicit zero means known zero. Gross profit=revenue-COGS. profit_known_costs subtracts supplied expenses only. operating_margin_known_costs_pct is not audited net margin. Zero revenue => ratios null. ABC uses positive net revenue; negative SKUs remain visible in products. Daily anomaly test needs >=7 observations and assumes complete history. Days cover uses gross sold units / calendar days, current available stock, fixed demand. Average-stock turnover is available as the reusable inventory(..., average_stock=...) function; no average means unknown.

Each run creates a unique project folder with source hashes, JSON computations, report.md, products.csv and products.xlsx. Add business interpretation with native edit without changing source/calculated numbers. User-defined strings are neutralized against spreadsheet formula injection on export.
