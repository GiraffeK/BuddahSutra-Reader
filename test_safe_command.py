import json, re, subprocess, sys
from pathlib import Path

def run(cmd):
    print(f"=== {' '.join(cmd)} ===", flush=True)
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        sys.exit(r.returncode)

# 1. Validate firebase.json, app.js, main.py, and .lst file
with open("firebase.json", "r", encoding="utf-8") as f:
    json.load(f)
print("firebase.json OK")
run(["node", "--check", "frontend/app.js"])
run([sys.executable, "-m", "py_compile", "backend/main.py"])

lst_path = Path("frontend/data/佛經高頻破音詞典-設定.lst")
assert lst_path.exists(), "Missing .lst file"
rules = []
for raw in lst_path.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(r"^(.+?)\s*(?:=|→)\s*(.+)$", line)
    assert m, f"Invalid line in .lst: {line}"
    rules.append((m.group(1).strip(), m.group(2).strip()))
print(f"Parsed {len(rules)} rules from {lst_path.name} OK")
assert any(src == "著地" and read == "着地" for src, read in rules)
assert any(src == "祇樹給孤獨" and read == "奇樹己孤獨" for src, read in rules)

# 2. Commit & push on main
run([
    "git", "add",
    "frontend/data/佛經高頻破音詞典-設定.lst",
    "frontend/app.js",
    "frontend/index.html",
    "firebase.json",
    "backend/main.py",
    "development-log.md",
    "test_safe_command.py",
])
if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode != 0:
    run(["git", "commit", "-m", "refactor(tts): externalize built-in Buddhist pronunciation dict to 佛經高頻破音詞典-設定.lst"])
run(["git", "push", "origin", "main"])

# 3. Deploy Firebase Hosting live site
run([
    "npx.cmd", "-y", "firebase-tools@latest",
    "deploy", "--only", "hosting",
    "--project", "buddahsutra-reader",
])
print("ALL DONE")
