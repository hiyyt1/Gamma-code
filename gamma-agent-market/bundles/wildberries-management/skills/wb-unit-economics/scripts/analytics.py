"""WB analytics, Python 3 stdlib only. Monetary inputs in RUB, Decimal arithmetic.
Input: JSON job on stdin; files confined by caller and again here to project root.
No network, credentials, formula execution or external workbook links.
"""
import csv
import hashlib
import io
import json
import math
import statistics
import sys
import zipfile
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
MONEY = ('revenue', 'cost', 'commission', 'logistics', 'advertising', 'storage', 'acquiring', 'other', 'tax')
EXPENSES = MONEY[2:]
ALIASES = {'артикул wb': 'nmID', 'артикул продавца': 'vendorCode', 'себестоимость': 'cost', 'баркод': 'barcode', 'nmId': 'nmID', 'supplierArticle': 'vendorCode', 'nm_id': 'nmID'}

def number(value):
    if value is None or str(value).strip() == '':
        return None
    try:
        result = Decimal(str(value).replace('\u00a0', '').replace(' ', '').replace(',', '.'))
    except InvalidOperation:
        raise ValueError('invalid_number') from None
    if not result.is_finite():
        raise ValueError('invalid_number')
    return result

def ratio(a, b):
    return None if not b else a / b * 100

def compare(current, previous):
    return {'current': current, 'previous': previous, 'delta': current - previous,
            'change_pct': ratio(current - previous, previous)}

def abc(values):
    if any(v < 0 for v in values.values()):
        raise ValueError('abc_requires_nonnegative_basis')
    total = sum(values.values(), Decimal(0))
    running = Decimal(0)
    result = []
    for sku, value in sorted(values.items(), key=lambda x: (-x[1], x[0])):
        # Crossing item belongs to the group whose interval it starts in.
        group = None if total == 0 else 'A' if running / total < Decimal('.8') else 'B' if running / total < Decimal('.95') else 'C'
        running += value
        result.append({'sku': sku, 'value': value, 'share_pct': ratio(value, total), 'cumulative_pct': ratio(running, total), 'class': group})
    return result

def anomalies(values):
    if len(values) < 7:
        return {'points': [], 'limitation': 'At least 7 complete daily observations required'}
    median = statistics.median(values)
    mad = statistics.median([abs(v - median) for v in values])
    return {'points': [i for i, v in enumerate(values) if abs(v - median) > (mad * Decimal('4.4478') if mad else max(abs(median) * Decimal('.5'), Decimal(1)))], 'median': median, 'mad': mad, 'method': 'median/MAD; flags are not causal explanations'}

def inventory(stock, sold, days, lead=14, safety=7, average_stock=None):
    if days <= 0 or min(stock, sold, lead, safety) < 0:
        raise ValueError('invalid_inventory_input')
    velocity = sold / days
    return {'stock': stock, 'units_per_day': velocity, 'days_cover': stock / velocity if velocity else None,
            'turnover': sold / average_stock if average_stock and average_stock > 0 else None,
            'replenish': max(0, math.ceil(velocity * (lead + safety) - stock)),
            'stockout_risk': bool(velocity and stock / velocity < lead + safety),
            'limitation': 'Constant demand; stockout days suppress observed sales; excludes unprovided inbound stock'}

def safe_path(root, name):
    target = (root / name).resolve()
    if not target.is_relative_to(root) or not target.is_file() or target.stat().st_size > 20000000:
        raise ValueError('invalid_input_file')
    return target

