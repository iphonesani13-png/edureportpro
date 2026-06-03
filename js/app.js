/**
 * SMPIT Tracker - Main Orchestrator
 * Refactored for SMPIT Laa Tahzan Citra
 */

import { auth, db } from "./modules/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { 
    parseDate, formatNama, escapeHtml, calculateCurrentKelas, getActiveTahun 
} from "./modules/utils.js";

import { 
    showCustomAlert, closeGlobalAlert, showLoading, hideLoading, switchTab, toggleModal 
} from "./modules/ui-manager.js";

import { 
    loginWithGoogle, logout as firebaseLogout, checkTeacherAuthorization, getUserProfile, saveUserProfile 
} from "./modules/auth-service.js";

import { 
    streamStudents, streamAssignments, streamSingleStudent, getStudentByNis, linkChildToParent, autoFixStudentData 
} from "./modules/student-data.js";

import { 
    updateDashboardSummary, renderTimeline, renderDashboardTable, renderLeaderboard, loadParentDashboard 
} from "./modules/render-functions.js";

import { 
    addAssignment, deleteAssignment, updateStudentBasicInfo, deleteStudent, handleCsvUpload 
} from "./modules/teacher-service.js";

import { 
    loadPartial, renderAppFragments, registerStudentTableEvents 
} from "./modules/page-loader.js";

// --- GLOBAL STATE ---
let state = {
    currentUser: null,
    currentRole: 'guru',
    studentsData: [],
    assignmentsData: [],
    currentStudentId: null,
    unsubscribeStudents: null,
    unsubscribeAssignments: null,
    subjectsList: ['Bahasa Indonesia', 'Wafa', 'Bahasa Inggris', 'IPA', 'Matematika', 'Seni Musik', 'Civil Society', 'Sport Class']
};

// --- AUTHENTICATION LOGIC ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        showLoading("Menyiapkan Dashboard...");
        try {
            let intentRole = localStorage.getItem('login_intent_role');
            let profile = await getUserProfile(user.uid);
            const isTeacherAuthorized = checkTeacherAuthorization(user.email);

            if (intentRole) {
                if (intentRole === 'guru' && !isTeacherAuthorized) {
                    await firebaseLogout();
                    localStorage.removeItem('login_intent_role');
                    hideLoading();
                    showCustomAlert(`Akses Ditolak!\nEmail ${user.email} tidak terdaftar sebagai Guru/Admin.`, true);
                    showLoginScreen();
                    return;
                }
                profile = { role: intentRole, email: user.email };
                await saveUserProfile(user.uid, profile);
                localStorage.removeItem('login_intent_role');
            } else if (!profile) {
                // Fallback if no profile and no intent
                showLoginScreen();
                return;
            }

            if (profile.role === 'guru' && !isTeacherAuthorized) {
                await firebaseLogout();
                hideLoading();
                showCustomAlert(`Akses Ditolak!\nEmail ${user.email} tidak terdaftar sebagai Guru/Admin.`, true);
                showLoginScreen();
                return;
            }

            setupUIForRole(profile.role, profile.childId);
        } catch (err) {
            console.error("Auth Error:", err);
            hideLoading();
            showCustomAlert("Terjadi kesalahan saat masuk. Silakan coba lagi.", true);
        }
    } else {
        showLoginScreen();
    }
});

// --- NAVIGATION & UI FLOW ---
function showLoginScreen() {
    hideLoading();
    document.getElementById('ortu-setup-screen')?.classList.add('hidden');
    document.getElementById('login-screen')?.classList.remove('hidden');
    document.getElementById('main-app')?.classList.add('hidden');
}

function setupUIForRole(role, childId) {
    state.currentRole = role;
    hideLoading();
    document.getElementById('login-screen')?.classList.add('hidden');
    document.getElementById('ortu-setup-screen')?.classList.add('hidden');
    document.getElementById('main-app')?.classList.add('hidden');

    const badge = document.getElementById('user-role-badge');
    if (badge) badge.innerText = role === 'guru' ? 'GURU / ADMIN' : 'ORANG TUA';

    if (role === 'guru') {
        document.getElementById('main-app')?.classList.remove('hidden');
        document.getElementById('nav-guru')?.classList.remove('hidden');
        document.getElementById('nav-ortu')?.classList.add('hidden');
        window.switchTab('dashboard');
        initRealtimeSync('guru');
    } else {
        if (childId) {
            document.getElementById('main-app')?.classList.remove('hidden');
            document.getElementById('nav-guru')?.classList.add('hidden');
            document.getElementById('nav-ortu')?.classList.remove('hidden');
            state.currentStudentId = childId;
            window.switchTab('viewer');
            initRealtimeSync('orangtua', childId);
        } else {
            document.getElementById('ortu-setup-screen')?.classList.remove('hidden');
        }
    }
}

