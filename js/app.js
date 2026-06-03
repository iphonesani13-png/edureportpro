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
    showCustomAlert, closeGlobalAlert, showLoading, hideLoading, switchTab as uiSwitchTab, toggleModal 
} from "./modules/ui-manager.js";

import { 
    loginWithGoogle, logout as firebaseLogout, checkTeacherAuthorization, getUserProfile, saveUserProfile 
} from "./modules/auth-service.js";

import { 
    streamStudents, streamAssignments, streamSingleStudent, getStudentByNis, linkChildToParent, autoFixStudentData 
} from "./modules/student-data.js";

import { 
    updateDashboardSummary, renderTimeline, renderDashboardTable, renderLeaderboard as uiRenderLeaderboard, loadParentDashboard 
} from "./modules/render-functions.js";

import { 
    addAssignment, deleteAssignment, updateStudentBasicInfo, deleteStudent, handleCsvUpload 
} from "./modules/teacher-service.js";

import { 
    renderAppFragments, registerStudentTableEvents 
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
const startAuthListener = () => {
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
                showLoginScreen();
            }
        } else {
            showLoginScreen();
        }
    });
};

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
    document.getElementById('main-app')?.classList.remove('hidden');

    const badge = document.getElementById('user-role-badge');
    if (badge) badge.innerText = role === 'guru' ? 'GURU / ADMIN' : 'ORANG TUA';

    if (role === 'guru') {
        document.getElementById('nav-guru')?.classList.remove('hidden');
        document.getElementById('nav-ortu')?.classList.add('hidden');
        window.switchTab('dashboard');
        initRealtimeSync('guru');
    } else {
        if (childId) {
            document.getElementById('nav-guru')?.classList.add('hidden');
            document.getElementById('nav-ortu')?.classList.remove('hidden');
            state.currentStudentId = childId;
            window.switchTab('viewer');
            initRealtimeSync('orangtua', childId);
        } else {
            document.getElementById('main-app')?.classList.add('hidden');
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
            if (!document.getElementById('dashboard-section')?.classList.contains('hidden')) window.renderDashboard();
            if (!document.getElementById('leaderboard-section')?.classList.contains('hidden')) window.renderLeaderboard();
            if (!document.getElementById('editor-section')?.classList.contains('hidden') && state.currentStudentId) window.openStudentEditor(state.currentStudentId);
        });

        state.unsubscribeAssignments = streamAssignments((data) => {
            state.assignmentsData = data;
            if (!document.getElementById('tugas-section')?.classList.contains('hidden')) window.renderTugasGuru();
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

// --- WINDOW GLOBALS ---
window.setLoginRole = (role) => {
    state.currentRole = role;
    const btnGuru = document.getElementById('role-btn-guru');
    const btnOrtu = document.getElementById('role-btn-ortu');
    
    // Premium Role Switch Animation Logic
    const activeClasses = ['active', 'border-indigo-600', 'bg-indigo-50/30', 'text-indigo-600'];
    const inactiveClasses = ['text-slate-400', 'border-slate-100'];

    if (role === 'guru') {
        btnGuru.classList.add(...activeClasses);
        btnGuru.classList.remove(...inactiveClasses);
        btnOrtu.classList.remove(...activeClasses);
        btnOrtu.classList.add(...inactiveClasses);
    } else {
        btnOrtu.classList.add(...activeClasses);
        btnOrtu.classList.remove(...inactiveClasses);
        btnGuru.classList.remove(...activeClasses);
        btnGuru.classList.add(...inactiveClasses);
    }
};

window.handleGoogleLogin = () => loginWithGoogle(state.currentRole);
window.logout = () => {
    if (state.unsubscribeStudents) state.unsubscribeStudents();
    if (state.unsubscribeAssignments) state.unsubscribeAssignments();
    firebaseLogout();
};

window.switchTab = (mode) => {
    uiSwitchTab(mode);
    // Update Sidebar Active State
    document.querySelectorAll('.sidebar-item').forEach(p => p.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-${mode}`);
    if (activeBtn) activeBtn.classList.add('active');

    if (mode === 'leaderboard') window.renderLeaderboard();
    if (mode === 'dashboard') window.renderDashboard();
    if (mode === 'tugas') window.renderTugasGuru();
};

window.renderDashboard = () => {
    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const filterKelas = document.getElementById('filter-kelas')?.value || 'ALL';
    const query = document.getElementById('filter-siswa-query')?.value?.toLowerCase() || '';

    let filtered = state.studentsData.map(st => ({
        ...st,
        calculatedKelas: calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun)
    })).filter(st => st.calculatedKelas !== 'Lulus' && st.calculatedKelas !== 'Belum Masuk');

    if (filterKelas !== 'ALL') filtered = filtered.filter(st => st.calculatedKelas === filterKelas);
    if (query) filtered = filtered.filter(st => (st.docId || '').toLowerCase().includes(query) || (st.nama || '').toLowerCase().includes(query));

    filtered.sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
    updateDashboardSummary(filtered);
    renderDashboardTable(filtered, query, currentTahun);
};

window.renderLeaderboard = () => {
    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const selectedBulan = document.getElementById('leaderboard-bulan')?.value || 'ALL';
    uiRenderLeaderboard(state.studentsData, currentTahun, selectedBulan);
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
        list.innerHTML = '<div class="text-center py-10 bg-slate-50 rounded-3xl border border-dashed border-slate-200"><p class="text-slate-400 font-bold text-sm">Belum ada tugas aktif.</p></div>';
        return;
    }

    filtered.forEach(t => {
        const d = new Date(t.tenggat).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        list.insertAdjacentHTML('beforeend', `
            <div class="p-6 bg-white border border-slate-100 rounded-3xl flex justify-between items-center shadow-sm group">
                <div>
                    <div class="flex items-center gap-2 mb-2">
                        <span class="bg-[#F5E6C8] text-[#1B6B3A] text-[9px] px-3 py-1 rounded-full font-black uppercase tracking-widest">${t.kelas === 'ALL' ? 'Semua Kelas' : 'Kelas ' + t.kelas}</span>
                        <span class="bg-slate-100 text-slate-600 text-[9px] px-3 py-1 rounded-full font-black uppercase tracking-widest">${t.mapel}</span>
                    </div>
                    <h4 class="font-black text-[#1A2F1E]">${t.judul}</h4>
                    <p class="text-[10px] text-rose-500 font-black mt-1 uppercase tracking-widest">Tenggat: ${d}</p>
                </div>
                <button onclick="window.hapusTugas('${t.id}')" class="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 shadow-lg">🗑️</button>
            </div>
        `);
    });
};

window.openStudentEditor = async (docId) => {
    const st = state.studentsData.find(s => s.docId === docId);
    if (!st) return;
    await autoFixStudentData(st, state.subjectsList);
    state.currentStudentId = docId;
    
    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const calculatedKelas = calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun);
    
    document.getElementById('editor-title').innerText = formatNama(st.nama);
    document.getElementById('editor-nis').innerText = `IDENTITAS: ${st.docId}`;
    document.getElementById('editor-badge-kelas').innerText = `KELAS ${calculatedKelas}`;
    document.getElementById('guru-view-poin').innerText = st.poin || 0;

    const grid = document.getElementById('subjects-grid');
    if (grid) {
        grid.innerHTML = '';
        st.subjects.forEach((sub, idx) => {
            grid.insertAdjacentHTML('beforeend', `
                <div class="glass-card p-6 space-y-4">
                    <div class="flex justify-between items-center">
                        <h4 class="font-black text-[#1A2F1E] text-xs uppercase tracking-widest">${sub.name}</h4>
                        <span class="text-[8px] font-black text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">${sub.last_updated_date ? 'UPDATE: ' + sub.last_updated_date : 'BELUM DINILAI'}</span>
                    </div>
                    <div class="grid grid-cols-4 gap-2">
                        ${['harian', 'uh', 'pts', 'pas'].map(type => `
                            <div class="text-center">
                                <p class="text-[8px] font-black text-slate-400 uppercase mb-1">${type === 'uh' ? 'UH' : type.toUpperCase()}</p>
                                <input type="number" value="${sub[`score_${type}`] || 0}" onchange="window.updateSubjectScore(${idx}, '${type}', this.value)" class="w-full p-2 text-center font-black text-[#1B6B3A] bg-[#FBF7F0] border-none rounded-xl text-xs focus:ring-1 focus:ring-[#C9A84C]">
                            </div>
                        `).join('')}
                    </div>
                    <input type="text" value="${sub.note || ''}" onchange="window.updateSubjectNote(${idx}, this.value)" placeholder="Catatan..." class="w-full p-3 text-[10px] font-bold text-slate-600 bg-slate-50 rounded-xl border-none focus:ring-1 focus:ring-[#1B6B3A]">
                </div>
            `);
        } );
    }
    window.switchTab('editor');
    window.applyTimelineFilter('guru');
};

window.hapusSiswa = (docId) => {
    const st = state.studentsData.find(s => s.docId === docId);
    state.currentStudentId = docId;
    const el = document.getElementById('delete-student-name');
    if (el) el.innerText = st ? formatNama(st.nama) : docId;
    toggleModal('delete-modal', true);
};

window.konfirmasiHapus = async () => {
    showLoading("Menghapus...");
    try { await deleteStudent(state.currentStudentId); toggleModal('delete-modal', false); } 
    catch (err) { showCustomAlert("Gagal.", true); }
    hideLoading();
};

window.tambahTugas = async () => {
    const data = {
        mapel: document.getElementById('tugas-mapel')?.value,
        kelas: document.getElementById('tugas-kelas')?.value,
        judul: document.getElementById('tugas-judul')?.value,
        tenggat: document.getElementById('tugas-tenggat')?.value,
        tahun_ajaran: document.getElementById('filter-tahun')?.value
    };
    if (!data.judul || !data.tenggat) return showCustomAlert("Lengkapi data!", true);
    showLoading("Menyebarkan...");
    await addAssignment(data);
    const input = document.getElementById('tugas-judul');
    if (input) input.value = '';
    hideLoading();
};

window.hapusTugas = (id) => {
    state.currentTaskId = id;
    toggleModal('delete-task-modal', true);
};

window.konfirmasiHapusTugas = async () => {
    showLoading("Menghapus...");
    await deleteAssignment(state.currentTaskId);
    toggleModal('delete-task-modal', false);
    hideLoading();
};

window.updateSubjectScore = (idx, type, val) => {
    const st = state.studentsData.find(s => s.docId === state.currentStudentId);
    const score = parseInt(val) || 0;
    st.subjects[idx][`score_${type}`] = score;
    st.subjects[idx].last_updated_date = new Date().toLocaleDateString('id-ID');
    setDoc(doc(db, 'students', state.currentStudentId), st);
};

window.updateSubjectNote = (idx, val) => {
    const st = state.studentsData.find(s => s.docId === state.currentStudentId);
    st.subjects[idx].note = val;
    st.subjects[idx].last_updated_date = new Date().toLocaleDateString('id-ID');
    setDoc(doc(db, 'students', state.currentStudentId), st);
};

window.quickTrackEvent = (category, desc, pointVal, icon) => {
    const st = state.studentsData.find(s => s.docId === state.currentStudentId);
    const newEvent = {
        id: Date.now(),
        date: new Date().toLocaleDateString('id-ID'),
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        category, desc, pointChange: pointVal, icon
    };
    st.point_history.unshift(newEvent);
    st.poin = (st.poin || 0) + pointVal;
    setDoc(doc(db, 'students', state.currentStudentId), st);
};

window.tambahTransaksiPoin = () => {
    const jenis = document.getElementById('poin-jenis')?.value;
    const angka = parseInt(document.getElementById('poin-angka')?.value) || 0;
    const catatan = document.getElementById('poin-catatan')?.value;
    if (!angka || !catatan) return showCustomAlert("Lengkapi data!", true);
    const val = jenis === 'plus' ? angka : -angka;
    window.quickTrackEvent('Evaluasi', catatan, val, jenis === 'plus' ? '⭐' : '⚠️');
};

window.handleFileUpload = (e) => {
    showLoading("Mengimpor...");
    handleCsvUpload(e.target.files[0], getActiveTahun(), state.subjectsList)
        .then(({newCount, updateCount}) => showCustomAlert(`Berhasil! ${newCount} baru, ${updateCount} update.`))
        .finally(() => { hideLoading(); e.target.value = ''; });
};

window.verifyAndLinkStudent = async () => {
    const nis = document.getElementById('ortu-input-nis')?.value.trim();
    if (!nis) return showCustomAlert("Masukkan NIS!", true);
    showLoading("Mencari...");
    const snap = await getStudentByNis(nis);
    if (snap.exists()) {
        await linkChildToParent(auth.currentUser.uid, nis);
        setupUIForRole('orangtua', nis);
    } else {
        showCustomAlert("NIS tidak ditemukan.", true);
    }
    hideLoading();
};

window.applyTimelineFilter = (role) => {
    const st = role === 'guru' ? state.studentsData.find(s => s.docId === state.currentStudentId) : window.currentParentData;
    if (!st) return;
    renderTimeline(st.point_history || [], role === 'guru' ? 'guru-timeline' : 'parent-timeline');
};

window.closeGlobalAlert = closeGlobalAlert;

// --- INITIALIZATION ---
const initApp = async () => {
    try {
        console.log("System: Rendering fragments...");
        await renderAppFragments();
        
        console.log("System: Fragments ready. Starting Auth...");
        const tahunSelect = document.getElementById('filter-tahun');
        if (tahunSelect) {
            tahunSelect.value = getActiveTahun();
            tahunSelect.addEventListener('change', (e) => {
                localStorage.setItem('tahun_ajaran', e.target.value);
                window.renderDashboard();
            });
        }
        registerStudentTableEvents();
        startAuthListener(); // <--- SEKARANG DIA SABAR MENUNGGU
        
    } catch (err) {
        console.error('Init Error:', err);
    }
};

initApp();
