# Desain Arsitektur: Parent Linking V2

## Konteks & Latar Belakang
Pada desain awal (V1), verifikasi akses Portal Orang Tua menggunakan Nomor Induk Siswa (NIS) secara langsung. Karena *Document ID* di koleksi `students` menggunakan NIS, pendekatan ini menciptakan celah kerentanan *Enumeration Attack*, di mana akun orang tua yang belum tertaut dapat memindai NIS secara berurutan untuk mencuri data dasar siswa lain.

Untuk melindungi data 400+ siswa SMPIT Laa Tahzan Citra, alur registrasi mandiri via NIS dihentikan. Dokumen ini mendefinisikan arsitektur "Parent Linking V2" yang akan dibangun pada sprint berikutnya.

## Sasaran Keamanan
1. **Zero Enumeration**: Tidak ada orang tua atau akun eksternal yang dapat men-kueri koleksi `students` sebelum terhubung secara sah.
2. **Unguessable Tokens**: Penggunaan kode aktivasi yang diacak (kriptografis) dan tidak berurutan, memastikan tebakan acak selalu gagal.
3. **One-Time Use**: Kode aktivasi hanya berlaku satu kali untuk mencegah pencurian token ganda.

## Model Data (Firestore)

### Koleksi Baru: `parent_invites`
Koleksi ini berfungsi sebagai lapisan perantara (*demilitarized zone*) antara orang tua baru dan data siswa.

**Struktur Dokumen:**
- **Document ID**: Auto-Generated oleh Firebase (Unpredictable).
- `studentId` (String): ID/NIS siswa yang akan dihubungkan.
- `status` (String): `"pending" | "used"`.
- `createdAt` (Timestamp).
- `createdBy` (String): UID Admin/Wali Kelas yang meng-generate token.
- `usedBy` (String): UID Orang Tua yang berhasil menggunakan token ini.
- `usedAt` (Timestamp).

## Alur Sistem Baru (The Workflow)

### 1. Fase Generasi (Oleh Admin/Sekolah)
1. **Admin** masuk ke Dashboard, melihat daftar siswa.
2. Admin mengklik tombol "Generate Kode Akses Ortu" pada profil siswa tertentu (misal NIS: 12345).
3. Sistem membuat dokumen baru di `parent_invites` (misal Document ID: `X9fT2aBqR5vP0kLz`).
4. Admin membagikan ID unik `X9fT2aBqR5vP0kLz` ini kepada orang tua melalui WhatsApp atau secarik kertas.

### 2. Fase Aktivasi (Oleh Orang Tua)
1. **Orang Tua** mengunjungi portal, memilih "Masuk Sebagai Wali Murid".
2. Mereka login menggunakan akun Google.
3. Di layar aktivasi, orang tua **tidak lagi menginput NIS**, melainkan memasukkan **Kode Aktivasi** (`X9fT2aBqR5vP0kLz`).
4. Sistem memverifikasi kode tersebut ke koleksi `parent_invites` dengan kondisi `status == "pending"`.
5. Jika valid, sistem akan:
   - Melakukan `update` profil orang tua (`users`) dengan mengisi `childId` dari invite tersebut.
   - Mengubah status dokumen `parent_invites` menjadi `"used"`.
6. Akses orang tua resmi terhubung dengan aman.

## Firestore Security Rules (Dampak V2)

Pendekatan ini menyederhanakan dan memperkuat `firestore.rules`:
1. **`students` collection**: Akses `read` untuk role `ORANG_TUA` mutlak hanya diizinkan jika `childId` sudah terisi di profil. Tidak ada pengecualian *first-time setup* di level ini.
2. **`parent_invites` collection**: 
   - `allow get`: Publik untuk `isSignedIn()`. (Karena ID di-generate acak, orang tua tidak bisa menebak dokumen lain).
   - `allow list`: Dilarang keras.
   - `allow write`: Hanya untuk Staf/Admin, dan Orang Tua hanya bisa meng-update `status` menjadi "used" saat proses linking berlangsung melalui transaksi.

## Rencana Implementasi (Next Sprint)
1. **Setup Admin UI**: Buat fitur "Generate Invite" di tabel daftar siswa bagi role Admin/GURU.
2. **Setup Ortu UI**: Ubah form "Masukkan NIS" menjadi "Masukkan Kode Aktivasi".
3. **Transaction Logic**: Buat fungsi JavaScript yang mengeksekusi Firebase Transaction untuk memastikan token langsung mati setelah diklaim.