// --- REALTIME SYNC ---
function initRealtimeSync(role, childId = null) {
    if (state.unsubscribeStudents) state.unsubscribeStudents();
    if (state.unsubscribeAssignments) state.unsubscribeAssignments();

    if (role === 'guru') {
        state.unsubscribeStudents = streamStudents((data) => {
            state.studentsData = data;
            syncSubjectsList();
            if (!document.getElementById('dashboard-section').classList.contains('hidden')) window.renderDashboard();
            if (!document.getElementById('leaderboard-section').classList.contains('hidden')) window.renderLeaderboard();
            if (!document.getElementById('editor-section').classList.contains('hidden') && state.currentStudentId) window.openStudentEditor(state.currentStudentId);
        });

        state.unsubscribeAssignments = streamAssignments((data) => {
            state.assignmentsData = data;
            if (!document.getElementById('tugas-section').classList.contains('hidden')) window.renderTugasGuru();
        });
    } else {
        state.unsubscribeStudents = streamSingleStudent(childId, (data) => {
            window.currentParentData = data;
            const ortuTahun = document.getElementById('ortu-filter-tahun');
            if (ortuTahun && !ortuTahun.value) ortuTahun.value = getActiveTahun();
            loadParentDashboard(data, state.assignmentsData, getActiveTahun());
        }, (err) => {
            console.error("Parent sync error:", err);
        });

        state.unsubscribeAssignments = streamAssignments((data) => {
            state.assignmentsData = data;
            if (window.currentParentData) loadParentDashboard(window.currentParentData, data, getActiveTahun());
        });
    }
}

function syncSubjectsList() {
    state.studentsData.forEach(st => {
        if (st.subjects) {
            st.subjects.forEach(sub => {
                if (!state.subjectsList.includes(sub.name)) {
                    state.subjectsList.push(sub.name);
                }
            });
        }
    });
}

// --- WINDOW GLOBALS (For HTML Calls) ---
window.setLoginRole = (role) => {
    state.currentRole = role;
    const btnGuru = document.getElementById('role-btn-guru');
    const btnOrtu = document.getElementById('role-btn-ortu');
    const activeClass = 'py-3 px-2 bg-white rounded-xl shadow-sm text-purple-700 font-bold transition-all flex flex-col items-center gap-1 text-xs border border-gray-200 ring-2 ring-purple-500 ring-offset-2';
    const inactiveClass = 'py-3 px-2 rounded-xl text-gray-500 font-bold transition-all flex flex-col items-center gap-1 text-xs hover:bg-gray-100 border border-transparent';
    
    if (btnGuru) btnGuru.className = role === 'guru' ? activeClass : inactiveClass;
    if (btnOrtu) btnOrtu.className = role === 'orangtua' ? activeClass.replace('purple', 'orange') : inactiveClass;
};

window.handleGoogleLogin = () => loginWithGoogle(state.currentRole);
window.logout = () => {
    if (state.unsubscribeStudents) state.unsubscribeStudents();
    if (state.unsubscribeAssignments) state.unsubscribeAssignments();
    firebaseLogout();
};

window.switchTab = (mode) => {
    switchTab(mode);
    if (mode === 'leaderboard') window.renderLeaderboard();
    if (mode === 'dashboard') window.renderDashboard();
    if (mode === 'tugas') window.renderTugasGuru();
};

window.renderDashboard = () => {
    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const filterKelas = document.getElementById('filter-kelas')?.value || 'ALL';
    const query = document.getElementById('filter-siswa-query')?.value?.toLowerCase() || '';

    let activeStudents = state.studentsData.map(st => ({
        ...st,
        calculatedKelas: calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun)
    }));

    let filtered = activeStudents.filter(st => st.calculatedKelas !== 'Lulus' && st.calculatedKelas !== 'Belum Masuk');
    if (filterKelas !== 'ALL') filtered = filtered.filter(st => st.calculatedKelas === filterKelas);
    if (query) filtered = filtered.filter(st => (st.docId || '').toLowerCase().includes(query) || (st.nama || '').toLowerCase().includes(query));

    filtered.sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
    updateDashboardSummary(filtered);
    renderDashboardTable(filtered, query, currentTahun);
};

