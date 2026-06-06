import { db } from "./modules/firebase-config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const SEED_DATA = {
    subjects: [
        { id: "SUBJ_IPA", name: "IPA", category: "nasional", minPassingGrade: 75 },
        { id: "SUBJ_INDO", name: "Bahasa Indonesia", category: "nasional", minPassingGrade: 75 }
    ],
    assessment_templates: [
        {
            id: "TPL_IPA_BAB1",
            subjectId: "SUBJ_IPA", // FK to subjects.id
            academicYear: "2025/2026",
            semester: 1,
            type: "formative",
            title: "Sistem Organisasi Kehidupan",
            tpId: "IPA.7.1",
            tpDesc: "Siswa dapat mengidentifikasi sel sebagai unit terkecil kehidupan.",
            cognitiveLevel: "C2",
            weight: 1
        }
    ],
    classes: [
        {
            id: "2526_7A",
            name: "7A",
            academicYear: "2025/2026",
            homeroomTeacherId: "GURU_ADMIN_ID",
            studentIds: ["252607001"]
        }
    ],
    students: [
        {
            id: "252607001",
            nama: "Ahmad Zaki",
            base_kelas: "7A",
            base_tahun: "2025/2026",
            kelas: "7A",
            poin: 100,
            point_history: [],
            subjects: []
        }
    ],
    users: [
        {
            uid: "GURU_ADMIN_ID",
            email: "iphonesani13@gmail.com",
            role: "guru",
            name: "Rizki Akhsani",
            managedSubjects: ["SUBJ_IPA", "SUBJ_INDO"] // Using Master IDs
        }
    ]
};

export const seedDatabase = async (realUid) => {
    console.log("🚀 Starting Seeding V1.0 (Relational IDs)...");
    
    try {
        const adminUid = realUid || "GURU_ADMIN_ID";

        // Seed Subjects
        console.log("📦 Seeding Subjects...");
        for (const sub of SEED_DATA.subjects) {
            const { id, ...data } = sub;
            try {
                await setDoc(doc(db, "subjects", id), data);
                console.log(`   ✅ Subject: ${id}`);
            } catch (err) {
                console.error(`   ❌ Failed Subject ${id}:`, err.message);
            }
        }

        // Seed Templates
        console.log("📦 Seeding Assessment Templates...");
        for (const tpl of SEED_DATA.assessment_templates) {
            const { id, ...data } = tpl;
            try {
                await setDoc(doc(db, "assessment_templates", id), data);
                console.log(`   ✅ Template: ${id}`);
            } catch (err) {
                console.error(`   ❌ Failed Template ${id}:`, err.message);
            }
        }

        // Seed Classes
        console.log("📦 Seeding Classes...");
        for (const cls of SEED_DATA.classes) {
            const { id, ...data } = cls;
            if (data.homeroomTeacherId === "GURU_ADMIN_ID") data.homeroomTeacherId = adminUid;
            try {
                await setDoc(doc(db, "classes", id), data);
                console.log(`   ✅ Class: ${id}`);
            } catch (err) {
                console.error(`   ❌ Failed Class ${id}:`, err.message);
            }
        }

        // Seed Students
        console.log("📦 Seeding Students...");
        for (const student of SEED_DATA.students) {
            const { id, ...data } = student;
            try {
                await setDoc(doc(db, "students", id), data);
                console.log(`   ✅ Student: ${id}`);
            } catch (err) {
                console.error(`   ❌ Failed Student ${id}:`, err.message);
            }
        }

        // Seed User (Admin)
        console.log("📦 Seeding Admin User Profile...");
        const adminProfile = SEED_DATA.users[0];
        try {
            await setDoc(doc(db, "users", adminUid), {
                ...adminProfile,
                uid: adminUid
            });
            console.log(`   ✅ Admin Profile: ${adminUid}`);
        } catch (err) {
            console.error(`   ❌ Failed Admin Profile ${adminUid}:`, err.message);
        }
        
        console.log("🎉 Migration & Seeding Complete!");
    } catch (globalErr) {
        console.error("⛔ Global Seeding Failure:", globalErr.message);
    }
};
