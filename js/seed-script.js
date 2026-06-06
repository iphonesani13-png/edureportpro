import { db } from "./modules/firebase-config.js";
import { 
    doc, setDoc, getDocs, collection 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const SEED_DATA = {
    subjects: [
        { id: "SUBJ_IPA", name: "IPA", category: "nasional", minPassingGrade: 75 },
        { id: "SUBJ_INDO", name: "Bahasa Indonesia", category: "nasional", minPassingGrade: 75 }
    ],
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
    users: [
        {
            email: "iphonesani13@gmail.com",
            role: "guru",
            name: "Rizki Akhsani",
            managedSubjects: ["SUBJ_IPA", "SUBJ_INDO"]
        }
    ]
};

export const seedDatabase = async (realUid) => {
    console.log("🚀 Starting Dynamic Sync V1.0...");
    
    try {
        const adminUid = realUid || "GURU_ADMIN_ID";

        // 1. Sync Subjects (Master Data)
        console.log("📦 Syncing Subjects...");
        for (const sub of SEED_DATA.subjects) {
            await setDoc(doc(db, "subjects", sub.id), sub);
        }

        // 2. Sync Templates (Materi/TP)
        console.log("📦 Syncing Assessment Templates...");
        for (const tpl of SEED_DATA.assessment_templates) {
            await setDoc(doc(db, "assessment_templates", tpl.id), tpl);
        }

        // 3. READ ALL EXISTING STUDENTS FROM YOUR DATABASE
        console.log("🔍 Scanning existing students in Firestore...");
        const studentsSnap = await getDocs(collection(db, "students"));
        
        // Map untuk menampung list NIS per kelas
        const classMap = {
            "7A": [], "7B": [], "8": [], "9": []
        };

        let totalScanned = 0;
        studentsSnap.forEach(d => {
            const data = d.data();
            // Ambil kelas dari input manual Anda (field 'kelas') atau fallback 'base_kelas'
            const kelasSiswa = data.kelas || data.base_kelas;
            
            if (kelasSiswa && classMap[kelasSiswa]) {
                classMap[kelasSiswa].push(d.id); // Masukkan NIS (doc ID) ke list kelas
                totalScanned++;
            }
        });
        console.log(`📊 Found ${totalScanned} students to sync.`);

        // 4. UPDATE COLLECTION 'classes' SECARA OTOMATIS
        console.log("📦 Updating Class Registries (Bridge)...");
        for (const [className, studentIds] of Object.entries(classMap)) {
            const classId = `2526_${className}`;
            const classData = {
                id: classId,
                name: className,
                academicYear: "2025/2026",
                homeroomTeacherId: adminUid,
                studentIds: studentIds
            };
            await setDoc(doc(db, "classes", classId), classData);
            console.log(`   ✅ Class ${classId}: Registered ${studentIds.length} students`);
        }

        // 5. Sync Admin Profile
        console.log("📦 Syncing Admin User Profile...");
        const adminProfile = SEED_DATA.users[0];
        await setDoc(doc(db, "users", adminUid), {
            ...adminProfile,
            uid: adminUid
        });
        
        console.log("🎉 Dynamic Sync Complete! All your students are now linked.");
    } catch (globalErr) {
        console.error("⛔ Sync Failure:", globalErr.message);
    }
};