window.renderLeaderboard = () => {
    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const selectedBulan = document.getElementById('leaderboard-bulan')?.value || 'ALL';
    renderLeaderboard(state.studentsData, currentTahun, selectedBulan);
};

window.renderTugasGuru = () => {
    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const list = document.getElementById('guru-tugas-list');
    if (!list) return;

    list.innerHTML = '';
    const filtered = state.assignmentsData
        .filter(t => t.tahun_ajaran === currentTahun)
        .sort((a, b) => new Date(b.tanggal_dibuat) - new Date(a.tanggal_dibuat));

    if (filtered.length === 0) {
        list.innerHTML = '<div class="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200"><p class="text-gray-400 font-bold text-sm">Belum ada tugas.</p></div>';
        return;
    }

    filtered.forEach(t => {
        const d = new Date(t.tenggat).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        list.insertAdjacentHTML('beforeend', `
            <div class="p-4 border border-gray-100 rounded-2xl flex justify-between items-center bg-white group shadow-sm">
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <span class="bg-purple-100 text-purple-700 text-[10px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest">${t.kelas === 'ALL' ? 'Semua Kelas' : 'Kelas ' + t.kelas}</span>
                        <span class="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest">${t.mapel}</span>
                    </div>
                    <h4 class="font-bold text-gray-900">${t.judul}</h4>
                    <p class="text-xs text-red-500 font-bold mt-1">Tenggat: ${d}</p>
                </div>
                <button onclick="window.hapusTugas('${t.id}')" class="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100">🗑️</button>
            </div>
        `);
    });
};

window.openStudentEditor = async (docId) => {
    const st = state.studentsData.find(s => s.docId === docId);
    if (!st) return;
    await autoFixStudentData(st, state.subjectsList);
    state.currentStudentId = docId;
    
    // UI logic for setting up editor values...
    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const calculatedKelas = calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun);
    
    document.getElementById('editor-title').innerText = formatNama(st.nama);
    document.getElementById('editor-nis').innerText = `ID / NIS: ${st.docId}`;
    document.getElementById('editor-badge-kelas').innerText = `KELAS ${calculatedKelas}`;
    document.getElementById('guru-view-poin').innerText = st.poin || 0;

    const grid = document.getElementById('subjects-grid');
    grid.innerHTML = '';
    st.subjects.forEach((sub, idx) => {
        grid.insertAdjacentHTML('beforeend', `
            <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-purple-200 transition-colors">
                <div class="flex justify-between items-center mb-3">
                    <h4 class="font-bold text-gray-800 text-sm">${sub.name}</h4>
                    <span class="text-[9px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md">${sub.last_updated_date ? 'Update: ' + sub.last_updated_date : 'Belum Dinilai'}</span>
                </div>
                <div class="grid grid-cols-4 gap-2 mb-3">
                    ${['harian', 'uh', 'pts', 'pas'].map(type => `
                        <div>
                            <p class="text-[9px] font-bold text-gray-500 uppercase text-center mb-1">${type === 'uh' ? 'Mingguan' : type.toUpperCase()}</p>
                            <input type="number" value="${sub[`score_${type}`] || 0}" onchange="window.updateSubjectScore(${idx}, '${type}', this.value)" class="w-full p-1.5 text-center font-black text-purple-700 bg-purple-50 border-none rounded-lg text-xs">
                        </div>
                    `).join('')}
                </div>
                <input type="text" value="${sub.note || ''}" onchange="window.updateSubjectNote(${idx}, this.value)" placeholder="Catatan..." class="w-full p-2.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-xl border-none">
            </div>
        `);
    });
    window.switchTab('editor');
    window.applyTimelineFilter('guru');
};

