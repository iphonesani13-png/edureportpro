import { db, auth } from "./firebase-config.js";
import { 
    doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp, runTransaction, addDoc, deleteDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { ROLES } from "./auth-service.js";

/**
 * AssessmentService V2.0 (Access Matrix V2 Standard)
 */

/**
 * Mendapatkan daftar template TP berdasarkan mata pelajaran
 */
export const getTemplatesBySubject = async (subjectId, academicYear) => {
    const q = query(
        collection(db, "assessment_templates"), 
        where("subjectId", "==", subjectId),
        where("academicYear", "==", academicYear)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

/**
 * Mendapatkan detail mata pelajaran (untuk KKM)
 */
export const getSubjectDetails = async (subjectId) => {
    const snap = await getDoc(doc(db, "subjects", subjectId));
    return snap.exists() ? snap.data() : null;
};

/**
 * Mendapatkan seluruh aktivitas penilaian published untuk Rekap
 */
export const getAllPublishedAssessments = async (subjectId, classId, academicYear) => {
    const q = query(
        collection(db, "assessments"),
        where("subjectId", "==", subjectId),
        where("classId", "==", classId),
        where("academicYear", "==", academicYear),
        where("status", "==", "published")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

/**
 * Mendapatkan daftar aktivitas penilaian untuk TP dan Kelas tertentu
 */
export const getAssessmentsByFilter = async (templateId, classId) => {
    const q = query(
        collection(db, "assessments"),
        where("templateId", "==", templateId),
        where("classId", "==", classId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

/**
 * Mendapatkan satu dokumen assessment berdasarkan ID
 */
export const getAssessmentById = async (assessmentId) => {
    const docRef = doc(db, "assessments", assessmentId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
        return { id: snap.id, ...snap.data() };
    }
    return null;
};

/**
 * Validasi Publish sesuai PRD
 */
const validatePublish = (scores, reflection, totalStudents) => {
    const scoreCount = Object.values(scores).filter(s => s !== null && s !== undefined && s !== "").length;
    if (scoreCount < totalStudents) {
        throw new Error(`Gagal Publish: Masih ada ${totalStudents - scoreCount} siswa yang belum memiliki nilai.`);
    }
    if (!reflection || reflection.trim().length < 10) {
        throw new Error("Gagal Publish: Refleksi guru minimal 10 karakter.");
    }
    return true;
};

/**
 * Menyimpan atau Update data assessment (Multi-Assessment)
 */
export const saveAssessment = async (assessmentId, assessmentData, isPublish = false, totalStudents = 0) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User tidak terautentikasi.");
    
    const teacherId = user.uid;

    if (isPublish) {
        validatePublish(assessmentData.scores || {}, assessmentData.teacherReflection, totalStudents);
    }

    const baseData = {
        ...assessmentData,
        updatedAt: serverTimestamp(),
        updatedBy: teacherId,
        gradingStatus: isPublish ? "completed" : "ongoing" // New V1.1 Field
    };

    if (isPublish) {
        baseData.status = "published";
        baseData.publishedAt = serverTimestamp();
        baseData.publishedBy = teacherId;
    }

    let finalSubjectId = assessmentData.subjectId;
    let finalClassId = assessmentData.classId;
    let finalAcademicYear = assessmentData.academicYear;
    let finalStatus = isPublish ? "published" : null;

    if (!assessmentId) {
        // CREATE NEW (Auto-ID)
        const docRef = await addDoc(collection(db, "assessments"), {
            ...baseData,
            status: isPublish ? "published" : "draft",
            createdAt: serverTimestamp(),
            createdBy: teacherId,
            isRemedial: false,
            originalAssessmentId: null
        });
        
        if (isPublish) {
            await syncStudentGradesAfterPublish(finalSubjectId, finalClassId, finalAcademicYear);
        }
        return docRef.id;
    } else {
        // UPDATE EXISTING
        const docRef = doc(db, "assessments", assessmentId);
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(docRef);
            if (!snap.exists()) throw new Error("Dokumen tidak ditemukan.");
            
            const existing = snap.data();
            if (existing.status === "published" && !isPublish) {
                // Principal/Admin can override this via rules, but logic prevents it for teachers
                const userDoc = await transaction.get(doc(db, "users", teacherId));
                const userRole = userDoc.exists() ? userDoc.data().role : null;
                if (userRole !== ROLES.SUPER_ADMIN && userRole !== ROLES.KEPALA_SEKOLAH && userRole !== ROLES.OWNER) {
                    throw new Error("Dokumen sudah dipublish dan terkunci.");
                }
            }
            
            finalSubjectId = existing.subjectId;
            finalClassId = existing.classId;
            finalAcademicYear = existing.academicYear;
            finalStatus = isPublish ? "published" : existing.status;
            
            transaction.update(docRef, baseData);
        });
        
        if (finalStatus === "published") {
            await syncStudentGradesAfterPublish(finalSubjectId, finalClassId, finalAcademicYear);
        }
        return assessmentId;
    }
};

/**
 * Mengambil daftar siswa (Parallel Query Optimization)
 */
export const getStudentsInClass = async (classId) => {
    const classSnap = await getDoc(doc(db, "classes", classId));
    if (!classSnap.exists()) return [];

    const studentIds = classSnap.data().studentIds || [];
    if (studentIds.length === 0) return [];

    const chunks = [];
    for (let i = 0; i < studentIds.length; i += 30) {
        chunks.push(studentIds.slice(i, i + 30));
    }

    const promises = chunks.map(chunk => {
        const q = query(collection(db, "students"), where("__name__", "in", chunk));
        return getDocs(q);
    });

    const snapshots = await Promise.all(promises);
    const students = [];
    snapshots.forEach(snap => {
        snap.forEach(d => students.push({ id: d.id, ...d.data() }));
    });

    return students.sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
};

/**
 * KURIKULUM V2: Menambah TP baru dengan Audit Log
 */
export const addTemplate = async (templateData, teacherId) => {
    const docRef = await addDoc(collection(db, "assessment_templates"), {
        ...templateData,
        createdBy: teacherId,
        createdAt: serverTimestamp(),
        status: "active"
    });
    return docRef.id;
};

/**
 * KURIKULUM V2: Update TP dengan Audit Log
 */
export const updateTemplate = async (id, data, teacherId) => {
    const docRef = doc(db, "assessment_templates", id);
    await updateDoc(docRef, {
        ...data,
        updatedBy: teacherId,
        updatedAt: serverTimestamp()
    });
};

/**
 * KURIKULUM V2: Archive TP (Soft Delete sesuai Matrix V2)
 */
export const archiveTemplate = async (id, teacherId) => {
    const docRef = doc(db, "assessment_templates", id);
    await updateDoc(docRef, { 
        status: "archived", 
        updatedBy: teacherId,
        updatedAt: serverTimestamp() 
    });
};

/**
 * KURIKULUM V2: Hapus TP (Hanya OWNER yang boleh hard delete)
 */
export const deleteTemplatePermanently = async (id) => {
    const docRef = doc(db, "assessment_templates", id);
    await deleteDoc(docRef);
};

/**
 * KURIKULUM V2: Update Konfigurasi Mapel dengan Audit Log
 */
export const updateSubjectConfig = async (subjectId, config, teacherId) => {
    const docRef = doc(db, "subjects", subjectId);
    await updateDoc(docRef, {
        ...config,
        updatedBy: teacherId,
        updatedAt: serverTimestamp()
    });
};

/**
 * Melakukan sinkronisasi nilai kategori ke koleksi students setelah publish
 */
export const syncStudentGradesAfterPublish = async (subjectId, classId, academicYear) => {
    try {
        console.log(`[Sync] Starting grade sync for subjectId=${subjectId}, classId=${classId}, academicYear=${academicYear}`);
        
        // 1. Dapatkan detail mapel untuk mencocokkan nama
        const subjectDoc = await getDoc(doc(db, "subjects", subjectId));
        if (!subjectDoc.exists()) {
            console.error(`[Sync] Subject doc not found: ${subjectId}`);
            return;
        }
        const subjectName = subjectDoc.data().name;

        // 2. Dapatkan seluruh published assessments untuk filter ini
        const q = query(
            collection(db, "assessments"),
            where("subjectId", "==", subjectId),
            where("classId", "==", classId),
            where("academicYear", "==", academicYear),
            where("status", "==", "published")
        );
        const snap = await getDocs(q);
        const assessments = snap.docs.map(d => d.data());

        // 3. Dapatkan daftar siswa dalam kelas
        const students = await getStudentsInClass(classId);
        if (students.length === 0) return;

        // 4. Kalkulasi nilai rata-rata per kategori untuk setiap siswa
        for (const student of students) {
            const accum = {
                harian: { sum: 0, count: 0 },
                tugas: { sum: 0, count: 0 },
                uh: { sum: 0, count: 0 },
                pts: { sum: 0, count: 0 },
                pas: { sum: 0, count: 0 },
                pat: { sum: 0, count: 0 }
            };

            assessments.forEach(a => {
                const score = a.scores ? a.scores[student.id] : null;
                if (score !== undefined && score !== null) {
                    // Normalisasi jenis asesmen
                    let type = (a.assessmentType || '').toLowerCase();
                    if (type === 'kuis' || type === 'uh') type = 'uh';
                    else if (type === 'praktikum' || type === 'harian') type = 'harian';
                    else if (type === 'tugas') type = 'tugas';
                    else if (type === 'pas') type = 'pas';
                    else if (type === 'pat') type = 'pat';
                    
                    if (accum[type]) {
                        accum[type].sum += Number(score);
                        accum[type].count++;
                    }
                }
            });

            // Update subjek dalam array subjects siswa
            const updatedSubjects = (student.subjects || []).map(sub => {
                if (sub.name === subjectName) {
                    return {
                        ...sub,
                        score_harian: accum.harian.count > 0 ? Math.round(accum.harian.sum / accum.harian.count) : 0,
                        score_tugas: accum.tugas.count > 0 ? Math.round(accum.tugas.sum / accum.tugas.count) : 0,
                        score_uh: accum.uh.count > 0 ? Math.round(accum.uh.sum / accum.uh.count) : 0,
                        score_pts: accum.pts.count > 0 ? Math.round(accum.pts.sum / accum.pts.count) : 0,
                        score_pas: accum.pas.count > 0 ? Math.round(accum.pas.sum / accum.pas.count) : 0,
                        score_pat: accum.pat.count > 0 ? Math.round(accum.pat.sum / accum.pat.count) : 0,
                        last_updated_date: new Date().toLocaleDateString('id-ID'),
                        note: sub.note || ''
                    };
                }
                return sub;
            });

            // Simpan perubahan ke Firestore
            const studentRef = doc(db, "students", student.id);
            await updateDoc(studentRef, { subjects: updatedSubjects });
        }
        console.log(`[Sync] Grade sync completed successfully for ${students.length} students.`);
    } catch (e) {
        console.error("[Sync] Error in syncStudentGradesAfterPublish:", e);
    }
};
