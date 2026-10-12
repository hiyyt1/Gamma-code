#!/usr/bin/env python3
"""Privileged provisioning only. No agent/session/MCP runtime patches.

Host is the OS boundary: tests substitute it with a temporary filesystem and
fake service/package manager, never a CLI flag that could redirect only some writes.
"""
import argparse
import base64
import fcntl
import fnmatch
import getpass
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

REPO = "https://github.com/hiyyt1/Gamma-code.git"
BUN = "1.3.14"
NODE = "22.22.0"
BUN_SHA = "a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7"
NODE_SHA = "9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37"
RUNTIME = "/opt/gamma/runtime"
BUN_BIN = f"{RUNTIME}/bun-{BUN}/bun"
NODE_BIN = f"{RUNTIME}/node-v{NODE}-linux-x64/bin"
MANIFEST = "/etc/gamma/install.json"
JOURNAL = "/etc/gamma/transaction.json"
NGINX = "/etc/nginx/conf.d/gamma.conf"
MARKER = "# Managed by install-gamma.sh v1"
PACKAGES = ["ca-certificates", "curl", "unzip", "xz-utils", "git", "ripgrep",
            "build-essential", "python3", "python3-venv", "pkg-config", "nginx",
            "certbot", "sqlite3", "openssl", "iproute2", "libreoffice-impress", "libreoffice-calc", "poppler-utils",
            "openjdk-21-jre-headless", "fontconfig", "fonts-dejavu-core", "fonts-liberation", "fonts-noto-color-emoji", "python3-lxml",
            "libasound2t64", "libatk-bridge2.0-0t64", "libatk1.0-0t64", "libatspi2.0-0t64",
            "libcairo2", "libcups2t64", "libdbus-1-3", "libdrm2", "libgbm1", "libglib2.0-0t64",
            "libnspr4", "libnss3", "libpango-1.0-0", "libx11-6", "libxcb1", "libxcomposite1",
            "libxdamage1", "libxext6", "libxfixes3", "libxkbcommon0", "libxrandr2"]
MANAGED = [MANIFEST, "/etc/gamma/gamma.env", "/etc/gamma/opencode.json", NGINX,
           "/etc/systemd/system/gamma-backend.service", "/etc/systemd/system/gamma-web.service"]


