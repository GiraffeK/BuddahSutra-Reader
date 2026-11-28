import subprocess, sys

def run(cmd):
    print(f"=== {' '.join(cmd)} ===", flush=True)
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        sys.exit(r.returncode)

run(["node", "--check", "frontend/app.js"])

branch = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True).stdout.strip()
if branch != "feat/mobile-ui":
    print(f"ERROR: expected feat/mobile-ui, got {branch}")
    sys.exit(1)

run(["git", "add", "frontend/app.js", "frontend/index.html", "development-log.md", "test_safe_command.py"])
diff_cached = subprocess.run(["git", "diff", "--cached", "--quiet"])
if diff_cached.returncode != 0:
    run(["git", "commit", "-m", "fix(mobile-tts): avoid cancel-before-speak race, prevent non-Chinese voice fallback, and fix touch pause/resume"])
run(["git", "push", "origin", "feat/mobile-ui"])

run([
    "npx.cmd", "-y", "firebase-tools@latest",
    "hosting:channel:deploy", "mobile-preview",
    "--expires", "14d",
    "--project", "buddahsutra-reader",
])
print("ALL DONE")
