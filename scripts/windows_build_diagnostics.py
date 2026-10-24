"""Publish bounded CI build diagnostics without requiring access to private log APIs."""
from pathlib import Path
import os
import re
import sys


def report(path: Path):
    if not path.is_file():
        print("Build log not found")
        return
    log = path.read_text(encoding="utf-8-sig", errors="replace")
    tail = "\n".join(log.splitlines()[-120:])
    tail = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", tail)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write("\n### Windows build diagnostics\n\n```text\n" + tail + "\n```\n")
    # GitHub truncates individual annotations; keep each part well under 4 KB.
    tail = tail[-8400:]
    for index, start in enumerate(range(0, len(tail), 2400), 1):
        part = tail[start:start + 2400]
        message = part.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error title=Windows build diagnostics part {index}::{message}", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    report(Path(sys.argv[1] if len(sys.argv) > 1 else "windows-build.log"))
