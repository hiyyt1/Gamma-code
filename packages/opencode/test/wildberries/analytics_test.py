import importlib.util
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[4] / 'gamma-agent-market/bundles/wildberries-management/skills/wb-unit-economics/scripts/analytics.py'
spec = importlib.util.spec_from_file_location('analytics', SCRIPT)
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

class AnalyticsTest(unittest.TestCase):
    def test_known_metrics(self):
        self.assertEqual(a.ratio(Decimal(150), Decimal(1000)), Decimal(15))
        self.assertIsNone(a.ratio(Decimal(150), Decimal(0)))
        self.assertEqual(a.compare(Decimal(700), Decimal(1000))['change_pct'], Decimal(-30))
        self.assertEqual([x['class'] for x in a.abc({'A': Decimal(80), 'B': Decimal(15), 'C': Decimal(5)})], ['A', 'B', 'C'])
        self.assertEqual(a.anomalies([Decimal(10)] * 7 + [Decimal(50)])['points'], [7])
        inv = a.inventory(Decimal(10), Decimal(28), Decimal(14), average_stock=Decimal(7))
        self.assertEqual(inv['days_cover'], Decimal(5))
        self.assertEqual(inv['replenish'], 32)
        self.assertEqual(inv['turnover'], Decimal(4))
        self.assertIsNone(a.inventory(Decimal(10), Decimal(0), Decimal(14))['days_cover'])

    def test_five_scenarios_with_xlsx_costs(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            rows = [
                {'kind': 'sale', 'id': 'previous', 'nmID': 1, 'vendorCode': '001', 'date': '2026-09-01', 'quantity': 10, 'revenue': 1000},
                {'kind': 'sale', 'id': 'current', 'nmID': 1, 'vendorCode': '001', 'date': '2026-09-15', 'quantity': 8, 'revenue': 800, 'commission': 80, 'logistics': 40},
                {'kind': 'return', 'id': 'return', 'nmID': 1, 'date': '2026-09-16', 'quantity': 1, 'revenue': 100, 'resalable': True, 'logistics': 10},
                {'kind': 'ad', 'nmID': 1, 'campaign': 'campaign1', 'date': '2026-09-15', 'advertising': 70, 'attributed_revenue': 350},
                {'kind': 'order', 'nmID': 1, 'date': '2026-09-15', 'revenue': 9000},
                {'kind': 'payout', 'nmID': 1, 'date': '2026-09-15', 'revenue': 8000},
                {'kind': 'stock', 'nmID': 1, 'date': '2026-09-28', 'stock': 2},
                {'kind': 'card', 'nmID': 1, 'title': '', 'description': '', 'brand': 'Brand'},
                {'kind': 'sale', 'nmID': 2, 'date': '2026-09-15', 'quantity': 1, 'revenue': 0},
            ]
            (root / 'data.json').write_text(json.dumps(rows))
            a.write_xlsx(root / 'costs.xlsx', [['vendorCode', 'cost'], ['001', '50']])
            for scenario in ['sales', 'advertising', 'profit', 'cards', 'inventory']:
                result = a.run({'root': str(root), 'files': [{'path': 'data.json'}, {'path': 'costs.xlsx', 'kind': 'cost'}], 'start': '2026-09-15', 'end': '2026-09-28', 'scenario': scenario, 'output': scenario, 'chart': scenario == 'sales'})
                data = result['summary']
                self.assertEqual(data['sales']['current'], Decimal(700))
                self.assertEqual(data['sales']['change_pct'], Decimal(-30))
                p = data['products'][0]
                self.assertEqual(p['cogs'], Decimal(350))
                self.assertEqual(p['gross_profit'], Decimal(350))
                self.assertEqual(p['gross_margin_pct'], Decimal(50))
                self.assertEqual(p['profit_known_costs'], Decimal(150))
                self.assertEqual(p['drr_pct'], Decimal(10))
                self.assertEqual(p['inventory']['days_cover'], Decimal('3.5'))
                self.assertEqual(p['inventory']['replenish'], 10)
                self.assertIsNone(data['products'][1]['profit_known_costs'])
                self.assertEqual(data['campaigns'][0]['drr_pct'], Decimal(20))
                self.assertIn('title_missing', data['cards'][0]['issues'])
                self.assertIn('tax', p['missing_expenses'])
                self.assertEqual(len(result['artifacts']), 5 if scenario == 'sales' else 4)
                if scenario == 'sales':
                    self.assertIn('<svg', (root / scenario / 'sales.svg').read_text())
                self.assertEqual(a.xlsx_rows(root / scenario / 'products.xlsx')[0][0], 'sku')

    def test_input_guards(self):
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            a.identify([{'nmID': 1, 'vendorCode': 'a'}, {'nmID': 2, 'vendorCode': 'a'}])
        self.assertEqual(a.safe_cell('=HYPERLINK("https://evil")')[0], "'")
        self.assertEqual(a.number('1 200,50'), Decimal('1200.50'))
        with self.assertRaises(ValueError): a.number('NaN')
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError): a.safe_path(Path(d), '/etc/passwd')

    def test_missing_history_is_not_zero_demand(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'stock.csv').write_text('nmID,date,stock\n1,2026-09-18,50\n')
            result = a.analyse({'files': [{'path': 'stock.csv', 'kind': 'stock'}], 'start': '2026-09-01', 'end': '2026-09-30'}, root)
            self.assertIsNone(result['sales']['current'])
            self.assertIsNone(result['products'][0]['revenue'])
            self.assertIsNone(result['products'][0]['inventory']['stockout_risk'])
            self.assertIsNone(result['products'][0]['inventory']['replenish'])
            self.assertEqual(result['coverage']['sale'], 0)

    def test_normalization(self):
        rows = a.normalize_wb({'method': 'sales', 'shop': 'store', 'pages': [[{'nmId': 3, 'saleID': 'R1', 'date': '2026-09-18', 'priceWithDisc': 200, 'forPay': 150}]]})
        self.assertEqual(rows[0]['kind'], 'return')
        self.assertEqual(rows[0]['revenue'], 200)
        self.assertNotIn('commission', rows[0])
        stock = a.normalize_wb({'method': 'inventory', 'shop': 'store', 'retrievedAt': '2026-09-18', 'pages': [{'data': {'items': [{'nmId': 3, 'quantity': 10, 'inWayToClient': 99}]}}]})
        self.assertEqual(stock[0]['stock'], 10)

if __name__ == '__main__': unittest.main()
