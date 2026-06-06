import { db } from "./firebase-config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const SEED_DATA = {
    subjects: [
        { id: "SUBJ_IPA", name: "IPA", category: "nasional", minPassingGrade: 75 },
        { id: "SUBJ_INDO", name: "Bahasa Indonesia", category: "nasional", minPassingGrade: 75 }
    ],
    assessment_templates: [
        {
            id: "TPL_IPA_BAB1",
            subjectId: "IPA",
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
            managedSubjects: ["IPA", "Bahasa Indonesia"]
        }
    ]
};

export const seedDatabase = async (realUid) => {
    console.log("Starting Seeding V1.0...");
    
    const adminUid = realUid || "GURU_ADMIN_ID";

    // Seed Subjects
    for (const sub of SEED_DATA.subjects) {
        const { id, ...data } = sub;
        await setDoc(doc(db, "subjects", id), data);
    }

    // Seed Templates
    for (const tpl of SEED_DATA.assessment_templates) {
        const { id, ...data } = tpl;
        await setDoc(doc(db, "assessment_templates", id), data);
    }

    // Seed Classes
    for (const cls of SEED_DATA.classes) {
        const { id, ...data } = cls;
        if (data.homeroomTeacherId === "GURU_ADMIN_ID") data.homeroomTeacherId = adminUid;
        await setDoc(doc(db, "classes", id), data);
    }

    // Seed Students
    for (const student of SEED_DATA.students) {
        const { id, ...data } = student;
        await setDoc(doc(db, "students", id), data);
    }

    // Seed User (Admin)
    const adminProfile = SEED_DATA.users[0];
    await setDoc(doc(db, "users", adminUid), {
        ...adminProfile,
        uid: adminUid
    });
    
    console.log("Seeding Complete!");
};
