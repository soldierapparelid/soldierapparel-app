import os
import google.generativeai as genai

api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY tidak ditemukan di environment variables.")

genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-2.5-flash')

file_path = "jahit-command.html"
if os.path.exists(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        code_content = f.read()

    prompt = (
        "Analisis kode HTML dan JavaScript berikut yang mengatur sistem antrean produksi jahit di SOLDIERAPPAREL.ID. "
        "Temukan bug logika pada fungsi JavaScript yang menyebabkan item dengan status 'beres jahit' atau selesai masih tetap tersangkut di daftar antrean aktif. "
        "Tunjukkan baris kode yang error dan berikan solusi perbaikannya secara akurat:\n\n" + code_content
    )

    response = model.generate_content(prompt)
    print("=== LAPORAN ANALISIS BUG DARI GEMINI ===")
    print(response.text)
else:
    print(f"File {file_path} tidak ditemukan di direktori.")
