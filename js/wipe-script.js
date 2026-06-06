import { db } from "./modules/firebase-config.js";
import { collection, getDocs, deleteDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export const wipeGrades = async () => {
    console.log("🧹 Memulai pembersihan database (Wipe Grades)...");
    let deletedAssessments = 0;
    let updatedStudents = 0;

    try {
        // 1. Hapus SEMUA dokumen di koleksi `assessments` (V1.1)
        console.log("Menghapus data di koleksi assessments...");
        const assessmentsSnap = await getDocs(collection(db, "assessments"));
        for (const d of assessmentsSnap.docs) {
            await deleteDoc(doc(db, "assessments", d.id));
            deletedAssessments++;
        }
        console.log(`✅ Berhasil menghapus ${deletedAssessments} dokumen assessment.`);

        // 2. Bersihkan field `subjects` di koleksi `students` (Legacy V1.0)
        // Agar profil siswa juga bersih dari nilai lama
        console.log("Membersihkan sisa nilai lama di profil siswa...");
        const studentsSnap = await getDocs(collection(db, "students"));
        for (const d of studentsSnap.docs) {
            const studentData = d.data();
            if (studentData.subjects && studentData.subjects.length > 0) {
                await updateDoc(doc(db, "students", d.id), {
                    subjects: [] // Kosongkan array subjects
                });
                updatedStudents++;
            }
        }
        console.log(`✅ Berhasil membersihkan profil dari ${updatedStudents} siswa.`);

        console.log("🎉 PEMBERSIHAN SELESAI! Database nilai sekarang kembali ke 0.");
    } catch (error) {
        console.error("⛔ Terjadi kesalahan saat pembersihan:", error);
    }
};

wipeGrades();
