import shutil
import subprocess

node = shutil.which("node")
r = subprocess.run([node, "--check", "frontend/app.js"], capture_output=True, text=True)
assert r.returncode == 0, r.stderr

js_test = r"""
const fs = require('fs');
const code = fs.readFileSync('frontend/app.js', 'utf8');
const start = code.indexOf('function normalizeForMatch(');
const end = code.indexOf('function renderCommFullBody(');
const fnCode = code.slice(start, end);

const sutra = JSON.parse(fs.readFileSync('translation_kb/sutras/T19n0945/fascicles/003.json', 'utf8'));
const comm = JSON.parse(fs.readFileSync('translation_kb/commentary_fulltext/hanshan_tongyi/003.json', 'utf8'));

const state = { bundle: { sutra } };
const evalFn = new Function('state', fnCode + '; return { buildCommentaryBlocks };');
const { buildCommentaryBlocks } = evalFn(state);

const blocks = buildCommentaryBlocks(comm.paragraphs.slice(0, 12));
for (const b of blocks) {
  console.log(`[${b.kind}] raw=${b.rawIndices.join(',')} text=${b.items.map(x => x.displayText.slice(0, 35)).join(' | ')}`);
}
// Ensure zero unstripped CBETA kepan brackets remain across entire juan 3
const allBlocks = buildCommentaryBlocks(comm.paragraphs);
const leaked = allBlocks
  .flatMap(b => b.items)
  .filter(it => /^\[[△▽▲▼○●◎□■◇◆╳︽︾?@()/+\-*]+\]/.test(it.displayText));
console.log('Leaked kepan markers in juan 3:', leaked.length);
if (leaked.length > 0) process.exit(1);
"""
r2 = subprocess.run([node, "-e", js_test], capture_output=True, text=True, encoding="utf-8")
print(r2.stdout)
assert r2.returncode == 0, r2.stderr
print("PASS")
