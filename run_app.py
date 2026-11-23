"""
一鍵啟動大藏經 AI 白話翻譯與古大德註疏系統。
執行：python run_app.py
瀏覽：http://127.0.0.1:8000
"""
import subprocess
import sys
from pathlib import Path

try:
    import uvicorn
except ModuleNotFoundError:
    root = Path(__file__).resolve().parent
    candidates = [
        root / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "bin" / "python",
    ]
    venv_python = next((p for p in candidates if p.exists()), None)
    if venv_python and Path(sys.executable).resolve() != venv_python.resolve():
        print(f"偵測到專案虛擬環境，自動切換至 {venv_python} 啟動...")
        try:
            raise SystemExit(
                subprocess.call([str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])
            )
        except KeyboardInterrupt:
            raise SystemExit(0)
    raise


if __name__ == "__main__":
    print("啟動《大正新脩大藏經》AI 白話翻譯與古大德註疏系統 -> http://127.0.0.1:8000")
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
