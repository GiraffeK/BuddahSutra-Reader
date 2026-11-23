"""
test_safe_command.py
安全初始化 Git、加入遠端 origin、確認 .env 絕未被暫存後，執行 commit 與 push 至 GiraffeK/BuddahSutra-Reader。
"""
import subprocess
import sys


def run(cmd, check=True):
    print(f"$ {' '.join(cmd)}")
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.stdout:
        print(p.stdout.strip())
    if p.stderr:
        print(p.stderr.strip())
    if check and p.returncode != 0:
        sys.exit(p.returncode)
    return p


def main() -> None:
    run(["git", "init", "-b", "main"])
    run(["git", "config", "user.name", "GiraffeK"])
    run(["git", "config", "user.email", "GiraffeK@users.noreply.github.com"])

    # 設定 origin（若已存在則更新 URL）
    rem = run(["git", "remote"], check=False)
    if "origin" in rem.stdout.split():
        run(["git", "remote", "set-url", "origin", "https://github.com/GiraffeK/BuddahSutra-Reader.git"])
    else:
        run(["git", "remote", "add", "origin", "https://github.com/GiraffeK/BuddahSutra-Reader.git"])

    run(["git", "add", "-A"])

    # 嚴格安全查核：確認 .env 與任何圖片/金鑰檔絕未被暫存
    staged = run(["git", "diff", "--cached", "--name-only"]).stdout.splitlines()
    print(f"\n[SECURITY CHECK] Total staged files: {len(staged)}")
    forbidden = [f for f in staged if f == ".env" or f.endswith("/.env") or f.lower().endswith((".png", ".jpg", ".jpeg", ".mp4"))]
    assert not forbidden, f"ABORT! Forbidden files staged: {forbidden}"
    print("[SECURITY CHECK] PASS - .env and debug media are strictly excluded.")

    run(["git", "commit", "-m", "feat: initial BuddhaSutra-Reader with Taisho catalog, cache-first AI KB, and full-text classical commentaries"])
    run(["git", "push", "-u", "origin", "main"])
    print("\nPUSH COMPLETED SUCCESSFULLY!")


if __name__ == "__main__":
    main()
