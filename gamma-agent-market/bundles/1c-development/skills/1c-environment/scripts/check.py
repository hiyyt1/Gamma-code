"""Gamma dependency discovery; no server, installer or platform process is launched."""
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

configured = os.environ.get("GAMMA_1C_PLATFORM")
platform = configured or shutil.which("1cv8") or shutil.which("1cv8c")
available = bool(platform and Path(platform).is_file() and os.access(platform, os.X_OK))
jar = os.environ.get("GAMMA_BSL_JAR")
print(json.dumps({
    "python": {"executable": sys.executable, "version": sys.version.split()[0], "lxml": importlib.util.find_spec("lxml") is not None},
    "java": shutil.which(os.environ.get("GAMMA_BSL_JAVA", "java")),
    "bsl": {"jar": jar, "jarExists": bool(jar and Path(jar).is_file()), "connection": "not_checked"},
    "platform": {"executable": platform if available else None, "licenseAndInfobase": "not_checked"},
    "mode": "platform_binary_found_requires_verification" if available else "source_only",
}, ensure_ascii=False, indent=2))