// ... More globals for actions (save, delete, etc.) ...
window.closeGlobalAlert = closeGlobalAlert;
window.applyTimelineFilter = (role) => {
    const st = role === 'guru' ? state.studentsData.find(s => s.docId === state.currentStudentId) : window.currentParentData;
    if (!st) return;
    const filterVal = document.getElementById(role === 'guru' ? 'guru-timeline-filter' : 'ortu-timeline-filter')?.value || 'ALL';
    // Logic for timeline filtering...
    renderTimeline(st.point_history || [], role === 'guru' ? 'guru-timeline' : 'parent-timeline');
};

// --- TEACHER ACTIONS ---
window.hapusSiswa = (docId) => {
    const st = state.studentsData.find(s => s.docId === docId);
    state.currentStudentId = docId;
    document.getElementById('delete-student-name').innerText = st ? formatNama(st.nama) : docId;
    toggleModal('delete-modal', true);
};

window.konfirmasiHapus = async () => {
    showLoading("Menghapus Data...");
    try {
        await deleteStudent(state.currentStudentId);
        toggleModal('delete-modal', false);
    } catch (err) {
        showCustomAlert("Gagal menghapus.", true);
    }
    hideLoading();
};

window.tambahTugas = async () => {
    const data = {
        mapel: document.getElementById('tugas-mapel').value,
        kelas: document.getElementById('tugas-kelas').value,
        judul: document.getElementById('tugas-judul').value,
        tenggat: document.getElementById('tugas-tenggat').value,
        tahun_ajaran: document.getElementById('filter-tahun').value
    };
    if (!data.judul || !data.tenggat) return showCustomAlert("Lengkapi data tugas!", true);
    showLoading("Menyebarkan Tugas...");
    await addAssignment(data);
    document.getElementById('tugas-judul').value = '';
    hideLoading();
};

window.hapusTugas = (id) => {
    state.currentTaskId = id;
    toggleModal('delete-task-modal', true);
};

window.konfirmasiHapusTugas = async () => {
    showLoading("Menghapus Tugas...");
    await deleteAssignment(state.currentTaskId);
    toggleModal('delete-task-modal', false);
    hideLoading();
};

window.updateSubjectScore = (idx, type, val) => {
    const st = state.studentsData.find(s => s.docId === state.currentStudentId);
    const score = parseInt(val) || 0;
    if (st.subjects[idx][`score_${type}`] === score) return;
    
    st.subjects[idx][`score_${type}`] = score;
    st.subjects[idx].last_updated_date = new Date().toLocaleDateString('id-ID');
    
    const newEvent = {
        id: Date.now(),
        date: st.subjects[idx].last_updated_date,
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        category: 'Akademik',
        desc: `Nilai ${type.toUpperCase()} ${st.subjects[idx].name} diperbarui: ${score}`,
        pointChange: 0,
        icon: '📚'
    };
    st.point_history.unshift(newEvent);
    setDoc(doc(db, 'students', state.currentStudentId), st);
};

window.handleFileUpload = (e) => {
    showLoading("Mengimpor CSV...");
    handleCsvUpload(e.target.files[0], getActiveTahun(), state.subjectsList)
        .then(({newCount, updateCount}) => {
            showCustomAlert(`Berhasil! ${newCount} baru, ${updateCount} diperbarui.`, false);
        })
        .catch(() => showCustomAlert("Gagal impor.", true))
        .finally(() => {
            hideLoading();
            e.target.value = '';
        });
};

// --- ORANG TUA ACTIONS ---
window.verifyAndLinkStudent = async () => {
    const nis = document.getElementById('ortu-input-nis').value.trim();
    if (!nis) return showCustomAlert("Masukkan NIS!", true);
    showLoading("Mencari Data...");
    const snap = await getStudentByNis(nis);
    if (snap.exists()) {
        await linkChildToParent(auth.currentUser.uid, nis);
        setupUIForRole('orangtua', nis);
    } else {
        showCustomAlert("NIS tidak ditemukan.", true);
    }
    hideLoading();
};

// --- INITIALIZATION ---
const initApp = async () => {
    try {
        await renderAppFragments();
        const tahunSelect = document.getElementById('filter-tahun');
        if (tahunSelect) {
            tahunSelect.value = getActiveTahun();
            tahunSelect.addEventListener('change', (e) => {
                localStorage.setItem('tahun_ajaran', e.target.value);
                window.renderDashboard();
            });
        }
        registerStudentTableEvents();
    } catch (err) {
        console.error('Init Error:', err);
    }
};

initApp();
