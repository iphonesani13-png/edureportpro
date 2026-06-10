import { db } from "./firebase-config.js";
import { 
    doc, setDoc, deleteDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { formatNama } from "./utils.js";
import { showCustomAlert, showLoading, hideLoading } from "./ui-manager.js";

export const addAssignment = async (data) => {
    const newId = 'TGS' + Date.now();
    return await setDoc(doc(db, 'assignments', newId), {
        id: newId,
        ...data,
        tanggal_dibuat: new Date().toISOString()
    });
};

export const deleteAssignment = async (id) => {
    return await deleteDoc(doc(db, 'assignments', id));
};

export const updateStudentBasicInfo = async (id, data) => {
    return await setDoc(doc(db, 'students', id), data, { merge: true });
};

export const deleteStudent = async (id) => {
    return await deleteDoc(doc(db, 'students', id));
};

export const handleCsvUpload = async (file, currentTahun, subjectsList) => {
    const text = await file.text();
    const rows = text.replace(/\r/g, '').split('\n');
    let newCount = 0;
    let updateCount = 0;

    for (let i = 0; i < rows.length; i++) {
        const cols = rows[i].split(',');
        if (cols.length >= 2 && cols[0].trim().length > 0) {
            const id = cols[0].trim();
            const name = formatNama(cols[1].trim());
            const kelas = (cols[2] && cols[2].trim() !== "" ? cols[2].trim() : "7");

            const studentRef = doc(db, 'students', id);
            const snap = await getDoc(studentRef);

            if (snap.exists()) {
                await setDoc(studentRef, { nama: name, base_kelas: kelas, base_tahun: currentTahun, kelas: kelas }, { merge: true });
                updateCount++;
            } else {
                const data = {
                    nama: name,
                    base_kelas: kelas,
                    base_tahun: currentTahun,
                    kelas: kelas,
                    poin: 0,
                    point_history: [],
                    subjects: subjectsList.map(name => ({ 
                        name: name, score_harian: 0, score_tugas: 0, score_uh: 0, score_pts: 0, score_pas: 0, score_pat: 0, 
                        note: '', last_updated_date: '' 
                    }))
                };
                await setDoc(studentRef, data);
                newCount++;
            }
        }
    }
    return { newCount, updateCount };
};
