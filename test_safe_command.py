import subprocess, sys

def run(cmd):
    print(f"=== {' '.join(cmd)} ===", flush=True)
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        sys.exit(r.returncode)

# 1. Final JS syntax check
run(["node", "--check", "frontend/app.js"])

# 2. Commit log update on feat/mobile-ui if present
run(["git", "add", "development-log.md", "test_safe_command.py"])
if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode != 0:
    run(["git", "commit", "-m", "docs: record Session 64 mobile-ui merge and production deploy"])

# 3. Switch to main, merge feat/mobile-ui, push main
run(["git", "checkout", "main"])
run(["git", "merge", "--no-ff", "feat/mobile-ui", "-m", "merge: integrate feat/mobile-ui (mobile RWD, PWA, and mobile TTS fixes)"])
run(["git", "push", "origin", "main"])

# 4. Clean up merged short-lived branch (local + remote)
run(["git", "branch", "-d", "feat/mobile-ui"])
run(["git", "push", "origin", "--delete", "feat/mobile-ui"])

# 5. Deploy to Firebase Hosting live site
run([
    "npx.cmd", "-y", "firebase-tools@latest",
    "deploy", "--only", "hosting",
    "--project", "buddahsutra-reader",
])

run(["git", "branch", "--show-current"])
run(["git", "log", "-n", "3", "--oneline"])
print("ALL DONE")
