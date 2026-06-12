/**
 * SMPIT Tracker - Main Orchestrator
 * Refactored for SMPIT Laa Tahzan Citra
 */

import { auth, db } from "./modules/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, collection, query, where, getDocs, getDoc, deleteDoc, runTransaction, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import {
    parseDate, formatNama, escapeHtml, calculateCurrentKelas, getActiveTahun
} from "./modules/utils.js";

import {
    showCustomAlert, closeGlobalAlert, showLoading, hideLoading, switchTab as uiSwitchTab, toggleModal
} from "./modules/ui-manager.js";

import {
    loginWithGoogle, logout as firebaseLogout, getUserProfile, saveUserProfile, checkAuthorizedEmail, registerPendingUser, ROLES, addAuditLog
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

import * as AssessmentService from "./modules/assessment-service.js";

// --- GLOBAL STATE ---
let state = {
    currentUser: null,
    currentRole: ROLES.GURU,
    studentsData: [],
    assignmentsData: [],
    currentStudentId: null,
    previousTab: 'dashboard',
    unsubscribeStudents: null,
    unsubscribeAssignments: null,
    subjectsList: ['Bahasa Indonesia', 'Wafa', 'Bahasa Inggris', 'IPA', 'Matematika', 'Seni Musik', 'Civil Society', 'Sport Class'],
    nhState: {
        activeMode: 'input', // 'input' or 'rekap'
        activeTemplate: null,
        activeAssessment: null,
        currentClassStudents: [],
        tempScores: {},
        tempNotes: {},
        // Caching for Rekap
        rekapBaseData: {
            assessments: [],
            passingGrade: 75
        },
        rekapComputedScores: {},
        selectedTemplateId: null,
        // KURIKULUM V2 Workspace
        currentSubjectId: null,
        currentWorkspaceTab: 'tp', // cp, tp, atp, kkm
        allTemplates: [] // Global cache for readiness check
    },
    usState: {
        currentAssessmentId: null,
        students: [],
        tempScores: {}
    }
};

// --- AUTHENTICATION LOGIC ---
const startAuthListener = () => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("AUTH_STEP_1: User Authenticated", user.email);
            showLoading("Menyiapkan Sesi...");
            try {
                let intentRole = (localStorage.getItem('login_intent_role') || '').toUpperCase();
                if (intentRole === 'ORANGTUA') intentRole = ROLES.ORANG_TUA; // Map legacy cached intent

                let profile = await getUserProfile(user.uid);
                console.log("AUTH_STEP_2: Profile Resolved", profile?.role);

                // 1. FIRST TIME LOGIN (REGISTRATION)
                if (!profile) {
                    if (intentRole === ROLES.ORANG_TUA) {
                        // Parents register with NIS later, save basic profile now
                        profile = await registerPendingUser(user.uid, {
                            email: user.email,
                            name: user.displayName,
                            role: ROLES.ORANG_TUA,
                            status: 'active' // Parents are active by default once they login? 
                        });
                        // Or keep as active but stuck at NIS screen
                    } else {
                        // Teachers/Admins: Check database authorization
                        const authCheck = await checkAuthorizedEmail(user.email);
                        if (authCheck.authorized) {
                            // PRE-APPROVED FLOW
                            const existingProfile = await getUserProfile(user.uid);

                            if (!existingProfile) {
                                // Create new profile (allowed by 'create' rule)
                                profile = {
                                    uid: user.uid,
                                    email: user.email,
                                    name: user.displayName,
                                    role: authCheck.role || 'GURU',
                                    status: 'active',
                                    managedSubjects: authCheck.managedSubjects || [],
                                    managedClasses: authCheck.managedClasses || []
                                };
                                await saveUserProfile(user.uid, profile);
                            } else {
                                // Profile exists: Only update safe metadata to avoid PERMISSION_DENIED
                                await saveUserProfile(user.uid, {
                                    name: user.displayName
                                });
                                profile = existingProfile; // Use DB data for state
                            }
                        } else {
                            // Not pre-approved: Register as PENDING
                            profile = await registerPendingUser(user.uid, {
                                email: user.email,
                                name: user.displayName,
                                role: 'GURU'
                            });
                        }
                    }
                    localStorage.removeItem('login_intent_role');
                }

                // 2. CHECK STATUS (PENDING/BLOCKED)
                if (profile.status === 'pending') {
                    hideLoading();
                    return showPendingScreen();
                }
                if (profile.status === 'blocked') {
                    await firebaseLogout();
                    hideLoading();
                    showCustomAlert("Akses Anda telah ditangguhkan. Silakan hubungi Admin.", true);
                    return showLoginScreen();
                }

                // 3. OWNER/ADMIN SPECIAL TRIGGER (Migration/Seed)
                // DISABLED: Migration is complete. Re-enable only if a new global schema change is needed.
                /*
                const isOwner = user.email === 'rizkialbatamy@gmail.com';
                const isAdmin = user.email === 'iphonesani13@gmail.com' || profile.role === 'SUPER_ADMIN' || profile.role === 'OWNER';

                if (isOwner || isAdmin) {
                    console.log("🛠️ Admin/Owner detected. Skipping database sync to maintain clean console...");
                    // try {
                    //     const { seedDatabase } = await import("./seed-script.js");
                    //     await seedDatabase(user.uid);
                    // } catch (e) {
                    //     console.error("⚠️ Sync failed:", e);
                    // }
                }
                */

                state.currentUser = profile;
                console.log("AUTH_STEP_3: Setting up UI...");
                setupUIForRole(profile);
            } catch (err) {
                console.error("AUTH_STEP_CRITICAL_EXCEPTION:", err);
                hideLoading();
                showLoginScreen();
            }
        } else {
            showLoginScreen();
        }
    });
};

function showPendingScreen() {
    // We'll use a simple alert-style screen or modal for now
    document.getElementById('app-root').innerHTML = `
        <div class="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
            <div class="max-w-md w-full glass-card p-10 bg-white space-y-6">
                <div class="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center text-4xl mx-auto">⏳</div>
                <h2 class="text-2xl font-black text-slate-900">Pendaftaran Diproses</h2>
                <p class="text-sm text-slate-500 leading-relaxed">Akun Anda sedang dalam antrian persetujuan Admin. Silakan hubungi <b>Rizki Albatamy</b> untuk aktivasi akses Anda.</p>
                <button onclick="window.logout()" class="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl">Keluar</button>
            </div>
        </div>
    `;
}

// --- NAVIGATION & UI FLOW ---
function showLoginScreen() {
    hideLoading();
    document.getElementById('ortu-setup-screen')?.classList.add('hidden');
    document.getElementById('login-screen')?.classList.remove('hidden');
    document.getElementById('main-app')?.classList.add('hidden');
}

function setupUIForRole(profile) {
    const { role, childId } = profile;
    state.currentRole = role;
    hideLoading();
    document.getElementById('login-screen')?.classList.add('hidden');
    document.getElementById('ortu-setup-screen')?.classList.add('hidden');
    document.getElementById('main-app')?.classList.remove('hidden');

    const badge = document.getElementById('user-role-badge');
    const roleLabel = (role || '').replace('_', ' ');
    if (badge) badge.innerText = roleLabel;

    // --- SIDEBAR VISIBILITY (ACCESS MATRIX V2) ---
    const isTeacher = ['OWNER', 'SUPER_ADMIN', 'KEPALA_SEKOLAH', 'KURIKULUM', 'GURU'].includes(role);
    const isAdmin = ['OWNER', 'SUPER_ADMIN'].includes(role);

    if (isTeacher) {
        document.getElementById('nav-guru')?.classList.remove('hidden');
        document.getElementById('nav-ortu')?.classList.add('hidden');

        // Toggle specific buttons
        const isKurikulumOrAdmin = ['OWNER', 'SUPER_ADMIN', 'KURIKULUM'].includes(role);
        document.getElementById('btn-users')?.classList.toggle('hidden', !isAdmin);
        document.getElementById('btn-kurikulum')?.classList.toggle('hidden', !isKurikulumOrAdmin);

        window.switchTab('dashboard');

        // SECURITY PATCH: Only staff with restricted roles (GURU) get filtered student lists
        const isRestricted = !['OWNER', 'SUPER_ADMIN', 'KURIKULUM', 'KEPALA_SEKOLAH'].includes(role);
        const managedClasses = profile.managedClasses || [];
        console.log(`[UAT] Initializing Sync for ${role}. Restricted=${isRestricted}, Classes:`, managedClasses);

        initRealtimeSync(ROLES.GURU, null);
    } else if (role === ROLES.ORANG_TUA) {
        document.getElementById('nav-guru')?.classList.add('hidden');
        document.getElementById('nav-ortu')?.classList.remove('hidden');
        if (childId) {
            state.currentStudentId = childId;
            window.switchTab('viewer');
            initRealtimeSync(ROLES.ORANG_TUA, childId);
        } else {
            document.getElementById('main-app')?.classList.add('hidden');
            document.getElementById('ortu-setup-screen')?.classList.remove('hidden');
        }
    }

    // --- BUTTON PROTECTION (READ-ONLY FOR KEPSEK & KURIKULUM) ---
    const isReadOnly = ['KEPALA_SEKOLAH', 'KURIKULUM'].includes(role);
    if (isReadOnly) {
        // Inject global CSS to hide action buttons for Kepsek & Kurikulum
        const style = document.createElement('style');
        style.id = 'readonly-protection';
        style.innerHTML = `
            button[onclick*="toggleModal"], 
            button[onclick*="tambah"], 
            button[onclick*="handlePublish"], 
            button[onclick*="handleSaveDraft"],
            button[onclick*="usSaveDraft"],
            button[onclick*="usPublish"],
            button[onclick*="save"],
            button[onclick*="hapus"],
            button[onclick*="confirmCreate"] { display: none !important; }
        `;
        document.head.appendChild(style);
    } else {
        document.getElementById('readonly-protection')?.remove();
    }
}

