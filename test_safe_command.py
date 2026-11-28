import subprocess, sys

def run(cmd):
    print(f"=== {' '.join(cmd)} ===", flush=True)
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        sys.exit(r.returncode)

# 1. Syntax checks
run(["node", "--check", "frontend/app.js"])
run([sys.executable, "-m", "py_compile", "backend/cbeta_fetcher.py"])

# 2. Unit check: verify XML parser strips <cb:t xml:lang="sa-Latn">subhūti</cb:t> and <foreign>
from backend.cbeta_fetcher import _extract_juan_from_xml_p5a
sample_xml = '''<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:cb="http://www.cbeta.org/ns/1.0">
  <text><body>
    <milestone unit="juan" n="1"/>
    <p>時，長老<cb:tt type="app"><cb:t xml:lang="sa-Latn">subhūti</cb:t><cb:t xml:lang="zh-Hant">須菩提</cb:t></cb:tt><foreign xml:lang="sa-Latn">test</foreign>在大眾中即從座起。</p>
  </body></text>
</TEI>'''
paras = _extract_juan_from_xml_p5a(sample_xml, 1)
assert len(paras) == 1, f"unexpected paras: {paras}"
assert paras[0]["text"] == "時，長老須菩提在大眾中即從座起。", f"got: {paras[0]['text']}"
print(f"XML Sanskrit-strip check PASSED: {paras[0]['text']}")

# 3. Git commit & push on main
run(["git", "add", "backend/cbeta_fetcher.py", "frontend/index.html", "frontend/styles.css", "frontend/app.js", "development-log.md", "test_safe_command.py"])
if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode != 0:
    run(["git", "commit", "-m", "fix(xml,tts): strip non-Chinese CBETA XML glosses (e.g. subhuti), expand Buddhist polyphone dict, and add custom pronunciation UI"])
run(["git", "push", "origin", "main"])

# 4. Deploy Firebase Hosting live site
run([
    "npx.cmd", "-y", "firebase-tools@latest",
    "deploy", "--only", "hosting",
    "--project", "buddahsutra-reader",
])
print("ALL DONE")
