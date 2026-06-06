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
    if (mode === 'kurikulum') window.renderKurikulum();
};

window.renderKurikulum = () => {
    // Default sub-tab jika baru dibuka
    const content = document.getElementById('kurikulum-content');
    if (content && content.innerHTML.includes('Pilih Menu')) {
        window.switchKurikulumTab('mapel');
    }
};

window.switchKurikulumTab = (tab) => {
    // Update active state di nav internal
    document.querySelectorAll('.kurikulum-nav-item').forEach(btn => {
        btn.classList.remove('active', 'bg-indigo-600', 'text-white');
        btn.classList.add('bg-white', 'text-slate-900');
    });

    const activeBtn = Array.from(document.querySelectorAll('.kurikulum-nav-item')).find(btn => btn.getAttribute('onclick').includes(tab));
    if (activeBtn) {
        activeBtn.classList.add('active', 'bg-indigo-600', 'text-white');
        activeBtn.classList.remove('bg-white', 'text-slate-900');
    }

    renderKurikulumContent(tab);
};

function renderKurikulumContent(tab) {
    const container = document.getElementById('kurikulum-content');
    if (!container) return;

    if (tab === 'mapel') {
        container.innerHTML = `
            <h3 class="text-lg font-black text-slate-900 mb-6 uppercase tracking-tight">Daftar Mata Pelajaran</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${state.subjectsList.map(sub => `
                    <div class="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex justify-between items-center group">
                        <span class="font-bold text-slate-700 text-sm">${sub}</span>
                        <button onclick="window.hapusMapel('${sub}')" class="text-rose-500 opacity-0 group-hover:opacity-100 transition-all text-xs font-bold px-2 py-1 hover:bg-rose-50 rounded-lg">Hapus</button>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        const typeLabel = tab === 'nilai-harian' ? 'Harian' : (tab === 'nilai-uh' ? 'UH' : 'PAS');
        const typeKey = tab === 'nilai-harian' ? 'harian' : (tab === 'nilai-uh' ? 'uh' : 'pas');

        container.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <h3 class="text-lg font-black text-slate-900 uppercase tracking-tight">Input Nilai ${typeLabel}</h3>
                <div class="flex gap-2 w-full sm:w-auto">
                    <select id="kurikulum-filter-kelas" onchange="window.refreshInputNilai('${tab}')" class="flex-grow sm:flex-grow-0 px-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold focus:ring-1 focus:ring-indigo-500">
                        <option value="7A">Kelas 7A</option><option value="7B">Kelas 7B</option>
                        <option value="8">Kelas 8</option><option value="9">Kelas 9</option>
                    </select>
                    <select id="kurikulum-filter-mapel" onchange="window.refreshInputNilai('${tab}')" class="flex-grow sm:flex-grow-0 px-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold focus:ring-1 focus:ring-indigo-500">
                        ${state.subjectsList.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                </div>
            </div>
            
            <div class="overflow-x-auto">
                <table class="w-full text-left whitespace-nowrap">
                    <thead>
                        <tr class="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                            <th class="py-4 px-2 w-12 text-center">No</th>
                            <th class="py-4 px-4">Nama Siswa</th>
                            <th class="py-4 px-4 text-center w-32">Nilai ${typeLabel}</th>
                        </tr>
                    </thead>
                    <tbody id="input-nilai-body" class="divide-y divide-slate-50">
                        <!-- Siswa akan dimuat di sini -->
                    </tbody>
                </table>
            </div>
        `;
        window.refreshInputNilai(tab);
    }
}

window.refreshInputNilai = (tab) => {
    const typeKey = tab === 'nilai-harian' ? 'harian' : (tab === 'nilai-uh' ? 'uh' : 'pas');
    const selectedKelas = document.getElementById('kurikulum-filter-kelas')?.value;
    const selectedMapel = document.getElementById('kurikulum-filter-mapel')?.value;
    const body = document.getElementById('input-nilai-body');
    if (!body || !selectedKelas || !selectedMapel) return;

    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const filteredSiswa = state.studentsData.filter(st => {
        const calculatedKelas = calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun);
        return calculatedKelas === selectedKelas;
    }).sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));

    body.innerHTML = '';
    if (filteredSiswa.length === 0) {
        body.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-slate-400 font-bold text-xs italic">Tidak ada siswa di kelas ini.</td></tr>`;
        return;
    }

    filteredSiswa.forEach((st, idx) => {
        const sub = (st.subjects || []).find(s => s.name === selectedMapel) || { [`score_${typeKey}`]: 0 };
        const val = sub[`score_${typeKey}`] || 0;
        
        body.insertAdjacentHTML('beforeend', `
            <tr class="hover:bg-slate-50/50 transition-all">
                <td class="py-4 px-2 text-center text-slate-400 font-bold text-xs">${idx + 1}</td>
                <td class="py-4 px-4 font-bold text-slate-700 text-sm">${formatNama(st.nama)}</td>
                <td class="py-4 px-4">
                    <input type="number" value="${val}" 
                        onchange="window.updateBulkScore('${st.docId}', '${selectedMapel}', '${typeKey}', this.value)"
                        class="w-20 mx-auto block p-2 text-center font-black text-indigo-600 bg-indigo-50/50 border-none rounded-xl text-sm focus:ring-1 focus:ring-indigo-500">
                </td>
            </tr>
        `);
    });
};

window.updateBulkScore = (studentId, mapel, type, val) => {
    const st = state.studentsData.find(s => s.docId === studentId);
    if (!st) return;
    
    // Pastikan array subjects ada
    if (!st.subjects) st.subjects = [];
    
    let sub = st.subjects.find(s => s.name === mapel);
    if (!sub) {
        sub = { name: mapel };
        st.subjects.push(sub);
    }
    
    sub[`score_${type}`] = parseInt(val) || 0;
    sub.last_updated_date = new Date().toLocaleDateString('id-ID');
    
    setDoc(doc(db, 'students', studentId), st)
        .then(() => {
            console.log(`Saved score for ${studentId} - ${mapel} - ${type}`);
        })
        .catch(err => {
            console.error("Error saving score:", err);
            showCustomAlert("Gagal menyimpan nilai.", true);
        });
};

window.konfirmasiTambahMapel = async () => {
    const nama = document.getElementById('input-mapel-baru')?.value.trim();
    if (!nama) return showCustomAlert("Nama mapel tidak boleh kosong!", true);
    
    if (state.subjectsList.includes(nama)) return showCustomAlert("Mapel sudah ada!", true);
    
    showLoading("Menambahkan Mapel...");
    state.subjectsList.push(nama);
    
    // Tambahkan mapel ke seluruh siswa (optional, bisa lewat autoFix nantinya)
    // Untuk saat ini biarkan sync yang handle atau user fix manual
    
    toggleModal('tambah-mapel-modal', false);
    document.getElementById('input-mapel-baru').value = '';
    renderKurikulumContent('mapel');
    hideLoading();
    showCustomAlert("Mata pelajaran berhasil ditambahkan.");
};

window.hapusMapel = (nama) => {
    if (confirm(`Yakin ingin menghapus mata pelajaran ${nama}? Nilai siswa untuk mapel ini akan tetap ada di database tapi tidak muncul di daftar ini.`)) {
        state.subjectsList = state.subjectsList.filter(s => s !== nama);
        renderKurikulumContent('mapel');
    }
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

window.bukaEditSiswa = (docId) => {
    const st = state.studentsData.find(s => s.docId === docId);
    if (!st) return;
    state.currentStudentId = docId;
    document.getElementById('edit-nis-input').value = st.docId;
    document.getElementById('edit-nama-input').value = st.nama;
    document.getElementById('edit-kelas-input').value = st.kelas;
    toggleModal('edit-modal', true);
};

window.konfirmasiEdit = async () => {
    const nama = document.getElementById('edit-nama-input').value;
    const kelas = document.getElementById('edit-kelas-input').value;
    if (!nama || !kelas) return showCustomAlert("Lengkapi data!", true);
    
    showLoading("Menyimpan...");
    try {
        await updateStudentBasicInfo(state.currentStudentId, { nama, kelas });
        toggleModal('edit-modal', false);
        showCustomAlert("Berhasil diperbarui.");
    } catch (err) {
        showCustomAlert("Gagal.", true);
    }
    hideLoading();
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
    toggleModal('tambah-tugas-modal', false);
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

// --- MODAL HELPERS ---
window.batalHapus = () => toggleModal('delete-modal', false);
window.batalHapusSemua = () => toggleModal('delete-all-modal', false);
window.batalHapusTugas = () => toggleModal('delete-task-modal', false);
window.batalTambahMapel = () => toggleModal('tambah-mapel-modal', false);
window.batalEdit = () => toggleModal('edit-modal', false);

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