def xlsx_rows(path):
    with zipfile.ZipFile(path) as archive:
        if sum(x.file_size for x in archive.infolist()) > 50000000 or len(archive.infolist()) > 1000:
            raise ValueError('xlsx_too_large')
        def xml(name):
            data = archive.read(name)
            if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
                raise ValueError('unsafe_xml')
            return ET.fromstring(data)
        shared = [''.join(x.itertext()) for x in xml('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in archive.namelist() else []
        workbook = xml('xl/workbook.xml')
        sheet = workbook.find(NS + 'sheets')[0]
        rel = sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target = next(x.attrib['Target'] for x in xml('xl/_rels/workbook.xml.rels') if x.attrib['Id'] == rel)
        sheet_path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        if '..' in sheet_path.split('/'):
            raise ValueError('invalid_sheet_path')
        rows = []
        for row in xml(sheet_path).iter(NS + 'row'):
            cells = {}
            for cell in row:
                if cell.find(NS + 'f') is not None:
                    raise ValueError('formula_cells_not_supported_export_values')
                letters = ''.join(c for c in cell.attrib.get('r', '') if c.isalpha())
                col = 0
                for c in letters:
                    col = col * 26 + ord(c.upper()) - 64
                if not 1 <= col <= 200:
                    raise ValueError('invalid_column')
                raw = cell.findtext(NS + 'v', '')
                cells[col - 1] = shared[int(raw)] if cell.attrib.get('t') == 's' else ''.join(cell.find(NS + 'is').itertext()) if cell.attrib.get('t') == 'inlineStr' else raw
            rows.append([cells.get(i, '') for i in range(max(cells, default=-1) + 1)])
        return rows

def load(path, mapping):
    if path.suffix.lower() == '.json':
        rows = json.loads(path.read_text())
        if isinstance(rows, dict) and 'pages' in rows and 'method' in rows:
            rows = normalize_wb(rows)
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            raise ValueError('json_requires_normalized_row_array')
        return [{mapping.get(k, ALIASES.get(k, k)): v for k, v in r.items()} for r in rows]
    if path.suffix.lower() == '.xlsx':
        table = xlsx_rows(path)
    elif path.suffix.lower() == '.csv':
        text = path.read_text(encoding='utf-8-sig')
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=',;\t')
        table = list(csv.reader(io.StringIO(text), dialect))
    else:
        raise ValueError('unsupported_file_type')
    if not table:
        return []
    header = [mapping.get(h, ALIASES.get(h, h)) for h in table[0]]
    if len(set(header)) != len(header):
        raise ValueError('duplicate_columns')
    return [dict(zip(header, r)) for r in table[1:] if any(r)]

def normalize_wb(response):
    method = response['method']
    result = []
    for page in response['pages']:
        if page is None:
            continue
        rows = page if isinstance(page, list) else page.get('cards', []) if method == 'cards' else page.get('data', {}).get('items', []) if method == 'inventory' else page.get('data', {}).get('listGoods', []) if method == 'prices' else page.get('data', {}).get('feedbacks', []) if method == 'reviews' else None
        if rows is None:
            raise ValueError('unsupported_wb_response_use_documented_normalized_rows')
        for r in rows:
            base = {'nmID': r.get('nmId', r.get('nmID')), 'vendorCode': r.get('vendorCode', r.get('supplierArticle')), 'shop': response['shop']}
            if method in ('sales', 'orders'):
                if method == 'sales' and not str(r.get('saleID', '')).startswith(('S', 'R')):
                    raise ValueError('unknown_sale_type')
                base.update(kind='order' if method == 'orders' else 'return' if r['saleID'].startswith('R') else 'sale', id=r.get('saleID', r.get('srid')), date=r['date'], quantity=1)
                # finishedPrice includes WB discount, priceWithDisc is seller's discounted sale price.
                # This feed alone cannot establish complete financial expenses/profit.
                base['revenue'] = r.get('priceWithDisc')
            elif method == 'cards':
                base.update(kind='card', title=r.get('title'), description=r.get('description'), brand=r.get('brand'), characteristics=r.get('characteristics'))
            elif method == 'inventory':
                base.update(kind='stock', stock=r['quantity'], date=response['retrievedAt'][:10], warehouse=r.get('warehouseId'))
            elif method == 'finance':
                # Non-sale lines carry fees too. Never discard them as zero sales.
                doc = r.get('docTypeName')
                if not base['nmID']:
                    base['nmID'] = None
                    base['vendorCode'] = 'UNALLOCATED-FINANCE'
                kind = 'sale' if doc == 'Продажа' else 'return' if doc == 'Возврат' else 'fee'
                base.update(kind=kind, id=r['rrdId'], date=r.get('saleDt') or r['rrDate'], quantity=r['quantity'] if kind != 'fee' else 0,
                            revenue=abs(number(r['retailAmount'])) if kind != 'fee' else 0, currency=r.get('currency', 'RUB'),
                            commission=r.get('ppvzSalesCommission') if kind != 'return' else None, logistics=r.get('deliveryService'), acquiring=r.get('acquiringFee') if kind != 'return' else None, storage=r.get('paidStorage'))
                # Unmapped financial components are disclosed, not assumed absent.
                base['other'] = None
            elif method == 'advertising_stats':
                for day in r.get('days', []):
                    for app in day.get('apps', []):
                        for product in app.get('nms', []):
                            result.append({'kind': 'ad', 'shop': response['shop'], 'nmID': product.get('nmId'), 'date': day['date'], 'campaign': r['advertId'], 'advertising': product.get('sum'), 'attributed_revenue': product.get('sum_price')})
                continue
            else:
                raise ValueError('unsupported_wb_response_use_documented_normalized_rows')
            result.append(base)
    return result


def identify(rows):
    # Build exact alias links; never guess by title/fuzzy matching or lose leading zeros.
    links = {}
    for r in rows:
        if str(r.get('nmID') or '').strip():
            for key in ('vendorCode', 'barcode'):
                if str(r.get(key) or '').strip():
                    links.setdefault((key, str(r[key]).strip()), set()).add(str(r['nmID']).strip())
    for r in rows:
        if any(len(links.get((key, str(r.get(key) or '').strip()), set())) > 1 for key in ('vendorCode', 'barcode')):
            raise ValueError('ambiguous_sku_mapping')
        if str(r.get('nmID') or '').strip():
            r['sku'] = 'nm:' + str(r['nmID']).strip()
            continue
        candidates = set().union(*(links.get((key, str(r.get(key) or '').strip()), set()) for key in ('vendorCode', 'barcode')))
        if len(candidates) > 1:
            raise ValueError('ambiguous_sku_mapping')
        if candidates:
            r['sku'] = 'nm:' + next(iter(candidates))
            continue
        identity = next(((k, str(r[k]).strip()) for k in ('vendorCode', 'barcode') if str(r.get(k) or '').strip()), None)
        if not identity:
            raise ValueError('missing_stable_product_identifier')
        r['sku'] = ':'.join(identity)
    return rows

def analyse(job, root):
    rows = []
    sources = []
    for source in job['files']:
        file = safe_path(root, source['path'])
        content = load(file, source.get('columns', {}))
        for r in content:
            if source.get('kind'):
                if r.get('kind') and r['kind'] != source['kind']:
                    raise ValueError('row_kind_conflict')
                r['kind'] = source['kind']
            r['_source'] = str(file.relative_to(root))
        rows.extend(content)
        sources.append({'path': str(file.relative_to(root)), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'rows': len(content)})
    if len(rows) > 100000:
        raise ValueError('too_many_rows')
    rows = identify(rows)
    permitted = {'sale', 'return', 'order', 'payout', 'stock', 'ad', 'card', 'cost', 'fee'}
    if any(r.get('kind') not in permitted for r in rows):
        raise ValueError('explicit_row_kind_required')
    stores = {str(r['shop']) for r in rows if r.get('shop')}
    if len(stores) > 1:
        raise ValueError('mixed_stores_split_input')
    currencies = {r.get('currency', 'RUB') for r in rows}
    if currencies != {'RUB'}:
        raise ValueError('only_rub_supported_no_implicit_currency_conversion')
    start, end = date.fromisoformat(job['start']), date.fromisoformat(job['end'])
    days = (end - start).days + 1
    if not 1 <= days <= 366:
        raise ValueError('invalid_period')
    previous_start = start.toordinal() - days
    def row_date(r):
        try:
            return date.fromisoformat(str(r['date'])[:10])
        except (ValueError, KeyError):
            raise ValueError('transaction_date_required_iso8601') from None
    transactions = [r for r in rows if r['kind'] in {'sale', 'return', 'order', 'payout', 'ad', 'fee'}]
    current = [r for r in transactions if start <= row_date(r) <= end]
    previous = [r for r in transactions if previous_start <= row_date(r).toordinal() < start.toordinal()]
    # Duplicates with explicit IDs are rejected, not silently double-counted.
    keys = [(r['kind'], str(r.get('id'))) for r in transactions if r.get('id')]
    if len(keys) != len(set(keys)):
        raise ValueError('duplicate_transaction_ids')
    for r in transactions:
        for key in ('revenue', 'cost', 'quantity'):
            if number(r.get(key)) is not None and number(r[key]) < 0:
                raise ValueError('amounts_must_be_positive_use_return_kind')
    costs = {}
    for r in rows:
        if r['kind'] != 'cost':
            continue
        value = number(r.get('cost'))
        if value is None or value < 0:
            raise ValueError('invalid_cost')
        if r['sku'] in costs and costs[r['sku']] != value:
            raise ValueError('conflicting_cost_requires_period_specific_input')
        costs[r['sku']] = value
    def revenue(data):
        relevant = [r for r in data if r['kind'] in {'sale', 'return'}]
        if any(number(r.get('revenue')) is None for r in relevant):
            raise ValueError('realized_revenue_required_not_orders_or_payouts')
        return sum((number(r['revenue']) * (-1 if r['kind'] == 'return' else 1) for r in relevant), Decimal(0))
    products = []
    for sku in sorted({r['sku'] for r in rows}):
        selected = [r for r in current if r['sku'] == sku]
        realised = [r for r in selected if r['kind'] in {'sale', 'return'}]
        if any(number(r.get('quantity')) is None for r in realised):
            raise ValueError('quantity_required')
        gross = revenue(realised)
        sold = sum((number(r['quantity']) for r in realised if r['kind'] == 'sale'), Decimal(0))
        returned = sum((number(r['quantity']) for r in realised if r['kind'] == 'return'), Decimal(0))
        cost = costs.get(sku)
        # Returns restore inventory cost only when explicitly marked resalable.
        restorable = sum((number(r['quantity']) for r in realised if r['kind'] == 'return' and str(r.get('resalable', '')).lower() == 'true'), Decimal(0))
        cogs = cost * (sold - restorable) if cost is not None and realised else None
        expenses = {k: sum((number(r.get(k)) or Decimal(0) for r in selected if r['kind'] in {'sale', 'return', 'ad', 'fee'}), Decimal(0)) for k in EXPENSES}
        covered = [k for k in EXPENSES if selected and all(number(r.get(k)) is not None for r in realised) and realised]
        if any(r['kind'] == 'ad' for r in selected) and any(number(r.get('advertising')) not in (None, 0) for r in realised):
            raise ValueError('advertising_double_count_choose_one_source')
        profit = gross - cogs - sum(expenses.values()) if cogs is not None else None
        stock_rows = [r for r in rows if r['sku'] == sku and r['kind'] == 'stock']
        stock_dates = {r.get('date') for r in stock_rows}
        if len(stock_dates) > 1:
            raise ValueError('stock_requires_single_snapshot')
        stock = sum((number(r.get('stock')) or Decimal(0) for r in stock_rows), Decimal(0))
        if any(number(r.get('stock')) is None for r in stock_rows):
            raise ValueError('stock_quantity_required')
        products.append({'sku': sku, 'revenue': gross if realised else None, 'sold': sold if realised else None, 'returns': returned, 'cogs': cogs,
                         'gross_profit': gross - cogs if cogs is not None else None,
                         'gross_margin_pct': ratio(gross - cogs, gross) if cogs is not None else None,
                         'profit_known_costs': profit, 'operating_margin_known_costs_pct': ratio(profit, gross) if profit is not None else None,
                         'drr_pct': ratio(expenses['advertising'], gross) if any(number(r.get('advertising')) is not None for r in selected) else None, **expenses,
                         'missing_expenses': [k for k in EXPENSES if k not in covered],
                         'missing_cost': cost is None, 'sales_observed': bool(realised),
                         'inventory': inventory(stock, sold, Decimal(days), Decimal(str(job.get('leadDays', 14))), Decimal(str(job.get('safetyDays', 7))), sum((number(r['average_stock']) for r in stock_rows), Decimal(0)) if stock_rows and all(number(r.get('average_stock')) is not None for r in stock_rows) else None) if stock_rows and realised else {'stock': stock, 'units_per_day': None, 'days_cover': None, 'turnover': None, 'replenish': None, 'stockout_risk': None, 'limitation': 'Sales history missing; no demand inferred'} if stock_rows else None})
    campaigns = []
    for campaign in sorted({str(r.get('campaign', 'unattributed')) for r in current if r['kind'] == 'ad'}):
        ads = [r for r in current if r['kind'] == 'ad' and str(r.get('campaign', 'unattributed')) == campaign]
        spend = sum((number(r.get('advertising')) or Decimal(0) for r in ads), Decimal(0))
        attributed = None if any(number(r.get('attributed_revenue')) is None for r in ads) else sum((number(r['attributed_revenue']) for r in ads), Decimal(0))
        campaigns.append({'campaign': campaign, 'spend': spend, 'attributed_revenue': attributed, 'drr_pct': ratio(spend, attributed) if attributed is not None else None, 'limitation': 'Attribution revenue is not realized profit'})
    cards = [{'sku': r['sku'], 'issues': [k + '_missing' for k in ('title', 'description', 'brand', 'characteristics') if not r.get(k)] + (['title_over_60'] if len(str(r.get('title', ''))) > 60 else []), 'limitation': 'Subject-required attributes and factual accuracy need subject schema/manual evidence'} for r in rows if r['kind'] == 'card']
    daily = [revenue([r for r in current if row_date(r).toordinal() == d]) for d in range(start.toordinal(), end.toordinal() + 1)]
    limitations = ['Only supplied files/rows; completeness not established.', 'Net realized revenue excludes orders and payouts. Returns subtract revenue; costs stay positive.', 'Profit is contribution after supplied costs, not audited net profit. Missing costs are never imputed.', 'No causal claims from correlation; compare stock, prices and advertising evidence separately.', 'Costs assumed constant for selected period; split files for cost changes.', 'Zero-filled days require complete daily coverage to interpret anomalies.']
    return {'scenario': job.get('scenario', 'all'), 'period': {'start': str(start), 'end': str(end), 'days': days}, 'sources': sources,
            'sales': compare(revenue(current), revenue(previous)) if any(r['kind'] in {'sale', 'return'} for r in current) and any(r['kind'] in {'sale', 'return'} for r in previous) else {'current': revenue(current) if any(r['kind'] in {'sale', 'return'} for r in current) else None, 'previous': revenue(previous) if any(r['kind'] in {'sale', 'return'} for r in previous) else None, 'delta': None, 'change_pct': None, 'limitation': 'Missing period evidence; empty input is not proof of zero sales'}, 'products': products,
            'coverage': {kind: sum(r['kind'] == kind for r in rows) for kind in sorted(permitted)},
            'abc': abc({p['sku']: max(p['revenue'] or Decimal(0), Decimal(0)) for p in products}),
            'abc_basis': 'positive net realized revenue; negative SKU revenue excluded from shares',
            'daily_revenue': daily, 'anomalies': anomalies(daily), 'campaigns': campaigns, 'cards': cards, 'limitations': limitations}

def serial(value):
    if isinstance(value, Decimal):
        return float(value.quantize(Decimal('.0001')))
    raise TypeError(type(value).__name__)

def safe_cell(v):
    text = '' if v is None else json.dumps(v, ensure_ascii=False, default=serial) if isinstance(v, (dict, list)) else str(v)
    return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) else text

