"""Download pinned source archives for review, never execute their contents.

Archives stay in /tmp until license review permits redistribution. No third-party
Python dependencies, git hooks, package installers, or repository scripts run.
"""
import concurrent.futures
import hashlib
import io
import json
import pathlib
import os
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent
CACHE = pathlib.Path(os.environ.get('GAMMA_SKILL_MARKET_AUDIT_ROOT', '/tmp/gamma-skill-market-audit'))


def fetch(url):
    result = subprocess.run(['curl', '--fail', '-L', '--max-time', '180', '--retry', '2', '-sS', url], capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.decode()[:300])
    return result.stdout


def download(pkg):
    dest = CACHE / pkg['id']
    dest.mkdir(parents=True, exist_ok=True)
    if (dest / 'source.json').exists():
        cached = json.loads((dest / 'source.json').read_text())
        if pkg.get('pin') and cached.get('revision') != pkg['pin']:
            raise ValueError('Review cache revision mismatch: use a fresh GAMMA_SKILL_MARKET_AUDIT_ROOT')
        return cached
    try:
        repo = pkg['source'].removeprefix('https://github.com/')
        metadata = json.loads(fetch('https://api.github.com/repos/' + repo))
        commit = json.loads(fetch('https://api.github.com/repos/' + repo + '/commits/' + (pkg.get('pin') or metadata['default_branch'])))
        revision = commit['sha']
        archive = fetch('https://codeload.github.com/' + repo + '/tar.gz/' + revision)
        if len(archive) > 150_000_000:
            raise ValueError('Archive exceeds review size limit')
        rejected = []
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
            members = tar.getmembers()
            if sum(m.size for m in members) > 600_000_000:
                raise ValueError('Unpacked archive exceeds review size limit')
            for member in members:
                parts = pathlib.PurePosixPath(member.name).parts
                if not parts or pathlib.PurePosixPath(member.name).is_absolute() or '..' in parts:
                    raise ValueError('Unsafe archive path')
                if member.isdir():
                    continue
                if not member.isfile():
                    rejected.append(dict(path=member.name, target=member.linkname, reason='Non-regular entry omitted'))
                    continue
                file = dest / 'source' / pathlib.Path(*parts[1:])
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(tar.extractfile(member).read())
        result = dict(id=pkg['id'], revision=revision, source=pkg['source'], license=(metadata.get('license') or {}).get('spdx_id'), archiveSha256=hashlib.sha256(archive).hexdigest(), rejected=rejected)
    except Exception as error:
        result = dict(id=pkg['id'], source=pkg['source'], error=str(error))
    (dest / 'source.json').write_text(json.dumps(result, indent=2)+'\n')
    return result


if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(download, json.loads((ROOT / 'candidates.json').read_text())):
            print(json.dumps(result), flush=True)
