"""Build Compose with the environment's existing proxy and trusted CA, if supplied.
No credential values are written to disk or printed. Requires Docker Compose.
"""

import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1]
args = ["docker", "compose", "-f", str(root / "compose.yaml")]
hosts = {}
for key in ["HTTP_PROXY", "HTTPS_PROXY"]:
    value = os.getenv(key)
    if value:
        host = urlsplit(value).hostname
        if host:
            hosts[host] = socket.gethostbyname(host)
cert = os.getenv("SSL_CERT_FILE")
override = {"services": {name: {"build": {}} for name in ["api", "web"]}}
for service in override["services"].values():
    if hosts:
        service["build"]["extra_hosts"] = [f"{host}:{ip}" for host, ip in hosts.items()]
    if cert and Path(cert).is_file():
        service["build"]["secrets"] = ["proxy_ca"]
if cert and Path(cert).is_file():
    override["secrets"] = {"proxy_ca": {"file": cert}}
with tempfile.TemporaryDirectory(prefix="studio-build-") as folder:
    file = Path(folder) / "override.json"
    file.write_text(json.dumps(override))
    args += ["-f", str(file), "build"]
    for key in ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]:
        if os.getenv(key):
            args += ["--build-arg", key]
    subprocess.run(args, cwd=root, check=True)
