import shutil
import subprocess
from fastapi.testclient import TestClient
from backend.main import app

# 1. JS syntax check
node = shutil.which("node")
assert node, "node not found"
r = subprocess.run([node, "--check", "frontend/app.js"], capture_output=True, text=True)
print("node --check frontend/app.js:", r.returncode, r.stderr.strip())
assert r.returncode == 0, r.stderr

# 2. FastAPI endpoints & static check
client = TestClient(app)
assert client.get("/api/health").status_code == 200
html = client.get("/").text
assert "modelProbeSummary" in html and "reprobeModelsBtn" in html
css = client.get("/styles.css").text if client.get("/styles.css").status_code == 200 else client.get("/static/styles.css").text
assert "model-probe-bar" in css
js = client.get("/app.js").text if client.get("/app.js").status_code == 200 else client.get("/static/app.js").text
assert "probeAllGeminiModelsInBackground" in js

# 3. Verify /api/llm/probe-model validation & structure
bad = client.post("/api/llm/probe-model", json={"model": ""})
assert bad.status_code == 400
print("Empty model validation:", bad.status_code)

print("ALL CHECKS PASS")
