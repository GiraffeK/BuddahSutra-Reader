import shutil
import subprocess
import urllib.request

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


# 1. JS syntax check
run([node, "--check", "frontend/app.js"], "node --check frontend/app.js")

# 2. Verify Cloudflare Worker CORS preflight is live
print("=== Verify Cloudflare Worker CORS ===")
req = urllib.request.Request(
    "https://nvidia-nim-proxy.seantang-mal.workers.dev/v1/chat/completions",
    method="OPTIONS",
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Origin": "https://buddahsutra-reader.web.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
    },
)
with urllib.request.urlopen(req, timeout=10) as resp:
    acao = resp.headers.get("Access-Control-Allow-Origin", "")
    print("Worker OPTIONS status:", resp.status, "ACAO:", acao)
    assert resp.status == 204
    assert acao == "https://buddahsutra-reader.web.app"

# 3. Safe git status check + commit + push
status = run(["git", "status", "--short"], "git status")
for line in status.splitlines():
    path = line[3:].strip()
    if path == ".env" or path.endswith((".png", ".jpg", ".jpeg", ".mp4")):
        raise SystemExit(f"ABORT: sensitive/media file detected: {path}")

if status.strip():
    run(["git", "add", "-A"], "git add")
    run(
        ["git", "commit", "-m", "feat: add Cloudflare Worker NVIDIA NIM CORS proxy and set default proxy URL"],
        "git commit",
    )
    run(["git", "push", "origin", "main"], "git push")

# 4. Deploy to Firebase Hosting
run(
    ["npx.cmd", "-y", "firebase-tools@latest", "deploy", "--only", "hosting", "--project", "buddahsutra-reader"],
    "firebase deploy",
)
print("ALL DONE")