def write_xlsx(path, table):
    def col(n):
        return (col((n - 1) // 26) if n > 26 else '') + chr(65 + (n - 1) % 26)
    rows = ''.join('<row r="%d">%s</row>' % (i, ''.join('<c r="%s%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (col(j), i, escape(safe_cell(v))) for j, v in enumerate(row, 1))) for i, row in enumerate(table, 1))
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows + '</sheetData></worksheet>')

def run(job):
    root = Path(job['root']).resolve()
    result = analyse(job, root)
    output = (root / job['output']).resolve()
    if not output.is_relative_to(root) or output.exists():
        raise ValueError('output_must_be_new_project_directory')
    output.mkdir(parents=True)
    (output / 'analysis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, default=serial))
    table = [list(result['products'][0])] + [list(r.values()) for r in result['products']] if result['products'] else [['sku']]
    with (output / 'products.csv').open('w', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerows([[safe_cell(v) for v in row] for row in table])
    write_xlsx(output / 'products.xlsx', table)
    report = '# Wildberries: проверяемый расчёт\n\nПериод: %s — %s\n\n' % (job['start'], job['end'])
    report += 'Продажи: ' + json.dumps(result['sales'], ensure_ascii=False, default=serial) + '\n\n'
    report += '## Ограничения\n\n' + '\n'.join('- ' + x for x in result['limitations']) + '\n\n'
    report += '## Товары\n\n| SKU | Выручка | Результат по известным затратам | Запас, дней |\n|---|---:|---:|---:|\n'
    for p in result['products']:
        report += '| %s | %s | %s | %s |\n' % (p['sku'].replace('|', '\\|'), p['revenue'], p['profit_known_costs'] if p['profit_known_costs'] is not None else 'Нет себестоимости', (p['inventory'] or {}).get('days_cover'))
    if job.get('chart'):
        values = result['daily_revenue']
        scale = max((abs(v) for v in values), default=Decimal(0)) or Decimal(1)
        width = Decimal(740) / len(values)
        bars = ''.join('<rect x="%s" y="%s" width="%s" height="%s" fill="%s"><title>%s: %s RUB</title></rect>' % (30 + i * width, 130 - (v / scale * 100 if v >= 0 else 0), max(width - 1, Decimal('.5')), abs(v) / scale * 100, '#7c3aed' if v >= 0 else '#dc2626', i + 1, v) for i, v in enumerate(values))
        (output / 'sales.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 270" role="img"><title>Realized revenue by day; missing observations require source completeness check</title><rect width="800" height="270" fill="white"/><path d="M30 130H770" stroke="#888"/>' + bars + '<text x="30" y="255" font-size="12">' + escape(job['start'] + ' — ' + job['end'] + ' / RUB / supplied observations') + '</text></svg>')
        report += '\n![Выручка по предоставленным данным](sales.svg)\n'
    (output / 'report.md').write_text(report)
    return {'artifacts': [str(p.relative_to(root)) for p in sorted(output.iterdir())], 'summary': result}

if __name__ == '__main__':
    try:
        print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False, default=serial))
    except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile, ET.ParseError) as exc:
        print(json.dumps({'error': str(exc)[:180]}))
        sys.exit(1)
