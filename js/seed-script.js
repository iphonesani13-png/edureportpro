import { db } from "./modules/firebase-config.js";
import { 
    doc, setDoc, getDocs, collection 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const ALL_SUBJECTS = [
    { id: "SUBJ_INDO", name: "Bahasa Indonesia" },
    { id: "SUBJ_WAFA", name: "Wafa" },
    { id: "SUBJ_INGGRIS", name: "Bahasa Inggris" },
    { id: "SUBJ_IPA", name: "IPA" },
    { id: "SUBJ_MAT", name: "Matematika" },
    { id: "SUBJ_MUSIK", name: "Seni Musik" },
    { id: "SUBJ_CIVIL", name: "Civil Society" },
    { id: "SUBJ_SPORT", name: "Sport Class" }
];

const SEED_DATA = {
    authorized_users: [
        { email: "rizkialbatamy@gmail.com", role: "OWNER", name: "Rizki Albatamy" },
        { email: "iphonesani13@gmail.com", role: "SUPER_ADMIN", name: "Rizki Akhsani" },
        { email: "admin@gmail.com", role: "SUPER_ADMIN", name: "Admin IT" },
        { email: "kepsek@gmail.com", role: "KEPALA_SEKOLAH", name: "Kepala Sekolah" }
    ],
    subjects: ALL_SUBJECTS.map(s => ({
        id: s.id,
        name: s.name,
        category: "nasional",
        minPassingGrade: 75
    })),
    // ... templates and users remain same
};

export const seedDatabase = async (realUid) => {
    console.log("🚀 Starting Full Curriculum Sync V1.3 (Role System)...");
    
    try {
        const adminUid = realUid || "GURU_ADMIN_ID";

        // 0. Sync Authorized Users
        console.log("📦 Syncing Authorized Users Whitelist...");
        for (const authUser of SEED_DATA.authorized_users) {
            const authId = authUser.email.replace(/[@.]/g, '_');
            await setDoc(doc(db, "authorized_users", authId), authUser);
        }

        // 1. Sync All 8 Subjects
        console.log("📦 Syncing 8 Subjects...");
        for (const sub of SEED_DATA.subjects) {
            await setDoc(doc(db, "subjects", sub.id), sub);
        }

        // 2. Sync Templates
        console.log("📦 Syncing Assessment Templates...");
        for (const tpl of SEED_DATA.assessment_templates) {
            await setDoc(doc(db, "assessment_templates", tpl.id), tpl);
        }

        // 3. READ ALL EXISTING STUDENTS FROM YOUR DATABASE
        console.log("🔍 Scanning existing students in Firestore...");
        const studentsSnap = await getDocs(collection(db, "students"));
        const classMap = { "7A": [], "7B": [], "8": [], "9": [] };

        let totalScanned = 0;
        studentsSnap.forEach(d => {
            const data = d.data();
            const kelasSiswa = data.kelas || data.base_kelas;
            if (kelasSiswa && classMap[kelasSiswa]) {
                classMap[kelasSiswa].push(d.id);
                totalScanned++;
            }
        });
        console.log(`📊 Found ${totalScanned} students to sync.`);

        // 4. UPDATE CLASSES
        for (const [className, studentIds] of Object.entries(classMap)) {
            const classId = `2526_${className}`;
            await setDoc(doc(db, "classes", classId), {
                id: classId,
                name: className,
                academicYear: "2025/2026",
                homeroomTeacherId: adminUid,
                studentIds: studentIds
            });
        }

        // 5. Sync Admin/Owner Profile
        console.log("📦 Finalizing Admin/Owner Profile Status...");
        const myUser = await getDoc(doc(db, "users", adminUid));
        if (myUser.exists()) {
            const currentData = myUser.data();
            // Upgrade role if it matches our seed whitelist
            const authRecord = SEED_DATA.authorized_users.find(u => u.email === currentData.email);
            if (authRecord) {
                await setDoc(doc(db, "users", adminUid), {
                    role: authRecord.role,
                    status: 'active'
                }, { merge: true });
            }
        }
        
        console.log("🎉 System Security Sync Complete!");
    } catch (globalErr) {
        console.error("⛔ Sync Failure:", globalErr.message);
    }
};