// --- REALTIME SYNC ---
function initRealtimeSync(role, childId = null) {
    console.log("AUTH_STEP_4: Starting Realtime Sync...", { role });
    if (state.unsubscribeStudents) state.unsubscribeStudents();
    if (state.unsubscribeAssignments) state.unsubscribeAssignments();

    if (role === ROLES.GURU) {
        state.unsubscribeStudents = streamStudents((data) => {
            state.studentsData = data;
            syncSubjectsList();
            if (!document.getElementById('dashboard-section')?.classList.contains('hidden')) window.renderDashboard();
            if (!document.getElementById('leaderboard-section')?.classList.contains('hidden')) window.renderLeaderboard();
            if (!document.getElementById('editor-section')?.classList.contains('hidden') && state.currentStudentId) window.openStudentEditor(state.currentStudentId);

            // Refresh Kurikulum if active
            if (!document.getElementById('kurikulum-section')?.classList.contains('hidden')) {
                const progressBody = document.getElementById('progress-nilai-body');
                if (progressBody) {
                    const title = document.querySelector('#kurikulum-content h3')?.innerText;
                    if (title) window.refreshTableProgress(title);
                }
            }
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

    if (role === ROLES.GURU) {
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

window.toggleModal = toggleModal;

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
    if (mode === 'nilai-harian') window.initNilaiHarian();
    if (mode === 'ujian-semester') window.initUjianSemester();
    if (mode === 'users') window.renderUsers();
};

// --- USER MANAGEMENT (ACCESS MATRIX V2) ---

window.renderUsers = async () => {
    const container = document.getElementById('users-content');
    if (!container) return;

    showLoading("Memuat Daftar User...");
    try {
        // 1. Fetch all registered users
        const usersSnap = await getDocs(collection(db, "users"));
        const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

        // 2. Render Table
        container.innerHTML = `
            <div class="glass-card overflow-hidden bg-white border border-slate-100 shadow-sm">
                <table class="w-full text-left whitespace-nowrap">
                    <thead>
                        <tr class="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50 border-b border-slate-100">
                            <th class="py-4 px-6">User</th>
                            <th class="py-4 px-6 text-center">Role</th>
                            <th class="py-4 px-6 text-center">Status</th>
                            <th class="py-4 px-6">Akses Mapel</th>
                            <th class="py-4 px-6 text-center">Aksi</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-50">
                        ${allUsers.map(u => renderUserRow(u)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (e) {
        console.error(e);
        showCustomAlert("Gagal memuat manajemen user.", true);
    }
    hideLoading();
};

function renderUserRow(u) {
    const isPending = u.status === 'pending';
    const isBlocked = u.status === 'blocked';
    const subjects = u.managedSubjects || [];
    const classes = u.managedClasses || [];

    // Layer 1: Self-Protection UI
    const isSelf = u.uid === state.currentUser.uid;
    const isTargetOwner = u.role === 'OWNER';
    const amIOwner = state.currentUser.role === 'OWNER';
    
    // Prevent changing own role or editing other owners if not an owner
    const disableRoleChange = isSelf || (isTargetOwner && !amIOwner);
    
    // Allow self to change own access (classes/subjects) but protect other owners
    const disableAccessChange = (isTargetOwner && !amIOwner);

    return `
        <tr class="hover:bg-slate-50/50 transition-all ${disableRoleChange && disableAccessChange ? 'opacity-80' : ''}">
            <td class="py-4 px-6">
                <p class="font-black text-slate-900 text-sm">${u.name || 'User Baru'} ${isSelf ? '<span class="text-indigo-500 ml-1 text-[10px]">(Anda)</span>' : ''}</p>
                <p class="text-[10px] font-medium text-slate-500">${u.email}</p>
            </td>
            <td class="py-4 px-6 text-center">
                <select onchange="window.updateUserRole('${u.uid}', this.value)" 
                        class="bg-slate-50 border-none rounded-lg text-[10px] font-black uppercase px-2 py-1 focus:ring-1 focus:ring-indigo-500 ${disableRoleChange ? 'cursor-not-allowed opacity-50' : ''}" 
                        ${disableRoleChange ? 'disabled' : ''}>
                    <option value="GURU" ${u.role === 'GURU' ? 'selected' : ''}>GURU</option>
                    <option value="KURIKULUM" ${u.role === 'KURIKULUM' ? 'selected' : ''}>KURIKULUM</option>
                    <option value="KEPALA_SEKOLAH" ${u.role === 'KEPALA_SEKOLAH' ? 'selected' : ''}>KEPSEK</option>
                    <option value="SUPER_ADMIN" ${u.role === 'SUPER_ADMIN' ? 'selected' : ''}>ADMIN</option>
                    <option value="OWNER" ${u.role === 'OWNER' ? 'selected' : ''}>OWNER</option>
                    <option value="ORANG_TUA" ${u.role === 'ORANG_TUA' ? 'selected' : ''}>ORTU</option>
                </select>
            </td>
            <td class="py-4 px-6 text-center">
                <span class="px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest 
                    ${isPending ? 'bg-amber-50 text-amber-600' : isBlocked ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}">
                    ${u.status || 'active'}
                </span>
            </td>
            <td class="py-4 px-6">
                <div class="space-y-3 relative">
                    <!-- Managed Subjects -->
                    <div class="flex flex-wrap gap-1 max-w-[200px]">
                        <span class="text-[7px] font-black text-slate-300 uppercase block w-full mb-1">Mata Pelajaran:</span>
                        ${subjects.length ? subjects.map(s => `
                            <span class="bg-indigo-50 text-indigo-600 text-[8px] font-black px-2 py-0.5 rounded uppercase flex items-center gap-1">
                                ${s.replace('SUBJ_', '')}
                            </span>
                        `).join('') : '<span class="text-[9px] text-slate-300 italic">Tanpa Akses</span>'}
                    </div>
                    <!-- Managed Classes -->
                    <div class="flex flex-wrap gap-1 max-w-[200px]">
                        <span class="text-[7px] font-black text-slate-300 uppercase block w-full mb-1">Kelas Diampu:</span>
                        ${classes.length ? classes.map(c => `
                            <span class="bg-emerald-50 text-emerald-600 text-[8px] font-black px-2 py-0.5 rounded uppercase flex items-center gap-1">
                                ${c}
                            </span>
                        `).join('') : '<span class="text-[9px] text-slate-300 italic">Tanpa Akses</span>'}
                    </div>
                    <button onclick="window.openAksesModal('${u.uid}', '${u.name || 'User Baru'}', '${encodeURIComponent(JSON.stringify(classes))}', '${encodeURIComponent(JSON.stringify(subjects))}')" class="mt-2 text-indigo-600 text-[10px] font-black bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1" ${disableAccessChange ? 'disabled' : ''}>
                        ⚙️ Atur Akses
                    </button>
                </div>
            </td>
            <td class="py-4 px-6 text-center">
                <div class="flex flex-col gap-2 items-center justify-center">
                    <div class="flex gap-2">
                        ${isPending ? `
                            <button onclick="window.setUserStatus('${u.uid}', 'active')" class="px-3 py-1 bg-emerald-600 text-white text-[9px] font-black rounded-lg uppercase shadow-sm" ${disableRoleChange ? 'disabled' : ''}>Setujui</button>
                        ` : `
                            <button onclick="window.setUserStatus('${u.uid}', '${isBlocked ? 'active' : 'blocked'}')" 
                                    class="px-3 py-1 ${isBlocked ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-rose-600'} text-[9px] font-black rounded-lg uppercase ${disableRoleChange ? 'opacity-50 cursor-not-allowed' : ''}"
                                    ${disableRoleChange ? 'disabled' : ''}>
                                ${isBlocked ? 'Aktifkan' : 'Blokir'}
                            </button>
                        `}
                        <button onclick="window.deleteUser('${u.uid}')" 
                                class="px-3 py-1 bg-rose-100 text-rose-600 text-[9px] font-black rounded-lg uppercase ${disableRoleChange ? 'opacity-50 cursor-not-allowed' : 'hover:bg-rose-200'}"
                                ${disableRoleChange ? 'disabled' : ''}>
                            Hapus
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

window.openAksesModal = (uid, userName, classesJson, subjectsJson) => {
    document.getElementById('akses-modal-uid').value = uid;
    document.getElementById('akses-modal-subtitle').innerText = `Mengatur akses untuk: ${userName}`;
    
    let currentClasses = [];
    let currentSubjects = [];
    try {
        currentClasses = JSON.parse(decodeURIComponent(classesJson));
        currentSubjects = JSON.parse(decodeURIComponent(subjectsJson));
    } catch(e) {}

    // Render Classes
    const classContainer = document.getElementById('akses-modal-kelas-container');
    const allClasses = ['7A', '7B', '8', '9']; // Default standard classes
    
    // Allow custom classes if they exist in the user's current array but not in default
    currentClasses.forEach(c => {
        if (!allClasses.includes(c)) allClasses.push(c);
    });

    classContainer.innerHTML = allClasses.map(c => `
        <label class="flex items-center space-x-3 p-3 bg-slate-50 hover:bg-emerald-50 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-emerald-100">
            <input type="checkbox" value="${c}" class="akses-kelas-checkbox w-5 h-5 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500" ${currentClasses.includes(c) ? 'checked' : ''}>
            <span class="text-sm font-bold text-slate-700 uppercase">${c}</span>
        </label>
    `).join('');

    // Render Subjects
    const mapelContainer = document.getElementById('akses-modal-mapel-container');
    const allSubjects = state.subjectsList || [];
    
    mapelContainer.innerHTML = allSubjects.map(s => {
        const cleanName = s.replace('SUBJ_', '');
        // For backwards compatibility, the subject ID used in managedSubjects is usually SUBJ_ + NAME
        const expectedId = s.startsWith('SUBJ_') ? s : 'SUBJ_' + s.toUpperCase().replace(/\\s+/g, '_');
        const isChecked = currentSubjects.includes(expectedId) || currentSubjects.includes(s);

        return `
            <label class="flex items-center space-x-3 p-3 bg-slate-50 hover:bg-indigo-50 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-indigo-100">
                <input type="checkbox" value="${expectedId}" class="akses-mapel-checkbox w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" ${isChecked ? 'checked' : ''}>
                <span class="text-sm font-bold text-slate-700 uppercase">${cleanName}</span>
            </label>
        `;
    }).join('');

    toggleModal('atur-akses-modal', true);
};

window.saveAksesUser = async () => {
    const uid = document.getElementById('akses-modal-uid').value;
    if (!uid) return;

    // Get checked classes
    const classCheckboxes = document.querySelectorAll('.akses-kelas-checkbox:checked');
    const newClasses = Array.from(classCheckboxes).map(cb => cb.value);

    // Get checked subjects
    const mapelCheckboxes = document.querySelectorAll('.akses-mapel-checkbox:checked');
    const newSubjects = Array.from(mapelCheckboxes).map(cb => cb.value);

    showLoading("Menyimpan Akses...");
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        const user = userDoc.data();
        
        const oldClasses = user?.managedClasses || [];
        const oldSubjects = user?.managedSubjects || [];

        // Save to Firestore
        await saveUserProfile(uid, { 
            managedClasses: newClasses,
            managedSubjects: newSubjects
        });

        // Audit Logs (only if changed)
        if (JSON.stringify(oldClasses.sort()) !== JSON.stringify(newClasses.sort())) {
            await addAuditLog('CLASS_ACCESS_CHANGE', uid, user.email, oldClasses, newClasses);
        }
        if (JSON.stringify(oldSubjects.sort()) !== JSON.stringify(newSubjects.sort())) {
            await addAuditLog('SUBJECT_ACCESS_CHANGE', uid, user.email, oldSubjects, newSubjects);
        }

        toggleModal('atur-akses-modal', false);
        window.renderUsers();
        showCustomAlert("Hak Akses berhasil diperbarui!");
    } catch (e) {
        console.error(e);
        showCustomAlert("Gagal menyimpan akses: " + e.message, true);
    }
    hideLoading();
};

window.updateUserRole = async (uid, newRole) => {
    showLoading("Memperbarui Role...");
    try {
        const userDocRef = doc(db, "users", uid);
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) throw new Error("User tidak ditemukan.");

        const currentUserData = userDoc.data();
        const oldRole = (currentUserData.role || '').toUpperCase();
        const formattedNewRole = newRole.toUpperCase();

        // LAYER 2: SELF-PROTECTION
        if (uid === state.currentUser.uid) throw new Error("Anda tidak dapat mengubah role Anda sendiri.");
        if (oldRole === 'OWNER' && state.currentUser.role !== 'OWNER') throw new Error("Hanya OWNER yang dapat mengubah role OWNER lain.");
        if (formattedNewRole === 'OWNER' && state.currentUser.role !== 'OWNER') throw new Error("Hanya OWNER yang dapat memberikan role OWNER.");

        if (oldRole === 'OWNER' && formattedNewRole !== 'OWNER') {
            const ownerQuery = query(collection(db, "users"), where("role", "==", "OWNER"));
            const ownersSnap = await getDocs(ownerQuery);
            if (ownersSnap.size <= 1) throw new Error("Gagal: Ini adalah satu-satunya akun OWNER yang tersisa. Sistem harus memiliki minimal 1 OWNER.");
        }

        let updates = { role: formattedNewRole };

        // DATA HYGIENE POLICY: GURU -> NON-GURU Transition
        if (oldRole === ROLES.GURU && formattedNewRole !== ROLES.GURU) {
            const hasPermissions = (currentUserData.managedSubjects && currentUserData.managedSubjects.length > 0) ||
                (currentUserData.managedClasses && currentUserData.managedClasses.length > 0);

            if (hasPermissions) {
                if (!confirm("Perubahan role akan menghapus seluruh akses kelas dan mata pelajaran yang dimiliki user ini. Lanjutkan?")) {
                    window.renderUsers();
                    hideLoading();
                    return;
                }
            }
            // Clear orphan permissions
            updates.managedSubjects = [];
            updates.managedClasses = [];
        }

        // AUDIT LOG: ROLE_CHANGE
        await addAuditLog('ROLE_CHANGE', uid, currentUserData.email, oldRole, formattedNewRole);

        // Note: We use saveUserProfile which merges. 
        // By explicitly sending [], we overwrite the existing arrays.
        // childId is not in 'updates', so merge:true will preserve it.
        await saveUserProfile(uid, updates);
        showCustomAlert("Role berhasil diperbarui.");
        window.renderUsers();
    } catch (e) {
        showCustomAlert(e.message, true);
        window.renderUsers(); // Reset UI on error
    }
    hideLoading();
};

window.setUserStatus = async (uid, status) => {
    showLoading("Memperbarui Status...");
    try {
        const userDocRef = doc(db, "users", uid);
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) throw new Error("User tidak ditemukan.");

        const currentUserData = userDoc.data();
        const oldRole = (currentUserData.role || '').toUpperCase();

        // LAYER 2: SELF-PROTECTION
        if (uid === state.currentUser.uid) throw new Error("Anda tidak dapat mengubah status Anda sendiri.");
        if (oldRole === 'OWNER' && state.currentUser.role !== 'OWNER') throw new Error("Hanya OWNER yang dapat memblokir OWNER lain.");

        // AUDIT LOG: USER_STATUS_CHANGE
        await addAuditLog('USER_STATUS_CHANGE', uid, currentUserData.email, currentUserData.status || 'active', status);

        await saveUserProfile(uid, { status });
        showCustomAlert(`Status user diubah menjadi ${status.toUpperCase()}.`);
        window.renderUsers();
    } catch (e) { showCustomAlert(e.message, true); }
    hideLoading();
};

window.deleteUser = async (uid) => {
    if (!confirm("Hapus pengguna ini secara permanen?")) return;
    showLoading("Menghapus User...");
    try {
        const userDocRef = doc(db, "users", uid);
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) throw new Error("User tidak ditemukan.");

        const targetUser = userDoc.data();
        const targetRole = (targetUser.role || '').toUpperCase();

        // LAYER 2: SELF-PROTECTION
        if (uid === state.currentUser.uid) throw new Error("Anda tidak dapat menghapus akun Anda sendiri.");
        if (targetRole === 'OWNER' && state.currentUser.role !== 'OWNER') throw new Error("Hanya OWNER yang dapat menghapus akun OWNER lain.");

        if (targetRole === 'OWNER') {
            const ownerQuery = query(collection(db, "users"), where("role", "==", "OWNER"));
            const ownersSnap = await getDocs(ownerQuery);
            if (ownersSnap.size <= 1) throw new Error("Gagal: Ini adalah satu-satunya akun OWNER yang tersisa. Sistem harus memiliki minimal 1 OWNER.");
        }

        await deleteDoc(userDocRef);
        showCustomAlert("User berhasil dihapus.");
        window.renderUsers();
    } catch (e) {
        showCustomAlert(e.message, true);
    }
    hideLoading();
};


// --- NILAI HARIAN ORCHESTRATION ---
window.tambahMapelCepat = async () => {
    const nama = prompt("Masukkan Nama Mata Pelajaran Baru:");
    if (!nama || nama.trim() === "") return;

    const subjectId = "SUBJ_" + nama.trim().toUpperCase().replace(/\s+/g, '_');

    showLoading("Menambahkan Mapel...");
    try {
        const user = auth.currentUser;
        if (!user) throw new Error("User tidak terautentikasi.");

        // 1. Simpan ke koleksi subjects
        await setDoc(doc(db, "subjects", subjectId), {
            id: subjectId,
            name: nama.trim(),
            category: "nasional", // Default
            minPassingGrade: 75
        });

        // 2. Update profile user (managedSubjects)
        const profile = await getUserProfile(user.uid);
        const managed = profile.managedSubjects || [];
        if (!managed.includes(subjectId)) {
            managed.push(subjectId);
            await saveUserProfile(user.uid, { managedSubjects: managed });
        }

        showCustomAlert("Mata pelajaran berhasil ditambahkan.");
        window.initNilaiHarian(); // Refresh dropdown
    } catch (e) {
        console.error(e);
        showCustomAlert("Gagal menambah mapel: " + e.message, true);
    }
    hideLoading();
};

window.initNilaiHarian = async () => {
    const user = auth.currentUser;
    if (!user) return;

    // 1. Determine which subjects this user can see
    const profile = await getUserProfile(user.uid);
    const role = profile?.role || 'GURU';

    // NEW POLICY: ALL Staff can SEE all subjects in dropdown
    const subSnap = await getDocs(collection(db, "subjects"));
    let subjectsToShow = subSnap.docs.map(d => d.id);

    const selectMapel = document.getElementById('nh-select-mapel');
    if (selectMapel) {
        selectMapel.innerHTML = '<option value="">Pilih Mapel...</option>';
        subjectsToShow.forEach(sid => {
            const label = sid.replace('SUBJ_', '').replace('_', ' ');
            selectMapel.insertAdjacentHTML('beforeend', `<option value="${sid}">${label}</option>`);
        });

        // UX: Auto-select last used
        const lastSubject = localStorage.getItem('nh_last_subject');
        if (lastSubject && subjectsToShow.includes(lastSubject)) {
            selectMapel.value = lastSubject;
            window.onNhMapelChange();
        } else if (subjectsToShow.length === 1) {
            selectMapel.value = subjectsToShow[0];
            window.onNhMapelChange();
        }
    }

    // Load Kelas
    const selectKelas = document.getElementById('nh-select-kelas');
    if (selectKelas) {
        let classesHTML = '<option value="">Pilih Kelas...</option>';

        const isAdmin = ['OWNER', 'SUPER_ADMIN'].includes(role);
        if (isAdmin) {
            // Admin sees all standard classes
            const allClasses = ["7A", "7B", "8", "9"];
            allClasses.forEach(c => {
                classesHTML += `<option value="${c}">Kelas ${c}</option>`;
            });
        } else {
            // Guru ONLY sees their managed classes
            const managedClasses = profile?.managedClasses || [];
            if (managedClasses.length === 0) {
                classesHTML += `<option value="" disabled>-- Anda tidak memiliki kelas --</option>`;
            } else {
                managedClasses.forEach(c => {
                    classesHTML += `<option value="${c}">Kelas ${c}</option>`;
                });
            }
        }
        selectKelas.innerHTML = classesHTML;
    }
};

window.tambahTpCepat = async () => {
    const subjectId = document.getElementById('nh-select-mapel')?.value;
    if (!subjectId) return showCustomAlert("Pilih Mapel terlebih dahulu!", true);

    const title = prompt("Masukkan Judul Materi / TP:");
    if (!title || title.trim() === "") return;

    const desc = prompt("Masukkan Deskripsi Tujuan Pembelajaran (TP):", title);

    showLoading("Menambahkan TP...");
    try {
        const tpId = `TP_${Date.now()}`;
        const newTemplate = {
            id: tpId,
            subjectId: subjectId,
            academicYear: getActiveTahun(),
            semester: 1, // Default ganjil
            type: "formative",
            title: title.trim(),
            tpId: `TP.${Math.floor(Math.random() * 100)}`, // Dummy TP ID
            tpDesc: desc,
            cognitiveLevel: "C3",
            weight: 1
        };

        await setDoc(doc(db, "assessment_templates", tpId), newTemplate);

        showCustomAlert("Tujuan Pembelajaran berhasil ditambahkan.");
        await window.onNhMapelChange(); // Refresh dropdown TP
        document.getElementById('nh-select-tp').value = tpId;
        window.onNhFilterChange();
    } catch (e) {
        console.error(e);
        showCustomAlert("Gagal menambah TP: " + e.message, true);
    }
    hideLoading();
};

window.onNhMapelChange = async () => {
    const subjectId = document.getElementById('nh-select-mapel')?.value;
    const selectTp = document.getElementById('nh-select-tp');
    const btnAddTp = document.getElementById('nh-btn-add-tp');
    if (!subjectId || !selectTp) return;

    // UX: Remember last subject
    localStorage.setItem('nh_last_subject', subjectId);

    if (btnAddTp) btnAddTp.classList.remove('hidden');

    showLoading("Memuat TP...");
    try {
        const templates = await AssessmentService.getTemplatesBySubject(subjectId, getActiveTahun());
        selectTp.innerHTML = '<option value="">Pilih TP...</option>';
        templates.forEach(t => {
            selectTp.insertAdjacentHTML('beforeend', `<option value="${t.id}">${t.tpId} - ${t.title}</option>`);
        });
        state.nhTemplates = templates;
    } catch (e) {
        showCustomAlert("Gagal memuat TP.", true);
    }
    hideLoading();
};

window.onNhFilterChange = async () => {
    const rawClassId = document.getElementById('nh-select-kelas')?.value;
    const templateId = document.getElementById('nh-select-tp')?.value;
    const workspace = document.getElementById('nh-workspace');
    const emptyState = document.getElementById('nh-empty-state');
    const listView = document.getElementById('nh-list-view');
    const actionBar = document.getElementById('nh-action-buttons');
    const metaForm = document.getElementById('nh-metadata-form');

    if (!rawClassId || !templateId) {
        [workspace, listView, actionBar, metaForm].forEach(el => el?.classList.add('hidden'));
        emptyState?.classList.remove('hidden');
        return;
    }

    const yearParts = getActiveTahun().split('/');
    const classId = `${yearParts[0].slice(-2)}${yearParts[1].slice(-2)}_${rawClassId}`;

    // FIX: Ensure classId is saved to state
    state.nhState.activeClassId = classId;
    state.nhState.activeTemplateId = templateId;
    state.nhState.activeTemplate = state.nhTemplates.find(t => t.id === templateId);

    console.log(`NH Filter Change: classId=${classId}, templateId=${templateId}`);

    showLoading("Memuat Daftar Penilaian...");
    try {
        const assessments = await AssessmentService.getAssessmentsByFilter(templateId, classId);
        state.nhState.assessmentsList = assessments;

        renderNhList();

        [workspace, emptyState, metaForm, actionBar].forEach(el => el?.classList.add('hidden'));
        listView?.classList.remove('hidden');
    } catch (e) {
        console.error(e);
        showCustomAlert("Gagal memuat daftar penilaian.", true);
    }
    hideLoading();
};

function renderNhList() {
    const container = document.getElementById('nh-assessment-cards');
    if (!container) return;

    container.innerHTML = '';
    if (state.nhState.assessmentsList.length === 0) {
        container.innerHTML = `
                <div class="col-span-full py-12 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                    <p class="text-slate-400 font-bold text-sm">Belum ada aktivitas penilaian untuk TP ini.</p>
                </div>
            `;
        return;
    }

    state.nhState.assessmentsList.forEach(asmt => {
        const date = new Date(asmt.assessmentDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        const isPub = asmt.status === 'published';

        container.insertAdjacentHTML('beforeend', `
                <div onclick="window.openAssessmentGrid('${asmt.id}')" class="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-md hover:border-indigo-500 transition-all cursor-pointer group relative overflow-hidden">
                    <div class="flex justify-between items-start mb-4">
                        <span class="px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${isPub ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}">
                            ${asmt.status}
                        </span>
                        <span class="text-[9px] font-bold text-slate-400 uppercase">${date}</span>
                    </div>
                    <h4 class="font-black text-slate-900 leading-tight mb-1 group-hover:text-indigo-600 transition-colors">${asmt.assessmentName}</h4>
                    <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${asmt.assessmentType} • Bobot ${asmt.assessmentWeight}%</p>
                </div>
            `);
    });
}

window.showNhMetadataForm = () => {
    document.getElementById('nh-list-view').classList.add('hidden');
    document.getElementById('nh-metadata-form').classList.remove('hidden');
    document.getElementById('nh-input-date').value = new Date().toISOString().split('T')[0];
};

window.cancelNhMetadataForm = () => {
    document.getElementById('nh-metadata-form').classList.add('hidden');
    document.getElementById('nh-list-view').classList.remove('hidden');
};

window.confirmCreateAssessment = async () => {
    const name = document.getElementById('nh-input-name').value;
    const type = document.getElementById('nh-input-type').value;
    const date = document.getElementById('nh-input-date').value;
    const weight = document.getElementById('nh-input-weight').value;

    if (!name || !date) return showCustomAlert("Lengkapi data penilaian!", true);

    const { activeClassId, activeTemplateId, activeTemplate } = state.nhState;
    
    // VALIDASI STATE CRITICAL
    if (!activeClassId) {
        console.error("Critical Error: state.nhState.activeClassId is missing.");
        return showCustomAlert("Sesi kelas kadaluarsa. Silakan pilih ulang kelas.", true);
    }

    showLoading("Memulai Penilaian...");
    try {
        const assessmentData = {
            assessmentName: name,
            assessmentType: type,
            assessmentDate: date,
            assessmentWeight: parseInt(weight) || 100,
            templateId: activeTemplateId,
            classId: activeClassId,
            subjectId: activeTemplate.subjectId,
            academicYear: activeTemplate.academicYear,
            semester: activeTemplate.semester,
            scores: {},
            notes: {},
            teacherReflection: ""
        };

        const newId = await AssessmentService.saveAssessment(null, assessmentData);
        
        console.log(`✨ NH Assessment Created:
           assessmentId=${newId}
           classId=${activeClassId}
           templateId=${activeTemplateId}
           subjectId=${activeTemplate.subjectId}`);

        await window.openAssessmentGrid(newId);
    } catch (e) {
        showCustomAlert(e.message, true);
    }
    hideLoading();
};

window.openAssessmentGrid = async (id) => {
    showLoading("Memuat Grid Nilai...");
    let assessment = null;
    try {
        assessment = await AssessmentService.getAssessmentById(id);
        if (!assessment) throw new Error("Dokumen penilaian tidak ditemukan (ID: " + id + ")");

        const students = await AssessmentService.getStudentsInClass(assessment.classId);

        state.nhState.currentAssessmentId = id;
        state.nhState.activeAssessment = assessment;
        state.nhState.currentClassStudents = students;
        state.nhState.tempScores = assessment.scores || {};
        state.nhState.tempNotes = assessment.notes || {};

        // UI Setup
        document.getElementById('nh-tp-title').innerText = assessment.assessmentName;
        document.getElementById('nh-tp-desc').innerText = state.nhState.activeTemplate.tpDesc;
        document.getElementById('nh-reflection').value = assessment.teacherReflection || "";

        window.renderNhGrid();

        document.getElementById('nh-list-view').classList.add('hidden');
        document.getElementById('nh-metadata-form').classList.add('hidden');
        document.getElementById('nh-workspace').classList.remove('hidden');
        document.getElementById('nh-action-buttons').classList.remove('hidden');
    } catch (e) {
        console.error("NH GRID ERROR:", e);
        console.log("ASSESSMENT ID SEARCHED:", id);
        if (assessment) console.log("ASSESSMENT DATA RECOVERED:", assessment);
        console.log("ACTIVE TEMPLATE:", state.nhState.activeTemplate);
        console.log("ACTIVE CLASS ID:", state.nhState.activeClassId);

        showCustomAlert("Gagal memuat grid nilai.", true);
    }
    hideLoading();
};

window.backToNhList = () => {
    document.getElementById('nh-workspace').classList.add('hidden');
    document.getElementById('nh-action-buttons').classList.add('hidden');
    window.onNhFilterChange(); // Refresh list
};

window.switchNhMode = (mode) => {
    state.nhState.activeMode = mode;
    const tabInput = document.getElementById('nh-tab-input');
    const tabRekap = document.getElementById('nh-tab-rekap');
    const viewInput = document.getElementById('nh-mode-input');
    const viewRekap = document.getElementById('nh-mode-rekap');

    if (mode === 'input') {
        tabInput.className = "px-6 py-2 rounded-xl text-sm font-bold bg-white text-slate-900 shadow-sm transition-all";
        tabRekap.className = "px-6 py-2 rounded-xl text-sm font-bold text-slate-500 hover:text-slate-900 transition-all";
        viewInput.classList.remove('hidden');
        viewRekap.classList.add('hidden');
    } else {
        tabRekap.className = "px-6 py-2 rounded-xl text-sm font-bold bg-white text-slate-900 shadow-sm transition-all";
        tabInput.className = "px-6 py-2 rounded-xl text-sm font-bold text-slate-500 hover:text-slate-900 transition-all";
        viewInput.classList.add('hidden');
        viewRekap.classList.remove('hidden');
        window.loadRekapData(); // Trigger data computation
    }
};

window.closeRekapDetail = () => {
    document.getElementById('rekap-detail-view').classList.add('hidden', 'lg:block'); // Hide on mobile, keep on desktop
    document.getElementById('rekap-master-view').classList.remove('hidden'); // Show master on mobile
};

window.loadRekapData = async () => {
    const rawClassId = document.getElementById('nh-select-kelas')?.value;
    const subjectId = document.getElementById('nh-select-mapel')?.value;
    const academicYear = getActiveTahun();

    if (!rawClassId || !subjectId) {
        return showCustomAlert("Silakan pilih Mapel dan Kelas terlebih dahulu.", true);
    }

    const yearParts = academicYear.split('/');
    const classId = `${yearParts[0].slice(-2)}${yearParts[1].slice(-2)}_${rawClassId}`;
    state.nhState.activeClassId = classId; // Save it back to state for the detail view

    showLoading("Mengkalkulasi Rekapitulasi...");
    try {
        // 1. DATA FETCHING (PRE-FETCH)
        const [subject, templates, students, assessments] = await Promise.all([
            AssessmentService.getSubjectDetails(subjectId),
            AssessmentService.getTemplatesBySubject(subjectId, academicYear),
            AssessmentService.getStudentsInClass(classId),
            AssessmentService.getAllPublishedAssessments(subjectId, classId, academicYear)
        ]);

        const passingGrade = subject?.minPassingGrade || 75;

        // Cache Base Data
        state.nhState.rekapBaseData = {
            students, templates, assessments, passingGrade
        };

        // 2. CALCULATION ENGINE
        const tpStats = {}; // { [templateId]: { totalWeight: 0, activities: [] } }
        const studentScores = {}; // { [templateId]: { [studentId]: weightedScoreSum } }

        // Initialize structures
        templates.forEach(t => {
            tpStats[t.id] = {
                totalWeight: 0,
                activities: [],
                lastAssessed: null,
                passCount: 0
            };
            studentScores[t.id] = {};
            students.forEach(s => studentScores[t.id][s.id] = 0);
        });

        // Aggregate Assessments
        assessments.forEach(a => {
            const tId = a.templateId;
            if (!tpStats[tId]) return; // Orphanned assessment

            const weight = a.assessmentWeight || 100;
            tpStats[tId].activities.push(a);
            tpStats[tId].totalWeight += weight;

            // Track last assessed date based on publishedAt or assessmentDate
            let dateToCompare = null;
            if (a.publishedAt && a.publishedAt.toDate) {
                dateToCompare = a.publishedAt.toDate();
            } else if (a.assessmentDate) {
                dateToCompare = new Date(a.assessmentDate);
            }

            if (dateToCompare) {
                if (!tpStats[tId].lastAssessed || dateToCompare > tpStats[tId].lastAssessed) {
                    tpStats[tId].lastAssessed = dateToCompare;
                }
            }

            // Sum weighted scores per student
            students.forEach(s => {
                const score = a.scores[s.id] || 0;
                studentScores[tId][s.id] += (score * weight);
            });
        });

        // Calculate final averages and pass rates per TP
        let totalPassRateSum = 0;
        let tpWithActivitiesCount = 0;

        templates.forEach(t => {
            const stats = tpStats[t.id];
            if (stats.totalWeight > 0) {
                tpWithActivitiesCount++;
                students.forEach(s => {
                    // Calculate average
                    studentScores[t.id][s.id] = studentScores[t.id][s.id] / stats.totalWeight;
                    // Check pass status
                    if (studentScores[t.id][s.id] >= passingGrade) {
                        stats.passCount++;
                    }
                });

                stats.passRate = Math.round((stats.passCount / students.length) * 100) || 0;
                totalPassRateSum += stats.passRate;
            } else {
                stats.passRate = 0;
            }
        });

        // Cache computed scores
        state.nhState.rekapComputedScores = studentScores;

        // 3. LEVEL 1: SEMESTER SUMMARY RENDER
        const totalTp = templates.length;
        const doneTp = tpWithActivitiesCount;
        const waitTp = totalTp - doneTp;
        const classPassRate = doneTp > 0 ? Math.round(totalPassRateSum / doneTp) : 0;

        document.getElementById('rekap-stat-total-tp').innerText = totalTp;
        document.getElementById('rekap-stat-done-tp').innerText = doneTp;
        document.getElementById('rekap-stat-wait-tp').innerText = waitTp;
        document.getElementById('rekap-stat-pass-rate').innerText = `${classPassRate}%`;

        // 4. LEVEL 2: TP LIST RENDER
        const listContainer = document.getElementById('rekap-tp-list');
        listContainer.innerHTML = '';

        if (templates.length === 0) {
            listContainer.innerHTML = `<div class="text-center py-8 text-slate-400 font-bold text-sm">Belum ada TP untuk mapel ini.</div>`;
        }

        templates.forEach(t => {
            const stats = tpStats[t.id];
            const actCount = stats.activities.length;
            let statusBadge, progressBarColor;

            if (actCount === 0) {
                statusBadge = `<span class="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[9px] font-black uppercase">Belum Dinilai</span>`;
                progressBarColor = 'bg-slate-200';
            } else if (stats.passRate >= 50) { // Using 50 as safe visual threshold if no school target
                statusBadge = `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-black uppercase">Tuntas</span>`;
                progressBarColor = 'bg-emerald-500';
            } else {
                statusBadge = `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[9px] font-black uppercase">Perlu Remedial</span>`;
                progressBarColor = 'bg-rose-500';
            }

            const lastDateStr = stats.lastAssessed ? stats.lastAssessed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-';

            listContainer.insertAdjacentHTML('beforeend', `
                    <div onclick="window.openRekapDetail('${t.id}')" class="glass-card p-4 bg-white border border-slate-100 shadow-sm hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <span class="text-[10px] font-black bg-indigo-50 text-indigo-600 px-2 py-1 rounded uppercase tracking-widest">${t.tpId}</span>
                                ${statusBadge}
                            </div>
                            <span class="text-[9px] font-bold text-slate-400 uppercase">Terkahir: ${lastDateStr}</span>
                        </div>
                        <h4 class="font-bold text-slate-900 text-sm mb-3 group-hover:text-indigo-600 transition-colors">${t.title}</h4>
                        
                        <div class="flex items-center justify-between mt-auto">
                            <span class="text-[10px] font-bold text-slate-500">${actCount} Aktivitas</span>
                            <div class="flex items-center gap-2 w-1/2">
                                <div class="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div class="h-full ${progressBarColor}" style="width: ${stats.passRate}%"></div>
                                </div>
                                <span class="text-[10px] font-black text-slate-700 w-8 text-right">${stats.passRate}%</span>
                            </div>
                        </div>
                    </div>
                `);
        });

    } catch (e) {
        console.error("Rekap Engine Error:", e);
        showCustomAlert("Gagal mengkalkulasi rekap penilaian.", true);
    }
    hideLoading();
};

window.openRekapDetail = (templateId) => {
    const { templates, assessments, students, passingGrade } = state.nhState.rekapBaseData;
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    state.nhState.selectedTemplateId = templateId;

    // UI Header
    document.getElementById('rekap-detail-tpid').innerText = template.tpId;
    document.getElementById('rekap-detail-title').innerText = template.title;

    // Filter activities for this TP
    const acts = assessments.filter(a => a.templateId === templateId);

    // 1. Render Activities & Reflections
    const actContainer = document.getElementById('rekap-detail-activities');
    const refContainer = document.getElementById('rekap-detail-reflections');
    const refBox = document.getElementById('rekap-detail-reflection-box');

    actContainer.innerHTML = '';
    refContainer.innerHTML = '';

    if (acts.length === 0) {
        actContainer.innerHTML = `<p class="text-xs text-slate-400 italic">Belum ada aktivitas.</p>`;
        refBox.classList.add('hidden');
    } else {
        refBox.classList.remove('hidden');
        acts.forEach(a => {
            // Calc avg for activity
            const validScores = Object.values(a.scores).filter(s => s > 0);
            const avg = validScores.length ? Math.round(validScores.reduce((sum, s) => sum + s, 0) / validScores.length) : 0;

            actContainer.insertAdjacentHTML('beforeend', `
                    <div class="flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <div>
                            <p class="text-[10px] font-bold text-slate-900">${a.assessmentName}</p>
                            <p class="text-[8px] font-bold text-slate-400 uppercase">${a.assessmentType}</p>
                        </div>
                        <span class="text-xs font-black ${avg >= passingGrade ? 'text-emerald-600' : 'text-rose-600'}">${avg}</span>
                    </div>
                `);

            if (a.teacherReflection) {
                refContainer.insertAdjacentHTML('beforeend', `
                        <div class="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 text-xs text-indigo-900 italic">
                            <span class="font-bold text-[9px] uppercase tracking-widest text-indigo-400 block mb-1">${a.assessmentName}</span>
                            "${a.teacherReflection}"
                        </div>
                    `);
            }
        });
    }

    // 2. Render Remedial List
    const remList = document.getElementById('rekap-detail-remedial-list');
    const remBox = document.getElementById('rekap-detail-remedial-box');
    remList.innerHTML = '';

    const scoresMap = state.nhState.rekapComputedScores[templateId];
    let remedialCount = 0;

    if (acts.length > 0 && scoresMap) {
        students.forEach(st => {
            const avgScore = scoresMap[st.id] || 0;
            if (avgScore < passingGrade) {
                remedialCount++;
                remList.insertAdjacentHTML('beforeend', `
                        <li class="flex justify-between items-center border-b border-rose-100/50 pb-1 last:border-0">
                            <span>${formatNama(st.name || st.nama)}</span>
                            <span class="font-black bg-rose-100 px-2 py-0.5 rounded">${Math.round(avgScore)}</span>
                        </li>
                    `);
            }
        });
    }

    if (remedialCount > 0) {
        remBox.classList.remove('hidden');
    } else if (acts.length > 0) {
        remBox.classList.remove('hidden');
        remList.innerHTML = `<li class="text-emerald-600 text-center py-2">✅ Semua siswa tuntas KKM (${passingGrade})</li>`;
    } else {
        remBox.classList.add('hidden');
    }

    // Show Panel (Mobile logic)
    document.getElementById('rekap-detail-view').classList.remove('hidden', 'lg:block');
    if (window.innerWidth < 1024) {
        document.getElementById('rekap-master-view').classList.add('hidden');
    }
};

window.renderNhGrid = () => {
    const body = document.getElementById('nh-table-body');
    if (!body) return;

    const isLocked = state.nhState.activeAssessment.status === 'published';

    body.innerHTML = '';
    state.nhState.currentClassStudents.forEach((st, idx) => {
        const score = state.nhState.tempScores[st.id] || 0;
        const note = state.nhState.tempNotes[st.id] || "";

        body.insertAdjacentHTML('beforeend', `
                <tr class="hover:bg-slate-50/50 transition-all">
                    <td class="py-4 px-6 text-center text-slate-400 font-bold text-xs">${idx + 1}</td>
                    <td class="py-4 px-4">
                        <p class="font-black text-slate-700 text-sm">${formatNama(st.nama || "Tanpa Nama")}</p>
                        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${st.id}</p>
                    </td>
                    <td class="py-4 px-4">
                        <input type="number" value="${score}" min="0" max="100"
                            ${isLocked ? 'disabled' : ''}
                            onfocus="this.select()"
                            oninput="window.syncNhInput('${st.id}', 'score', this.value)"
                            class="w-20 mx-auto block p-2.5 text-center font-black text-indigo-600 bg-indigo-50/50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                    </td>
                    <td class="py-4 px-6">
                        <input type="text" value="${note}" placeholder="Catatan..."
                            ${isLocked ? 'disabled' : ''}
                            oninput="window.syncNhInput('${st.id}', 'note', this.value)"
                            class="w-full p-2.5 bg-slate-50 border-none rounded-xl text-xs font-bold focus:ring-1 focus:ring-indigo-500 disabled:opacity-50">
                    </td>
                </tr>
            `);
    });
    updateNhStats();
};

window.syncNhInput = (studentId, type, val) => {
    if (type === 'score') {
        let num = parseInt(val) || 0;
        if (num > 100) num = 100;
        state.nhState.tempScores[studentId] = num;
    } else {
        state.nhState.tempNotes[studentId] = val;
    }
    updateNhStats();
};

function updateNhStats() {
    const scores = Object.values(state.nhState.tempScores);
    const validScores = scores.filter(s => s > 0);

    const total = state.nhState.currentClassStudents.length;
    const max = validScores.length ? Math.max(...validScores) : 0;
    const min = validScores.length ? Math.min(...validScores) : 0;
    const avg = validScores.length ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : 0;

    const statTotal = document.getElementById('nh-stat-total');
    const statMax = document.getElementById('nh-stat-max');
    const statMin = document.getElementById('nh-stat-min');
    const statAvg = document.getElementById('nh-stat-avg');

    if (statTotal) statTotal.innerText = total;
    if (statMax) statMax.innerText = max;
    if (statMin) statMin.innerText = min;
    if (statAvg) statAvg.innerText = avg;
}

window.handleSaveDraft = async () => {
    const id = state.nhState.currentAssessmentId;
    const reflection = document.getElementById('nh-reflection').value;

    showLoading("Menyimpan Draft...");
    try {
        const updatedData = {
            scores: state.nhState.tempScores,
            notes: state.nhState.tempNotes,
            teacherReflection: reflection
        };
        await AssessmentService.saveAssessment(id, updatedData, false);
        showCustomAlert("Draft berhasil disimpan.");
    } catch (e) {
        showCustomAlert(e.message, true);
    }
    hideLoading();
};

window.handlePublish = async () => {
    const id = state.nhState.currentAssessmentId;
    const reflection = document.getElementById('nh-reflection').value;
    const total = state.nhState.currentClassStudents.length;

    showLoading("Mempublikasikan Nilai...");
    try {
        const updatedData = {
            scores: state.nhState.tempScores,
            notes: state.nhState.tempNotes,
            teacherReflection: reflection
        };
        await AssessmentService.saveAssessment(id, updatedData, true, total);
        showCustomAlert("Nilai berhasil dipublish.");
        window.backToNhList();
    } catch (e) {
        showCustomAlert(e.message, true);
    }
    hideLoading();
};

window.renderKurikulum = () => {
    const content = document.getElementById('kurikulum-content');
    if (content && content.innerHTML.includes('Pilih Menu')) {
        window.switchKurikulumTab('mapel');
    }
};

window.renderKurikulum = async () => {
    const content = document.getElementById('kurikulum-content');
    if (!content) return;

    if (!state.nhState.currentSubjectId) {
        await window.renderKatalog();
    } else {
        await window.renderWorkspace();
    }
};

window.renderKatalog = async () => {
    const container = document.getElementById('kurikulum-content');
    const headerActions = document.getElementById('kurikulum-global-actions');
    const workspaceActions = document.getElementById('workspace-actions');

    const profile = state.currentUser;
    const role = profile?.role || 'GURU';
    const isAdmin = ['OWNER', 'SUPER_ADMIN', 'KURIKULUM'].includes(role);

    if (headerActions) headerActions.classList.toggle('hidden', role === 'KEPALA_SEKOLAH');
    if (workspaceActions) workspaceActions.classList.add('hidden');

    showLoading("Memuat Katalog...");
    try {
        const year = getActiveTahun();
        const managed = profile?.managedSubjects || [];

        // 1. DATA LOCKDOWN: Fetch only relevant templates
        let q;
        if (isAdmin || role === 'KEPALA_SEKOLAH') {
            q = query(collection(db, "assessment_templates"), where("academicYear", "==", year));
        } else {
            if (managed.length === 0) {
                state.nhState.allTemplates = [];
                container.innerHTML = `<div class="col-span-full py-20 text-center text-slate-400 font-bold italic">Anda belum diberikan akses ke mata pelajaran manapun. Silakan hubungi Admin.</div>`;
                hideLoading();
                return;
            }
            q = query(
                collection(db, "assessment_templates"),
                where("academicYear", "==", year),
                where("subjectId", "in", managed)
            );
        }

        const snap = await getDocs(q);
        state.nhState.allTemplates = snap.docs.map(d => d.data());

        // Get subjects based on role
        let subjectsToRender = [];
        if (isAdmin || role === 'KEPALA_SEKOLAH') {
            subjectsToRender = state.subjectsList; // Show all names
        } else {
            subjectsToRender = state.subjectsList.filter(name => {
                const sidStd = "SUBJ_" + name.toUpperCase().replace(/\s+/g, '_');
                return managed.includes(sidStd);
            });
        }

        container.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                ${subjectsToRender.map(sub => {
            const sid = "SUBJ_" + sub.toUpperCase().replace(/\s+/g, '_');
            const readiness = calculateSubjectReadiness(sid);

            return `
                        <div onclick="window.openSubjectWorkspace('${sid}')" 
                             class="glass-card p-6 bg-white border border-slate-100 hover:border-indigo-500 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group">
                            <div class="flex justify-between items-start mb-6">
                                <div class="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">📚</div>
                                <div class="flex items-center gap-1.5">
                                    <div class="w-2 h-2 rounded-full ${readiness.color}"></div>
                                    <span class="text-[8px] font-black uppercase tracking-widest text-slate-400">${readiness.text}</span>
                                </div>
                            </div>
                            <h4 class="font-black text-slate-900 leading-tight mb-2">${sub}</h4>
                            <p class="text-[10px] font-medium text-slate-400 leading-relaxed">Klik untuk mengelola materi dan standar akademik.</p>
                            <div class="mt-6 pt-4 border-t border-slate-50 flex justify-between items-center">
                                <span class="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Buka Workspace</span>
                                <span class="text-xs group-hover:translate-x-1 transition-transform">→</span>
                            </div>
                        </div>
                    `;
        }).join('')}
                ${subjectsToRender.length === 0 ? `<div class="col-span-full py-20 text-center text-slate-400 font-bold italic">Anda belum diberikan akses ke mata pelajaran manapun. Silakan hubungi Admin.</div>` : ''}
            </div>
        `;
    } catch (e) {
        console.error(e);
        showCustomAlert("Gagal memuat katalog mapel.", true);
    }
    hideLoading();
};

function calculateSubjectReadiness(subjectId) {
    const templates = state.nhState.allTemplates.filter(t => t.subjectId === subjectId);

    // 🔴 Belum Siap: 0 TP
    if (templates.length === 0) {
        return { text: "Belum Siap", color: "bg-rose-500" };
    }

    // Check if ATP (semester/order) is complete for all templates
    const atpIncomplete = templates.some(t => !t.semester || t.order === undefined);

    // 🟡 Sedang Disiapkan: TP ada tapi ATP/KKM belum lengkap
    // (Note: KKM check would need subject details, assuming Yellow if ATP missing)
    if (atpIncomplete) {
        return { text: "Sedang Disiapkan", color: "bg-amber-400" };
    }

    // 🟢 Siap Mengajar
    return { text: "Siap Mengajar", color: "bg-emerald-500" };
}

window.openSubjectWorkspace = async (subjectId) => {
    state.nhState.currentSubjectId = subjectId;
    state.nhState.currentWorkspaceTab = 'tp';
    window.renderKurikulum();
};

window.backToKatalog = () => {
    state.nhState.currentSubjectId = null;
    window.renderKurikulum();
};

window.renderWorkspace = async () => {
    const container = document.getElementById('kurikulum-content');
    const headerActions = document.getElementById('kurikulum-global-actions');
    const workspaceActions = document.getElementById('workspace-actions');
    const subjectId = state.nhState.currentSubjectId;
    const currentTab = state.nhState.currentWorkspaceTab || 'tp';

    const subjectName = subjectId.replace('SUBJ_', '').replace('_', ' ');

    if (headerActions) headerActions.classList.add('hidden');
    if (workspaceActions) workspaceActions.classList.remove('hidden');

    container.innerHTML = `
        <div class="space-y-6">
            <!-- Workspace Navigation -->
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                <div class="flex items-center gap-6">
                    <h3 class="text-sm font-black text-slate-900 uppercase tracking-widest border-r border-slate-200 pr-6">${subjectName}</h3>
                    <div class="flex gap-4">
                        <button onclick="window.switchWorkspaceTab('tp')" class="workspace-tab ${currentTab === 'tp' ? 'active' : ''} text-[10px] font-black uppercase tracking-widest py-2 border-b-2 border-transparent transition-all">TP & Materi</button>
                        <button onclick="window.switchWorkspaceTab('atp')" class="workspace-tab ${currentTab === 'atp' ? 'active' : ''} text-[10px] font-black uppercase tracking-widest py-2 border-b-2 border-transparent transition-all">ATP</button>
                        <button onclick="window.switchWorkspaceTab('kkm')" class="workspace-tab ${currentTab === 'kkm' ? 'active' : ''} text-[10px] font-black uppercase tracking-widest py-2 border-b-2 border-transparent transition-all">KKM</button>
                        <button onclick="window.switchWorkspaceTab('cp')" class="workspace-tab ${currentTab === 'cp' ? 'active' : ''} text-[10px] font-black uppercase tracking-widest py-2 border-b-2 border-transparent transition-all">CP</button>
                    </div>
                </div>
            </div>

            <!-- Tab Content -->
            <div id="workspace-tab-content" class="py-4 min-h-[300px]">
                <div class="flex items-center justify-center py-20">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
            </div>
        </div>
    `;

    // Dispatch to Tab Renderers
    if (currentTab === 'tp') await window.renderTpTab(subjectId);
    if (currentTab === 'atp') await window.renderAtpTab(subjectId);
    if (currentTab === 'kkm') await window.renderKkmTab(subjectId);
    if (currentTab === 'cp') await window.renderCpTab(subjectId);
};

// --- WORKSPACE TAB RENDERERS ---

window.renderTpTab = async (subjectId) => {
    const content = document.getElementById('workspace-tab-content');
    const year = getActiveTahun();

    try {
        const templates = await AssessmentService.getTemplatesBySubject(subjectId, year);
        const sortedTemplates = templates.filter(t => t.status !== 'deleted').sort((a, b) => (a.tpId || "").localeCompare(b.tpId || ""));

        content.innerHTML = `
            <div class="space-y-6">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest">Daftar Tujuan Pembelajaran</h4>
                    <div class="flex gap-2 w-full sm:w-auto">
                        <button onclick="window.openImportTpModal()" class="flex-1 sm:flex-none px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black uppercase hover:bg-emerald-100 transition-all border border-emerald-100">📂 Import Excel</button>
                        <button onclick="window.openAddTpForm()" class="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">+ Tambah TP</button>
                    </div>
                </div>
                
                <div id="tp-list" class="grid grid-cols-1 gap-4">
                    ${sortedTemplates.length === 0 ? `
                        <div class="py-20 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                            <p class="text-xs font-bold text-slate-400">Belum ada TP untuk mata pelajaran ini.</p>
                        </div>
                    ` : sortedTemplates.map(t => `
                        <div class="glass-card p-5 bg-white border border-slate-100 flex justify-between items-start group">
                            <div class="space-y-2">
                                <div class="flex items-center gap-3">
                                    <span class="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md uppercase">${t.tpId || 'NO-ID'}</span>
                                    <span class="text-[10px] font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md uppercase">${t.cognitiveLevel || 'C2'}</span>
                                </div>
                                <h5 class="font-black text-slate-900 text-sm">${t.title}</h5>
                                <p class="text-xs text-slate-500 leading-relaxed max-w-2xl">${t.tpDesc || '-'}</p>
                            </div>
                            <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button onclick="window.openEditTpForm('${t.id}')" class="p-2 hover:bg-slate-50 text-slate-400 hover:text-indigo-600 rounded-lg">✏️</button>
                                <button onclick="window.hapusTP('${t.id}')" class="p-2 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg">🗑️</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- MODAL TAMBAH/EDIT TP -->
            <div id="tp-modal" class="hidden fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
                <div class="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden animate-slide-up">
                    <div class="p-8 space-y-6">
                        <div class="text-center">
                            <h3 id="tp-modal-title" class="text-xl font-black text-slate-900 uppercase tracking-tight">Tambah Tujuan Pembelajaran</h3>
                            <p class="text-slate-400 text-xs font-medium mt-1">Rumuskan target kompetensi siswa di sini.</p>
                        </div>
                        
                        <input type="hidden" id="tp-input-id">
                        <div class="grid grid-cols-3 gap-4">
                            <div class="col-span-1">
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Kode TP</label>
                                <input type="text" id="tp-input-code" placeholder="Cth: IPA.7.1" class="w-full px-4 py-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500">
                            </div>
                            <div class="col-span-2">
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Judul Ringkas</label>
                                <input type="text" id="tp-input-title" placeholder="Cth: Klasifikasi Sel" class="w-full px-4 py-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500">
                            </div>
                        </div>

                        <div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Level Kognitif (Bloom)</label>
                            <select id="tp-input-bloom" class="w-full px-4 py-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500">
                                <option value="C1">C1 - Mengingat</option>
                                <option value="C2" selected>C2 - Memahami</option>
                                <option value="C3">C3 - Mengaplikasikan</option>
                                <option value="C4">C4 - Menganalisis</option>
                                <option value="C5">C5 - Mengevaluasi</option>
                                <option value="C6">C6 - Mencipta</option>
                            </select>
                        </div>

                        <div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Deskripsi Narasi (Akan muncul di Rapor)</label>
                            <textarea id="tp-input-desc" placeholder="Cth: Siswa mampu mengidentifikasi bagian-bagian mikroskop..." class="w-full px-4 py-3 bg-slate-50 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 h-28"></textarea>
                        </div>

                        <div class="flex gap-3">
                            <button onclick="toggleModal('tp-modal', false)" class="flex-1 py-4 bg-slate-100 text-slate-600 font-black uppercase text-[10px] rounded-2xl hover:bg-slate-200 transition-all">Batal</button>
                            <button onclick="window.saveTP()" class="flex-1 py-4 bg-indigo-600 text-white font-black uppercase text-[10px] rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">Simpan Perubahan</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error(e);
        content.innerHTML = `<p class="text-rose-500 text-xs font-bold">Gagal memuat daftar TP.</p>`;
    }
};

// --- EXCEL IMPORT LOGIC ---
let tempImportData = [];

window.openImportTpModal = () => {
    tempImportData = [];
    document.getElementById('tp-excel-input').value = '';
    document.getElementById('import-tp-preview').classList.add('hidden');
    document.getElementById('import-tp-dropzone').classList.remove('hidden');
    document.getElementById('btn-confirm-import-tp').disabled = true;
    toggleModal('import-tp-modal', true);

    // Wire up dropzone
    const dropzone = document.getElementById('import-tp-dropzone');
    const input = document.getElementById('tp-excel-input');

    dropzone.onclick = () => input.click();
    input.onchange = (e) => window.handleTpExcelFile(e.target.files[0]);
};

window.handleTpExcelFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);

        window.previewTpImport(json, file.name);
    };
    reader.readAsArrayBuffer(file);
};

window.previewTpImport = (data, filename) => {
    const previewBody = document.getElementById('tp-preview-body');
    const validCountEl = document.getElementById('tp-valid-count');
    const errorCountEl = document.getElementById('tp-error-count');
    const filenameEl = document.getElementById('tp-filename');

    previewBody.innerHTML = '';
    tempImportData = [];
    let valid = 0, error = 0;

    data.forEach(row => {
        // Map columns (Case insensitive check could be better, but sticking to standard)
        const code = row['Kode TP'] || row['KODE'] || '';
        const title = row['Judul TP'] || row['JUDUL'] || '';
        const desc = row['Deskripsi TP'] || row['DESKRIPSI'] || '';
        const bloom = row['Level Bloom'] || row['BLOOM'] || 'C2';

        const isValid = code && title;
        if (isValid) {
            valid++;
            tempImportData.push({ tpId: code, title, tpDesc: desc, cognitiveLevel: bloom });
        } else {
            error++;
        }

        previewBody.insertAdjacentHTML('beforeend', `
            <tr class="${isValid ? '' : 'bg-rose-50'}">
                <td class="p-3 font-bold ${isValid ? 'text-slate-700' : 'text-rose-600'}">${code || 'KOSONG'}</td>
                <td class="p-3 text-slate-500">${title || 'KOSONG'}</td>
                <td class="p-3 text-slate-500">${bloom}</td>
                <td class="p-3">
                    <span class="px-2 py-0.5 rounded text-[8px] font-black uppercase ${isValid ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-100 text-rose-700'}">
                        ${isValid ? 'Valid' : 'Error'}
                    </span>
                </td>
            </tr>
        `);
    });

    validCountEl.innerText = valid;
    errorCountEl.innerText = error;
    filenameEl.innerText = filename;

    document.getElementById('import-tp-dropzone').classList.add('hidden');
    document.getElementById('import-tp-preview').classList.remove('hidden');
    document.getElementById('btn-confirm-import-tp').disabled = valid === 0;
};

window.cancelImportTP = () => {
    tempImportData = [];
    toggleModal('import-tp-modal', false);
};

window.processImportTP = async () => {
    if (tempImportData.length === 0) return;

    showLoading(`Mengimport ${tempImportData.length} data...`);
    try {
        const subjectId = state.nhState.currentSubjectId;
        const year = getActiveTahun();

        // Batch additions (sequential for simplicity in V1)
        for (const tp of tempImportData) {
            await AssessmentService.addTemplate({
                ...tp,
                subjectId,
                academicYear: year,
                semester: 1 // Default
            });
        }

        toggleModal('import-tp-modal', false);
        await window.renderWorkspace();
        showCustomAlert(`${tempImportData.length} Tujuan Pembelajaran berhasil diimport.`);
    } catch (e) {
        showCustomAlert("Gagal import: " + e.message, true);
    }
    hideLoading();
};

window.downloadTpTemplate = () => {
    const data = [
        ['Kode TP', 'Judul TP', 'Deskripsi TP', 'Level Bloom'],
        ['IPA.7.1', 'Sel dan Mikroskop', 'Siswa mampu mengidentifikasi bagian-bagian sel melalui pengamatan mikroskop.', 'C2'],
        ['IPA.7.2', 'Organisasi Kehidupan', 'Siswa mampu mendeskripsikan hierarki organisasi kehidupan.', 'C3']
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template_TP");
    XLSX.writeFile(wb, "Template_Import_TP.xlsx");
};

window.renderAtpTab = async (subjectId) => {
    const content = document.getElementById('workspace-tab-content');
    const year = getActiveTahun();

    try {
        const templates = await AssessmentService.getTemplatesBySubject(subjectId, year);
        const activeTemplates = templates.filter(t => t.status !== 'deleted');

        content.innerHTML = `
            <div class="space-y-6">
                <div class="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex gap-3 items-start">
                    <span class="text-lg">🗺️</span>
                    <p class="text-[10px] text-amber-700 font-medium leading-relaxed">
                        Susun urutan mengajar dengan mengatur <b>Semester</b> dan <b>Nomor Urut</b>. 
                        Data ini menentukan urutan materi di menu Penilaian dan urutan deskripsi di Rapor Akhir.
                    </p>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <!-- SEMESTER 1 -->
                    <div class="space-y-4">
                        <h4 class="text-[10px] font-black text-slate-900 uppercase tracking-widest pl-2">Semester 1 (Ganjil)</h4>
                        <div id="atp-list-1" class="space-y-3 p-4 bg-slate-50 rounded-3xl border border-slate-100 min-h-[200px]">
                            ${renderAtpList(activeTemplates, 1)}
                        </div>
                    </div>
                    <!-- SEMESTER 2 -->
                    <div class="space-y-4">
                        <h4 class="text-[10px] font-black text-slate-900 uppercase tracking-widest pl-2">Semester 2 (Genap)</h4>
                        <div id="atp-list-2" class="space-y-3 p-4 bg-slate-50 rounded-3xl border border-slate-100 min-h-[200px]">
                            ${renderAtpList(activeTemplates, 2)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error(e);
        content.innerHTML = `<p class="text-rose-500 text-xs font-bold">Gagal memuat ATP.</p>`;
    }
};

function renderAtpList(templates, semester) {
    const filtered = templates.filter(t => t.semester == semester).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (filtered.length === 0) return `<p class="text-[10px] text-slate-400 italic text-center py-10">Belum ada materi di semester ini.</p>`;

    return filtered.map((t, idx) => `
        <div class="p-4 bg-white border border-slate-100 rounded-2xl flex items-center gap-4 shadow-sm">
            <span class="w-6 h-6 flex items-center justify-center bg-slate-100 text-slate-500 text-[10px] font-black rounded-lg">${t.order || (idx + 1)}</span>
            <div class="flex-grow">
                <p class="font-black text-slate-900 text-[11px] leading-tight">${t.title}</p>
                <p class="text-[9px] text-slate-400 font-bold uppercase mt-1">${t.tpId}</p>
            </div>
            <div class="flex gap-1">
                <button onclick="window.moveTpSemester('${t.id}', ${semester === 1 ? 2 : 1})" class="p-1.5 hover:bg-slate-50 text-slate-300 hover:text-indigo-600 rounded-lg text-xs" title="Pindah Semester">⇄</button>
            </div>
        </div>
    `).join('');
}

window.renderKkmTab = async (subjectId) => {
    const content = document.getElementById('workspace-tab-content');

    try {
        const subject = await AssessmentService.getSubjectDetails(subjectId);
        const kkm = subject?.minPassingGrade || 75;

        content.innerHTML = `
            <div class="max-w-md mx-auto py-10 space-y-8">
                <div class="text-center">
                    <div class="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">⚙️</div>
                    <h4 class="text-lg font-black text-slate-900 uppercase tracking-tight">Standar Kelulusan (KKM)</h4>
                    <p class="text-slate-400 text-xs font-medium mt-1">Tentukan nilai ambang batas minimal untuk mapel ini.</p>
                </div>

                <div class="glass-card p-8 bg-white border border-slate-100 space-y-6">
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block text-center">Angka KKM Saat Ini</label>
                        <input type="number" id="kkm-input-value" value="${kkm}" class="w-full text-5xl font-black text-center text-indigo-600 bg-transparent border-none focus:ring-0">
                    </div>
                    <p class="text-[10px] text-slate-400 text-center font-medium leading-relaxed">
                        Siswa dengan nilai di bawah angka ini akan otomatis ditandai sebagai <b>Belum Tuntas</b> di seluruh dashboard monitoring.
                    </p>
                    <button onclick="window.saveKKM()" class="w-full py-4 bg-indigo-600 text-white font-black uppercase text-[10px] rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">Simpan Perubahan</button>
                </div>
            </div>
        `;
    } catch (e) {
        console.error(e);
    }
};

window.renderCpTab = async (subjectId) => {
    const content = document.getElementById('workspace-tab-content');

    try {
        const subject = await AssessmentService.getSubjectDetails(subjectId);
        const cp = subject?.cpText || "Belum ada dokumen Capaian Pembelajaran untuk mata pelajaran ini. Silakan hubungi admin kurikulum.";

        content.innerHTML = `
            <div class="space-y-6">
                <div class="flex justify-between items-center">
                    <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest">Capaian Pembelajaran (CP) Resmi</h4>
                </div>
                <div class="glass-card p-8 bg-white border border-slate-100 leading-relaxed text-slate-700 text-sm italic font-serif">
                    "${cp}"
                </div>
                <p class="text-[10px] text-slate-400 font-medium">
                    * CP digunakan sebagai acuan utama dalam merumuskan Tujuan Pembelajaran (TP) di tab sebelah.
                </p>
            </div>
        `;
    } catch (e) {
        console.error(e);
    }
};

// --- WORKSPACE ACTIONS ---

window.openAddTpForm = () => {
    document.getElementById('tp-modal-title').innerText = "Tambah Tujuan Pembelajaran";
    document.getElementById('tp-input-id').value = "";
    document.getElementById('tp-input-code').value = "";
    document.getElementById('tp-input-title').value = "";
    document.getElementById('tp-input-bloom').value = "C2";
    document.getElementById('tp-input-desc').value = "";
    toggleModal('tp-modal', true);
};

window.openEditTpForm = async (id) => {
    const year = getActiveTahun();
    const templates = await AssessmentService.getTemplatesBySubject(state.nhState.currentSubjectId, year);
    const t = templates.find(item => item.id === id);
    if (!t) return;

    document.getElementById('tp-modal-title').innerText = "Edit Tujuan Pembelajaran";
    document.getElementById('tp-input-id').value = id;
    document.getElementById('tp-input-code').value = t.tpId || "";
    document.getElementById('tp-input-title').value = t.title || "";
    document.getElementById('tp-input-bloom').value = t.cognitiveLevel || "C2";
    document.getElementById('tp-input-desc').value = t.tpDesc || "";
    toggleModal('tp-modal', true);
};

window.saveTP = async () => {
    const id = document.getElementById('tp-input-id').value;
    const tpId = document.getElementById('tp-input-code').value.trim();
    const title = document.getElementById('tp-input-title').value.trim();
    const cognitiveLevel = document.getElementById('tp-input-bloom').value;
    const tpDesc = document.getElementById('tp-input-desc').value.trim();

    if (!tpId || !title) return showCustomAlert("Lengkapi Kode dan Judul TP!", true);

    const teacherId = auth.currentUser.uid;
    showLoading("Menyiapkan TP...");
    try {
        const data = {
            subjectId: state.nhState.currentSubjectId,
            academicYear: getActiveTahun(),
            semester: 1,
            tpId, title, cognitiveLevel, tpDesc
        };

        if (id) {
            await AssessmentService.updateTemplate(id, data, teacherId);
        } else {
            await AssessmentService.addTemplate(data, teacherId);
        }

        toggleModal('tp-modal', false);
        await window.renderWorkspace();
        showCustomAlert("Tujuan Pembelajaran berhasil disimpan.");
    } catch (e) {
        showCustomAlert("Gagal menyimpan TP: " + e.message, true);
    }
    hideLoading();
};

window.hapusTP = async (id) => {
    const role = state.currentUser?.role;
    const isOwner = role === 'OWNER';

    const msg = isOwner
        ? "Anda adalah OWNER. Hapus permanen materi ini?"
        : "Arsip materi ini? Materi tidak akan muncul lagi di daftar aktif namun histori nilai tetap aman.";

    if (!confirm(msg)) return;

    showLoading("Memproses...");
    try {
        if (isOwner) {
            await AssessmentService.deleteTemplatePermanently(id);
        } else {
            await AssessmentService.archiveTemplate(id, auth.currentUser.uid);
        }
        await window.renderWorkspace();
        showCustomAlert(isOwner ? "TP dihapus permanen." : "TP berhasil diarsip.");
    } catch (e) {
        showCustomAlert(e.message, true);
    }
    hideLoading();
};

window.moveTpSemester = async (id, newSemester) => {
    showLoading("Memindahkan...");
    try {
        await AssessmentService.updateTemplate(id, { semester: newSemester }, auth.currentUser.uid);
        await window.renderWorkspace();
    } catch (e) {
        showCustomAlert("Gagal memindah semester.", true);
    }
    hideLoading();
};

window.saveKKM = async () => {
    const val = parseInt(document.getElementById('kkm-input-value').value);
    if (isNaN(val) || val < 0 || val > 100) return showCustomAlert("KKM harus angka 0-100", true);

    showLoading("Menyimpan KKM...");
    try {
        await AssessmentService.updateSubjectConfig(state.nhState.currentSubjectId, { minPassingGrade: val }, auth.currentUser.uid);
        showCustomAlert("Standar KKM berhasil diperbarui.");
    } catch (e) {
        showCustomAlert("Gagal menyimpan KKM.", true);
    }
    hideLoading();
};

window.switchWorkspaceTab = (tab) => {
    state.nhState.currentWorkspaceTab = tab;
    window.renderWorkspace();
};


function renderKurikulumContent(tab) {
    // This function is now legacy and handled by window.renderKurikulum
    window.renderKurikulum();
}

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
    const queryStr = document.getElementById('filter-siswa-query')?.value?.toLowerCase() || '';

    const user = state.currentUser;
    const role = user?.role || 'GURU';
    const isAdmin = ['OWNER', 'SUPER_ADMIN', 'KURIKULUM', 'KEPALA_SEKOLAH'].includes(role);

    console.log(`[UAT] Rendering Dashboard: Role=${role}, Year=${currentTahun}, Filter=${filterKelas}`);
    console.log(`[UAT] Students in State: ${state.studentsData.length}`);

    // ACCESS MATRIX V2: Filter students based on role
    let baseStudents = state.studentsData;

    if (!isAdmin) {
        const managedClasses = user?.managedClasses || [];

        // If teacher has no assigned classes, show informative empty state
        if (managedClasses.length === 0) {
            const tableBody = document.getElementById('student-table-body');
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" class="py-20 text-center bg-white">
                            <div class="max-w-xs mx-auto">
                                <div class="w-16 h-16 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center text-2xl mx-auto mb-4">🏠</div>
                                <h3 class="text-sm font-black text-slate-900 uppercase">Akses Kelas Belum Tersedia</h3>
                                <p class="text-[10px] text-slate-400 font-medium mt-2 leading-relaxed">
                                    Anda belum ditugaskan mengampu kelas manapun. Silakan hubungi <b>Admin</b> untuk pengaturan kelas di menu Manajemen User.
                                </p>
                            </div>
                        </td>
                    </tr>
                `;
            }
            updateDashboardSummary([]);
            return;
        }

        baseStudents = baseStudents.filter(st => {
            const baseK = st.base_kelas || st.kelas || '';
            const baseT = st.base_tahun || '2025/2026';
            const calculatedKelas = calculateCurrentKelas(baseK, baseT, currentTahun);
            return managedClasses.includes(calculatedKelas);
        });
    }

    let filtered = baseStudents.map(st => ({
        ...st,
        calculatedKelas: calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun)
    })).filter(st => st.calculatedKelas !== 'Lulus' && st.calculatedKelas !== 'Belum Masuk');

    if (filterKelas !== 'ALL') filtered = filtered.filter(st => st.calculatedKelas === filterKelas);
    if (queryStr) filtered = filtered.filter(st => (st.docId || '').toLowerCase().includes(queryStr) || (st.nama || '').toLowerCase().includes(queryStr));

    filtered.sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
    updateDashboardSummary(filtered);
    renderDashboardTable(filtered, queryStr, currentTahun);
};

window.renderLeaderboard = async () => {
    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    const selSemester = document.getElementById('rank-filter-semester')?.value || 'ALL';
    const selBulan = document.getElementById('rank-filter-bulan')?.value || 'ALL';

    const listUnggulan = document.getElementById('rank-list-unggulan');
    const listBimbingan = document.getElementById('rank-list-bimbingan');
    if (!listUnggulan || !listBimbingan) return;

    const user = state.currentUser;
    const role = user?.role || 'GURU';
    const managedSubjects = user?.managedSubjects || [];
    const managedClasses = user?.managedClasses || [];
    const isAdmin = ['OWNER', 'SUPER_ADMIN', 'KURIKULUM', 'KEPALA_SEKOLAH'].includes(role);

    showLoading("Mengkalkulasi Peringkat...");

    try {
        // 1. DATA LOCKDOWN (OPEN READ): All staff can see published grades
        const assessmentsRef = collection(db, "assessments");
        const q = query(
            assessmentsRef,
            where("academicYear", "==", currentTahun),
            where("status", "==", "published")
        );

        const snap = await getDocs(q);
        let assessments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 2. APPLY ADDITIONAL FILTERS (Semester, Bulan, Class)
        if (selSemester !== 'ALL') {
            const semNum = parseInt(selSemester);
            assessments = assessments.filter(a => a.semester === semNum);
        }
        if (selBulan !== 'ALL') {
            const bulNum = parseInt(selBulan);
            assessments = assessments.filter(a => {
                const date = new Date(a.assessmentDate);
                return (date.getMonth() + 1) === bulNum;
            });
        }

        // 3. CLASS ISOLATION FOR GURU
        if (!isAdmin && managedClasses.length > 0) {
            // Only include assessments that belong to teacher's classes
            // assessments doc has classId: '2526_7A'
            assessments = assessments.filter(a => {
                const pureClassName = a.classId.split('_')[1];
                return managedClasses.includes(pureClassName);
            });
        }

        // 4. AGGREGATE PER STUDENT
        const studentStats = {};
        const kkm = 75;

        assessments.forEach(a => {
            const weight = a.assessmentWeight || 100;
            for (const [sid, score] of Object.entries(a.scores)) {
                // IMPORTANT: Only process scores for students that exist in teacher's classes if restricted
                if (!studentStats[sid]) {
                    studentStats[sid] = { totalScore: 0, totalWeight: 0, redMapel: new Set(), name: "" };
                }
                studentStats[sid].totalScore += (score * weight);
                studentStats[sid].totalWeight += weight;

                if (score < kkm) {
                    studentStats[sid].redMapel.add(a.subjectId);
                }
            }
        });

        // 5. PREPARE FINAL LISTS
        const students = state.studentsData;
        const finalData = Object.entries(studentStats).map(([id, stats]) => {
            const st = students.find(s => s.docId === id);
            return {
                id,
                name: st ? st.nama : "Siswa " + id,
                avg: stats.totalWeight > 0 ? Math.round(stats.totalScore / stats.totalWeight) : 0,
                redCount: stats.redMapel.size
            };
        });

        // 6. RENDER UI (Title change based on role)
        const rankTitle = document.querySelector('#leaderboard-section h3');
        if (rankTitle) {
            rankTitle.innerText = isAdmin ? "Siswa Unggulan (Global)" : "Siswa Unggulan (Mapel Anda)";
        }

        // ... Sort & Render logic remains same, but data is now clean ...
        const unggulan = [...finalData].sort((a, b) => b.avg - a.avg).slice(0, 10);
        listUnggulan.innerHTML = '';
        if (unggulan.length === 0) listUnggulan.innerHTML = '<p class="text-xs text-slate-400 italic text-center py-10">Belum ada data nilai.</p>';

        unggulan.forEach((s, idx) => {
            listUnggulan.insertAdjacentHTML('beforeend', `
                <div onclick="window.openStudentEditor('${s.id}')" class="p-4 bg-white border border-slate-100 rounded-2xl flex items-center justify-between shadow-sm cursor-pointer hover:bg-indigo-50 transition-all transform hover:scale-[1.01]">
                    <div class="flex items-center gap-4">
                        <span class="w-8 h-8 flex items-center justify-center font-black text-xs ${idx < 3 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'} rounded-lg">${idx + 1}</span>
                        <div>
                            <p class="font-black text-slate-900 text-sm group-hover:text-indigo-700">${formatNama(s.name)}</p>
                            <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Rata-Rata ${isAdmin ? 'Sekolah' : 'Internal'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-xl font-black text-indigo-600">${s.avg}</span>
                        <span class="text-slate-300 font-bold">&rarr;</span>
                    </div>
                </div>
            `);
        });

        const bimbingan = [...finalData].filter(s => s.redCount > 0).sort((a, b) => b.redCount - a.redCount).slice(0, 10);
        listBimbingan.innerHTML = '';
        if (bimbingan.length === 0) listBimbingan.innerHTML = '<p class="text-xs text-slate-400 italic text-center py-10">Semua siswa tuntas KKM!</p>';

        bimbingan.forEach((s) => {
            listBimbingan.insertAdjacentHTML('beforeend', `
                <div onclick="window.openStudentEditor('${s.id}')" class="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center justify-between shadow-sm cursor-pointer hover:bg-rose-100 transition-all transform hover:scale-[1.01]">
                    <div class="flex items-center gap-4">
                        <div class="w-8 h-8 flex items-center justify-center bg-rose-100 text-rose-600 rounded-lg text-xs">⚠️</div>
                        <div>
                            <p class="font-black text-rose-900 text-sm group-hover:text-rose-700">${formatNama(s.name)}</p>
                            <p class="text-[9px] font-bold text-rose-400 uppercase tracking-widest">Mapel Merah (${isAdmin ? 'Sekolah' : 'Internal'})</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-xl font-black text-rose-600">${s.redCount}</span>
                        <span class="text-rose-300 font-bold">&rarr;</span>
                    </div>
                </div>
            `);
        });

    } catch (e) {
        console.error("Gagal memproses peringkat:", e);
        showCustomAlert("Gagal memuat data peringkat akademik.", true);
    }
    hideLoading();
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

    // Save previous tab so back button knows where to return
    const sections = ['dashboard', 'leaderboard', 'tugas', 'nilai-harian', 'kurikulum', 'users', 'viewer', 'ujian-semester'];
    for (const sec of sections) {
        const el = document.getElementById(`${sec}-section`);
        if (el && !el.classList.contains('hidden')) {
            state.previousTab = sec;
            break;
        }
    }

    state.currentStudentId = docId;

    // Reset filters to ALL when opening a new student
    const semEl = document.getElementById('bi-filter-semester');
    const bulEl = document.getElementById('bi-filter-bulan');
    if (semEl) semEl.value = 'ALL';
    if (bulEl) bulEl.value = 'ALL';

    await window.refreshBukuInduk();
    window.switchTab('editor');
};

window.goBackFromEditor = () => {
    state.currentStudentId = null;
    window.switchTab(state.previousTab || 'dashboard');
};

window.refreshBukuInduk = async () => {
    const docId = state.currentStudentId;
    const st = state.studentsData.find(s => s.docId === docId);
    if (!st) return;

    const role = state.currentUser?.role || 'GURU';
    const isRestricted = !['OWNER', 'SUPER_ADMIN', 'KURIKULUM', 'KEPALA_SEKOLAH'].includes(role);
    const managed = state.currentUser?.managedSubjects || [];

    // Auto-fix student schema anomalies on the fly (adds missing subjects/fields)
    await autoFixStudentData(st, state.subjectsList);

    showLoading("Mengkalkulasi Rekap...");

    try {
        const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
        const calculatedKelas = calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun);

        // Get filter values
        const selectedSemester = document.getElementById('bi-filter-semester')?.value || 'ALL';
        const selectedBulan = document.getElementById('bi-filter-bulan')?.value || 'ALL';

        // 1. SET BASIC INFO
        document.getElementById('editor-title').innerText = formatNama(st.nama);
        document.getElementById('editor-nis').innerText = `NIS: ${st.docId}`;
        document.getElementById('editor-badge-kelas').innerText = `KELAS ${calculatedKelas}`;
        document.getElementById('guru-view-poin').innerText = st.poin || 0;

        // 2. DATA LOCKDOWN (OPEN READ): All staff can see published results
        const assessmentsRef = collection(db, "assessments");
        const q = query(
            assessmentsRef,
            where("academicYear", "==", currentTahun),
            where("status", "==", "published")
        );

        const snap = await getDocs(q);
        let assessments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 3. APPLY FILTERS (IN-MEMORY)
        if (selectedSemester !== 'ALL') {
            const semNum = parseInt(selectedSemester);
            assessments = assessments.filter(a => a.semester === semNum);
        }
        if (selectedBulan !== 'ALL') {
            const bulNum = parseInt(selectedBulan);
            assessments = assessments.filter(a => {
                const date = new Date(a.assessmentDate);
                return (date.getMonth() + 1) === bulNum;
            });
        }

        const studentAssessments = assessments.filter(a => a.scores[docId] !== undefined);
        const missingTasks = assessments.filter(a => a.scores[docId] === undefined || a.scores[docId] === 0);

        // Mapel Performance Tracking
        const mapelStats = {};
        const teacherNotes = [];

        studentAssessments.forEach(a => {
            const sid = a.subjectId;

            // Double check isolation in memory (extra safety)
            if (isRestricted && !managed.includes(sid)) return;

            if (!mapelStats[sid]) {
                mapelStats[sid] = { 
                    totalScore: 0, totalWeight: 0, actCount: 0,
                    harianSum: 0, harianWeight: 0,
                    tugasSum: 0, tugasWeight: 0,
                    uhSum: 0, uhWeight: 0,
                    pasSum: 0, pasWeight: 0,
                    patSum: 0, patWeight: 0
                };
            }

            const type = (a.assessmentType || '').toLowerCase();
            const w = a.assessmentWeight || 100;
            const score = a.scores[docId] || 0;

            mapelStats[sid].totalScore += (score * w);
            mapelStats[sid].totalWeight += w;
            mapelStats[sid].actCount++;

            if (type === 'harian') { mapelStats[sid].harianSum += score * w; mapelStats[sid].harianWeight += w; }
            else if (type === 'tugas') { mapelStats[sid].tugasSum += score * w; mapelStats[sid].tugasWeight += w; }
            else if (type === 'uh') { mapelStats[sid].uhSum += score * w; mapelStats[sid].uhWeight += w; }
            else if (type === 'pas') { mapelStats[sid].pasSum += score * w; mapelStats[sid].pasWeight += w; }
            else if (type === 'pat') { mapelStats[sid].patSum += score * w; mapelStats[sid].patWeight += w; }

            if (a.notes && a.notes[docId]) {
                teacherNotes.push({
                    subjectId: sid,
                    assessmentName: a.assessmentName,
                    note: a.notes[docId],
                    date: a.assessmentDate || (a.publishedAt ? a.publishedAt.toDate().toISOString().split('T')[0] : '')
                });
            }
        });

        // 4. RENDER ACADEMIC DASHBOARD
        const mapelListContainer = document.getElementById('buku-induk-mapel-list');
        mapelListContainer.innerHTML = '';
        let redMapelCount = 0;

        if (Object.keys(mapelStats).length === 0) {
            mapelListContainer.innerHTML = `<div class="col-span-full py-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200"><p class="text-xs font-bold text-slate-400">Tidak ada data untuk periode ini.</p></div>`;
        } else {
            for (const [sid, stats] of Object.entries(mapelStats)) {
                const subjectName = sid.replace('SUBJ_', '').replace('_', ' ');
                const kkm = 75;
                const avg = stats.totalWeight > 0 ? Math.round(stats.totalScore / stats.totalWeight) : 0;
                const isPassing = avg >= kkm;
                if (!isPassing) redMapelCount++;

                const missingInThisSub = missingTasks.filter(m => m.subjectId === sid).length;

                const avgHarian = stats.harianWeight > 0 ? Math.round(stats.harianSum / stats.harianWeight) : 0;
                const avgTugas = stats.tugasWeight > 0 ? Math.round(stats.tugasSum / stats.tugasWeight) : 0;
                const avgUH = stats.uhWeight > 0 ? Math.round(stats.uhSum / stats.uhWeight) : 0;
                const avgPAS = stats.pasWeight > 0 ? Math.round(stats.pasSum / stats.pasWeight) : 0;
                const avgPAT = stats.patWeight > 0 ? Math.round(stats.patSum / stats.patWeight) : 0;
                const avgAkhir = avgPAS || avgPAT || 0;

                mapelListContainer.insertAdjacentHTML('beforeend', `
                    <div class="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex justify-between items-center transition-all hover:border-indigo-200">
                        <div>
                            <h4 class="font-black text-slate-900 text-sm uppercase tracking-tight">${subjectName}</h4>
                            <p class="text-[9px] font-bold text-slate-400 mt-1">KKM: ${kkm} • ${stats.actCount} Aktivitas</p>
                            <div class="flex gap-1.5 flex-wrap mt-2 text-[8px] font-black text-slate-500 uppercase tracking-wider">
                                <span class="bg-indigo-50/50 px-1.5 py-0.5 rounded">Har: ${avgHarian}</span>
                                <span class="bg-indigo-50/50 px-1.5 py-0.5 rounded">Tgs: ${avgTugas}</span>
                                <span class="bg-indigo-50/50 px-1.5 py-0.5 rounded">UH: ${avgUH}</span>
                                <span class="bg-indigo-50/50 px-1.5 py-0.5 rounded">PAS: ${avgPAS}</span>
                                <span class="bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-700 font-black">Akhir: ${avgAkhir}</span>
                            </div>
                            ${missingInThisSub > 0 ? `<p class="text-[9px] font-black text-rose-500 mt-1.5 flex items-center gap-1"><span>⚠️</span> ${missingInThisSub} Tugas Kosong</p>` : ''}
                        </div>
                        <div class="text-right">
                            <span class="text-2xl font-black ${isPassing ? 'text-slate-900' : 'text-rose-600'}">${avg}</span>
                        </div>
                    </div>
                `);
            }
        }

        // --- RENDER RAT CHART (ADMIN/GURU POV) ---
        const ratCanvasAdmin = document.getElementById('ratChartAdmin');
        if (ratCanvasAdmin && window.Chart) {
            if (window.ratChartAdminInstance) {
                window.ratChartAdminInstance.destroy();
            }

            const chartLabels = [];
            const dataTugas = [];
            const dataUH = [];
            const dataRAT = [];

            for (const [sid, stats] of Object.entries(mapelStats)) {
                const subjectName = sid.replace('SUBJ_', '').replace('_', ' ');
                chartLabels.push(subjectName);
                
                const avgTugas = stats.tugasWeight > 0 ? Math.round(stats.tugasSum / stats.tugasWeight) : 0;
                const avgUH = stats.uhWeight > 0 ? Math.round(stats.uhSum / stats.uhWeight) : 0;
                const avgPAS = stats.pasWeight > 0 ? Math.round(stats.pasSum / stats.pasWeight) : 0;
                const avgPAT = stats.patWeight > 0 ? Math.round(stats.patSum / stats.patWeight) : 0;
                
                dataTugas.push(avgTugas);
                dataUH.push(avgUH);
                dataRAT.push(avgPAS || avgPAT || 0);
            }

            window.ratChartAdminInstance = new Chart(ratCanvasAdmin, {
                type: 'bar',
                data: {
                    labels: chartLabels,
                    datasets: [
                        { label: 'Nilai Tugas', data: dataTugas, backgroundColor: '#93c5fd', borderRadius: 4 },
                        { label: 'Ulangan Harian (UH)', data: dataUH, backgroundColor: '#fcd34d', borderRadius: 4 },
                        { label: 'Real Assessment (PAS/PAT)', data: dataRAT, backgroundColor: '#10b981', borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true, max: 100, grid: { color: '#f1f5f9' } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } },
                    plugins: {
                        legend: { position: 'top', labels: { font: { size: 10, family: "'Inter', sans-serif", weight: 'bold' }, usePointStyle: true, boxWidth: 8 } },
                        tooltip: { backgroundColor: '#1e293b', padding: 12, cornerRadius: 8 }
                    }
                }
            });
        }
        // --- END RAT CHART ---

        // 5. UPDATE HERO STATS
        const redMapelEl = document.getElementById('buku-induk-red-mapel');
        const statusBadge = document.getElementById('buku-induk-status');
        const heroCard = document.getElementById('buku-induk-hero');
        redMapelEl.innerText = redMapelCount;

        if (redMapelCount > 2) {
            statusBadge.innerText = "KRITIS";
            statusBadge.className = "text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest bg-rose-500 text-white shadow-sm shadow-rose-200";
            heroCard.className = "glass-card p-6 md:p-8 border shadow-sm relative overflow-hidden transition-colors duration-300 bg-rose-50 border-rose-100";
            redMapelEl.className = "text-3xl font-black text-rose-600";
        } else if (redMapelCount > 0) {
            statusBadge.innerText = "PERHATIAN";
            statusBadge.className = "text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest bg-amber-400 text-white shadow-sm shadow-amber-200";
            heroCard.className = "glass-card p-6 md:p-8 border border-slate-100 shadow-sm relative overflow-hidden transition-colors duration-300 bg-white";
            redMapelEl.className = "text-3xl font-black text-amber-500";
        } else {
            statusBadge.innerText = "AMAN";
            statusBadge.className = "text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest bg-emerald-500 text-white shadow-sm shadow-emerald-200";
            heroCard.className = "glass-card p-6 md:p-8 border border-slate-100 shadow-sm relative overflow-hidden transition-colors duration-300 bg-white";
            redMapelEl.className = "text-3xl font-black text-emerald-500";
        }

        // 6. RENDER DIAGNOSTICS & INSIGHTS
        const missingList = document.getElementById('buku-induk-missing-tasks');
        missingList.innerHTML = '';
        if (missingTasks.length === 0) {
            missingList.innerHTML = `<li class="text-xs font-bold text-emerald-600">✅ Tidak ada tunggakan nilai.</li>`;
        } else {
            missingTasks.slice(0, 10).forEach(m => {
                missingList.insertAdjacentHTML('beforeend', `
                    <li class="flex items-start gap-2 text-[10px] font-bold text-slate-600">
                        <span class="text-rose-500 mt-0.5">•</span>
                        <span>[${m.subjectId.replace('SUBJ_', '')}] ${m.assessmentName}</span>
                    </li>
                `);
            });
        }

        const notesList = document.getElementById('buku-induk-teacher-notes');
        notesList.innerHTML = '';
        if (teacherNotes.length === 0) {
            notesList.innerHTML = `<div class="text-center py-6 text-[10px] font-bold text-slate-400 italic">Belum ada catatan guru untuk periode ini.</div>`;
        } else {
            teacherNotes.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(n => {
                notesList.insertAdjacentHTML('beforeend', `
                    <div class="p-3 bg-white border border-slate-100 rounded-xl shadow-sm relative pl-4 before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-indigo-400 before:rounded-l-xl">
                        <div class="flex justify-between items-center mb-1">
                            <span class="text-[9px] font-black uppercase text-indigo-600">${n.subjectId.replace('SUBJ_', '')}</span>
                            <span class="text-[8px] font-bold text-slate-400">${n.date}</span>
                        </div>
                        <p class="text-[10px] font-bold text-slate-500 mb-1 leading-tight">${n.assessmentName}</p>
                        <p class="text-xs font-medium text-slate-700 leading-relaxed italic">"${n.note}"</p>
                    </div>
                `);
            });
        }

        window.applyTimelineFilter(ROLES.GURU);
    } catch (e) {
        console.error("Gagal refresh Buku Induk:", e);
        showCustomAlert("Gagal memproses data periode.", true);
    }
    hideLoading();
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
        .then(({ newCount, updateCount }) => showCustomAlert(`Berhasil! ${newCount} baru, ${updateCount} update.`))
        .finally(() => { hideLoading(); e.target.value = ''; });
};

window.generateParentInvite = async () => {
    const studentId = state.currentStudentId;
    if (!studentId) return showCustomAlert("Siswa belum dipilih!", true);
    
    showLoading("Membuat Kode Aktivasi...");
    try {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 16; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const inviteRef = doc(db, 'parent_invites', code);
        await setDoc(inviteRef, {
            studentId: studentId,
            status: 'pending',
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser.uid
        });
        
        document.getElementById('generated-invite-code').innerText = code;
        toggleModal('generate-invite-modal', true);
    } catch (e) {
        console.error("Error generating invite:", e);
        showCustomAlert("Gagal membuat kode aktivasi.", true);
    }
    hideLoading();
};

window.copyInviteCode = () => {
    const code = document.getElementById('generated-invite-code').innerText;
    navigator.clipboard.writeText(code).then(() => {
        showCustomAlert("Kode berhasil disalin!");
    });
};

window.closeInviteModal = () => {
    toggleModal('generate-invite-modal', false);
};

window.verifyAndLinkStudent = async () => {
    const code = document.getElementById('ortu-input-invite-code')?.value.trim().toUpperCase();
    if (!code) return showCustomAlert("Masukkan Kode Aktivasi!", true);
    
    showLoading("Memverifikasi Kode...");
    try {
        const uid = auth.currentUser.uid;
        const inviteRef = doc(db, 'parent_invites', code);
        const userRef = doc(db, 'users', uid);
        
        const result = await runTransaction(db, async (transaction) => {
            const inviteDoc = await transaction.get(inviteRef);
            if (!inviteDoc.exists()) {
                throw "Kode Aktivasi tidak valid.";
            }
            const inviteData = inviteDoc.data();
            if (inviteData.status !== "pending") {
                throw "Kode Aktivasi sudah digunakan atau kedaluwarsa.";
            }
            
            transaction.update(inviteRef, {
                status: "used",
                usedBy: uid,
                usedAt: serverTimestamp()
            });
            
            transaction.update(userRef, {
                childId: inviteData.studentId
            });
            
            return inviteData.studentId;
        });
        
        showCustomAlert("Berhasil terhubung dengan data ananda!");
        setupUIForRole(ROLES.ORANG_TUA, result);
    } catch (e) {
        console.error("Error linking student:", e);
        showCustomAlert(typeof e === 'string' ? e : "Gagal menghubungkan akun. Periksa kembali kode Anda.", true);
    }
    hideLoading();
};

window.applyTimelineFilter = (role) => {
    const st = role === ROLES.GURU ? state.studentsData.find(s => s.docId === state.currentStudentId) : window.currentParentData;
    if (!st) return;
    renderTimeline(st.point_history || [], role === ROLES.GURU ? 'guru-timeline' : 'parent-timeline');
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

// ===========================================
// UJIAN SEMESTER MODULE (PAS / PAT)
// ===========================================

window.initUjianSemester = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const profile = await getUserProfile(user.uid);
    const role = profile?.role || 'GURU';
    const isAdmin = ['OWNER', 'SUPER_ADMIN', 'KURIKULUM', 'KEPALA_SEKOLAH'].includes(role);

    // Load Mapel
    const subSnap = await getDocs(collection(db, "subjects"));
    const subjectsToShow = subSnap.docs.map(d => d.id);

    const selectMapel = document.getElementById('us-select-mapel');
    if (selectMapel) {
        selectMapel.innerHTML = '<option value="">Pilih Mapel...</option>';
        subjectsToShow.forEach(sid => {
            const label = sid.replace('SUBJ_', '').replace('_', ' ');
            selectMapel.insertAdjacentHTML('beforeend', `<option value="${sid}">${label}</option>`);
        });
    }

    // Load Kelas (reuse same logic as NH)
    const selectKelas = document.getElementById('us-select-kelas');
    if (selectKelas) {
        let classesHTML = '<option value="">Pilih Kelas...</option>';
        if (isAdmin) {
            ["7A", "7B", "8", "9"].forEach(c => {
                classesHTML += `<option value="${c}">Kelas ${c}</option>`;
            });
        } else {
            const managedClasses = profile?.managedClasses || [];
            if (managedClasses.length === 0) {
                classesHTML += `<option value="" disabled>-- Anda tidak memiliki kelas --</option>`;
            } else {
                managedClasses.forEach(c => {
                    classesHTML += `<option value="${c}">Kelas ${c}</option>`;
                });
            }
        }
        selectKelas.innerHTML = classesHTML;
    }

    // Reset workspace
    document.getElementById('us-workspace')?.classList.add('hidden');
    document.getElementById('us-empty-state')?.classList.remove('hidden');
};


window.onUsFilterChange = async () => {
    const subjectId = document.getElementById('us-select-mapel')?.value;
    const rawClassId = document.getElementById('us-select-kelas')?.value;
    const jenis = document.getElementById('us-select-jenis')?.value; // 'pas' or 'pat'
    const workspace = document.getElementById('us-workspace');
    const emptyState = document.getElementById('us-empty-state');

    if (!subjectId || !rawClassId) {
        workspace?.classList.add('hidden');
        emptyState?.classList.remove('hidden');
        return;
    }

    const yearParts = getActiveTahun().split('/');
    const classId = `${yearParts[0].slice(-2)}${yearParts[1].slice(-2)}_${rawClassId}`;
    const academicYear = getActiveTahun();
    const semester = jenis === 'pas' ? 1 : 2;
    const jenisLabel = jenis === 'pas' ? 'PAS (Penilaian Akhir Semester)' : 'PAT (Penilaian Akhir Tahun)';
    const subjectName = subjectId.replace('SUBJ_', '').replace('_', ' ');

    showLoading("Memuat data ujian...");

    try {
        // 1. Load students in this class
        const students = await AssessmentService.getStudentsInClass(classId);
        state.usState.students = students;

        // 2. Check if an assessment for this PAS/PAT already exists
        const assessmentsRef = collection(db, "assessments");
        const q = query(
            assessmentsRef,
            where("subjectId", "==", subjectId),
            where("classId", "==", classId),
            where("academicYear", "==", academicYear),
            where("assessmentType", "==", jenis)
        );
        const snap = await getDocs(q);

        let existingAssessment = null;
        if (!snap.empty) {
            existingAssessment = { id: snap.docs[0].id, ...snap.docs[0].data() };
        }

        state.usState.currentAssessmentId = existingAssessment?.id || null;
        state.usState.tempScores = existingAssessment?.scores || {};

        // 3. Update UI
        document.getElementById('us-grid-title').innerText = `${subjectName} — ${jenisLabel}`;
        document.getElementById('us-grid-subtitle').innerText = `Kelas ${rawClassId} • Tahun ${academicYear} • Semester ${semester}`;

        const statusBadge = document.getElementById('us-status-badge');
        if (existingAssessment) {
            const isPub = existingAssessment.status === 'published';
            statusBadge.innerText = isPub ? 'PUBLISHED' : 'DRAFT';
            statusBadge.className = `text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${isPub ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`;
        } else {
            statusBadge.innerText = 'BARU';
            statusBadge.className = 'text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest bg-blue-50 text-blue-600';
        }

        // 4. Render student score grid
        const grid = document.getElementById('us-score-grid');
        grid.innerHTML = '';

        if (students.length === 0) {
            grid.innerHTML = '<div class="text-center py-8 text-slate-400 text-sm font-bold">Tidak ada siswa di kelas ini.</div>';
        } else {
            students.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
            students.forEach((st, idx) => {
                const score = state.usState.tempScores[st.id] || '';
                grid.insertAdjacentHTML('beforeend', `
                    <div class="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-all group">
                        <span class="w-8 text-right text-[10px] font-black text-slate-400">${idx + 1}</span>
                        <div class="flex-grow">
                            <p class="text-sm font-bold text-slate-900">${formatNama(st.nama)}</p>
                            <p class="text-[9px] text-slate-400 font-bold uppercase">${st.id}</p>
                        </div>
                        <input type="number" min="0" max="100" value="${score}"
                            data-student-id="${st.id}"
                            onchange="window.onUsScoreChange(this)"
                            class="w-20 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-center text-sm font-black focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                            placeholder="0">
                    </div>
                `);
            });
        }

        emptyState?.classList.add('hidden');
        workspace?.classList.remove('hidden');
    } catch (e) {
        console.error("US Filter Error:", e);
        showCustomAlert("Gagal memuat data: " + e.message, true);
    }
    hideLoading();
};

window.onUsScoreChange = (input) => {
    const studentId = input.dataset.studentId;
    const val = parseInt(input.value) || 0;
    state.usState.tempScores[studentId] = Math.min(100, Math.max(0, val));
};

window.usSaveDraft = async () => {
    const subjectId = document.getElementById('us-select-mapel')?.value;
    const rawClassId = document.getElementById('us-select-kelas')?.value;
    const jenis = document.getElementById('us-select-jenis')?.value;

    if (!subjectId || !rawClassId) return showCustomAlert("Pilih mapel dan kelas!", true);

    const yearParts = getActiveTahun().split('/');
    const classId = `${yearParts[0].slice(-2)}${yearParts[1].slice(-2)}_${rawClassId}`;
    const academicYear = getActiveTahun();
    const semester = jenis === 'pas' ? 1 : 2;
    const subjectName = subjectId.replace('SUBJ_', '').replace('_', ' ');

    showLoading("Menyimpan Draft...");
    try {
        const assessmentData = {
            assessmentName: `${jenis.toUpperCase()} - ${subjectName}`,
            assessmentType: jenis,
            assessmentDate: new Date().toISOString().split('T')[0],
            assessmentWeight: 100,
            classId: classId,
            subjectId: subjectId,
            academicYear: academicYear,
            semester: semester,
            scores: state.usState.tempScores,
            notes: {},
            teacherReflection: `Nilai ${jenis.toUpperCase()} ${subjectName}`
        };

        const savedId = await AssessmentService.saveAssessment(
            state.usState.currentAssessmentId,
            assessmentData,
            false, // not publish
            0
        );

        state.usState.currentAssessmentId = savedId;

        // Update status badge
        const statusBadge = document.getElementById('us-status-badge');
        statusBadge.innerText = 'DRAFT';
        statusBadge.className = 'text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest bg-amber-50 text-amber-600';

        showCustomAlert("Draft berhasil disimpan! ✅");
    } catch (e) {
        showCustomAlert("Gagal menyimpan: " + e.message, true);
    }
    hideLoading();
};

window.usPublish = async () => {
    const subjectId = document.getElementById('us-select-mapel')?.value;
    const rawClassId = document.getElementById('us-select-kelas')?.value;
    const jenis = document.getElementById('us-select-jenis')?.value;

    if (!subjectId || !rawClassId) return showCustomAlert("Pilih mapel dan kelas!", true);

    // Check all students have scores
    const totalStudents = state.usState.students.length;
    const filledScores = Object.values(state.usState.tempScores).filter(s => s > 0).length;
    if (filledScores < totalStudents) {
        return showCustomAlert(`Masih ada ${totalStudents - filledScores} siswa yang belum memiliki nilai. Lengkapi semua nilai sebelum publish.`, true);
    }

    const yearParts = getActiveTahun().split('/');
    const classId = `${yearParts[0].slice(-2)}${yearParts[1].slice(-2)}_${rawClassId}`;
    const academicYear = getActiveTahun();
    const semester = jenis === 'pas' ? 1 : 2;
    const subjectName = subjectId.replace('SUBJ_', '').replace('_', ' ');

    showLoading("Mempublish Nilai...");
    try {
        const assessmentData = {
            assessmentName: `${jenis.toUpperCase()} - ${subjectName}`,
            assessmentType: jenis,
            assessmentDate: new Date().toISOString().split('T')[0],
            assessmentWeight: 100,
            classId: classId,
            subjectId: subjectId,
            academicYear: academicYear,
            semester: semester,
            scores: state.usState.tempScores,
            notes: {},
            teacherReflection: `Nilai ${jenis.toUpperCase()} ${subjectName} - Kelas ${rawClassId}`
        };

        const savedId = await AssessmentService.saveAssessment(
            state.usState.currentAssessmentId,
            assessmentData,
            true, // publish
            totalStudents
        );

        state.usState.currentAssessmentId = savedId;

        // Update status badge
        const statusBadge = document.getElementById('us-status-badge');
        statusBadge.innerText = 'PUBLISHED';
        statusBadge.className = 'text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest bg-emerald-50 text-emerald-600';

        showCustomAlert("Nilai berhasil dipublish! 🎉 Nilai sudah masuk ke profil siswa.");
    } catch (e) {
        showCustomAlert("Gagal publish: " + e.message, true);
    }
    hideLoading();
};
