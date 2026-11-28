import json
import shutil
import subprocess
from pathlib import Path

# 1. Sync translation_kb/commentaries/masters_registry.json -> frontend/data/masters_registry.json
src = Path("translation_kb/commentaries/masters_registry.json")
dst = Path("frontend/data/masters_registry.json")
data = json.loads(src.read_text(encoding="utf-8"))
masters = data["masters"]
sutras = set()
for m in masters:
    if m.get("sutra_id"):
        sutras.add(m["sutra_id"])
    for a in m.get("applicable_sutras") or []:
        sutras.add(a)
print(f"Total verified masters: {len(masters)} across {len(sutras)} sutras")
dst.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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


# 2. JS syntax check
node = shutil.which("node")
assert node, "node not found"
run([node, "--check", "frontend/app.js"], "node --check frontend/app.js")

# 3. Safe git status check + commit + push
status = run(["git", "status", "--short"], "git status")
for line in status.splitlines():
    path = line[3:].strip()
    if path == ".env" or path.endswith((".png", ".jpg", ".jpeg", ".mp4")):
        raise SystemExit(f"ABORT: sensitive/media file detected: {path}")

if status.strip():
    run(["git", "add", "-A"], "git add")
    run(
        ["git", "commit", "-m", "feat: add verified classic commentaries for 16 sutras and dynamic CBETA commentary search"],
        "git commit",
    )
    run(["git", "push", "origin", "main"], "git push")

# 4. Deploy to Firebase Hosting
run(
    ["npx.cmd", "-y", "firebase-tools@latest", "deploy", "--only", "hosting", "--project", "buddahsutra-reader"],
    "firebase deploy",
)
print("ALL DONE")
