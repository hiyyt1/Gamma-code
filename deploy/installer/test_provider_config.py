"""Validation tests: deliberately stricter than the extensible runtime schema."""
import json
import unittest
import provider_config as config


class ProviderConfigTests(unittest.TestCase):
    def test_jsonc_provider(self):
        value = config.parse('''{
          // Existing UI-created provider config
          "$schema": "https://opencode.ai/config.json",
          "disabled_providers": ["openai",],
          "provider": {"vsellm": {
            "name": "VSELLM", "npm": "@ai-sdk/openai-compatible",
            "options": {"baseURL": "https://example.invalid/v1", "apiKey": "fixture-only"},
            "models": {"minimax/minimax-m3": {"name": "MiniMax M3",}},
          }}, /* trailing comment */
        }''')
        config.validate(value)
        self.assertEqual(value['provider']['vsellm']['models']['minimax/minimax-m3']['name'], 'MiniMax M3')

    def test_valid_model_metadata(self):
        config.validate({'model': 'vsellm/minimax/minimax-m3', 'small_model': 'openai/test',
                         'enabled_providers': ['vsellm'], 'provider': {'vsellm': {
                             'env': ['TEST_KEY'], 'whitelist': ['test'], 'blacklist': [],
                             'options': {'timeout': False, 'chunkTimeout': 1000, 'setCacheKey': True},
                             'models': {'test': {'tool_call': True, 'reasoning': True,
                                 'limit': {'context': 100000, 'output': 8192},
                                 'cost': {'input': 1, 'output': 2},
                                 'modalities': {'input': ['text', 'image']},
                                 'provider': {'npm': '@ai-sdk/openai-compatible', 'api': 'https://example.invalid/v1'}}}}}})

    def test_forbidden_keys_at_every_structural_level(self):
        for key in ('permission', 'permissions', 'agent', 'mode', 'tools', 'command', 'plugin', 'mcp',
                    'instructions', 'experimental', 'server', 'lsp', 'hooks', 'unknown'):
            candidates = [{key: {}}, {'provider': {'test': {key: {}}}},
                          {'provider': {'test': {'options': {key: {}}}}},
                          {'provider': {'test': {'models': {'test': {key: {}}}}}}]
            for candidate in candidates:
                with self.subTest(key=key, candidate=candidate), self.assertRaises(config.InvalidProviderConfig):
                    config.validate(candidate)

    def test_arbitrary_packages_and_nested_extension_points_rejected(self):
        for npm in ('file:///tmp/evil.js', '/tmp/evil.js', 'evil', '@ai-sdk/openai@latest',
                    'https://example.invalid/sdk.js', '@ai-sdk/openai-compatible/evil'):
            for candidate in ({'npm': npm}, {'models': {'test': {'provider': {'npm': npm}}}}):
                with self.subTest(npm=npm), self.assertRaises(config.InvalidProviderConfig):
                    config.validate({'provider': {'test': candidate}})
        for candidate in ({'options': {'body': {'tools': []}}},
                          {'models': {'test': {'variants': {'evil': {'tools': []}}}}},
                          {'models': {'test': {'options': {'permission': 'allow'}}}},
                          {'models': {'test': {'provider': {'plugin': 'evil'}}}}):
            with self.assertRaises(config.InvalidProviderConfig):
                config.validate({'provider': {'test': candidate}})

    def test_malformed_jsonc_and_duplicates(self):
        for raw in ('', '[]', '{', '{"provider":{,}}', '{"provider":{},,}',
                    '{"provider":{} "model":"x"}', '{"provider":{}, "provider":{}}',
                    '{"provider":{"x":{"name":"a","name":"b"}}}',
                    '{"provider": /* unterminated}', '{"model":"bad\\q"}',
                    '{"model":"x"} garbage', '{"model":NaN}', '{"model":Infinity}',
                    '{"model":1 2}', '{"model":truefalse}', '{"model":01}',
                    '{"__proto__":{}}', '{"provider":{"constructor":{}}}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                config.validate(config.parse(raw))

    def test_substitutions_and_secret_diagnostics(self):
        for marker in ('{env:UNTRUSTED}', '{file:/etc/shadow}'):
            for raw in ('{"model":' + json.dumps(marker) + '}', '// ' + marker + '\n{}'):
                with self.assertRaises(config.InvalidProviderConfig) as error:
                    config.parse(raw)
                self.assertNotIn(marker, str(error.exception))

    def test_types_and_unknown_nested_keys(self):
        for candidate in ({'disabled_providers': 'openai'}, {'provider': []},
                          {'provider': {'x': {'options': {'timeout': True}}}},
                          {'provider': {'x': {'options': {'baseURL': 'file:///etc/shadow'}}}},
                          {'provider': {'x': {'models': {'m': {'limit': {'context': True}}}}}},
                          {'provider': {'x': {'models': {'m': {'cost': {'input': float('inf')}}}}}},
                          {'provider': {'x': {'models': {'m': {'limit': {'output': 2, 'command': 'evil'}}}}}}):
            with self.subTest(candidate=candidate), self.assertRaises(config.InvalidProviderConfig):
                config.validate(candidate)

    def test_strings_preserve_comment_markers(self):
        value = config.parse('{"provider":{"x":{"name":"a /* b */ // c \\\"d\\\"","options":{"baseURL":"https://example.invalid/v1"}}}}')
        config.validate(value)
        self.assertIn('/* b */ // c', value['provider']['x']['name'])


if __name__ == '__main__':
    unittest.main()