class Failure(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Failure(message)


def policy(profile):
    permissions = {"*": "allow", "external_directory": "deny"} if profile == "trusted-auto" else {
        "*": "ask", "read": {"*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow"},
        "glob": "allow", "grep": "allow", "edit": "ask", "bash": "ask",
        "external_directory": "deny", "task": "ask", "webfetch": "ask", "websearch": "ask", "skill": "ask",
    }
    return {"default_agent": "gamma", "permission": permissions, "share": "disabled", "autoupdate": False}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Gamma Ubuntu 24.04 amd64 installer (no firewall changes)")
    modes = parser.add_mutually_exclusive_group(required=True)
    for name in ("check", "install", "upgrade", "status", "doctor"):
        modes.add_argument("--" + name, dest="mode", action="store_const", const=name)
    parser.add_argument("--repo", default=REPO, help="HTTPS GitHub repository, no credentials")
    parser.add_argument("--ref", default="HEAD", help="branch/tag/SHA; resolved to an immutable commit")
    parser.add_argument("--domain", help="DNS name (or IP with --https existing)")
    parser.add_argument("--https", choices=["letsencrypt", "existing", "ssh-tunnel"])
    parser.add_argument("--email", help="ACME contact")
    parser.add_argument("--tls-cert", help="existing trusted fullchain PEM")
    parser.add_argument("--tls-key", help="existing root-only private key PEM")
    parser.add_argument("--admin-user")
    parser.add_argument("--admin-password-file", help="root-owned 0600 file, never a password argument")
    parser.add_argument("--permission-profile", choices=["trusted-auto", "restricted"])
    parser.add_argument("--workspaces", help="new absolute project directory, default /home/gamma/workspaces")
    parser.add_argument("--non-interactive", action="store_true")
    return parser.parse_args(argv)


def safe_path(value):
    require(bool(re.fullmatch(r"/[A-Za-z0-9_./-]+", value)), "Path must be absolute without spaces or shell metacharacters")
    require(str(Path(value)) == value and ".." not in Path(value).parts, "Non-canonical path")
    return value


def validate(options):
    require(bool(re.fullmatch(r"https://github.com/[\w.-]+/[\w.-]+(?:\.git)?", options["repo"])), "Use a GitHub HTTPS URL without credentials")
    require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./-]*", options["ref"])), "Invalid git ref")
    require(options["profile"] in ("trusted-auto", "restricted"), "Invalid permission profile")
    safe_path(options["workspaces"])
    workspace = Path(options["workspaces"])
    require(any(workspace.is_relative_to(base) and workspace != Path(base) for base in ("/home/gamma", "/srv", "/mnt")),
            "Project path must be a child of /home/gamma, /srv or /mnt (dedicated empty directory)")
    require(not workspace.is_relative_to("/home/gamma/.bun"), "Runtime cannot be a workspace")
    require(options["https"] in ("letsencrypt", "existing", "ssh-tunnel"), "HTTPS mode required")
    if options["https"] == "ssh-tunnel":
        require(not options.get("domain"), "ssh-tunnel mode uses http://localhost:4444 only; omit --domain")
        return
    domain = options.get("domain", "")
    require(bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", domain)) and "." in domain and ".." not in domain,
            "Enter a lowercase DNS hostname without scheme, port or path")
    require(all(0 < len(label) <= 63 and not label.startswith("-") and not label.endswith("-") for label in domain.split(".")) and len(domain) < 254,
            "Invalid DNS labels")
    if options["https"] == "letsencrypt":
        require(not re.fullmatch(r"[0-9.]+", domain), "For IP use existing trusted TLS or ssh-tunnel")
        require(bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", options.get("email") or "")), "ACME email required")
    if options["https"] == "existing":
        safe_path(options.get("tls_cert") or "")
        safe_path(options.get("tls_key") or "")


def configuration(args, previous):
    if previous:
        options = previous["options"].copy()
        for attr, key in [("domain", "domain"), ("https", "https"), ("workspaces", "workspaces"),
                          ("permission_profile", "profile"), ("tls_cert", "tls_cert"), ("tls_key", "tls_key")]:
            require(getattr(args, attr) in (None, options.get(key)), "Existing settings differ; use documented manual migration, not install/upgrade")
        options.update(repo=args.repo, ref=args.ref)
        validate(options)
        return options
    options = {"repo": args.repo, "ref": args.ref, "domain": args.domain, "https": args.https,
               "email": args.email, "tls_cert": args.tls_cert, "tls_key": args.tls_key,
               "workspaces": args.workspaces or "/home/gamma/workspaces", "profile": args.permission_profile or "trusted-auto"}
    if not args.non_interactive:
        if not options["https"]:
            options["domain"] = options["domain"] or input("Gamma domain (empty = secure SSH tunnel by IP): ").strip()
            options["https"] = input("HTTPS: letsencrypt / existing / ssh-tunnel [%s]: " % ("letsencrypt" if options["domain"] else "ssh-tunnel")).strip() or ("letsencrypt" if options["domain"] else "ssh-tunnel")
        if options["https"] == "letsencrypt":
            options["email"] = options["email"] or input("ACME email: ").strip()
        if options["https"] == "existing":
            options["tls_cert"] = options["tls_cert"] or input("Trusted fullchain PEM path: ").strip()
            options["tls_key"] = options["tls_key"] or input("Private key PEM path: ").strip()
        if not args.workspaces:
            options["workspaces"] = input("Project storage [/home/gamma/workspaces]: ").strip() or "/home/gamma/workspaces"
    validate(options)
    return options


class Host:
    def path(self, name):
        return Path(name)

    def run(self, command, *, user=None, cwd=None, data=None, check=True, extra=None, timeout=1800):
        # Never inherit administrator credentials, proxies, SSH agent or config flags into tools/builds.
        env = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "HOME": "/root"}
        if user:
            env.update(HOME=f"/home/{user}", PATH=f"{RUNTIME}/bun-{BUN}:{NODE_BIN}:/usr/bin:/bin")
        env.update(extra or {})
        cmd = ["runuser", "-u", user, "--", "env", "-i", *[f"{key}={value}" for key, value in env.items()], *command] if user else command
        try:
            result = subprocess.run(cmd, cwd=cwd, input=data, text=True, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, env=env, timeout=timeout)
        except FileNotFoundError:
            raise Failure(f"Required executable missing: {Path(cmd[0]).name}; see docs/deployment/REQUIREMENTS.md") from None
        # Subprocess output may contain secrets (including malicious build scripts). Never print it automatically.
        if check and result.returncode:
            if "UnsupportedProxyProtocol" in result.stderr:
                raise Failure("Bun UnsupportedProxyProtocol: use direct egress or an HTTP proxy; inspect npm/Bun proxy configuration without printing credentials")
            raise Failure(f"Stage command failed: {Path(command[0]).name} (exit {result.returncode}); inspect the named stage, then --doctor")
        return result

    def owner(self, path, user, recursive=False):
        self.run(["chown", *( ["-R"] if recursive else []), f"{user}:{user}", str(path)])

    def uid(self, user):
        return pwd.getpwnam(user).pw_uid

    def mkdir(self, name, mode=0o700, user="root"):
        path = self.path(name)
        self.no_symlink(path)
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(mode)
        self.owner(path, user)
        return path

    def no_symlink(self, path):
        require(not any(item.is_symlink() for item in (path, *path.parents)), f"Symlink path refused: {path}")

    def write(self, name, content, mode=0o600, user="root"):
        path = self.path(name)
        self.no_symlink(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temp = Path(stream.name)
            stream.write(content.encode())
            stream.flush()
            os.fsync(stream.fileno())
        temp.chmod(mode)
        self.owner(temp, user)
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        os.fsync(directory)
        os.close(directory)

    def json(self, name, value):
        self.write(name, json.dumps(value, indent=2) + "\n")

    def read_json(self, name):
        path = self.path(name)
        return json.loads(path.read_text()) if path.exists() else None

    def copy(self, source, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        self.run(["cp", "-a", str(source), str(target)])

    def disk_free(self, path):
        return shutil.disk_usage(path).free

    def resolve(self, name):
        return socket.getaddrinfo(name, 443)

    def ports(self):
        return self.run(["ss", "-H", "-ltnp"]).stdout

    def request(self, url, *, headers=None, body=None):
        request = urllib.request.Request(url, data=body, headers=headers or {})
        # Local probes must never be sent to an inherited outbound proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=5) as response:
                return response.status, response.headers, response.read(65536)
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read(65536)
        except (OSError, urllib.error.URLError):
            return 0, {}, b""

    def download(self, url, target, expected):
        self.run(["curl", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--tlsv1.2",
                  "--max-time", "300", "--output", str(target), url], timeout=330)
        require(hashlib.sha256(target.read_bytes()).hexdigest() == expected, "Runtime SHA-256 mismatch; refusing extraction/execution")

    def pause(self):
        time.sleep(1)


def check_proxy(environment):
    # Provisioning deliberately has a clean environment; do not silently bypass a required proxy.
    keys = [key for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")
            if environment.get(key)]
    require(not keys, "Installer requires direct HTTPS/APT access; inherited proxy variables are not supported: "
            + ", ".join(keys) + ". Remove them only if direct access is permitted, or provision direct egress. "
            "SOCKS causes Bun UnsupportedProxyProtocol. Proxy values/credentials are not logged.")


def preflight(host, options, previous):
    release = dict(line.split("=", 1) for line in host.path("/etc/os-release").read_text().splitlines() if "=" in line)
    require(release.get("ID", "").strip('"') == "ubuntu" and release.get("VERSION_ID", "").strip('"') == "24.04",
            "Supported installation target: Ubuntu Server 24.04 LTS")
    require(host.run(["uname", "-m"]).stdout.strip() == "x86_64", "Only amd64 is qualified by this installer")
    require(host.path("/run/systemd/system").is_dir(), "A booted systemd host is required (not a plain container/chroot)")
    memory = int(re.search(r"MemTotal:\s+(\d+)", host.path("/proc/meminfo").read_text())[1])
    require(memory >= 7_600_000, "At least 8 GiB RAM required for the production build; 16 GiB recommended with browsers")
    require(int(host.run(["nproc"]).stdout) >= 2, "At least 2 vCPU required")
    for name in ("/opt", "/var/lib", options["workspaces"]):
        path = host.path(name)
        host.no_symlink(path)
        while not path.exists():
            path = path.parent
        require(host.disk_free(path) >= 30 * 1024**3, f"At least 30 GiB free required on filesystem for {name}")
    host.no_symlink(host.path("/etc/gamma"))
    for name in ("/etc/opencode/opencode.json", "/etc/opencode/opencode.jsonc"):
        require(not host.path(name).exists(), f"Managed OpenCode policy override detected: {name}; review before installation")
    for name in ["/opt/gamma", "/var/lib/gamma", "/home/gamma", "/home/gamma-build"]:
        host.no_symlink(host.path(name))
    if not previous:
        for name in ["/opt/gamma", "/var/lib/gamma", "/etc/gamma", *MANAGED[3:]]:
            require(not host.path(name).exists(), f"Unmanaged installation/configuration at {name}; migrate explicitly, no overwrite")
        path = host.path(options["workspaces"])
        require(not path.exists() or (path.is_dir() and not any(path.iterdir())), "New workspace directory must be empty")
        for user in ("gamma", "gamma-build"):
            require(host.run(["id", user], check=False).returncode != 0, f"Existing unmanaged user {user}; refusing adoption")
    ports = host.ports()
    for line in ports.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        port = parts[3].rsplit(":", 1)[-1]
        if port in ("4096", "4444"):
            require(bool(previous), f"Port {port} occupied; no service was stopped")
        if options["https"] != "ssh-tunnel" and port in ("80", "443"):
            require('"nginx"' in line, f"Port {port} occupied by a non-Nginx process")
    if options["https"] != "ssh-tunnel":
        require(bool(host.resolve(options["domain"])), "DNS resolution failed")
    if host.path("/etc/nginx/nginx.conf").exists():
        result = host.run(["nginx", "-T"], check=False)
        require(result.returncode == 0, "Existing Nginx configuration is invalid; repair it before installation")
        sections = re.split(r"# configuration file ([^\n]+):\n", result.stdout)
        for index in range(1, len(sections), 2):
            if sections[index] == NGINX and previous:
                continue
            for entry in re.findall(r"\bserver_name\s+([^;]+);", sections[index + 1]):
                require(not any(name.startswith("~") or fnmatch.fnmatch(options.get("domain") or "", name)
                                for name in entry.split() if name not in ("_", '""')),
                        "Requested hostname overlaps an existing Nginx server_name; resolve it without deleting foreign configs")
    print("Preflight OK: Ubuntu/CPU/RAM/disk/ports. Firewall and SSH will not be modified.")


def create_users(host):
    for user in ("gamma", "gamma-build"):
        if host.run(["id", user], check=False).returncode:
            host.run(["useradd", "--system", "--create-home", "--home-dir", f"/home/{user}",
                      "--shell", "/bin/bash", "--user-group", user])
        require(host.uid(user) != 0, "Gamma may not run as root")
        groups = host.run(["id", "-nG", user]).stdout.split()
        require(set(groups) == {user}, f"{user} must have only its own primary group (no sudo/docker/etc.)")
        host.mkdir(f"/home/{user}", user=user)


def install_runtimes(host):
    host.mkdir(RUNTIME, 0o755)
    if not host.path(BUN_BIN).exists():
        with tempfile.TemporaryDirectory(dir=host.path(RUNTIME)) as directory:
            archive = Path(directory) / "bun.zip"
            host.download(f"https://github.com/oven-sh/bun/releases/download/bun-v{BUN}/bun-linux-x64-baseline.zip", archive, BUN_SHA)
            host.run(["unzip", "-q", str(archive), "-d", directory])
            dest = host.mkdir(f"{RUNTIME}/bun-{BUN}", 0o755)
            shutil.copyfile(Path(directory) / "bun-linux-x64-baseline/bun", dest / "bun")
            (dest / "bun").chmod(0o755)
    if not host.path(NODE_BIN + "/node").exists():
        with tempfile.TemporaryDirectory(dir=host.path(RUNTIME)) as directory:
            archive = Path(directory) / "node.tar.xz"
            host.download(f"https://nodejs.org/dist/v{NODE}/node-v{NODE}-linux-x64.tar.xz", archive, NODE_SHA)
            host.run(["tar", "--no-same-owner", "-xJf", str(archive), "-C", str(host.path(RUNTIME))])
    require(host.run([BUN_BIN, "--version"]).stdout.strip() == BUN, "Bun version mismatch")
    require(host.run([NODE_BIN + "/node", "--version"]).stdout.strip() == "v" + NODE, "Node version mismatch")
    alias = host.path(f"{RUNTIME}/bun-{BUN}/bunx")
    require(not alias.exists() or alias.is_symlink() and os.readlink(alias) == "bun", "Unexpected bunx executable")
    if not alias.is_symlink():
        alias.symlink_to("bun")


def build_release(host, options):
    print("Resolving release and building as gamma-build (no production credentials)…", flush=True)
    host.mkdir("/opt/gamma/releases", 0o755)
    # A fresh directory prevents reuse of partial, mutable build output or .env files.
    release = f"/opt/gamma/releases/{uuid.uuid4().hex}"
    directory = host.mkdir(release, 0o755, "gamma-build")
    host.run(["git", "init", str(directory)], user="gamma-build")
    host.run(["git", "remote", "add", "origin", options["repo"]], user="gamma-build", cwd=directory)
    host.run(["git", "fetch", "--depth=1", "origin", options["ref"]], user="gamma-build", cwd=directory)
    host.run(["git", "checkout", "--detach", "FETCH_HEAD"], user="gamma-build", cwd=directory)
    commit = host.run(["git", "rev-parse", "HEAD"], user="gamma-build", cwd=directory).stdout.strip()
    require(bool(re.fullmatch(r"[a-f0-9]{40}", commit)), "Invalid release SHA")
    for name in ("bun.lock", "deploy/web.ts", "deploy/auth.ts", "packages/opencode/src/index.ts",
                 "gamma-agent-market/profiles", "gamma-skill-market"):
        require((directory / name).exists(), f"Incomplete Gamma release: {name}")
    require(json.loads((directory / "package.json").read_text())["packageManager"] == f"bun@{BUN}",
            "Release Bun requirement changed; update and review the installer runtime pins first")
    for name in (".env", ".env.local", ".env.production", ".env.production.local"):
        require(not any((directory / part / name).exists() for part in (".", "packages/app", "packages/opencode")),
                "Release contains a dotenv file; production environment must come from /etc/gamma")
    locked = hashlib.sha256((directory / "bun.lock").read_bytes()).hexdigest()
    host.run([BUN_BIN, "install", "--frozen-lockfile"], user="gamma-build", cwd=directory)
    host.run([BUN_BIN, "script/1c-agent/download-bsl.ts", str(directory / "runtime/bsl-language-server.jar")],
             user="gamma-build", cwd=directory)
    # Browser revision is pinned by the release lockfile and travels with rollback.
    host.run([BUN_BIN, "node_modules/playwright/cli.js", "install", "chromium"],
             user="gamma-build", cwd=directory / "packages/opencode",
             extra={"PLAYWRIGHT_BROWSERS_PATH": release + "/.playwright"})
    host.run([BUN_BIN, "run", "build"], user="gamma-build", cwd=directory / "packages/app", extra={"OPENCODE_CHANNEL": "prod", "NODE_OPTIONS": "--max-old-space-size=4096"})
    require((directory / "packages/app/dist/index.html").is_file(), "Frontend build has no index.html")
    require(hashlib.sha256((directory / "bun.lock").read_bytes()).hexdigest() == locked, "Build modified the lockfile")
    host.owner(directory, "root", recursive=True)
    host.run(["chmod", "-R", "a+rX,go-w", str(directory)])
    return {"release": release, "commit": commit, "lock_sha256": locked, "bun": BUN, "node": NODE}


def admin_input(host, args):
    if host.path("/etc/gamma/auth.json").exists():
        return None
    username = args.admin_user
    if not username and not args.non_interactive:
        username = input("Administrator login: ").strip()
    require(username and 0 < len(username) <= 128 and username.strip() == username, "Admin login required (1–128 characters)")
    if args.admin_password_file:
        path = Path(args.admin_password_file)
        require(path.is_absolute() and not path.is_symlink(), "Password file must be an absolute regular file")
        info = path.stat()
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == 0,
                "Password file must be root-owned 0600")
        require(not path.resolve().is_relative_to(Path(__file__).resolve().parents[2]), "Do not store password input in the Git checkout")
        password = path.read_text().removesuffix("\n")
    else:
        require(not args.non_interactive and sys.stdin.isatty(), "Use a TTY for hidden password input or --admin-password-file")
        password = getpass.getpass("Admin password (at least 12 characters): ")
        require(password == getpass.getpass("Repeat password: "), "Passwords do not match")
    require(12 <= len(password) <= 1024, "Password length must be 12–1024 characters")
    return {"username": username, "password": password}


def credentials(host, admin):
    if not host.path("/etc/gamma/auth.json").exists():
        require(admin is not None, "Administrator credentials required")
        # Password travels only over stdin to Bun, never argv/environment/logs.
        result = host.run([BUN_BIN, "-e", 'const p = await Bun.stdin.text(); console.log(await Bun.password.hash(p, {algorithm:"argon2id",memoryCost:65536,timeCost:3}))'],
                          user="gamma", data=admin["password"])
        require(result.stdout.strip().startswith("$argon2id$"), "Password hashing failed")
        host.write("/etc/gamma/auth.json", json.dumps({"username": admin["username"], "passwordHash": result.stdout.strip()}) + "\n", user="gamma")
    if not host.path("/etc/gamma/backend.env").exists():
        host.write("/etc/gamma/backend.env", "OPENCODE_SERVER_USERNAME=gamma-internal\nOPENCODE_SERVER_PASSWORD=" + secrets.token_hex(48) + "\n")
    check_credentials(host)


def check_credentials(host):
    for name, owner in (("/etc/gamma/auth.json", "gamma"), ("/etc/gamma/backend.env", "root")):
        path = host.path(name)
        host.no_symlink(path)
        require(path.is_file() and stat.S_IMODE(path.stat().st_mode) == 0o600 and path.stat().st_uid == host.uid(owner),
                f"Wrong ownership/permissions: {name}; expected {owner}:0600, credentials were not overwritten")
    auth = host.read_json("/etc/gamma/auth.json")
    require(isinstance(auth.get("username"), str) and bool(auth["username"]), "Invalid admin login configuration")
    match = re.match(r"\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$", auth.get("passwordHash", ""))
    require(match and int(match[1]) >= 65536 and int(match[2]) >= 3 and int(match[3]) >= 1, "Invalid or weak Argon2id hash")
    env = dict(line.split("=", 1) for line in host.path("/etc/gamma/backend.env").read_text().splitlines() if "=" in line)
    require(len(env.get("OPENCODE_SERVER_PASSWORD", "")) >= 32, "Internal backend password missing/short")


def nginx_config(options, bootstrap=False):
    if options["https"] == "ssh-tunnel":
        return MARKER + "\n# No public listener. Use ssh -L 4444:127.0.0.1:4444 user@VPS\n"
    domain = options["domain"]
    http = f"""server {{
    listen 80;
    listen [::]:80;
    server_name {domain};
    location /.well-known/acme-challenge/ {{ root /var/www/gamma-acme; }}
    location / {{ {'return 404;' if bootstrap else 'return 308 https://' + domain + '$request_uri;'} }}
}}
"""
    if bootstrap:
        return MARKER + "\n" + http
    cert = options["tls_cert"] if options["https"] == "existing" else f"/etc/letsencrypt/live/{domain}/fullchain.pem"
    key = options["tls_key"] if options["https"] == "existing" else f"/etc/letsencrypt/live/{domain}/privkey.pem"
    return MARKER + "\n" + http + f"""
map $http_upgrade $gamma_connection_upgrade {{ default upgrade; '' close; }}
server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name {domain};
    ssl_certificate {cert};
    ssl_certificate_key {key};
    client_max_body_size 21m;
    add_header Strict-Transport-Security "max-age=31536000" always;
    auth_basic off;
    location / {{
        proxy_pass http://127.0.0.1:4444;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization "";
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $gamma_connection_upgrade;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
    }}
}}
"""


def activate_nginx(host, content):
    path = host.path(NGINX)
    old = path.read_text() if path.exists() else None
    require(old is None or old.startswith(MARKER), "Refusing to overwrite foreign gamma.conf")
    host.write(NGINX, content, 0o644)
    if host.run(["nginx", "-t"], check=False).returncode:
        if old is None:
            path.unlink()
        else:
            host.write(NGINX, old, 0o644)
        raise Failure("nginx -t failed; prior Gamma config restored; no reload performed")
    host.run(["systemctl", "enable", "--now", "nginx"])
    host.run(["systemctl", "reload", "nginx"])


def tls(host, options, previous):
    if options["https"] == "ssh-tunnel":
        return
    if options["https"] == "existing":
        cert = host.path(options["tls_cert"])
        key = host.path(options["tls_key"])
        require(cert.is_file() and key.is_file(), "TLS certificate/key missing")
        require(key.stat().st_uid == host.uid("root") and stat.S_IMODE(key.stat().st_mode) & 0o077 == 0,
                "TLS private key must be root-owned and private")
        check = "-checkip" if re.fullmatch(r"[0-9.]+", options["domain"]) else "-checkhost"
        host.run(["openssl", "x509", "-in", str(cert), "-noout", check, options["domain"], "-checkend", "86400"])
        public = host.run(["openssl", "x509", "-in", str(cert), "-pubkey", "-noout"]).stdout
        require(public == host.run(["openssl", "pkey", "-in", str(key), "-pubout"]).stdout, "TLS key/certificate mismatch")
        return
    if host.path(f"/etc/letsencrypt/live/{options['domain']}/fullchain.pem").exists():
        require(previous is not None, "Existing ACME certificate not owned by this install; use --https existing")
    else:
        host.mkdir("/var/www/gamma-acme", 0o755)
        activate_nginx(host, nginx_config(options, bootstrap=True))
        print("Requesting ACME certificate; DNS A/AAAA and inbound TCP 80 must reach this VPS…", flush=True)
        host.run(["certbot", "certonly", "--webroot", "-w", "/var/www/gamma-acme", "--cert-name", options["domain"],
                  "-d", options["domain"], "--email", options["email"], "--agree-tos", "--non-interactive"])
    hook = "/etc/letsencrypt/renewal-hooks/deploy/gamma-nginx"
    if host.path(hook).exists():
        require(MARKER in host.path(hook).read_text(), "Foreign certbot deploy hook; refusing overwrite")
    host.write(hook, "#!/bin/sh\n" + MARKER + "\n/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx\n", 0o755)
    host.run(["systemctl", "enable", "--now", "certbot.timer"])
    host.run(["certbot", "renew", "--cert-name", options["domain"], "--dry-run"], timeout=600)


def rendered(options, release):
    origin = "http://localhost:4444" if options["https"] == "ssh-tunnel" else "https://" + options["domain"]
    env = {"NODE_ENV": "production", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "HOME": "/home/gamma", "GAMMA_WORKSPACES_ROOT": options["workspaces"],
           "GAMMA_KNOWLEDGE_ROOT": "/var/lib/gamma/knowledge", "GAMMA_AGENT_MARKET_ROOT": release + "/gamma-agent-market",
           "GAMMA_SKILL_MARKET_ROOT": release + "/gamma-skill-market", "OPENCODE_DB": "/var/lib/gamma/opencode.db",
           "XDG_DATA_HOME": "/var/lib/gamma/data", "XDG_CONFIG_HOME": "/var/lib/gamma/config", "XDG_STATE_HOME": "/var/lib/gamma/state",
           "XDG_CACHE_HOME": "/var/lib/gamma/cache", "GAMMA_BACKEND_PORT": "4096", "GAMMA_BACKEND_URL": "http://127.0.0.1:4096",
           "GAMMA_WEB_PORT": "4444", "GAMMA_WEB_ROOT": release + "/packages/app/dist", "GAMMA_PUBLIC_ORIGIN": origin,
           "PLAYWRIGHT_BROWSERS_PATH": release + "/.playwright",
           "GAMMA_BSL_JAR": release + "/runtime/bsl-language-server.jar",
           "GAMMA_1C_PYTHON": "/usr/bin/python3",
           "GAMMA_AUTH_CONFIG": "/etc/gamma/auth.json", "GAMMA_TRUST_PROXY": "0" if options["https"] == "ssh-tunnel" else "1",
           "OPENCODE_CONFIG": "/etc/gamma/opencode.json", "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
           "OPENCODE_DISABLE_AUTOUPDATE": "1", "OPENCODE_DISABLE_SHARE": "1"}
    files = {"/etc/gamma/gamma.env": (MARKER + "\n" + "".join(f"{key}={value}\n" for key, value in env.items()), 0o600),
             "/etc/gamma/opencode.json": (json.dumps(policy(options["profile"]), indent=2) + "\n", 0o644)}
    for name in ("backend", "web"):
        command = f"{BUN_BIN} run --cwd {release}/packages/opencode ./src/index.ts --print-logs serve --hostname 127.0.0.1 --port 4096" if name == "backend" else f"{BUN_BIN} run {release}/deploy/web.ts"
        files[f"/etc/systemd/system/gamma-{name}.service"] = (MARKER + f"""
[Unit]
Description=Gamma {name}
After=network-online.target{' gamma-backend.service' if name == 'web' else ''}
Wants=network-online.target{' gamma-backend.service' if name == 'web' else ''}
[Service]
Type=simple
User=gamma
Group=gamma
WorkingDirectory={release}
EnvironmentFile=/etc/gamma/gamma.env
EnvironmentFile=/etc/gamma/backend.env
Environment=PATH={RUNTIME}/bun-{BUN}:{NODE_BIN}:/usr/bin:/bin
ExecStart={command}
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
[Install]
WantedBy=multi-user.target
""", 0o644)
    return files


def check_drift(host, state):
    check_credentials(host)
    for name, expected in state.get("files", {}).items():
        path = host.path(name)
        host.no_symlink(path)
        require(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == expected,
                f"Managed file drift: {name}; not overwriting. Reconcile changes with installation manifest first")
        require(path.stat().st_uid == host.uid("root") and path.stat().st_mode & 0o022 == 0, f"Unsafe managed file ownership: {name}")
    for name in ("/home/gamma/.opencode", "/etc/opencode/opencode.json", "/etc/opencode/opencode.jsonc"):
        require(not host.path(name).exists(), f"Policy override detected: {name}; review before upgrade")
    config = host.path("/var/lib/gamma/config/opencode")
    require(not any((config / name).exists() for name in ("config.json", "opencode.json", "opencode.jsonc", "agents", "agent", "modes", "mode")),
            "Global OpenCode overrides detected; review effective permissions before upgrade")


def smoke(host, options, admin=None):
    require(host.run(["systemctl", "is-enabled", "gamma-backend", "gamma-web"]).returncode == 0, "Autostart is not enabled")
    env = dict(line.split("=", 1) for line in host.path("/etc/gamma/backend.env").read_text().splitlines() if "=" in line)
    basic = base64.b64encode((env.get("OPENCODE_SERVER_USERNAME", "opencode") + ":" + env["OPENCODE_SERVER_PASSWORD"]).encode()).decode()
    ready = False
    for attempt in range(90):
        anonymous = host.request("http://127.0.0.1:4096/global/health")[0]
        authenticated = host.request("http://127.0.0.1:4096/global/health", headers={"Authorization": "Basic " + basic})[0]
        gateway = host.request("http://127.0.0.1:4444/auth/session")[0]
        if anonymous == 401 and authenticated == 200 and gateway == 401:
            ready = True
            break
        host.pause()
    require(ready, "Health check failed; backend must return anonymous 401/authenticated 200, gateway anonymous 401")
    code, _, body = host.request("http://127.0.0.1:4444/login")
    require(code == 200 and b"<html" in body.lower(), "Frontend login page is missing or not HTML")
    for route in ("/global/health", "/session", "/product/projects", "/event", "/pty", "/api/session"):
        require(host.request("http://127.0.0.1:4444" + route)[0] == 401, "Gateway protection smoke failed")
    for line in host.ports().splitlines():
        fields = line.split()
        if len(fields) >= 4 and fields[3].rsplit(":", 1)[-1] in ("4096", "4444"):
            require(fields[3].startswith("127.0.0.1:"), "Backend/gateway is not loopback-only")
    if admin:
        origin = "http://localhost:4444" if options["https"] == "ssh-tunnel" else "https://" + options["domain"]
        headers = {"Origin": origin, "Content-Type": "application/json"}
        code, response, _ = host.request("http://127.0.0.1:4444/auth/login", headers=headers, body=json.dumps(admin).encode())
        require(code == 200 and "HttpOnly" in response.get("Set-Cookie", ""), "Administrator login smoke failed")
        cookie = response["Set-Cookie"].split(";", 1)[0]
        require(host.request("http://127.0.0.1:4444/global/health", headers={"Cookie": cookie})[0] == 200, "Authenticated gateway smoke failed")
        require(host.request("http://127.0.0.1:4444/auth/logout", headers={**headers, "Cookie": cookie}, body=b"{}")[0] == 200, "Logout smoke failed")
        require(host.request("http://127.0.0.1:4444/auth/session", headers={"Cookie": cookie})[0] == 401, "Session revocation smoke failed")
    # No model credentials/costs are assumed. OS filesystem access is exercised as the actual service user.
    host.run(["/bin/sh", "-eu", "-c", 'd=$(mktemp -d "$1/.gamma-smoke.XXXXXX"); printf gamma > "$d/file"; test "$(cat "$d/file")" = gamma; rm "$d/file"; rmdir "$d"',
              "gamma-smoke", str(host.path(options["workspaces"]))], user="gamma")


def begin_transaction(host, state, previous):
    sources = ["/var/lib/gamma", state["options"]["workspaces"]]
    size = sum(int(host.run(["du", "-s", "--block-size=1", str(host.path(name))]).stdout.split()[0]) for name in sources)
    target = host.path("/var/backups")
    while not target.exists():
        target = target.parent
    require(host.disk_free(target) >= size * 2 + 2 * 1024**3,
            "Insufficient backup space for snapshot and failed-state quarantine; free space without deleting Gamma data")
    backup = f"/var/backups/gamma/{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{uuid.uuid4().hex[:8]}"
    host.mkdir(backup)
    transaction = {"backup": backup, "previous": previous, "state": state, "snapshot": False,
                   "present": [name for name in MANAGED if host.path(name).exists()]}
    for name in transaction["present"]:
        host.copy(host.path(name), host.path(backup + "/config" + name))
    # Journal precedes service stop: interrupted deployments are recoverable on the next mutating invocation.
    host.json(JOURNAL, transaction)
    host.run(["systemctl", "stop", "gamma-web", "gamma-backend"], check=bool(previous and previous.get("phase") == "ready"))
    for line in host.ports().splitlines():
        require(not re.search(r":(?:4096|4444)\s", line), "Ports still occupied after service stop; refusing activation")
    transaction["sources"] = sources
    for name in sources:
        host.copy(host.path(name), host.path(backup + "/data" + name))
    for name in ("auth.json", "backend.env"):
        host.copy(host.path("/etc/gamma/" + name), host.path(backup + "/credentials/" + name))
    transaction["snapshot"] = True
    host.json(JOURNAL, transaction)
    print("Offline recovery snapshot: " + backup)


def recover(host):
    transaction = host.read_json(JOURNAL)
    if not transaction:
        return
    print("Recovering interrupted/failed deployment; new state is retained in quarantine…", flush=True)
    host.run(["systemctl", "stop", "gamma-web", "gamma-backend"], check=False)
    backup = transaction["backup"]
    if transaction["snapshot"]:
        for name in transaction["sources"]:
            live = host.path(name)
            quarantine = host.path(backup + "/failed" + name)
            quarantine.parent.mkdir(parents=True, exist_ok=True)
            if live.exists():
                if quarantine.exists():
                    quarantine = host.path(backup + "/failed-retry-" + uuid.uuid4().hex + name)
                    quarantine.parent.mkdir(parents=True, exist_ok=True)
                # Same-filesystem rename may not be available for external workspace storage.
                host.run(["mv", str(live), str(quarantine)])
            host.copy(host.path(backup + "/data" + name), live)
    for name in MANAGED:
        if name in transaction["present"]:
            host.copy(host.path(backup + "/config" + name), host.path(name))
        elif host.path(name).exists():
            host.path(name).unlink()
    host.run(["systemctl", "daemon-reload"])
    if host.path("/etc/nginx/nginx.conf").exists():
        host.run(["nginx", "-t"])
        if host.run(["systemctl", "is-active", "nginx"], check=False).returncode == 0:
            host.run(["systemctl", "reload", "nginx"])
    previous = transaction["previous"]
    if previous and previous.get("phase") == "ready":
        host.run(["systemctl", "start", "gamma-backend", "gamma-web"])
        smoke(host, previous["options"])
    host.path(JOURNAL).unlink()


def finish_message(state):
    print("Gamma configuration ready. Commit: " + state["commit"])
    if state["options"]["https"] == "ssh-tunnel":
        print("No public HTTP published. On your computer: ssh -N -L 4444:127.0.0.1:4444 YOUR_SSH_USER@VPS_IP")
        print("Then open http://localhost:4444 (traffic to the VPS is protected by SSH).")
    else:
        print("Open https://" + state["options"]["domain"])
    print("Connect an LLM provider and select its model in the UI; live inference is not provisioned/tested.")
    print("Permissions: " + state["options"]["profile"] + ". Native Gamma policy persists across restarts.")
    print("Standard tools inherit auto permissions; role denies, delegation boundaries and business approvals remain.")
    print("Tools run as gamma, not root. This is NOT a sandbox: same-UID code can access Gamma credentials.")
    print("Preview, optional agent toolchains and multi-user isolation require separate configuration; see docs/deployment.")


def deploy(host, args, options, previous, admin):
    if previous and previous.get("phase") == "ready":
        check_drift(host, previous)
        if args.mode == "install":
            smoke(host, options)
            print("Already installed; credentials/data/config were not rewritten. Use --upgrade for a new release.")
            finish_message(previous)
            return
    print("Installing OS dependencies; no SSH/firewall rules changed…", flush=True)
    host.run(["apt-get", "update"])
    host.run(["apt-get", "install", "-y", *PACKAGES], extra={"DEBIAN_FRONTEND": "noninteractive"})
    # Record ownership of the installation before creating users, so a failed first install can resume.
    host.mkdir("/etc/gamma", 0o750)
    if not previous:
        host.json(MANIFEST, {"schema": 1, "phase": "pending", "options": options})
    create_users(host)
    host.run(["chgrp", "gamma", str(host.path("/etc/gamma"))])
    host.mkdir("/opt/gamma", 0o755)
    host.mkdir(options["workspaces"], user="gamma")
    host.mkdir("/var/lib/gamma", user="gamma")
    for name in ("data", "data/opencode", "data/opencode/log", "config", "state", "cache", "knowledge"):
        host.mkdir("/var/lib/gamma/" + name, user="gamma")
    install_runtimes(host)
    credentials(host, admin)
    release = build_release(host, options)
    tls(host, options, previous)
    state = {"schema": 1, "phase": "ready", "options": options, **release}
    try:
        begin_transaction(host, state, previous)
        for name, (content, mode) in rendered(options, release["release"]).items():
            host.write(name, content, mode)
        host.run(["systemd-analyze", "verify", *[str(host.path(f"/etc/systemd/system/gamma-{name}.service")) for name in ("backend", "web")]])
        host.run(["systemctl", "daemon-reload"])
        host.run(["systemctl", "enable", "--now", "gamma-backend", "gamma-web"])
        smoke(host, options, admin)
        if options["https"] != "ssh-tunnel":
            activate_nginx(host, nginx_config(options))
            code = host.run(["curl", "--silent", "--show-error", "--noproxy", "*", "--max-time", "15", "--resolve",
                             options["domain"] + ":443:127.0.0.1", "--output", "/dev/null", "--write-out", "%{http_code}",
                             "https://" + options["domain"] + "/auth/session"]).stdout
            require(code == "401", "Public TLS/gateway probe failed (no insecure TLS fallback)")
        else:
            host.write(NGINX, nginx_config(options), 0o644)
        state["files"] = {name: hashlib.sha256(host.path(name).read_bytes()).hexdigest() for name in MANAGED if name != MANIFEST}
        state["packages"] = host.run(["dpkg-query", "-W", "-f=${Package}=${Version}\n", *PACKAGES]).stdout.splitlines()
        host.json(MANIFEST, state)
        host.path(JOURNAL).unlink()
    except BaseException:
        recover(host)
        raise
    finish_message(state)


def inspect(host, mode):
    state = host.read_json(MANIFEST)
    require(state and state.get("schema") == 1, "No installer-managed Gamma found; legacy installations require explicit migration")
    print("Installation: " + state["phase"] + "; commit: " + state.get("commit", "not activated"))
    require(not host.path(JOURNAL).exists(), "Interrupted deployment found; next --install/--upgrade recovers it")
    require(state["phase"] == "ready", "Installation is incomplete; repeat --install with the original settings")
    if mode == "doctor":
        check_drift(host, state)
        require(host.run([BUN_BIN, "--version"]).stdout.strip() == BUN, "Bun mismatch")
        require(host.run([NODE_BIN + "/node", "--version"]).stdout.strip() == "v" + NODE, "Node mismatch")
        installed = host.run(["dpkg-query", "-W", "-f=${Package} ${Status}\n", *PACKAGES], check=False)
        require(installed.returncode == 0 and all(" install ok installed" in line for line in installed.stdout.splitlines()),
                "Required OS packages are missing or incomplete; run --upgrade to provision dependencies")
        host.run(["nginx", "-t"])
    # Status/doctor do not create a login session, run shell tools, or write a smoke file.
    for service in ("gamma-backend", "gamma-web"):
        host.run(["systemctl", "is-active", service])
        host.run(["systemctl", "is-enabled", service])
    require(host.request("http://127.0.0.1:4096/global/health")[0] == 401, "Backend anonymous health must be 401")
    require(host.request("http://127.0.0.1:4444/auth/session")[0] == 401, "Gateway anonymous session must be 401")
    env = dict(line.split("=", 1) for line in host.path("/etc/gamma/backend.env").read_text().splitlines() if "=" in line)
    basic = base64.b64encode((env.get("OPENCODE_SERVER_USERNAME", "opencode") + ":" + env["OPENCODE_SERVER_PASSWORD"]).encode()).decode()
    require(host.request("http://127.0.0.1:4096/global/health", headers={"Authorization": "Basic " + basic})[0] == 200,
            "Authenticated backend health failed")
    code, _, body = host.request("http://127.0.0.1:4444/login")
    require(code == 200 and b"<html" in body.lower(), "Frontend login page is missing or not HTML")
    print("Services active/enabled; authenticated backend and frontend healthy; anonymous endpoints protected.")


def main(argv=None):
    args = parse_args(argv)
    host = Host()
    require(os.geteuid() == 0, "Run with sudo; --check/--status/--doctor are read-only but inspect protected configuration")
    os.umask(0o077)
    if args.mode in ("status", "doctor"):
        inspect(host, args.mode)
        return
    check_proxy(os.environ)
    previous = host.read_json(MANIFEST)
    if previous:
        require(previous.get("schema") == 1, "Unknown installation manifest schema")
    if args.mode == "check":
        options = configuration(args, previous) if previous or args.https else {
            "repo": args.repo, "ref": args.ref, "https": "ssh-tunnel", "domain": None,
            "profile": args.permission_profile or "trusted-auto", "workspaces": args.workspaces or "/home/gamma/workspaces"}
        validate(options)
        preflight(host, options, previous)
        return
    lock = host.path("/run/lock/gamma-install.lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("w") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure("Another Gamma installation is in progress") from None
        recover(host)
        previous = host.read_json(MANIFEST)
        require(args.mode != "upgrade" or previous and previous.get("phase") == "ready", "--upgrade requires a completed managed installation")
        options = configuration(args, previous)
        preflight(host, options, previous)
        admin = admin_input(host, args)
        deploy(host, args, options, previous, admin)


if __name__ == "__main__":
    def interrupted(signum, frame):
        raise Failure("Interrupted; retry --install/--upgrade to recover the transaction")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        main()
    except (Failure, OSError, ValueError, subprocess.TimeoutExpired):
        # Exception messages from libraries may contain request bodies/secret paths; only our messages are safe.
        error = sys.exc_info()[1]
        print("Gamma: " + (str(error) if isinstance(error, Failure) else "OS/network/configuration error; check the current stage and run --doctor"), file=sys.stderr)
        print("No credentials are printed. Do not delete data. Retry the same command after correcting the error.", file=sys.stderr)
        sys.exit(1)
