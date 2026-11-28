import json, subprocess, sys

def run(cmd):
    print(f"=== {' '.join(cmd)} ===", flush=True)
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        sys.exit(r.returncode)

# 1. Validate JSON & JS syntax
with open("frontend/manifest.json", "r", encoding="utf-8") as f:
    json.load(f)
print("manifest.json OK")
run(["node", "--check", "frontend/app.js"])

# 2. Verify branch & status (guard against .env or images)
branch = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True).stdout.strip()
print(f"Current branch: {branch}")
if branch != "feat/mobile-ui":
    print(f"ERROR: expected feat/mobile-ui, got {branch}")
    sys.exit(1)

st = subprocess.run(["git", "status", "--short"], capture_output=True, text=True)
print("=== git status ===")
print(st.stdout.strip())
for line in st.stdout.splitlines():
    low = line.lower()
    if ".env" in low or low.endswith((".png", ".jpg", ".jpeg")):
        print(f"BLOCKED sensitive/image file: {line}")
        sys.exit(1)

# 3. Commit & push feat/mobile-ui + safety tag
run(["git", "add", "frontend/index.html", "frontend/styles.css", "frontend/app.js", "frontend/manifest.json", "development-log.md", "test_safe_command.py"])
diff_cached = subprocess.run(["git", "diff", "--cached", "--quiet"])
if diff_cached.returncode != 0:
    run(["git", "commit", "-m", "feat(mobile): add responsive drawer, bottom tab nav, sentence quick-bar, and PWA manifest"])
else:
    print("No staged changes to commit.")

run(["git", "push", "-u", "origin", "feat/mobile-ui"])
run(["git", "push", "origin", "v2.1-desktop-stable"])

# 4. Deploy Firebase Hosting Preview Channel (does NOT touch live production site)
run([
    "npx.cmd", "-y", "firebase-tools@latest",
    "hosting:channel:deploy", "mobile-preview",
    "--expires", "14d",
    "--project", "buddahsutra-reader",
])
print("ALL DONE")
