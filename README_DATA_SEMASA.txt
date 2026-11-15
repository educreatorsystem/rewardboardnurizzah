REWARD BOARD - TREASURE ISLAND ADVENTURE
DATA SEMASA GOOGLE SHEET

SUMBER NAMA MURID & KELAS
- CSV published Google Sheet digunakan terus oleh app.js.
- Susunan kolum: A = KELAS, B = NAMA MURID.
- Sistem tidak menggunakan cache murid sebagai sumber utama.

SUMBER SKOR & KUMPULAN
- Apps Script membaca/menulis terus Google Sheet ID:
  1u_NyNG0ZNQWI2Fpzw7SLUbv7-jiDB11e4CsBHxrBpHM
- Tab backend:
  Reward Scores
  Reward Groups
  Rekod Reward
- getState membaca Reward Scores + Reward Groups setiap kali sync.
- PropertiesService tidak lagi menjadi sumber state utama.

PEMASANGAN
1. GitHub: gantikan index.html, app.js dan styles.css.
2. Google Apps Script: gantikan keseluruhan Code.gs.
3. Apps Script > Deploy > Manage deployments > Edit > New version > Deploy.
4. Pastikan Execute as = Me dan Who has access = Anyone.
5. Kekalkan deployment yang sama supaya URL /exec kekal:
   https://script.google.com/macros/s/AKfycbzXFP3PvpMxDC983K_N-mew7WOCifycnR3uYGCiyLVvkUr21DSBEja0Tay_OeRSrMTF/exec
6. Selepas GitHub dikemas kini, buat hard refresh browser.

ALIRAN DATA
CSV Google Sheet -> Nama Murid & Kelas -> Paparan Sistem
Reward Board -> Apps Script -> Reward Scores / Reward Groups / Rekod Reward
Apps Script getState -> Reward Scores / Reward Groups -> Paparan Sistem
