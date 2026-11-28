import subprocess, sys

def run(cmd):
    print(f"=== {' '.join(cmd)} ===", flush=True)
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        sys.exit(r.returncode)

run(["node", "--check", "frontend/app.js"])
run(["git", "add", "frontend/app.js", "frontend/index.html", "development-log.md", "test_safe_command.py"])
if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode != 0:
    run(["git", "commit", "-m", "fix(tts): add 著地 (zhao di) to built-in Buddhist pronunciation map"])
run(["git", "push", "origin", "main"])
run(["npx.cmd", "-y", "firebase-tools@latest", "deploy", "--only", "hosting", "--project", "buddahsutra-reader"])
print("ALL DONE")
