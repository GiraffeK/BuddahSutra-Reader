"""
一鍵啟動大藏經 AI 白話翻譯與古大德註疏系統。
執行：python run_app.py
瀏覽：http://127.0.0.1:8000
"""
import uvicorn


if __name__ == "__main__":
    print("啟動《大正新脩大藏經》AI 白話翻譯與古大德註疏系統 -> http://127.0.0.1:8000")
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
