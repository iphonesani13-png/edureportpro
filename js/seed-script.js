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
    users: [
        {
            email: "iphonesani13@gmail.com",
            role: "guru",
            name: "Rizki Akhsani",
            managedSubjects: ALL_SUBJECTS.map(s => s.id) // Grant all 8 subjects to admin
        },
        {
            email: "rizkialbatamy@gmail.com",
            role: "guru",
            name: "Rizki Albatamy",
            managedSubjects: ALL_SUBJECTS.map(s => s.id)
        }
    ]
};

export const seedDatabase = async (realUid) => {
    console.log("🚀 Starting Full Curriculum Sync V1.2...");
    
    try {
        const adminUid = realUid || "GURU_ADMIN_ID";

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

        // 5. Sync Admin Profile with All 8 Subjects
        console.log("📦 Syncing Admin User Profile (8 Subjects)...");
        const adminProfile = SEED_DATA.users[0];
        await setDoc(doc(db, "users", adminUid), {
            ...adminProfile,
            uid: adminUid
        });
        
        console.log("🎉 Full Curriculum Sync Complete!");
    } catch (globalErr) {
        console.error("⛔ Sync Failure:", globalErr.message);
    }
};
