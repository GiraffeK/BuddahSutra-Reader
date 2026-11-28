import shutil
import subprocess
from fastapi.testclient import TestClient
from backend.main import app

node = shutil.which("node")
assert node, "node not found"
r = subprocess.run([node, "--check", "frontend/app.js"], capture_output=True, text=True)
print("node --check frontend/app.js:", r.returncode, r.stderr.strip())
assert r.returncode == 0, r.stderr

# Verify pronunciation helper in Node
js_test = r"""
const fs = require('fs');
const code = fs.readFileSync('frontend/app.js', 'utf8');
const start = code.indexOf('const BUDDHIST_PRONUNCIATION_MAP');
const end = code.indexOf('const ttsState =');
const fn = new Function(code.slice(start, end) + '; return { normalizeSutraPronunciation };');
const { normalizeSutraPronunciation } = fn();
const sample = '南無阿彌陀佛，爾時阿難聞般若波羅蜜，波斯匿王與舍利弗俱。';
const out = normalizeSutraPronunciation(sample);
console.log('Pronunciation out:', out);
if (!out.includes('拿摩') || !out.includes('啊彌陀') || !out.includes('啊難') || !out.includes('波惹')) {
  process.exit(1);
}
"""
r2 = subprocess.run([node, "-e", js_test], capture_output=True, text=True, encoding="utf-8")
print(r2.stdout.strip())
assert r2.returncode == 0, r2.stderr

client = TestClient(app)
html = client.get("/").text
assert "ttsPlayBtn" in html and "ttsVoiceSelect" in html and "ttsRateSelect" in html
print("ALL CHECKS PASS")
