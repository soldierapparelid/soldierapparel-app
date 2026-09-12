import os
import google.generativeai as genai

api_key = os.environ.get("GEMINI_API_KEY")
user_prompt = os.environ.get("USER_PROMPT", "Perbaiki bug di file ini.")

genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-2.6-flash')

file_path = "jahit-command.html"
if os.path.exists(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        code_content = f.read()

    # Perintah ketat agar Gemini hanya membalas dengan kode
    prompt = f"""
    Tugas Anda adalah memperbarui kode berikut berdasarkan perintah ini: "{user_prompt}"

    ATURAN SANGAT KETAT:
    1. Berikan HANYA kode HTML/JS/CSS secara lengkap dari atas sampai bawah.
    2. JANGAN tambahkan penjelasan, salam, atau teks apa pun di luar kode.
    3. JANGAN gunakan tag markdown seperti ```html di awal atau akhir, cukup berikan teks mentahnya saja.

    Kode saat ini:
    {code_content}
    """

    response = model.generate_content(prompt)
    new_code = response.text.strip()

    # Membersihkan sisa markdown jika Gemini masih bandel
    if new_code.startswith("```"):
        new_code = new_code.split("\n", 1)[1]
    if new_code.endswith("```"):
        new_code = new_code.rsplit("\n", 1)[0]

    # Menimpa file lama dengan kode baru
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(new_code)

    print("File berhasil diproses dan ditimpa oleh Gemini!")
else:
    print(f"File {file_path} tidak ditemukan.")
