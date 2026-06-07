import { db } from "./modules/firebase-config.js";
import { 
    doc, setDoc, getDocs, getDoc, collection 
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
    assessment_templates: [
        {
            id: "TPL_IPA_BAB1",
            subjectId: "SUBJ_IPA",
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
    users: []
};

export const seedDatabase = async (realUid) => {
    console.log("🚀 Starting Full Curriculum Sync V1.3 (Role System)...");
    
    try {
        const adminUid = realUid || "GURU_ADMIN_ID";

        // 0. Sync Authorized Users
        if (Array.isArray(SEED_DATA.authorized_users)) {
            console.log("📦 Syncing Authorized Users Whitelist...");
            for (const authUser of SEED_DATA.authorized_users) {
                const authId = authUser.email.replace(/[@.]/g, '_');
                await setDoc(doc(db, "authorized_users", authId), authUser);
            }
        }

        // 1. Sync All 8 Subjects
        if (Array.isArray(SEED_DATA.subjects)) {
            console.log("📦 Syncing 8 Subjects...");
            for (const sub of SEED_DATA.subjects) {
                await setDoc(doc(db, "subjects", sub.id), sub);
            }
        }

        // 2. Sync Templates
        if (Array.isArray(SEED_DATA.assessment_templates)) {
            console.log("📦 Syncing Assessment Templates...");
            for (const tpl of SEED_DATA.assessment_templates) {
                await setDoc(doc(db, "assessment_templates", tpl.id), tpl);
            }
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

        // 6. MIGRATION PATCH: Ensure all users follow Access Matrix V2 schema
        console.log("🛠️ Starting User Schema Migration Patch...");
        const allUsersSnap = await getDocs(collection(db, "users"));
        let totalUsers = 0;
        let patchedCount = 0;
        let validCount = 0;

        for (const userDoc of allUsersSnap.docs) {
            totalUsers++;
            const userData = userDoc.data();
            const updates = {};
            let needsPatch = false;

            if (!userData.role) { updates.role = 'GURU'; needsPatch = true; }
            if (!userData.status) { updates.status = 'pending'; needsPatch = true; }
            if (!userData.managedSubjects || !Array.isArray(userData.managedSubjects)) { 
                updates.managedSubjects = []; needsPatch = true; 
            }
            if (!userData.managedClasses || !Array.isArray(userData.managedClasses)) { 
                updates.managedClasses = []; needsPatch = true; 
            }

            if (needsPatch) {
                await setDoc(doc(db, "users", userDoc.id), updates, { merge: true });
                patchedCount++;
                console.log(`✅ Patched user: ${userData.email || userDoc.id}`);
            } else {
                validCount++;
            }
        }

        console.log("--- MIGRATION REPORT ---");
        console.log(`Total Users: ${totalUsers}`);
        console.log(`Patched Users: ${patchedCount}`);
        console.log(`Valid Users: ${validCount}`);
        console.log("------------------------");

        console.log("🎉 System Security Sync Complete!");
    } catch (globalErr) {
        console.error("⛔ Sync Failure:", globalErr.message);
    }
};
