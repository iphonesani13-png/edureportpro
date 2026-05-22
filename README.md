# edureportpro

Struktur proyek telah ditingkatkan menjadi lebih profesional:

- `index.html` — halaman utama minimal
- `css/style.css` — gaya CSS terpisah
- `js/app.js` — entry point JavaScript utama
- `js/modules/utils.js` — helper dan utilitas bersama
- `js/modules/page-loader.js` — partial loader dan event registration
- `partials/loading.html` — loading overlay
- `partials/login-screen.html` — tampilan login
- `partials/ortu-setup-screen.html` — layar input NIS orang tua
- `partials/main-app.html` — konten aplikasi utama
- `partials/body-modals.html` — semua modal dan dialog

## Cara menjalankan

1. Buka terminal di folder proyek.
2. Jalankan:
   - `npm start`
   - atau `python3 -m http.server 8080 --directory public`
3. Buka `http://localhost:8080`

> `package.json` sudah ditambahkan agar kamu punya titik mulai untuk server lokal dan penggunaan modul JS.
