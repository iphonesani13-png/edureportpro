import { db } from "./modules/firebase-config.js";
import { 
    doc, setDoc, getDocs, collection, query, where 
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
            uid: "GURU_ADMIN_ID",
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

        // 1. Seed Subjects
        console.log("📦 Syncing Subjects...");
        for (const sub of SEED_DATA.subjects) {
            await setDoc(doc(db, "subjects", sub.id), sub);
        }

        // 2. Seed Templates
        console.log("📦 Syncing Assessment Templates...");
        for (const tpl of SEED_DATA.assessment_templates) {
            await setDoc(doc(db, "assessment_templates", tpl.id), tpl);
        }

        // 3. READ EXISTING STUDENTS & GROUP BY CLASS
        console.log("🔍 Fetching existing students from Firestore...");
        const studentsSnap = await getDocs(collection(db, "students"));
        const classMap = {
            "7A": [], "7B": [], "8": [], "9": []
        };

        studentsSnap.forEach(d => {
            const data = d.data();
            const kelas = data.base_kelas || data.kelas;
            const tahun = data.base_tahun || "2025/2026";
            
            // Masukkan hanya yang tahun ajaran 2025/2026
            if (tahun === "2025/2026" && classMap[kelas]) {
                classMap[kelas].push(d.id);
            }
        });

        // 4. UPDATE CLASSES DYNAMICALLY
        console.log("📦 Updating Class Member Lists...");
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
            console.log(`   ✅ Class ${classId}: Linked ${studentIds.length} students`);
        }

        // 5. Seed User (Admin)
        console.log("📦 Syncing Admin User Profile...");
        const adminProfile = SEED_DATA.users[0];
        await setDoc(doc(db, "users", adminUid), {
            ...adminProfile,
            uid: adminUid
        });
        
        console.log("🎉 Dynamic Sync Complete!");
    } catch (globalErr) {
        console.error("⛔ Sync Failure:", globalErr.message);
    }
};
