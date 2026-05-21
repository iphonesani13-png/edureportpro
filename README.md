# edureportpro

Struktur proyek telah ditingkatkan menjadi lebih profesional:

- `public/index.html` — halaman utama minimal
- `public/css/style.css` — gaya CSS terpisah
- `public/js/app.js` — entry point JavaScript utama
- `public/js/modules/utils.js` — helper dan utilitas bersama
- `public/js/modules/page-loader.js` — partial loader dan event registration
- `public/partials/loading.html` — loading overlay
- `public/partials/login-screen.html` — tampilan login
- `public/partials/ortu-setup-screen.html` — layar input NIS orang tua
- `public/partials/main-app.html` — konten aplikasi utama
- `public/partials/body-modals.html` — semua modal dan dialog

## Cara menjalankan

1. Buka terminal di folder proyek.
2. Jalankan:
   - `npm start`
   - atau `python3 -m http.server 8080 --directory public`
3. Buka `http://localhost:8080`

> `package.json` sudah ditambahkan agar kamu punya titik mulai untuk server lokal dan penggunaan modul JS.
> `vercel.json` juga sudah ditambahkan agar deployment Vercel menggunakan folder `public` sebagai root.
