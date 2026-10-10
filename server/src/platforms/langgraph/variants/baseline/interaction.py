"""Authenticated shared input reads; LangGraph owns all human suspension."""
import json
from urllib.request import Request, urlopen
from .hosted_tools import host_key


def invoke_interaction(operation, payload, endpoint, key_file):
    request = Request(endpoint.rstrip('/') + '/internal/interaction/' + operation,
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + host_key(key_file)}, method='POST')
    with urlopen(request, timeout=30) as response:
        raw = response.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError('Task interaction response exceeded its bound.')
        return json.loads(raw)
