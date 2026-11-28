import json
import shutil
import subprocess
from pathlib import Path

# Verify firebase.json & frontend/app.js
json.loads(Path("firebase.json").read_text(encoding="utf-8"))
node = shutil.which("node")
assert node, "node not found"


def run(cmd: list[str], label: str) -> str:
    print(f"=== {label} ===")
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.stderr.strip():
        print(r.stderr.strip())
    if r.returncode != 0:
        raise SystemExit(r.returncode)
    return r.stdout


run([node, "--check", "frontend/app.js"], "node --check frontend/app.js")

status = run(["git", "status", "--short"], "git status")
for line in status.splitlines():
    path = line[3:].strip()
    if path == ".env" or path.endswith((".png", ".jpg", ".jpeg", ".mp4")):
        raise SystemExit(f"ABORT: sensitive/media file detected: {path}")

if status.strip():
    run(["git", "add", "-A"], "git add")
    run(
        ["git", "commit", "-m", "fix: bust stale 1h cache on masters_registry.json and catalog.json in Firebase Hosting"],
        "git commit",
    )
    run(["git", "push", "origin", "main"], "git push")

run(
    ["npx.cmd", "-y", "firebase-tools@latest", "deploy", "--only", "hosting", "--project", "buddahsutra-reader"],
    "firebase deploy",
)
print("ALL DONE")
