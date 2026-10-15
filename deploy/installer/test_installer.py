"""OS contract tests, NOT booted-VM tests. Git/SQLite/files/snapshots are real.
Only privileged commands, downloads, app build and services are substituted.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import gamma_installer as gamma


class TemporaryHost(gamma.Host):
    def __init__(self, root, version='24.04'):
        self.root, self.calls = root, []
        self.users, self.active, self.enabled = set(), set(), set()
        self.fail, self.conflict, self.disk, self.builds = None, '', 100 * 1024**3, 0
        self.cookie = False
        for name in ('etc', 'proc', 'run/systemd/system', 'opt', 'var/lib'):
            (root / name).mkdir(parents=True, exist_ok=True)
        self.path('/etc/os-release').write_text(f'ID=ubuntu\nVERSION_ID="{version}"\nPRETTY_NAME="Ubuntu {version}.1 LTS"\n')
        self.path('/proc/meminfo').write_text('MemTotal: 8388608 kB\n')
        self.repo = root / 'upstream'
        self.repo.mkdir()
        for name in ('bun.lock', 'deploy/web.ts', 'deploy/auth.ts', 'packages/opencode/src/index.ts',
                     'gamma-agent-market/profiles/catalog.json', 'gamma-skill-market/catalog.json'):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture\n')
        (self.repo / 'package.json').write_text(json.dumps({'packageManager': 'bun@1.3.14'}))
        self.git('init')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'fixture')
        self.commit()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, check=True, text=True, capture_output=True).stdout

    def commit(self):
        self.git('add', '.')
        self.git('commit', '--allow-empty', '-m', 'fixture')
        return self.git('rev-parse', 'HEAD').strip()

    def path(self, name): return self.root / name.lstrip('/')
    def uid(self, user): return os.getuid()
    def owner(self, path, user, recursive=False): self.calls.append(['ownership', user, str(path), str(recursive)])
    def disk_free(self, path): return self.disk
    def resolve(self, name): return [('fixture',)]
    def pause(self): pass

    def ports(self):
        return '\n'.join([self.conflict] + [f'LISTEN 0 128 127.0.0.1:{port} 0.0.0.0:* users:(("bun",pid=99,fd=1))'
            for name, port in (('gamma-backend', 4096), ('gamma-web', 4444)) if name in self.active])

    def run(self, command, *, user=None, cwd=None, data=None, check=True, extra=None, timeout=1800):
        self.calls.append(list(command))
        output, code = '', 0
        tool = Path(command[0]).name
        if self.fail == tool or (self.fail == 'build' and command[1:] == ['run', 'build']):
            self.fail = None
            if check: raise gamma.Failure('Injected failure: ' + tool)
            return subprocess.CompletedProcess(command, 1, '', '')
        if tool == 'uname': output = 'x86_64\n'
        elif tool == 'nproc': output = '4\n'
        elif tool == 'id':
            code = 0 if command[-1] in self.users else 1
            if '-nG' in command: output = command[-1] + '\n'
        elif tool == 'useradd': self.users.add(command[-1])
        elif tool == 'apt-get':
            self.path('/etc/nginx').mkdir(exist_ok=True)
            self.path('/etc/nginx/nginx.conf').write_text('# fixture')
        elif tool in ('chgrp', 'systemd-analyze', 'nginx'): pass
        elif tool == 'dpkg-query': output = 'fixture install ok installed\n' if '${Status}' in command[2] else 'fixture=1\n'
        elif tool == 'curl': output = '401'
        elif tool == 'openssl': output = 'fixture public key' if '-pubkey' in command or '-pubout' in command else ''
        elif tool == 'certbot':
            if 'certonly' in command:
                directory = self.path('/etc/letsencrypt/live/' + command[command.index('--cert-name') + 1])
                directory.mkdir(parents=True)
                (directory / 'fullchain.pem').write_text('certificate')
        elif tool == 'systemctl':
            names = [item for item in command[2:] if not item.startswith('--')]
            action = command[1]
            if action == 'enable':
                self.enabled.update(names)
                if '--now' in command: self.active.update(names)
            if action == 'start': self.active.update(names)
            if action == 'stop': self.active.difference_update(names)
            if action == 'is-active': code = 0 if all(name in self.active for name in names) else 3
            if action == 'is-enabled': code = 0 if all(name in self.enabled for name in names) else 1
        elif tool == 'git':
            return subprocess.run([str(self.repo) if arg == gamma.REPO else arg for arg in command],
                                  cwd=cwd, text=True, capture_output=True, check=check)
        elif tool == 'bun':
            if command[1:] == ['--version']: output = gamma.BUN + '\n'
            elif command[1] == '-e':
                return subprocess.run([shutil.which('bun'), *command[1:]], input=data, text=True, capture_output=True, check=True)
            elif command[1:] == ['run', 'build']:
                self.builds += 1
                (cwd / 'dist').mkdir(parents=True)
                (cwd / 'dist/index.html').write_text('<html>fixture</html>')
        elif tool == 'node': output = 'v' + gamma.NODE + '\n'
        elif tool in ('cp', 'mv', 'chmod', 'sh', 'du'):
            if tool != 'sh':
                for arg in command[1:]:
                    if arg.startswith('/'): assert arg.startswith(str(self.root)), command
            return subprocess.run(command, cwd=cwd, input=data, text=True, capture_output=True, check=check)
        else: raise AssertionError('Unsubstituted OS command: ' + repr(command))
        if code and check: raise gamma.Failure('Service/command unavailable: ' + tool)
        return subprocess.CompletedProcess(command, code, output, '')

    def request(self, url, *, headers=None, body=None):
        headers = headers or {}
        if ':4096' in url:
            if 'gamma-backend' not in self.active: return 0, {}, b''
            return (200 if 'Authorization' in headers else 401), {}, b'{}'
        if 'gamma-web' not in self.active: return 0, {}, b''
        if url.endswith(':4444/login'):
            if self.fail == 'frontend':
                self.fail = None
                return 404, {}, b''
            return 200, {}, b'<html>Gamma</html>'
        if url.endswith('/auth/login'):
            self.cookie = True
            return 200, {'Set-Cookie': 'test=session; HttpOnly'}, b'{}'
        if url.endswith('/auth/logout'):
            self.cookie = False
            return 200, {}, b'{}'
        return (200 if self.cookie and 'Cookie' in headers else 401), {}, b'{}'

    def prepare_runtime(self):
        self.path(gamma.BUN_BIN).parent.mkdir(parents=True, exist_ok=True)
        self.path(gamma.BUN_BIN).touch()
        self.path(gamma.NODE_BIN).mkdir(parents=True, exist_ok=True)
        self.path(gamma.NODE_BIN + '/node').touch()


class InstallerTests(unittest.TestCase):
    version = '24.04'

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gamma-installer-test-')
        self.addCleanup(self.temp.cleanup)
        self.host = TemporaryHost(Path(self.temp.name), self.version)
        self.args = gamma.parse_args(['--install', '--non-interactive', '--https', 'ssh-tunnel'])
        self.options = gamma.configuration(self.args, None)
        self.admin = {'username': 'admin', 'password': 'Fixture-password-only-9234!'}
        self.output = io.StringIO()
        capture = contextlib.redirect_stdout(self.output)
        capture.__enter__()
        self.addCleanup(capture.__exit__, None, None, None)

    def install(self):
        gamma.preflight(self.host, self.options, None)
        self.host.prepare_runtime()
        gamma.deploy(self.host, self.args, self.options, None, self.admin)
        return self.host.read_json(gamma.MANIFEST)

    def seed_data(self):
        db = self.host.path('/var/lib/gamma/opencode.db')
        with contextlib.closing(sqlite3.connect(db)) as connection, connection:
            connection.execute('create table session (id text primary key)')
            connection.execute("insert into session values ('keep-me')")
        self.host.path(self.options['workspaces'] + '/keep.txt').write_text('user content')
        self.host.path('/var/lib/gamma/knowledge/material.txt').write_text('knowledge')
        return db.read_bytes()

    def funnel_args(self, *extra):
        return gamma.parse_args(['--reconfigure', '--https', 'tailscale-funnel',
                                 '--public-origin', 'https://fixture.tail123.ts.net', *extra])

    def test_funnel_migration_upgrade_and_rollback(self):
        previous = self.install()
        data = self.seed_data()
        secrets = {name: self.host.path('/etc/gamma/' + name).read_bytes()
                   for name in ('auth.json', 'backend.env')}
        builds = self.host.builds
        gamma.reconfigure(self.host, self.funnel_args(), previous)
        state = self.host.read_json(gamma.MANIFEST)
        gamma.inspect(self.host, 'doctor')
        self.assertEqual(self.host.builds, builds)
        self.assertIn('GAMMA_TRUST_PROXY=0', self.host.path('/etc/gamma/gamma.env').read_text())
        calls = len(self.host.calls)
        gamma.reconfigure(self.host, self.funnel_args(), state)
        self.assertEqual(len(self.host.calls), calls)
        self.host.path(self.options['workspaces'] + '/new.txt').write_text('after migration')
        gamma.reconfigure(self.host, gamma.parse_args(['--rollback-config']), state)
        rolled = self.host.read_json(gamma.MANIFEST)
        self.assertEqual(rolled['options'], previous['options'])
        gamma.inspect(self.host, 'doctor')
        self.assertEqual(self.host.path(self.options['workspaces'] + '/new.txt').read_text(), 'after migration')
        gamma.reconfigure(self.host, self.funnel_args(), rolled)
        state = self.host.read_json(gamma.MANIFEST)
        args = gamma.parse_args(['--upgrade', '--non-interactive'])
        gamma.deploy(self.host, args, gamma.configuration(args, state), state, None)
        upgraded = self.host.read_json(gamma.MANIFEST)
        self.assertEqual(gamma.public_origin(upgraded['options']), 'https://fixture.tail123.ts.net')
        gamma.inspect(self.host, 'doctor')
        self.assertEqual(self.host.path('/var/lib/gamma/opencode.db').read_bytes(), data)
        self.assertEqual(self.host.path('/var/lib/gamma/knowledge/material.txt').read_text(), 'knowledge')
        for name, content in secrets.items():
            self.assertEqual(self.host.path('/etc/gamma/' + name).read_bytes(), content)

    def test_funnel_adoption_is_narrow_and_dry_run_read_only(self):
        previous = self.install()
        env = self.host.path('/etc/gamma/gamma.env')
        original = env.read_bytes()
        edited = original.replace(b'http://localhost:4444', b'https://fixture.tail123.ts.net')
        env.write_bytes(edited)
        with self.assertRaises(gamma.Failure):
            gamma.reconfigure(self.host, self.funnel_args(), previous)
        args = self.funnel_args('--adopt-public-origin', '--dry-run')
        before = len(self.host.calls)
        gamma.reconfigure(self.host, args, previous)
        self.assertEqual(len(self.host.calls), before)
        self.assertEqual(self.host.read_json(gamma.MANIFEST), previous)
        self.assertFalse(self.host.path(gamma.JOURNAL).exists())
        for invalid in (edited + b'# unexpected edit\n', edited.replace(b'\n', b'\r\n'),
                        edited.replace(b'GAMMA_TRUST_PROXY=0', b'GAMMA_TRUST_PROXY=1')):
            env.write_bytes(invalid)
            with self.assertRaises(gamma.Failure):
                gamma.reconfigure(self.host, args, previous)
        env.write_bytes(edited)
        gamma.reconfigure(self.host, self.funnel_args('--adopt-public-origin'), previous)
        gamma.inspect(self.host, 'doctor')
        gamma.reconfigure(self.host, gamma.parse_args(['--rollback-config']), self.host.read_json(gamma.MANIFEST))
        self.assertEqual(env.read_bytes(), original)
        gamma.inspect(self.host, 'doctor')

    def test_funnel_failed_activation_restores_exact_configuration(self):
        previous = self.install()
        data = self.seed_data()
        before = {name: self.host.path(name).read_bytes() for name in gamma.MANAGED}
        self.host.fail = 'frontend'
        with self.assertRaises(gamma.Failure):
            gamma.reconfigure(self.host, self.funnel_args(), previous)
        for name, content in before.items():
            self.assertEqual(self.host.path(name).read_bytes(), content)
        self.assertEqual(self.host.path('/var/lib/gamma/opencode.db').read_bytes(), data)
        self.assertFalse(self.host.path(gamma.JOURNAL).exists())
        gamma.inspect(self.host, 'doctor')

    def test_funnel_rejects_backup_tampering_and_other_drift(self):
        previous = self.install()
        policy = self.host.path('/etc/gamma/opencode.json')
        original = policy.read_bytes()
        policy.write_bytes(original + b' ')
        with self.assertRaises(gamma.Failure):
            gamma.reconfigure(self.host, self.funnel_args('--dry-run'), previous)
        policy.write_bytes(original)
        gamma.reconfigure(self.host, self.funnel_args(), previous)
        state = self.host.read_json(gamma.MANIFEST)
        self.host.path(state['config_rollback']['path']).write_text('{}')
        with self.assertRaisesRegex(gamma.Failure, 'backup drift'):
            gamma.reconfigure(self.host, gamma.parse_args(['--rollback-config']), state)
        self.assertEqual(self.host.read_json(gamma.MANIFEST), state)

    def test_funnel_cli_migration_doctor_and_rollback(self):
        self.install()
        argv = ['--reconfigure', '--https', 'tailscale-funnel',
                '--public-origin', 'https://fixture.tail123.ts.net']
        with patch.object(gamma, 'Host', return_value=self.host), patch.object(os, 'geteuid', return_value=0):
            with patch.dict(os.environ, {'HTTPS_PROXY': 'http://unused.invalid'}):
                gamma.main([*argv, '--dry-run'])
                self.assertEqual(self.host.read_json(gamma.MANIFEST)['options']['https'], 'ssh-tunnel')
                gamma.main(argv)
                gamma.main(['--doctor'])
                gamma.main(['--rollback-config', '--dry-run'])
                gamma.main(['--rollback-config'])
                gamma.main(['--doctor'])
        self.assertEqual(self.host.read_json(gamma.MANIFEST)['options']['https'], 'ssh-tunnel')

    def test_funnel_adoption_rejects_permissions_and_incomplete_manifest(self):
        previous = self.install()
        env = self.host.path('/etc/gamma/gamma.env')
        env.chmod(0o644)
        with self.assertRaisesRegex(gamma.Failure, 'private'):
            gamma.reconfigure(self.host, self.funnel_args('--dry-run'), previous)
        env.chmod(0o600)
        previous['files'].pop('/etc/gamma/opencode.json')
        with self.assertRaisesRegex(gamma.Failure, 'Incomplete'):
            gamma.reconfigure(self.host, self.funnel_args('--dry-run'), previous)

    def test_funnel_fresh_install_and_origin_validation(self):
        self.args = gamma.parse_args(['--install', '--non-interactive', '--https', 'tailscale-funnel',
                                      '--public-origin', 'https://fixture.tail123.ts.net'])
        self.options = gamma.configuration(self.args, None)
        with patch.object(self.host, 'resolve', side_effect=AssertionError('DNS must not be required')):
            state = self.install()
        gamma.inspect(self.host, 'doctor')
        self.assertFalse(any(Path(call[0]).name in ('certbot', 'tailscale') for call in self.host.calls))
        for origin in ('http://fixture.tail123.ts.net', 'https://fixture.tail123.ts.net/',
                       'https://fixture.tail123.ts.net.evil.test', 'https://user@fixture.tail123.ts.net',
                       'https://fixture.tail123.ts.net:443', 'https://fixture.tail123.ts.net?x=1'):
            args = gamma.parse_args(['--install', '--non-interactive', '--https', 'tailscale-funnel', '--public-origin', origin])
            with self.assertRaises(gamma.Failure):
                gamma.configuration(args, None)

    def test_proxy_rejected_without_disclosing_credentials(self):
        for scheme in ('socks5', 'http', 'https'):
            with self.assertRaises(gamma.Failure) as error:
                gamma.check_proxy({'HTTPS_PROXY': scheme + '://secret:password@example.invalid'})
            self.assertIn('HTTPS_PROXY', str(error.exception))
            self.assertNotIn('password', str(error.exception))
            self.assertNotIn('secret', str(error.exception))
        gamma.check_proxy({'NO_PROXY': 'localhost'})

    def test_runuser_resolves_outside_restricted_service_path(self):
        result = subprocess.CompletedProcess([], 0, '', '')
        with patch.object(gamma.subprocess, 'run', return_value=result) as run:
            gamma.Host().run(['/usr/bin/true'], user='gamma')
        self.assertEqual(run.call_args.args[0][0], '/usr/sbin/runuser')
        self.assertNotIn('/usr/sbin', run.call_args.kwargs['env']['PATH'].split(':'))

    def test_cli_lifecycle_with_isolated_os_boundary(self):
        self.host.path('/proc/meminfo').write_text('MemTotal: 7340032 kB\n')
        install_runtimes = gamma.install_runtimes

        def provision_runtime(host):
            host.prepare_runtime()
            install_runtimes(host)

        with patch.object(gamma, 'Host', return_value=self.host), patch.object(gamma.os, 'geteuid', return_value=0), \
                patch.object(gamma, 'admin_input', return_value=self.admin), \
                patch.object(gamma, 'install_runtimes', side_effect=provision_runtime), \
                patch.dict(os.environ, {'PATH': os.environ['PATH']}, clear=True):
            # The real dispatcher runs; only OS access and interactive credentials are substituted.
            previous_umask = os.umask(0o077)
            self.addCleanup(os.umask, previous_umask)
            gamma.main(['--check'])
            gamma.main(['--install', '--non-interactive', '--https', 'ssh-tunnel'])
            before = self.host.path('/etc/gamma/auth.json').read_bytes()
            for mode in ('status', 'doctor', 'install', 'upgrade', 'doctor'):
                gamma.main(['--' + mode, '--non-interactive'])
            self.assertEqual(self.host.builds, 2)
            self.assertEqual(self.host.path('/etc/gamma/auth.json').read_bytes(), before)

    def test_unsupported_os_rejected_before_provisioning(self):
        for distro, version in (('ubuntu', '22.04'), ('ubuntu', '25.10'), ('ubuntu', '26.10'),
                                ('debian', '26.04'), ('linuxmint', '26.04'), ('ubuntu', '26.04.1')):
            with self.subTest(distro=distro, version=version):
                self.host.path('/etc/os-release').write_text(f'ID={distro}\nVERSION_ID="{version}"\n')
                with self.assertRaisesRegex(gamma.Failure, 'Supported installation targets'):
                    gamma.preflight(self.host, self.options, None)
        self.assertFalse(self.host.calls)

    def test_booted_systemd_required(self):
        self.host.path('/run/systemd/system').rmdir()
        with self.assertRaisesRegex(gamma.Failure, 'booted systemd'):
            gamma.preflight(self.host, self.options, None)

    def test_home_server_resources(self):
        self.host.path('/proc/meminfo').write_text('MemTotal: 7340032 kB\n')
        self.host.disk = 30 * 1024**3
        gamma.preflight(self.host, self.options, None)

    def test_six_gib_memory_boundary(self):
        self.host.path('/proc/meminfo').write_text('MemTotal: 6291455 kB\n')
        with self.assertRaisesRegex(gamma.Failure, 'At least 6 GiB'):
            gamma.preflight(self.host, self.options, None)
        self.assertFalse(any(call[0] == 'apt-get' for call in self.host.calls))
        self.host.path('/proc/meminfo').write_text('MemTotal: 6291456 kB\n')
        gamma.preflight(self.host, self.options, None)

    def test_memory_recommendation_is_a_warning(self):
        for memory in (6291456, 7340032, 8388608, 16777215, 16777216):
            with self.subTest(memory=memory):
                self.output.seek(0)
                self.output.truncate()
                self.host.path('/proc/meminfo').write_text(f'MemTotal: {memory} kB\n')
                gamma.preflight(self.host, self.options, None)
                self.assertIn('Preflight OK', self.output.getvalue())
                self.assertEqual('16 GiB recommended' in self.output.getvalue(), memory < 16777216)

    def test_cloudflare_tunnel_install_repeat_upgrade(self):
        self.options.update(https='cloudflare-tunnel', domain='gamma.example.test')
        gamma.validate(self.options)
        self.host.conflict = 'LISTEN 0 128 0.0.0.0:443 0.0.0.0:* users:(("other",pid=1,fd=1))'
        with patch.object(self.host, 'resolve', side_effect=AssertionError('Tunnel DNS may be configured later')):
            state = self.install()
        env = self.host.path('/etc/gamma/gamma.env').read_text()
        self.assertIn('GAMMA_PUBLIC_ORIGIN=https://gamma.example.test\n', env)
        self.assertIn('GAMMA_TRUST_PROXY=0\n', env)
        self.assertNotIn('listen ', self.host.path(gamma.NGINX).read_text())
        gamma.deploy(self.host, self.args, self.options, state, None)
        self.args.mode = 'upgrade'
        gamma.deploy(self.host, self.args, self.options, state, None)
        gamma.inspect(self.host, 'doctor')
        self.assertEqual(self.host.enabled, {'gamma-backend', 'gamma-web'})
        self.assertIn('OPENCODE_ENABLE_EXA=1\n', self.host.path('/etc/gamma/gamma.env').read_text())
        self.assertIn('OPENCODE_WEBSEARCH_PROVIDER=exa\n', self.host.path('/etc/gamma/gamma.env').read_text())
        self.assertFalse(any(call[0] in ('certbot', 'curl') for call in self.host.calls))
        for domain in (None, '', '127.0.0.1', 'https://gamma.example.test', 'bad;host'):
            with self.assertRaises(gamma.Failure):
                gamma.validate({**self.options, 'domain': domain})

    def test_dev_and_installer_defaults_match(self):
        config = json.loads((Path(gamma.__file__).parents[1] / 'opencode.json').read_text())
        config.pop('$schema', None)
        self.assertEqual(gamma.policy('trusted-auto'), config)

    def test_restricted_upgrade_stays_restricted(self):
        self.options['profile'] = 'restricted'
        state = self.install()
        self.args.mode = 'upgrade'
        gamma.deploy(self.host, self.args, self.options, state, None)
        self.assertEqual(self.host.read_json('/etc/gamma/opencode.json'), gamma.policy('restricted'))

    def test_frontend_failure_rolls_back(self):
        state = self.install()
        database = self.seed_data()
        self.args.mode, self.host.fail = 'upgrade', 'frontend'
        with self.assertRaisesRegex(gamma.Failure, 'Frontend'):
            gamma.deploy(self.host, self.args, self.options, state, None)
        self.assertEqual(self.host.read_json(gamma.MANIFEST), state)
        self.assertEqual(self.host.path('/var/lib/gamma/opencode.db').read_bytes(), database)
        self.assertFalse(self.host.path(gamma.JOURNAL).exists())

    def test_doctor_reports_missing_packages(self):
        self.install()
        self.host.fail = 'dpkg-query'
        with self.assertRaisesRegex(gamma.Failure, 'Required OS packages'):
            gamma.inspect(self.host, 'doctor')

    def test_clean_install(self):
        state = self.install()
        self.assertEqual(state['phase'], 'ready')
        self.assertEqual(state['commit'], self.host.git('rev-parse', 'HEAD').strip())
        self.assertEqual(self.host.read_json('/etc/gamma/opencode.json')['permission'], {'*': 'allow', 'external_directory': 'deny'})
        self.assertEqual(self.host.path('/etc/gamma/auth.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.host.enabled, {'gamma-backend', 'gamma-web'})
        self.assertNotIn('listen 80;', self.host.path(gamma.NGINX).read_text())
        self.assertFalse(self.host.path(gamma.JOURNAL).exists())

    def test_repeat_preserves_credentials_without_rebuild(self):
        state = self.install()
        before = {name: self.host.path(name).read_bytes() for name in ('/etc/gamma/auth.json', '/etc/gamma/backend.env', gamma.MANIFEST)}
        gamma.deploy(self.host, self.args, self.options, state, None)
        self.assertEqual(self.host.builds, 1)
        for name, value in before.items(): self.assertEqual(self.host.path(name).read_bytes(), value)

    def test_upgrade_preserves_database_files_knowledge_credentials(self):
        state = self.install()
        database = self.seed_data()
        auth = self.host.path('/etc/gamma/auth.json').read_bytes()
        (self.host.repo / 'new.txt').write_text('release 2')
        commit = self.host.commit()
        self.args.mode = 'upgrade'
        gamma.deploy(self.host, self.args, self.options, state, None)
        self.assertEqual(self.host.read_json(gamma.MANIFEST)['commit'], commit)
        self.assertEqual(self.host.path('/var/lib/gamma/opencode.db').read_bytes(), database)
        self.assertEqual(self.host.path(self.options['workspaces'] + '/keep.txt').read_text(), 'user content')
        self.assertEqual(self.host.path('/var/lib/gamma/knowledge/material.txt').read_text(), 'knowledge')
        self.assertEqual(self.host.path('/etc/gamma/auth.json').read_bytes(), auth)

    def test_no_secrets_in_output_argv_or_manifest(self):
        self.install()
        token = self.host.path('/etc/gamma/backend.env').read_text().split('OPENCODE_SERVER_PASSWORD=')[1].strip()
        public = self.output.getvalue() + repr(self.host.calls) + self.host.path(gamma.MANIFEST).read_text()
        for value in (self.admin['password'], token, '$argon2id$'): self.assertNotIn(value, public)
        self.assertNotIn(self.admin['password'], self.host.path('/etc/gamma/auth.json').read_text())

    def test_wrong_permissions_rejected(self):
        state = self.install()
        self.host.path('/etc/gamma/auth.json').chmod(0o644)
        self.args.mode = 'upgrade'
        with self.assertRaisesRegex(gamma.Failure, 'permissions'):
            gamma.deploy(self.host, self.args, self.options, state, None)
        self.assertEqual(self.host.builds, 1)

    def test_build_failure_leaves_old_services_running(self):
        state = self.install()
        database = self.seed_data()
        self.args.mode, self.host.fail = 'upgrade', 'build'
        with self.assertRaises(gamma.Failure): gamma.deploy(self.host, self.args, self.options, state, None)
        self.assertEqual(self.host.read_json(gamma.MANIFEST), state)
        self.assertEqual(self.host.path('/var/lib/gamma/opencode.db').read_bytes(), database)
        self.assertIn('gamma-web', self.host.active)

    def test_first_failed_build_can_resume(self):
        self.host.prepare_runtime()
        self.host.fail = 'build'
        with self.assertRaises(gamma.Failure): gamma.deploy(self.host, self.args, self.options, None, self.admin)
        auth = self.host.path('/etc/gamma/auth.json').read_bytes()
        pending = self.host.read_json(gamma.MANIFEST)
        gamma.preflight(self.host, self.options, pending)
        gamma.deploy(self.host, self.args, self.options, pending, None)
        self.assertEqual(self.host.path('/etc/gamma/auth.json').read_bytes(), auth)

    def test_port_conflict_no_mutation(self):
        self.host.conflict = 'LISTEN 0 128 0.0.0.0:4096 0.0.0.0:* users:(("other",pid=1,fd=1))'
        with self.assertRaisesRegex(gamma.Failure, 'Port 4096'): gamma.preflight(self.host, self.options, None)
        self.assertFalse(self.host.path('/etc/gamma').exists())
        self.assertFalse(any(call[0] == 'apt-get' for call in self.host.calls))

    def test_resources_os_rejected(self):
        for file, value in [('/etc/os-release', 'ID=ubuntu\nVERSION_ID=22.04\n'), ('/proc/meminfo', 'MemTotal: 1000 kB\n')]:
            old = self.host.path(file).read_text()
            self.host.path(file).write_text(value)
            with self.assertRaises(gamma.Failure): gamma.preflight(self.host, self.options, None)
            self.host.path(file).write_text(old)
        self.host.disk = 1024
        with self.assertRaisesRegex(gamma.Failure, 'free'): gamma.preflight(self.host, self.options, None)

    def test_foreign_nginx_never_overwritten(self):
        self.host.path(gamma.NGINX).parent.mkdir(parents=True)
        self.host.path(gamma.NGINX).write_text('foreign config')
        with self.assertRaises(gamma.Failure): gamma.preflight(self.host, self.options, None)
        with self.assertRaises(gamma.Failure): gamma.activate_nginx(self.host, 'new')
        self.assertEqual(self.host.path(gamma.NGINX).read_text(), 'foreign config')

    def test_bad_nginx_restores_without_reload(self):
        path = self.host.path(gamma.NGINX)
        path.parent.mkdir(parents=True)
        path.write_text(gamma.MARKER + '\nold')
        self.host.fail = 'nginx'
        with self.assertRaisesRegex(gamma.Failure, 'nginx -t'): gamma.activate_nginx(self.host, gamma.MARKER + '\nbad')
        self.assertEqual(path.read_text(), gamma.MARKER + '\nold')
        self.assertNotIn(['systemctl', 'reload', 'nginx'], self.host.calls)

    def test_activation_failure_rolls_back_data_and_units(self):
        state = self.install()
        database = self.seed_data()
        self.args.mode, self.host.fail = 'upgrade', 'systemd-analyze'
        with self.assertRaises(gamma.Failure): gamma.deploy(self.host, self.args, self.options, state, None)
        self.assertEqual(self.host.read_json(gamma.MANIFEST), state)
        self.assertEqual(self.host.path('/var/lib/gamma/opencode.db').read_bytes(), database)
        self.assertIn('gamma-web', self.host.active)
        self.assertTrue(list(self.host.path('/var/backups/gamma').glob('*/failed/var/lib/gamma')))

    def test_interrupted_upgrade_recovers_after_migration(self):
        state = self.install()
        database = self.seed_data()
        gamma.begin_transaction(self.host, state, state)
        self.host.path('/var/lib/gamma/opencode.db').write_bytes(b'new incompatible database')
        self.host.path('/var/lib/gamma/knowledge/material.txt').write_text('new version')
        gamma.recover(self.host)
        self.assertEqual(self.host.path('/var/lib/gamma/opencode.db').read_bytes(), database)
        self.assertEqual(self.host.path('/var/lib/gamma/knowledge/material.txt').read_text(), 'knowledge')
        self.assertEqual(self.host.read_json(gamma.MANIFEST), state)

    def test_autostart_contract_simulated_reboot(self):
        self.install()
        self.host.active.clear()
        for name in self.host.enabled:
            unit = self.host.path('/etc/systemd/system/' + name + '.service').read_text()
            for text in ('WantedBy=multi-user.target', 'User=gamma\n', 'NoNewPrivileges=true'): self.assertIn(text, unit)
            self.host.active.add(name)
        gamma.smoke(self.host, self.options)

    def test_restricted_no_sudo_or_firewall_commands(self):
        self.options['profile'] = 'restricted'
        self.install()
        self.assertEqual(self.host.read_json('/etc/gamma/opencode.json')['permission']['bash'], 'ask')
        self.assertEqual(self.host.read_json('/etc/gamma/opencode.json')['permission']['external_directory'], 'deny')
        self.assertFalse(any(call[0] in ('sudo', 'ufw', 'iptables') for call in self.host.calls))

    def test_doctor_status_read_only(self):
        self.install()
        before = {str(p): p.read_bytes() for p in self.host.root.rglob('*') if p.is_file()}
        gamma.inspect(self.host, 'doctor')
        gamma.inspect(self.host, 'status')
        after = {str(p): p.read_bytes() for p in self.host.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_drift_stops_upgrade(self):
        state = self.install()
        self.host.path('/etc/gamma/opencode.json').write_text('{"permission":"deny"}')
        with self.assertRaisesRegex(gamma.Failure, 'drift'): gamma.check_drift(self.host, state)

    def test_invalid_inputs_and_public_http(self):
        for patch in ({'https': 'http'}, {'https': 'existing', 'domain': 'host;bad'}, {'workspaces': '/etc'},
                      {'repo': 'https://token@github.com/hiyyt1/Gamma-code'}, {'workspaces': '/srv/../etc'}):
            with self.assertRaises(gamma.Failure): gamma.validate({**self.options, **patch})

    def test_nginx_sse_ws_acme(self):
        config = gamma.nginx_config({**self.options, 'https': 'letsencrypt', 'domain': 'gamma.example.test'})
        self.assertNotIn('4096', config)
        for text in ('proxy_pass http://127.0.0.1:4444', 'proxy_buffering off', 'proxy_request_buffering off',
                     'proxy_http_version 1.1', 'proxy_set_header Upgrade $http_upgrade', '/.well-known/acme-challenge/'):
            self.assertIn(text, config)

    def test_existing_tls_install(self):
        self.options.update(https='existing', domain='gamma.example.test', tls_cert='/etc/test-cert.pem', tls_key='/etc/test-key.pem')
        self.host.path('/etc/test-cert.pem').write_text('fixture')
        self.host.path('/etc/test-key.pem').write_text('fixture')
        self.host.path('/etc/test-key.pem').chmod(0o600)
        self.install()
        self.assertIn('nginx', self.host.enabled)
        self.assertTrue(any(call[0] == 'curl' and '--resolve' in call for call in self.host.calls))
        self.assertTrue(all('-k' not in call for call in self.host.calls))

    def test_workspace_symlink_rejected(self):
        self.host.path('/srv').mkdir()
        self.host.path('/srv/projects').symlink_to(self.host.path('/etc'), target_is_directory=True)
        self.options['workspaces'] = '/srv/projects'
        with self.assertRaisesRegex(gamma.Failure, 'Symlink'): gamma.preflight(self.host, self.options, None)

    def test_global_policy_override_rejected_before_changes(self):
        self.host.path('/etc/opencode').mkdir()
        self.host.path('/etc/opencode/opencode.json').write_text('{"permission":"deny"}')
        with self.assertRaisesRegex(gamma.Failure, 'policy override'):
            gamma.preflight(self.host, self.options, None)
        self.assertFalse(self.host.users)

    def test_backup_space_failure_does_not_stop_running_services(self):
        state = self.install()
        self.host.disk = 1024
        with self.assertRaisesRegex(gamma.Failure, 'backup space'):
            gamma.begin_transaction(self.host, state, state)
        self.assertEqual(self.host.active, {'gamma-backend', 'gamma-web'})
        self.assertFalse(self.host.path(gamma.JOURNAL).exists())

    def test_acme_bootstrap_renewal_and_repeat(self):
        self.options.update(https='letsencrypt', domain='gamma.example.test', email='admin@example.test')
        state = self.install()
        self.assertIn('certbot.timer', self.host.enabled)
        self.assertTrue(any(call[0] == 'certbot' and '--dry-run' in call for call in self.host.calls))
        self.assertIn('nginx -t', self.host.path('/etc/letsencrypt/renewal-hooks/deploy/gamma-nginx').read_text())
        gamma.deploy(self.host, self.args, self.options, state, None)
        self.assertEqual(sum(call[0] == 'certbot' and 'certonly' in call for call in self.host.calls), 1)


class Installer26Tests(InstallerTests):
    version = '26.04'


if __name__ == '__main__': unittest.main()
