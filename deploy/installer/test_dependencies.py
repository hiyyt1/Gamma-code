"""Real pinned Bun, temporary local workspace; no production services/network."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import gamma_installer as gamma


class LocalBuild:
    def __init__(self, root):
        self.root = root
        self.calls = []
        self.inject = True

    def run(self, command, *, user, cwd, check=False):
        assert user == 'gamma-build'
        self.calls.append(command)
        if self.inject and command[1] == 'install':
            self.inject = False
            return subprocess.CompletedProcess(command, 127, '', 'EPERM: Operation not permitted: failed to link package fixture')
        command = [shutil.which('bun') if arg == gamma.BUN_BIN else arg for arg in command]
        return subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=60,
                              env={'PATH': str(Path(shutil.which('bun')).parent) + ':/usr/bin:/bin',
                                   'HOME': str(self.root / 'home'), 'BUN_INSTALL_CACHE_DIR': str(self.root / 'cache')})


class DependencyTests(unittest.TestCase):
    def test_real_copyfile_retry_runs_lifecycle_and_preserves_external_paths(self):
        with tempfile.TemporaryDirectory(prefix='gamma-bun-test-') as tmp:
            root = Path(tmp)
            release = root / 'release'
            release.mkdir()
            (root / 'home').mkdir()
            (release / 'packages/demo').mkdir(parents=True)
            (release / 'packages/demo/package.json').write_text(json.dumps({'name': 'demo', 'version': '1.0.0'}))
            (release / 'lifecycle.ts').write_text("await Bun.write(Bun.argv[2], 'ran')")
            (release / 'package.json').write_text(json.dumps({'name': 'fixture', 'workspaces': ['packages/*'], 'dependencies': {'demo': 'workspace:*'},
                'scripts': {'postinstall': 'bun lifecycle.ts lifecycle-marker', 'prepare': 'bun lifecycle.ts prepare-marker'}}))
            host = LocalBuild(root)
            host.inject = False
            self.assertEqual(host.run([gamma.BUN_BIN, 'install'], user='gamma-build', cwd=release).returncode, 0)
            locked = (release / 'bun.lock').read_bytes()
            for name in ('lifecycle-marker', 'prepare-marker'):
                (release / name).unlink()
            outside = root / 'outside'
            (outside / 'node_modules').mkdir(parents=True)
            (outside / 'node_modules/keep').write_text('keep')
            (release / 'external-workspace').symlink_to(outside, target_is_directory=True)
            (release / 'packages/demo/node_modules').symlink_to(outside / 'node_modules', target_is_directory=True)
            (release / 'node_modules/partial').write_text('partial')
            host.inject = True
            with contextlib.redirect_stdout(io.StringIO()):
                gamma.install_dependencies(host, release)
            self.assertFalse((release / 'node_modules/partial').exists())
            self.assertEqual((outside / 'node_modules/keep').read_text(), 'keep')
            self.assertEqual((release / 'bun.lock').read_bytes(), locked)
            for name in ('lifecycle-marker', 'prepare-marker'):
                self.assertEqual((release / name).read_text(), 'ran')
            self.assertEqual(json.loads((release / 'node_modules/demo/package.json').read_text())['name'], 'demo')
            # Repeated frozen installs remain valid and still run project scripts.
            with contextlib.redirect_stdout(io.StringIO()):
                gamma.install_dependencies(host, release)
            self.assertEqual((release / 'bun.lock').read_bytes(), locked)

    def test_real_bundled_node_gyp_is_available_to_child_processes(self):
        node = Path(shutil.which('node')).resolve()
        bundled = node.parent / gamma.NODE_GYP
        self.assertTrue(bundled.is_file(), 'Test requires the npm bundle shipped with Node')
        with tempfile.TemporaryDirectory(prefix='gamma-node-gyp-test-') as tmp:
            root = Path(tmp)
            (root / 'bin').mkdir()
            (root / 'lib/node_modules').mkdir(parents=True)
            (root / 'bin/node').symlink_to(node)
            (root / 'lib/node_modules/npm').symlink_to(node.parent.parent / 'lib/node_modules/npm', target_is_directory=True)
            command = [str(node), '-e', 'const r=require("child_process").spawnSync("node-gyp",["--version"],{stdio:"ignore"});process.exit(r.error?1:r.status)']
            env = {'PATH': str(root / 'bin'), 'HOME': str(root)}
            self.assertEqual(subprocess.run(command, env=env, capture_output=True).returncode, 1)
            with patch.object(gamma, 'NODE_BIN', str(root / 'bin')):
                gamma.install_node_gyp(gamma.Host())
                gamma.install_node_gyp(gamma.Host())
            self.assertEqual(subprocess.run(command, env=env, capture_output=True).returncode, 0)

    def test_lockfile_mutation_prevents_retry(self):
        with tempfile.TemporaryDirectory(prefix='gamma-lock-test-') as tmp:
            root = Path(tmp)
            (root / 'bun.lock').write_text('original')
            class MutatingBuild:
                calls = 0
                def run(self, command, **kwargs):
                    self.calls += 1
                    (root / 'bun.lock').write_text('changed')
                    return subprocess.CompletedProcess(command, 127, '', 'EPERM: failed to link package test')
            host = MutatingBuild()
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(gamma.Failure, 'modified the frozen lockfile'):
                gamma.install_dependencies(host, root)
            self.assertEqual(host.calls, 1)
