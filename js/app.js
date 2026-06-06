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

import * as AssessmentService from "./modules/assessment-service.js";
import "./wipe-script.js"; // TEMP: Wipe grades on load

// --- GLOBAL STATE ---
let state = {
    currentUser: null,
    currentRole: 'guru',
    studentsData: [],
    assignmentsData: [],
    currentStudentId: null,
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
        selectedTemplateId: null
    }
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

// AUTO-SEED TRIGGER FOR ADMIN
                if (user.email === 'iphonesani13@gmail.com') {
                    console.log("🛠️ Admin detected. Running database seed/migration...");
                    try {
                        const { seedDatabase } = await import("./seed-script.js");
                        await seedDatabase(user.uid);
                        console.log("✨ Seeding process finished.");
                    } catch (e) {
                        console.error("⚠️ Seeding crashed in orchestrator:", e);
                    }
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
    if (mode === 'nilai-harian') window.initNilaiHarian();
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

    // Load Mapel (managedSubjects)
    const profile = await getUserProfile(user.uid);
    const managedSubjects = profile?.managedSubjects || ['IPA']; // Default if empty for now

    const selectMapel = document.getElementById('nh-select-mapel');
    if (selectMapel) {
        selectMapel.innerHTML = '<option value="">Pilih Mapel...</option>';
        managedSubjects.forEach(s => {
            selectMapel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
        });

        // UX: Auto-select last used subject from localStorage
        const lastSubject = localStorage.getItem('nh_last_subject');
        if (lastSubject && managedSubjects.includes(lastSubject)) {
            selectMapel.value = lastSubject;
            window.onNhMapelChange(); // Auto-load TP list
        } else if (managedSubjects.length === 1) {
            selectMapel.value = managedSubjects[0];
            window.onNhMapelChange();
        }
    }

    // Load Kelas
    const selectKelas = document.getElementById('nh-select-kelas');
    if (selectKelas) {
        selectKelas.innerHTML = `
            <option value="">Pilih Kelas...</option>
            <option value="7A">Kelas 7A</option>
            <option value="7B">Kelas 7B</option>
            <option value="8">Kelas 8</option>
            <option value="9">Kelas 9</option>
        `;
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
        const { activeClassId } = state.nhState;
        const subjectId = document.getElementById('nh-select-mapel')?.value;
        const academicYear = getActiveTahun();

        if (!activeClassId || !subjectId) {
            return showCustomAlert("Silakan pilih Mapel dan Kelas terlebih dahulu.", true);
        }

        showLoading("Mengkalkulasi Rekapitulasi...");
        try {
            // 1. DATA FETCHING (PRE-FETCH)
            const [subject, templates, students, assessments] = await Promise.all([
                AssessmentService.getSubjectDetails(subjectId),
                AssessmentService.getTemplatesBySubject(subjectId, academicYear),
                AssessmentService.getStudentsInClass(activeClassId),
                AssessmentService.getAllPublishedAssessments(subjectId, activeClassId, academicYear)
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

                const lastDateStr = stats.lastAssessed ? stats.lastAssessed.toLocaleDateString('id-ID', {day: 'numeric', month: 'short'}) : '-';

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

window.lihatProgressMapel = (mapel) => {
    const container = document.getElementById('kurikulum-content');
    const selectedKelas = document.getElementById('mapel-filter-kelas')?.value || '7A';
    
    container.innerHTML = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div class="flex items-center gap-4">
                <button onclick="window.switchKurikulumTab('mapel')" class="w-8 h-8 flex items-center justify-center bg-slate-100 rounded-xl hover:bg-slate-200 transition-all text-xs">←</button>
                <div>
                    <h3 class="text-lg font-black text-slate-900 uppercase tracking-tight">${mapel}</h3>
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Progress Nilai Kelas ${selectedKelas}</p>
                </div>
            </div>
            <select id="progress-filter-kelas" onchange="window.refreshTableProgress('${mapel}')" class="px-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold focus:ring-1 focus:ring-indigo-500">
                <option value="7A" ${selectedKelas === '7A' ? 'selected' : ''}>Kelas 7A</option>
                <option value="7B" ${selectedKelas === '7B' ? 'selected' : ''}>Kelas 7B</option>
                <option value="8" ${selectedKelas === '8' ? 'selected' : ''}>Kelas 8</option>
                <option value="9" ${selectedKelas === '9' ? 'selected' : ''}>Kelas 9</option>
            </select>
        </div>

        <div class="overflow-x-auto">
            <table class="w-full text-left whitespace-nowrap">
                <thead>
                    <tr class="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                        <th class="py-4 px-2 w-12 text-center">No</th>
                        <th class="py-4 px-4">Nama Siswa</th>
                        <th class="py-4 px-2 text-center">Harian</th>
                        <th class="py-4 px-2 text-center">UH</th>
                        <th class="py-4 px-2 text-center">PTS</th>
                        <th class="py-4 px-2 text-center">PAS</th>
                    </tr>
                </thead>
                <tbody id="progress-nilai-body" class="divide-y divide-slate-50">
                    <!-- Data siswa akan dimuat di sini -->
                </tbody>
            </table>
        </div>
    `;
    
    window.refreshTableProgress(mapel);
};

window.refreshTableProgress = (mapel) => {
    const selectedKelas = document.getElementById('progress-filter-kelas')?.value;
    const body = document.getElementById('progress-nilai-body');
    if (!body || !selectedKelas) return;

    const currentTahun = document.getElementById('filter-tahun')?.value || getActiveTahun();
    
    // Debug: Cek data mentah
    console.log(`Filtering for Mapel: ${mapel}, Kelas: ${selectedKelas}, Tahun: ${currentTahun}`);
    console.log(`Total Students in state: ${state.studentsData.length}`);

    const filteredSiswa = state.studentsData.filter(st => {
        const baseK = st.base_kelas || st.kelas || '';
        const baseT = st.base_tahun || '2025/2026';
        const calculatedKelas = calculateCurrentKelas(baseK, baseT, currentTahun);
        
        // Debug per siswa jika masih kosong
        // console.log(`Siswa: ${st.nama}, Base: ${baseK} (${baseT}), Calc: ${calculatedKelas}`);
        
        return calculatedKelas === selectedKelas;
    }).sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));

    console.log(`Found ${filteredSiswa.length} students matching class ${selectedKelas}`);

    body.innerHTML = '';
    if (filteredSiswa.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-slate-400 font-bold text-xs italic">
            Tidak ada siswa ditemukan di kelas ${selectedKelas}.<br>
            <span class="text-[10px] opacity-50">Pastikan data base_kelas dan base_tahun siswa sudah benar.</span>
        </td></tr>`;
        return;
    }

    filteredSiswa.forEach((st, idx) => {
        const sub = (st.subjects || []).find(s => s.name === mapel) || {};
        
        body.insertAdjacentHTML('beforeend', `
            <tr class="hover:bg-slate-50/50 transition-all">
                <td class="py-4 px-2 text-center text-slate-400 font-bold text-xs">${idx + 1}</td>
                <td class="py-4 px-4 font-bold text-slate-700 text-sm">${formatNama(st.nama)}</td>
                ${['harian', 'uh', 'pts', 'pas'].map(type => `
                    <td class="py-4 px-2">
                        <input type="number" value="${sub[`score_${type}`] || 0}" 
                            onchange="window.updateBulkScore('${st.docId}', '${mapel}', '${type}', this.value)"
                            class="w-16 mx-auto block p-2 text-center font-black text-indigo-600 bg-indigo-50/30 border-none rounded-xl text-xs focus:ring-1 focus:ring-indigo-500">
                    </td>
                `).join('')}
            </tr>
        `);
    });
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
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <h3 class="text-lg font-black text-slate-900 uppercase tracking-tight">Pilih Mata Pelajaran</h3>
                <select id="mapel-filter-kelas" class="px-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold focus:ring-1 focus:ring-indigo-500">
                    <option value="7A">Kelas 7A</option><option value="7B">Kelas 7B</option>
                    <option value="8">Kelas 8</option><option value="9">Kelas 9</option>
                </select>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                ${state.subjectsList.map(sub => `
                    <div class="p-5 bg-white border border-slate-100 rounded-3xl flex justify-between items-center group hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-50 transition-all cursor-pointer" 
                         onclick="window.lihatProgressMapel('${sub}')">
                        <div class="flex items-center gap-4">
                            <div class="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-lg">📚</div>
                            <div>
                                <span class="font-black text-slate-900 text-sm block">${sub}</span>
                                <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Klik untuk lihat nilai</span>
                            </div>
                        </div>
                        <button onclick="event.stopPropagation(); window.hapusMapel('${sub}')" class="text-rose-500 opacity-0 group-hover:opacity-100 transition-all text-[10px] font-black uppercase px-3 py-2 hover:bg-rose-50 rounded-xl">Hapus</button>
                    </div>
                `).join('')}
            </div>
        `;
    }
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
                <div class="glass-card p-6 space-y-4 border border-slate-100 bg-white">
                    <div class="flex justify-between items-center">
                        <h4 class="font-black text-slate-900 text-xs uppercase tracking-widest">${sub.name}</h4>
                        <span class="text-[8px] font-black text-slate-400 bg-slate-50 px-2 py-1 rounded-lg uppercase">${sub.last_updated_date ? 'Update: ' + sub.last_updated_date : 'Belum Dinilai'}</span>
                    </div>
                    <div class="grid grid-cols-4 gap-2">
                        ${['harian', 'uh', 'pts', 'pas'].map(type => `
                            <div class="bg-slate-50 rounded-xl p-2 text-center border border-slate-100/50">
                                <p class="text-[7px] font-black text-slate-400 uppercase mb-0.5">${type === 'uh' ? 'UH' : type.toUpperCase()}</p>
                                <p class="font-black text-indigo-600 text-sm">${sub[`score_${type}`] || 0}</p>
                            </div>
                        `).join('')}
                    </div>
                    ${sub.note ? `
                        <div class="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                            <p class="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-1">Catatan Guru</p>
                            <p class="text-[10px] font-bold text-indigo-700 leading-relaxed">${sub.note}</p>
                        </div>
                    ` : ''}
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
