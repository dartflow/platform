"""Bounded public-POM observations after a failed build, never a recovery gate."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

URLS = (
    "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.0.21/kotlin-stdlib-2.0.21.pom",
    "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugins-bom/2.2.20/kotlin-gradle-plugins-bom-2.2.20.pom",
    "https://repo.maven.apache.org/maven2/org/ow2/asm/asm/9.8/asm-9.8.pom",
)
HEADER_NAMES = frozenset(("date", "server", "content-type", "content-length", "cache-control", "age", "via", "x-cache", "x-served-by"))
MAX_BYTES = 65536


def safe_headers(raw):
    if len(raw) > MAX_BYTES:
        return {}, True
    headers = {}
    for line in raw.decode("ascii", errors="replace").splitlines():
        name, separator, value = line.partition(":")
        name, value = name.lower(), value.strip()
        if separator and name in HEADER_NAMES and len(value) <= 256 and all(32 <= ord(c) <= 126 for c in value):
            headers[name] = value
    return headers, False


def probe(url, runner=None):
    if url not in URLS:
        raise ValueError("Only the three reviewed public POM URLs may be observed")
    runner = runner or subprocess.run
    with tempfile.TemporaryDirectory(prefix="dartflow-public-pom-") as directory:
        header_file = Path(directory) / "headers"
        command = ["curl", "--disable", "--silent", "--show-error", "--request", "GET", "--proto", "=https", "--connect-timeout", "5", "--max-time", "12", "--max-filesize", str(MAX_BYTES), "--retry", "0", "--dump-header", str(header_file), "--output", os.devnull, "--write-out", "%{http_code}", url]
        try:
            # Default system TLS verification; no curlrc, proxy, auth, cookie,
            # custom CA or other inherited credential/environment options.
            result = runner(command, capture_output=True, text=True, timeout=15, env={"PATH": os.environ.get("PATH", os.defpath), "LANG": "C", "LC_ALL": "C"}, check=False)
            code = result.stdout.strip()
            status = int(code) if re.fullmatch(r"[1-5][0-9]{2}", code) else None
            raw_headers = b""
            if header_file.exists():
                with header_file.open("rb") as stream:
                    raw_headers = stream.read(MAX_BYTES + 1)
            headers, oversized = safe_headers(raw_headers)
            return {"url": url, "httpStatus": status, "curlExitCode": result.returncode, "headers": headers, "headersOmittedAsOversized": oversized}
        except (subprocess.TimeoutExpired, OSError) as error:
            # An exception or stderr can contain local/provider details. Do not
            # echo either; retain only the bounded failure classification.
            return {"url": url, "httpStatus": None, "errorCategory": "timeout" if isinstance(error, subprocess.TimeoutExpired) else "curl-unavailable"}


def context(environ):
    def safe(key, pattern):
        value = environ.get(key, "")
        return value if re.fullmatch(pattern, value) else None
    return {"runId": safe("GITHUB_RUN_ID", r"[1-9][0-9]{0,19}"), "attempt": safe("GITHUB_RUN_ATTEMPT", r"[1-9][0-9]{0,5}"), "sha": safe("GITHUB_SHA", r"[0-9a-f]{40}")}


def main():
    report = {"purpose": "Failure-only public POM diagnostic; no retry, recovery or test-pass claim", "observedAt": datetime.now(timezone.utc).isoformat(), **context(os.environ), "requests": [probe(url) for url in URLS]}
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
