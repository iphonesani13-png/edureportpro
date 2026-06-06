import { db } from "./firebase-config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const SEED_DATA = {
    students: [
        {
            id: "252607001",
            nama: "Ahmad Zaki",
            base_kelas: "7A",
            base_tahun: "2025/2026",
            kelas: "7A",
            poin: 100,
            point_history: [
                { id: 1, date: "06/06/2026", time: "08:00", category: "Karakter", desc: "Membantu merapikan kelas", pointChange: 10, icon: "⭐" }
            ],
            subjects: [
                { name: "IPA", score_harian: 85, score_uh: 80, score_pts: 78, score_pas: 88, last_updated_date: "06/06/2026", note: "Sangat baik" },
                { name: "Bahasa Indonesia", score_harian: 90, score_uh: 85, score_pts: 80, score_pas: 92, last_updated_date: "06/06/2026", note: "" },
                { name: "Matematika", score_harian: 75, score_uh: 70, score_pts: 75, score_pas: 80, last_updated_date: "06/06/2026", note: "Perlu latihan soal" }
            ]
        },
        {
            id: "252607002",
            nama: "Siti Aminah",
            base_kelas: "7B",
            base_tahun: "2025/2026",
            kelas: "7B",
            poin: 150,
            point_history: [],
            subjects: []
        },
        {
            id: "252608001",
            nama: "Budi Santoso",
            base_kelas: "8",
            base_tahun: "2025/2026",
            kelas: "8",
            poin: 50,
            point_history: [],
            subjects: []
        },
        {
            id: "252609001",
            nama: "Dewi Sartika",
            base_kelas: "9",
            base_tahun: "2025/2026",
            kelas: "9",
            poin: 200,
            point_history: [],
            subjects: []
        }
    ],
    assignments: [
        {
            id: "TGS001",
            judul: "Latihan Bab Sel",
            mapel: "IPA",
            kelas: "7A",
            tenggat: "2026-06-15",
            tahun_ajaran: "2025/2026",
            tanggal_dibuat: new Date().toISOString()
        }
    ],
    users: [
        {
            uid: "GURU_ADMIN_ID", // Replace with real UID from Auth
            email: "iphonesani13@gmail.com",
            role: "guru",
            name: "Rizki Akhsani"
        }
    ]
};

export const seedDatabase = async () => {
    console.log("Starting Seeding...");
    
    // Seed Students
    for (const student of SEED_DATA.students) {
        const { id, ...data } = student;
        await setDoc(doc(db, "students", id), data);
        console.log(`Seeded student: ${student.nama}`);
    }

    // Seed Assignments
    for (const task of SEED_DATA.assignments) {
        const { id, ...data } = task;
        await setDoc(doc(db, "assignments", id), data);
    }

    // Seed Users
    for (const user of SEED_DATA.users) {
        const { uid, ...data } = user;
        await setDoc(doc(db, "users", uid), data);
    }

    console.log("Seeding Complete!");
};
