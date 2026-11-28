import re, subprocess, sys
from pathlib import Path

def run(cmd):
    print(f"=== {' '.join(cmd)} ===", flush=True)
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        sys.exit(r.returncode)

# 1. Validate 佛經高頻破音詞典-設定.lst format
lst_path = Path("frontend/data/佛經高頻破音詞典-設定.lst")
rules = []
bad_lines = []
for lineno, raw in enumerate(lst_path.read_text(encoding="utf-8").splitlines(), start=1):
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(r"^(.+?)\s*(?:=|→)\s*(.+)$", line)
    if not m or not m.group(1).strip() or not m.group(2).strip():
        bad_lines.append((lineno, raw))
    else:
        rules.append((m.group(1).strip(), m.group(2).strip()))

if bad_lines:
    print(f"ERROR: invalid lines in {lst_path.name}: {bad_lines}")
    sys.exit(1)
print(f"Validated {len(rules)} rules in {lst_path.name} OK")

# 2. Check git status & diff
run(["git", "status", "--short"])
run(["git", "diff", "--stat", "frontend/data/佛經高頻破音詞典-設定.lst"])

# 3. Commit & push
run(["git", "add", "frontend/data/佛經高頻破音詞典-設定.lst", "development-log.md", "test_safe_command.py"])
if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode != 0:
    run(["git", "commit", "-m", f"chore(tts): update Buddhist pronunciation dict ({len(rules)} rules)"])
run(["git", "push", "origin", "main"])

# 4. Deploy Firebase Hosting
run([
    "npx.cmd", "-y", "firebase-tools@latest",
    "deploy", "--only", "hosting",
    "--project", "buddahsutra-reader",
])
print("ALL DONE")
