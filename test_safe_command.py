import subprocess


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


status = run(["git", "status", "--short"], "git status")
for line in status.splitlines():
    path = line[3:].strip()
    if path == ".env" or path.endswith((".png", ".jpg", ".jpeg", ".mp4")):
        raise SystemExit(f"ABORT: sensitive/media file detected: {path}")

if status.strip():
    run(["git", "add", "-A"], "git add")
    run(
        ["git", "commit", "-m", "ui: move lock badge to AI panel header and auto-dismiss CBETA toast after 5s"],
        "git commit",
    )
    run(["git", "push", "origin", "main"], "git push")

run(
    ["npx.cmd", "-y", "firebase-tools@latest", "deploy", "--only", "hosting", "--project", "buddahsutra-reader"],
    "firebase deploy",
)
print("ALL DONE")
