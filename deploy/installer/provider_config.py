"""Fail-closed managed-install subset of core/src/v1/config/{config,provider}.ts.

OpenCode accepts arbitrary provider options and dynamically imports unknown npm
packages. Those extension points are deliberately NOT part of this allowlist.
No config evaluation, environment expansion, network access or file substitution.
"""
import json
import math
import re
from urllib.parse import urlsplit


class InvalidProviderConfig(ValueError):
    pass


def require(value):
    if not value:
        raise InvalidProviderConfig('Unsupported or invalid provider configuration')


def parse(text):
    require(len(text) <= 1024 * 1024)
    # Runtime substitutes raw text BEFORE parsing, including environment tokens
    # outside strings. Reject even comments so this cannot inject JSON members.
    require(not re.search(r'\{(?:env|file):', text))
    tokens = []
    cursor = 0
    pattern = r'"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|//[^\r\n]*|/\*[\s\S]*?\*/|[ \t\r\n]+|[{}\[\],:]|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null'
    for match in re.finditer(pattern, text):
        require(match.start() == cursor)
        cursor = match.end()
        token = match.group()
        if token.startswith(('//', '/*')) or token.isspace():
            continue
        if token in (']', '}') and tokens and tokens[-1] == ',':
            require(len(tokens) > 1 and tokens[-2] not in ('[', '{', ',', ':'))
            tokens.pop()
        tokens.append(token)
    require(cursor == len(text))
    # Keep whitespace between tokens: `1 2` must not become the valid number 12.
    return json.loads(' '.join(tokens), object_pairs_hook=unique_object)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result and key not in ('__proto__', 'constructor', 'prototype'))
        result[key] = value
    return result


def string(value):
    return isinstance(value, str) and not any(ord(char) < 32 for char in value)


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def strings(value):
    return isinstance(value, list) and all(string(item) for item in value)


def endpoint(value):
    if not string(value):
        return False
    url = urlsplit(value)
    return url.scheme in ('https', 'http') and bool(url.hostname) and not url.username and not url.password and not url.fragment


# Exact bundled imports, not arbitrary npm specs, versions, paths or URLs.
SDK = {'@ai-sdk/' + name for name in (
    'openai-compatible', 'openai', 'anthropic', 'azure', 'google', 'xai',
    'mistral', 'groq', 'deepinfra', 'cerebras', 'cohere', 'togetherai', 'perplexity',
)} | {'@openrouter/ai-sdk-provider'}


def sdk(value):
    return isinstance(value, str) and value in SDK


def timeout(value):
    return value is False or type(value) is int and value > 0


COST = {key: number for key in ('input', 'output', 'cache_read', 'cache_write')}
OPTIONS = {'baseURL': endpoint, 'apiKey': string, 'timeout': timeout, 'headerTimeout': timeout,
           'chunkTimeout': timeout, 'setCacheKey': lambda value: type(value) is bool}
MODEL = {
    **{key: string for key in ('id', 'name', 'family', 'release_date')},
    **{key: lambda value: type(value) is bool for key in ('attachment', 'reasoning', 'temperature', 'tool_call', 'experimental')},
    'status': lambda value: isinstance(value, str) and value in ('alpha', 'beta', 'deprecated', 'active'),
    'limit': {'context': number, 'input': number, 'output': number},
    'cost': {**COST, 'context_over_200k': COST},
    'modalities': {key: lambda value: strings(value) and all(item in ('text', 'audio', 'image', 'video', 'pdf') for item in value)
                   for key in ('input', 'output')},
    'provider': {'npm': sdk, 'api': endpoint},
}
PROVIDER = {
    **{key: string for key in ('id', 'name')}, 'api': endpoint, 'npm': sdk,
    **{key: strings for key in ('env', 'whitelist', 'blacklist')},
    'options': OPTIONS, 'models': ('map', MODEL),
}
CONFIG = {
    '$schema': string, 'disabled_providers': strings, 'enabled_providers': strings,
    'model': string, 'small_model': string, 'provider': ('map', PROVIDER),
}


def validate(value, schema=CONFIG, depth=0):
    require(depth < 20)
    if callable(schema):
        require(schema(value))
        return
    require(isinstance(value, dict))
    if isinstance(schema, tuple):
        for key, item in value.items():
            require(string(key) and bool(key))
            validate(item, schema[1], depth + 1)
        return
    require(value.keys() <= schema.keys())
    if schema is MODEL['limit']:
        require({'context', 'output'} <= value.keys())
    if schema is COST or schema is MODEL['cost']:
        require({'input', 'output'} <= value.keys())
    for key, item in value.items():
        validate(item, schema[key], depth + 1)
