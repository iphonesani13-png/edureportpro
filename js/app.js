import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        import { parseDate, formatNama, escapeHtml, calculateCurrentKelas, getActiveTahun } from "./modules/utils.js";
        import { loadPartial, renderAppFragments, registerStudentTableEvents } from "./modules/page-loader.js";

        const firebaseConfig = {
            apiKey: "AIzaSyAKURaZ1qn3hX264SQdVd-FHuKpXcBL8RI",
            authDomain: "smpitlaatahzan-raport.firebaseapp.com",
            projectId: "smpitlaatahzan-raport",
            storageBucket: "smpitlaatahzan-raport.firebasestorage.app",
            messagingSenderId: "888443305012",
            appId: "1:888443305012:web:5869fab053efecfd3bde61"
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const provider = new GoogleAuthProvider();
        const db = getFirestore(app);

        // --- DAFTAR EMAIL GURU YANG DIIZINKAN (WHITELIST) ---
        const AUTHORIZED_TEACHER_EMAILS = [
            "admin@gmail.com",
            "guru1@gmail.com",
            "kepsek@gmail.com",
            "iphonesani13@gmail.com"
        ];

        const AUTHORIZED_DOMAIN = "";

        let currentUser = null;
        let currentRole = 'guru';
        let studentsData = [];
        let assignmentsData = [];
        let currentStudentId = null;
        let unsubscribeStudents = null;
        let unsubscribeAssignments = null;
        let subjectsList = ['Bahasa Indonesia', 'Wafa', 'Bahasa Inggris', 'IPA', 'Matematika', 'Seni Musik', 'Civil Society', 'Sport Class'];

        // --- GLOBAL RENDER TIMELINE DENGAN FILTER ---
        window.applyTimelineFilter = (role) => {
            const filterId = role === 'guru' ? 'guru-timeline-filter' : 'ortu-timeline-filter';
            const tlId = role === 'guru' ? 'guru-timeline' : 'parent-timeline';
            const filterEl = document.getElementById(filterId);
            if (!filterEl) return;

            const filterVal = filterEl.value;

            let st;
            if (role === 'guru') {
                st = studentsData.find(s => s.docId === currentStudentId);
            } else {
                st = window.currentParentData;
            }
            if (!st) return;

            const history = st.point_history || [];

            if (filterVal === 'ALL') {
                renderTimeline(history, tlId);
                return;
            }

            const now = new Date();
            now.setHours(0, 0, 0, 0);

            const filteredHistory = history.filter(item => {
                if (!item.date) return true;
                const itemDate = parseDate(item.date);
                itemDate.setHours(0, 0, 0, 0);

                const diffTime = now.getTime() - itemDate.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                if (filterVal === 'TODAY') return diffDays === 0;
                if (filterVal === '7DAYS') return diffDays >= 0 && diffDays <= 7;
                if (filterVal === '14DAYS') return diffDays >= 0 && diffDays <= 14;
                if (filterVal === '30DAYS') return diffDays >= 0 && diffDays <= 30;

                return true;
            });

            renderTimeline(filteredHistory, tlId);
        };

        window.renderTimeline = (history, elementId) => {
            const tl = document.getElementById(elementId);
            if (!tl) return;
            tl.innerHTML = '';

            if (!history || history.length === 0) {
                tl.innerHTML = '<div class="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200"><p class="text-gray-400 font-bold text-sm">Belum ada aktivitas tercatat pada waktu tersebut.</p></div>';
                return;
            }

            history.forEach(item => {
                let color, badgeText;
                if (item.category === 'Akademik') {
                    color = 'text-purple-600 bg-purple-50 border-purple-100';
                    badgeText = 'Info Nilai';
                } else {
                    color = item.pointChange > 0 ? 'text-green-600 bg-green-50 border-green-100' : 'text-red-600 bg-red-50 border-red-100';
                    const sign = item.pointChange > 0 ? '+' : '';
                    badgeText = `${sign}${item.pointChange || 0} Poin`;
                }

                tl.insertAdjacentHTML('beforeend', `
                    <li class="relative pl-10 md:pl-12 py-2">
                        <div class="absolute left-0 top-3 w-8 h-8 bg-white border-2 border-gray-200 rounded-full flex items-center justify-center z-10 shadow-sm text-sm">${item.icon || '📌'}</div>
                        <div class="bg-white border border-gray-100 p-4 md:p-5 rounded-2xl shadow-sm hover:shadow-md transition-all">
                            <div class="flex justify-between items-start mb-2">
                                <h4 class="font-black text-gray-900 text-sm">${item.category || 'Aktivitas'}</h4>
                                <span class="inline-block px-2.5 py-1 rounded-lg text-[10px] font-black border ${color}">${badgeText}</span>
                            </div>
                            <p class="text-sm text-gray-600 font-medium mb-3">${item.desc || '-'}</p>
                            <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-1 rounded-md">${item.date || ''} • Pukul ${item.time || ''}</span>
                        </div>
                    </li>
                `);
            });
        };

        // --- SISTEM MAPEL DINAMIS ---
        const syncSubjectsFromStudents = () => {
            let hasNew = false;
            studentsData.forEach(st => {
                if (st.subjects) {
                    st.subjects.forEach(sub => {
                        if (!subjectsList.includes(sub.name)) {
                            subjectsList.push(sub.name);
                            hasNew = true;
                        }
                    });
                }
            });
            const mapelSelect = document.getElementById('tugas-mapel');
            if (hasNew || (mapelSelect && mapelSelect.options.length === 0)) {
                renderTugasMapelDropdown();
            }
        };

        window.renderTugasMapelDropdown = () => {
            const mapelSelect = document.getElementById('tugas-mapel');
            if (!mapelSelect) return;
            const currentVal = mapelSelect.value;
            mapelSelect.innerHTML = '';
            subjectsList.forEach(m => mapelSelect.insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`));
            if (subjectsList.includes(currentVal)) mapelSelect.value = currentVal;
        };

        window.bukaTambahMapel = () => {
            const input = document.getElementById('input-mapel-baru');
            if (input) input.value = '';
            const modal = document.getElementById('tambah-mapel-modal');
            if (modal) modal.classList.remove('hidden');
        };

        window.batalTambahMapel = () => {
            const modal = document.getElementById('tambah-mapel-modal');
            if (modal) modal.classList.add('hidden');
        };

        window.konfirmasiTambahMapel = async () => {
            const mapelBaru = formatNama(document.getElementById('input-mapel-baru')?.value?.trim());
            if (!mapelBaru) return showCustomAlert("Nama mata pelajaran tidak boleh kosong!", true);
            if (subjectsList.includes(mapelBaru)) return showCustomAlert("Mata pelajaran sudah ada!", true);

            const overlay = document.getElementById('loading-overlay');
            const text = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (text) text.innerText = "Menambahkan Mata Pelajaran...";

            try {
                subjectsList.push(mapelBaru);

                const updatePromises = studentsData.map(st => {
                    const hasMapel = st.subjects && st.subjects.some(sub => sub.name === mapelBaru);
                    if (!hasMapel) {
                        const updatedSubjects = st.subjects ? [...st.subjects] : [];
                        updatedSubjects.push({ name: mapelBaru, score_harian: 0, score_uh: 0, score_pts: 0, score_pas: 0, note: '', last_updated_date: '' });
                        return setDoc(doc(db, 'students', st.docId), { subjects: updatedSubjects }, { merge: true });
                    }
                    return Promise.resolve();
                });

                await Promise.all(updatePromises);

                batalTambahMapel();
                renderTugasMapelDropdown();
                showCustomAlert("Berhasil menambahkan mata pelajaran baru!", false);
            } catch (e) {
                console.error(e);
                showCustomAlert("Gagal menambahkan mata pelajaran.", true);
            }
            if (overlay) overlay.classList.add('hidden');
        };

        // --- SISTEM NOTIFIKASI CUSTOM (ANTI-CRASH) ---
        window.showCustomAlert = (message, isError = false) => {
            const msgEl = document.getElementById('global-alert-message');
            const titleEl = document.getElementById('global-alert-title');
            const iconEl = document.getElementById('global-alert-icon');
            const modalEl = document.getElementById('global-alert-modal');

            if (msgEl) msgEl.innerText = message;
            if (titleEl) titleEl.innerText = isError ? "Perhatian" : "Berhasil";
            if (iconEl) {
                iconEl.innerText = isError ? "⚠️" : "✅";
                iconEl.className = isError
                    ? "w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-3xl mb-4 mx-auto"
                    : "w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-3xl mb-4 mx-auto";
            }
            if (modalEl) modalEl.classList.remove('hidden');
        };

        window.closeGlobalAlert = () => {
            const modalEl = document.getElementById('global-alert-modal');
            if (modalEl) modalEl.classList.add('hidden');
        };

        

        
        

        const setupTahunAjaran = () => {
            const tahunSelect = document.getElementById('filter-tahun');
            if (tahunSelect) {
                tahunSelect.value = getActiveTahun();

                tahunSelect.addEventListener('change', (e) => {
                    localStorage.setItem('tahun_ajaran', e.target.value);
                    renderDashboard();

                    const leaderboardSec = document.getElementById('leaderboard-section');
                    if (leaderboardSec && !leaderboardSec.classList.contains('hidden')) {
                        renderLeaderboard();
                    }
                    const tugasSec = document.getElementById('tugas-section');
                    if (tugasSec && !tugasSec.classList.contains('hidden')) {
                        renderTugasGuru();
                    }
                });
            }
        }
        
        window.setLoginRole = (role) => {
            currentRole = role;
            const btnGuru = document.getElementById('role-btn-guru');
            const btnOrtu = document.getElementById('role-btn-ortu');
            if (btnGuru) btnGuru.className = role === 'guru' ? 'py-3 px-2 bg-white rounded-xl shadow-sm text-purple-700 font-bold transition-all flex flex-col items-center gap-1 text-xs border border-gray-200 ring-2 ring-purple-500 ring-offset-2' : 'py-3 px-2 rounded-xl text-gray-500 font-bold transition-all flex flex-col items-center gap-1 text-xs hover:bg-gray-100 border border-transparent';
            if (btnOrtu) btnOrtu.className = role === 'orangtua' ? 'py-3 px-2 bg-white rounded-xl shadow-sm text-orange-600 font-bold transition-all flex flex-col items-center gap-1 text-xs border border-gray-200 ring-2 ring-orange-400 ring-offset-2' : 'py-3 px-2 rounded-xl text-gray-500 font-bold transition-all flex flex-col items-center gap-1 text-xs hover:bg-gray-100 border border-transparent';
        };

        window.handleGoogleLogin = async () => {
            const errorMsg = document.getElementById('login-error-msg');
            if (errorMsg) errorMsg.classList.add('hidden');

            const overlay = document.getElementById('loading-overlay');
            const text = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (text) text.innerText = "Mengautentikasi...";

            try {
                localStorage.setItem('login_intent_role', currentRole);
                await signInWithPopup(auth, provider);
            } catch (error) {
                if (overlay) overlay.classList.add('hidden');
                if (errorMsg) {
                    errorMsg.innerText = "Gagal login. Pastikan Anda memilih akun Google pada pop-up. (Error: " + error.message + ")";
                    errorMsg.classList.remove('hidden');
                }
            }
        };

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const overlay = document.getElementById('loading-overlay');
                    const text = document.getElementById('loading-text');
                    if (overlay) overlay.classList.remove('hidden');
                    if (text) text.innerText = "Menyiapkan Dashboard...";

                    const userDocRef = doc(db, 'users', user.uid);
                    let intentRole = localStorage.getItem('login_intent_role');
                    let profile = { role: 'guru', childId: null };

                    // Logika Pengecekan Izin Guru
                    let isTeacherAuthorized = false;
                    if (AUTHORIZED_DOMAIN && user.email.endsWith(AUTHORIZED_DOMAIN)) {
                        isTeacherAuthorized = true;
                    } else if (AUTHORIZED_TEACHER_EMAILS.includes(user.email)) {
                        isTeacherAuthorized = true;
                    }

                    if (intentRole) {
                        if (intentRole === 'guru' && !isTeacherAuthorized) {
                            await signOut(auth);
                            localStorage.removeItem('login_intent_role');
                            if (overlay) overlay.classList.add('hidden');
                            showCustomAlert(`Akses Ditolak!\nEmail ${user.email} tidak terdaftar sebagai Guru/Admin.`, true);
                            showLogin();
                            return;
                        }

                        profile.role = intentRole;
                        await setDoc(userDocRef, { role: profile.role, email: user.email || '' }, { merge: true });
                        localStorage.removeItem('login_intent_role');
                    } else {
                        const userSnap = await getDoc(userDocRef);
                        if (userSnap.exists()) {
                            profile = userSnap.data();

                            if (profile.role === 'guru' && !isTeacherAuthorized) {
                                await signOut(auth);
                                if (overlay) overlay.classList.add('hidden');
                                showCustomAlert(`Akses Ditolak!\nEmail ${user.email} tidak terdaftar sebagai Guru/Admin.`, true);
                                showLogin();
                                return;
                            }
                        }
                    }
                    setupUIForRole(profile.role, profile.childId);

                } catch (err) {
                    console.error("System Error:", err);
                    const overlay = document.getElementById('loading-overlay');
                    if (overlay) overlay.classList.add('hidden');

                    if (err.message.includes('classList') || err.message.includes('getElementById')) {
                        showCustomAlert("Terjadi kendala pada tampilan (UI) sistem. Detail: " + err.message, true);
                    } else {
                        showCustomAlert("Akses Firebase Ditolak! Pastikan Aturan (Rules) Database Anda mengizinkan membaca dan menulis data /users. Detail: " + err.message, true);
                    }
                }
            } else {
                showLogin();
            }
        });

        window.logout = () => {
            if (unsubscribeStudents) unsubscribeStudents();
            if (unsubscribeAssignments) unsubscribeAssignments();
            signOut(auth);
        };

        function showLogin() {
            const overlay = document.getElementById('loading-overlay');
            const ortuScreen = document.getElementById('ortu-setup-screen');
            const loginScreen = document.getElementById('login-screen');
            const mainApp = document.getElementById('main-app');

            if (overlay) overlay.classList.add('hidden');
            if (ortuScreen) ortuScreen.classList.add('hidden');
            if (loginScreen) loginScreen.classList.remove('hidden');
            if (mainApp) mainApp.classList.add('hidden');
        }

        function setupUIForRole(role, childId) {
            const overlay = document.getElementById('loading-overlay');
            const loginScreen = document.getElementById('login-screen');
            const ortuScreen = document.getElementById('ortu-setup-screen');
            const mainApp = document.getElementById('main-app');
            const badge = document.getElementById('user-role-badge');
            const navGuru = document.getElementById('nav-guru');
            const navOrtu = document.getElementById('nav-ortu');

            if (overlay) overlay.classList.add('hidden');
            if (loginScreen) loginScreen.classList.add('hidden');
            if (ortuScreen) ortuScreen.classList.add('hidden');
            if (mainApp) mainApp.classList.add('hidden');

            if (badge) badge.innerText = role === 'guru' ? 'GURU / ADMIN' : 'ORANG TUA';

            if (role === 'guru') {
                if (mainApp) mainApp.classList.remove('hidden');
                if (navGuru) navGuru.classList.remove('hidden');
                if (navOrtu) navOrtu.classList.add('hidden');
                switchTab('dashboard');
                initRealtimeSync({ role: role });
            } else {
                if (childId) {
                    if (mainApp) mainApp.classList.remove('hidden');
                    if (navGuru) navGuru.classList.add('hidden');
                    if (navOrtu) navOrtu.classList.remove('hidden');
                    currentStudentId = childId;
                    switchTab('viewer');
                    initRealtimeSync({ role: role, childId: childId });
                } else {
                    if (ortuScreen) ortuScreen.classList.remove('hidden');
                }
            }
        }

        window.verifyAndLinkStudent = async () => {
            const nisInput = document.getElementById('ortu-input-nis');
            const nis = nisInput ? nisInput.value.trim() : '';
            const errorMsg = document.getElementById('ortu-setup-error');
            if (errorMsg) errorMsg.classList.add('hidden');

            if (!nis) {
                if (errorMsg) {
                    errorMsg.innerText = "Sistem menolak: Anda wajib mengetik NIS Anak!";
                    errorMsg.classList.remove('hidden');
                }
                return;
            }

            const overlay = document.getElementById('loading-overlay');
            const text = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (text) text.innerText = "Mencari Data Siswa...";

            try {
                const studentRef = doc(db, 'students', String(nis));
                const snap = await getDoc(studentRef);

                if (overlay) overlay.classList.add('hidden');

                if (snap.exists()) {
                    await setDoc(doc(db, 'users', auth.currentUser.uid), { childId: nis }, { merge: true });
                    setupUIForRole('orangtua', nis);
                } else {
                    if (errorMsg) {
                        errorMsg.innerText = `Data untuk NIS "${nis}" tidak ditemukan. Pastikan NIS yang dimasukkan benar.`;
                        errorMsg.classList.remove('hidden');
                    }
                }
            } catch (err) {
                if (overlay) overlay.classList.add('hidden');
                if (errorMsg) {
                    if (err.code === 'permission-denied') {
                        errorMsg.innerHTML = "<b>Akses Ditolak Server.</b><br>Pastikan Aturan Firebase Firestore mengizinkan user membaca data siswa.";
                    } else {
                        errorMsg.innerText = `Terjadi kesalahan saat memeriksa data. (Error: ${err.message})`;
                    }
                    errorMsg.classList.remove('hidden');
                }
            }
        };

        window.resetParentChildId = async () => {
            if (auth.currentUser) {
                const overlay = document.getElementById('loading-overlay');
                if (overlay) overlay.classList.remove('hidden');
                await setDoc(doc(db, 'users', auth.currentUser.uid), { childId: null }, { merge: true });
                setupUIForRole('orangtua', null);
            }
        };

        function initRealtimeSync(profile) {
            if (unsubscribeStudents) unsubscribeStudents();
            if (unsubscribeAssignments) unsubscribeAssignments();

            if (profile.role === 'guru') {
                const studentsCol = collection(db, 'students');
                unsubscribeStudents = onSnapshot(studentsCol, (snapshot) => {
                    studentsData = snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
                    syncSubjectsFromStudents();

                    const dashboardSec = document.getElementById('dashboard-section');
                    const leaderboardSec = document.getElementById('leaderboard-section');
                    const editorSec = document.getElementById('editor-section');

                    if (dashboardSec && !dashboardSec.classList.contains('hidden')) renderDashboard();
                    if (leaderboardSec && !leaderboardSec.classList.contains('hidden')) renderLeaderboard();
                    if (editorSec && !editorSec.classList.contains('hidden') && currentStudentId) window.openStudentEditor(currentStudentId);
                });

                const assignCol = collection(db, 'assignments');
                unsubscribeAssignments = onSnapshot(assignCol, (snapshot) => {
                    assignmentsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                    const tugasSec = document.getElementById('tugas-section');
                    if (tugasSec && !tugasSec.classList.contains('hidden')) renderTugasGuru();
                });
            } else {
                if (!profile.childId) {
                    tampilkanErrorOrtu("ID Anak Kosong", "Sistem mendeteksi Anda belum memasukkan ID anak saat login.");
                    return;
                }
                const overlay = document.getElementById('loading-overlay');
                const text = document.getElementById('loading-text');
                if (overlay) overlay.classList.remove('hidden');
                if (text) text.innerText = "Menarik Data Sekolah...";

                const studentRef = doc(db, 'students', profile.childId);
                unsubscribeStudents = onSnapshot(studentRef, (docSnap) => {
                    if (overlay) overlay.classList.add('hidden');
                    if (docSnap.exists()) {
                        const myChild = { docId: docSnap.id, ...docSnap.data() };
                        window.currentParentData = myChild;

                        const ortuTahun = document.getElementById('ortu-filter-tahun');
                        if (ortuTahun && !ortuTahun.value) ortuTahun.value = getActiveTahun();

                        loadParentDashboard(myChild);
                    } else {
                        tampilkanErrorOrtu(
                            "Data Tidak Ditemukan",
                            `Sistem tidak dapat menemukan data untuk ID/NIS: <b>${profile.childId}</b>.<br><br><span class="text-red-600 font-bold">PENTING:</span> Pastikan Anda mengetik ID berupa ANGKA NIS yang persis sama dengan yang ada di daftar Guru.`
                        );
                    }
                }, (error) => {
                    if (overlay) overlay.classList.add('hidden');
                    tampilkanErrorOrtu("Akses Ditolak Server", "Sistem Keamanan Firebase menolak permintaan Anda.");
                });

                const assignCol = collection(db, 'assignments');
                unsubscribeAssignments = onSnapshot(assignCol, (snapshot) => {
                    assignmentsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                    const viewerSec = document.getElementById('viewer-section');
                    if (window.currentParentData && viewerSec && !viewerSec.classList.contains('hidden')) {
                        loadParentDashboard(window.currentParentData);
                    }
                });
            }
        }

        function tampilkanErrorOrtu(judul, pesan) {
            const contentBox = document.getElementById('ortu-content-box');
            const errorBox = document.getElementById('ortu-error-box');
            const errorTitle = document.getElementById('ortu-error-title');
            const errorDesc = document.getElementById('ortu-error-desc');

            if (contentBox) contentBox.classList.add('hidden');
            if (errorBox) errorBox.classList.remove('hidden');
            if (errorTitle) errorTitle.innerText = judul;
            if (errorDesc) errorDesc.innerHTML = pesan;
        }

        async function autoFixStudentData(st) {
            let needsUpdate = false;
            if (st.academic) { delete st.academic; needsUpdate = true; }
            if (st.poin === undefined) { st.poin = 0; needsUpdate = true; }
            if (!st.point_history) { st.point_history = []; needsUpdate = true; }

            if (!st.base_tahun) { st.base_tahun = '2025/2026'; needsUpdate = true; }
            if (!st.base_kelas) { st.base_kelas = st.kelas || '7'; needsUpdate = true; }
            if (!st.kelas) { st.kelas = st.base_kelas; needsUpdate = true; }

            if (!st.subjects || !Array.isArray(st.subjects)) {
                st.subjects = subjectsList.map(name => ({ name: name, score_harian: 0, score_uh: 0, score_pts: 0, score_pas: 0, note: '', last_updated_date: '' }));
                needsUpdate = true;
            } else {
                st.subjects.forEach(sub => {
                    if (sub.score !== undefined) {
                        sub.score_harian = sub.score;
                        delete sub.score;
                        needsUpdate = true;
                    }
                    if (sub.score_harian === undefined) { sub.score_harian = 0; needsUpdate = true; }
                    if (sub.score_uh === undefined) { sub.score_uh = 0; needsUpdate = true; }
                    if (sub.score_pts === undefined) { sub.score_pts = 0; needsUpdate = true; }
                    if (sub.score_pas === undefined) { sub.score_pas = 0; needsUpdate = true; }
                    if (sub.last_updated_date === undefined) { sub.last_updated_date = ''; needsUpdate = true; }
                });
            }

            if (needsUpdate) {
                await setDoc(doc(db, 'students', st.docId), st, { merge: true });
                return true;
            }
            return false;
        }

        window.switchTab = (mode) => {
            const sections = ['dashboard', 'leaderboard', 'tugas', 'editor', 'viewer'];

            sections.forEach(s => {
                const el = document.getElementById(`${s}-section`);
                if (el) el.classList.add('hidden');
            });

            const targetEl = document.getElementById(`${mode}-section`);
            if (targetEl) targetEl.classList.remove('hidden');

            document.querySelectorAll('.nav-pill').forEach(p => p.classList.remove('active'));
            const activeBtn = document.getElementById(`btn-${mode}`);
            if (activeBtn) {
                activeBtn.classList.remove('hidden');
                activeBtn.classList.add('active');
            }

            if (mode === 'leaderboard') renderLeaderboard();
            if (mode === 'dashboard') renderDashboard();
            if (mode === 'tugas') {
                renderTugasGuru();
                const mapelSelect = document.getElementById('tugas-mapel');
                if (mapelSelect && mapelSelect.options.length === 0) {
                    renderTugasMapelDropdown();
                }
            }
        };

        window.renderDashboard = () => {
            const currentTahun = document.getElementById('filter-tahun')?.value || '2025/2026';
            const filter = document.getElementById('filter-kelas')?.value || 'ALL';
            const queryRaw = document.getElementById('filter-siswa-query')?.value || '';
            const query = queryRaw.trim().toLowerCase();
            const tbody = document.getElementById('student-table-body');
            if (!tbody) return;

            tbody.innerHTML = '';

            let activeStudents = studentsData.map(st => {
                return {
                    ...st,
                    calculatedKelas: calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun)
                };
            });

            let filteredStudents = activeStudents.filter(st => st.calculatedKelas !== 'Lulus' && st.calculatedKelas !== 'Belum Masuk');

            if (filter !== 'ALL') {
                filteredStudents = filteredStudents.filter(st => st.calculatedKelas === filter);
            }

            if (query) {
                filteredStudents = filteredStudents.filter(st => {
                    const docId = String(st.docId || '').toLowerCase();
                    const nama = formatNama(st.nama).toLowerCase();
                    return docId.includes(query) || nama.includes(query);
                });
            }

            filteredStudents.sort((a, b) => {
                const nameA = (a.nama || "").toUpperCase();
                const nameB = (b.nama || "").toUpperCase();
                return nameA.localeCompare(nameB);
            });

            updateDashboardSummary(filteredStudents);

            const badge = document.getElementById('total-siswa-badge');
            if (badge) {
                badge.innerText = query ? `${filteredStudents.length} Hasil` : `${filteredStudents.length} Siswa`;
            }

            if (filteredStudents.length === 0) {
                const safeQuery = escapeHtml(queryRaw.trim());
                tbody.innerHTML = query
                    ? `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400 font-bold">Tidak ada siswa yang cocok dengan pencarian "${safeQuery}" pada tahun ajaran ${currentTahun}.</td></tr>`
                    : `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400 font-bold">Belum ada siswa di kelas ini pada tahun ajaran ${currentTahun}.</td></tr>`;
                return;
            }

            filteredStudents.forEach((st, index) => {
                const poin = st.poin !== undefined ? st.poin : 0;
                let badgeClass = poin > 0 ? 'bg-green-100 text-green-800' : (poin < 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-500');
                let displayPoin = poin > 0 ? `+${poin}` : poin;

                const docId = String(st.docId || '');
                const safeDocId = escapeHtml(docId);
                const namaRapi = formatNama(st.nama);
                const safeNama = escapeHtml(namaRapi);
                const safeKelas = escapeHtml(st.calculatedKelas);

                tbody.insertAdjacentHTML('beforeend', `
                    <tr class="hover:bg-purple-50/50 transition-colors group cursor-pointer" data-student-id="${safeDocId}">
                        <td class="px-6 py-5 text-center font-black text-gray-400">${index + 1}</td>
                        <td class="px-6 py-5">
                            <p class="font-bold text-gray-900 group-hover:text-purple-700 transition-colors">${safeDocId}</p>
                        </td>
                        <td class="px-6 py-5 font-bold text-gray-700">${safeNama}</td>
                        <td class="px-6 py-5 text-center"><span class="bg-gray-100 text-gray-600 px-3 py-1 rounded-lg font-black text-xs">${safeKelas}</span></td>
                        <td class="px-6 py-5 text-center"><span class="${badgeClass} px-3 py-1 rounded-full font-black text-xs">${displayPoin}</span></td>
                        <td class="px-6 py-5">
                            <div class="flex justify-end gap-2 relative z-50" data-row-action-block>
                                <button type="button" data-student-action="profile" data-student-id="${safeDocId}" class="student-row-action text-purple-600 font-bold text-sm bg-purple-50 px-4 py-2 rounded-xl transition-opacity hover:bg-purple-100 cursor-pointer shadow-sm relative z-50">Buka Profil &rarr;</button>
                                <button type="button" data-student-action="edit" data-student-id="${safeDocId}" class="student-row-action text-orange-600 font-bold text-sm bg-orange-50 px-4 py-2 rounded-xl transition-opacity hover:bg-orange-100 cursor-pointer shadow-sm relative z-50">Edit</button>
                                <button type="button" data-student-action="delete" data-student-id="${safeDocId}" class="student-row-action text-red-600 font-bold text-sm bg-red-50 px-4 py-2 rounded-xl transition-opacity hover:bg-red-100 cursor-pointer shadow-sm relative z-50">Hapus</button>
                            </div>
                        </td>
                    </tr>
                `);
            });
        };

        const updateDashboardSummary = (students) => {
            const total = students.length;
            const positive = students.filter(st => (st.poin || 0) > 0).length;
            const negative = students.filter(st => (st.poin || 0) < 0).length;
            const neutral = students.filter(st => (st.poin || 0) === 0).length;

            const setText = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.innerText = value;
            };

            setText('dashboard-total-active', total);
            setText('dashboard-positive-count', positive);
            setText('dashboard-neutral-count', neutral);
            setText('dashboard-negative-count', negative);
        };

        window.clearDashboardSearch = () => {
            const input = document.getElementById('filter-siswa-query');
            if (!input) return;
            input.value = '';
            input.focus();
            renderDashboard();
        };

        const initApp = async () => {
            try {
                await renderAppFragments();
            } catch (err) {
                console.error('Failed to load HTML partials:', err);
            }
            setupTahunAjaran();
            registerStudentTableEvents();
        };

        initApp().catch(console.error);

        // --- FITUR HAPUS SATUAN ---
        let studentToDeleteId = null;

        window.hapusSiswa = (docId) => {
            const st = studentsData.find(s => s.docId === docId);
            const nama = st ? formatNama(st.nama) : docId;
            studentToDeleteId = docId;
            const delName = document.getElementById('delete-student-name');
            const delModal = document.getElementById('delete-modal');
            if (delName) delName.innerText = nama;
            if (delModal) delModal.classList.remove('hidden');
        };

        window.batalHapus = () => {
            studentToDeleteId = null;
            const delModal = document.getElementById('delete-modal');
            if (delModal) delModal.classList.add('hidden');
        };

        window.konfirmasiHapus = async () => {
            if (!studentToDeleteId) return;
            const overlay = document.getElementById('loading-overlay');
            const text = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (text) text.innerText = "Menghapus Data Permanen...";
            try {
                await deleteDoc(doc(db, 'students', studentToDeleteId));
                batalHapus();
            } catch (err) {
                console.error("Gagal menghapus:", err);
                batalHapus();
                showCustomAlert("Gagal menghapus siswa.", true);
            }
            if (overlay) overlay.classList.add('hidden');
        };

        window.hapusSemuaSiswa = () => {
            const modal = document.getElementById('delete-all-modal');
            if (modal) modal.classList.remove('hidden');
        };

        window.batalHapusSemua = () => {
            const modal = document.getElementById('delete-all-modal');
            if (modal) modal.classList.add('hidden');
        };

        window.konfirmasiHapusSemua = async () => {
            const overlay = document.getElementById('loading-overlay');
            const text = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (text) text.innerText = "Menghapus SELURUH Data Siswa...";

            try {
                const deletePromises = studentsData.map(st => deleteDoc(doc(db, 'students', st.docId)));
                await Promise.all(deletePromises);
                batalHapusSemua();
                showCustomAlert("Berhasil! Seluruh data siswa telah dikosongkan.", false);
            } catch (err) {
                console.error("Gagal menghapus semua:", err);
                batalHapusSemua();
                showCustomAlert("Terjadi kesalahan saat menghapus data massal.", true);
            }
            if (overlay) overlay.classList.add('hidden');
        };

        window.tambahTugas = async () => {
            const currentTahun = document.getElementById('filter-tahun')?.value || '2025/2026';
            const mapel = document.getElementById('tugas-mapel')?.value || '';
            const kelas = document.getElementById('tugas-kelas')?.value || '';
            const judulInput = document.getElementById('tugas-judul');
            const tenggatInput = document.getElementById('tugas-tenggat');
            const judul = judulInput ? judulInput.value.trim() : '';
            const tenggat = tenggatInput ? tenggatInput.value : '';

            if (!judul || !tenggat) {
                showCustomAlert("Judul tugas dan tenggat waktu wajib diisi!", true);
                return;
            }

            const overlay = document.getElementById('loading-overlay');
            const text = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (text) text.innerText = "Menyebarkan Tugas...";

            try {
                const newId = 'TGS' + Date.now();
                await setDoc(doc(db, 'assignments', newId), {
                    id: newId,
                    mapel: mapel,
                    kelas: kelas,
                    judul: judul,
                    tenggat: tenggat,
                    tahun_ajaran: currentTahun,
                    tanggal_dibuat: new Date().toISOString()
                });
                if (judulInput) judulInput.value = '';
                if (tenggatInput) tenggatInput.value = '';
            } catch (e) {
                console.error(e);
                showCustomAlert("Gagal menambah tugas. Pastikan Aturan Firebase mengizinkan penulisan ke koleksi 'assignments'.", true);
            }
            if (overlay) overlay.classList.add('hidden');
        };

        let taskToDeleteId = null;

        window.hapusTugas = (id) => {
            taskToDeleteId = id;
            const modal = document.getElementById('delete-task-modal');
            if (modal) modal.classList.remove('hidden');
        };

        window.batalHapusTugas = () => {
            taskToDeleteId = null;
            const modal = document.getElementById('delete-task-modal');
            if (modal) modal.classList.add('hidden');
        };

        window.konfirmasiHapusTugas = async () => {
            if (!taskToDeleteId) return;
            const overlay = document.getElementById('loading-overlay');
            const text = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (text) text.innerText = "Menghapus Tugas...";
            try {
                await deleteDoc(doc(db, 'assignments', taskToDeleteId));
                batalHapusTugas();
            } catch (err) {
                console.error("Gagal menghapus tugas:", err);
                batalHapusTugas();
                showCustomAlert("Gagal menghapus tugas.", true);
            }
            if (overlay) overlay.classList.add('hidden');
        };

        window.renderTugasGuru = () => {
            const currentTahun = document.getElementById('filter-tahun')?.value || '2025/2026';
            const list = document.getElementById('guru-tugas-list');
            if (!list) return;

            list.innerHTML = '';

            const filtered = assignmentsData
                .filter(t => t.tahun_ajaran === currentTahun)
                .sort((a, b) => new Date(b.tanggal_dibuat) - new Date(a.tanggal_dibuat));

            if (filtered.length === 0) {
                list.innerHTML = '<div class="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200"><p class="text-gray-400 font-bold text-sm">Belum ada tugas yang diberikan di tahun ajaran ini.</p></div>';
                return;
            }

            filtered.forEach(t => {
                const d = new Date(t.tenggat).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                list.insertAdjacentHTML('beforeend', `
                    <div class="p-4 border border-gray-100 rounded-2xl flex justify-between items-center hover:shadow-md transition-shadow bg-white group">
                        <div>
                            <div class="flex items-center gap-2 mb-1">
                                <span class="bg-purple-100 text-purple-700 text-[10px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest">${t.kelas === 'ALL' ? 'Semua Kelas' : 'Kelas ' + t.kelas}</span>
                                <span class="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest">${t.mapel}</span>
                            </div>
                            <h4 class="font-bold text-gray-900">${t.judul}</h4>
                            <p class="text-xs text-red-500 font-bold mt-1">Tenggat: ${d}</p>
                        </div>
                        <button onclick="hapusTugas('${t.id}')" class="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100">🗑️</button>
                    </div>
                `);
            });
        };

        // --- FITUR EDIT SISWA ---
        let studentToEditId = null;

        window.bukaEditSiswa = (docId) => {
            const currentTahun = document.getElementById('filter-tahun')?.value || '2025/2026';
            const st = studentsData.find(s => s.docId === docId);
            if (!st) {
                showCustomAlert("Data siswa tidak ditemukan. Coba muat ulang halaman.", true);
                return;
            }
            const calculatedKelas = calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun);

            studentToEditId = docId;
            const idInput = document.getElementById('edit-nis-input');
            const namaInput = document.getElementById('edit-nama-input');
            const kelasInput = document.getElementById('edit-kelas-input');
            const modal = document.getElementById('edit-modal');

            if (idInput) idInput.value = docId;
            if (namaInput) namaInput.value = formatNama(st.nama);
            if (kelasInput) kelasInput.value = (calculatedKelas !== 'Lulus' && calculatedKelas !== 'Belum Masuk') ? calculatedKelas : '';
            if (modal) modal.classList.remove('hidden');
        };

        window.batalEdit = () => {
            studentToEditId = null;
            const modal = document.getElementById('edit-modal');
            if (modal) modal.classList.add('hidden');
        };

        window.konfirmasiEdit = async () => {
            if (!studentToEditId) return;
            const currentTahun = document.getElementById('filter-tahun')?.value || '2025/2026';
            const namaInput = document.getElementById('edit-nama-input');
            const kelasInput = document.getElementById('edit-kelas-input');

            const newNama = namaInput ? formatNama(namaInput.value.trim()) : '';
            const newKelas = kelasInput ? kelasInput.value.trim() : '';

            if (!newNama || !newKelas) {
                showCustomAlert("Nama dan Kelas tidak boleh kosong!", true);
                return;
            }

            const overlay = document.getElementById('loading-overlay');
            const text = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (text) text.innerText = "Menyimpan Perubahan...";

            try {
                await setDoc(doc(db, 'students', studentToEditId), {
                    nama: newNama,
                    base_kelas: newKelas,
                    base_tahun: currentTahun,
                    kelas: newKelas
                }, { merge: true });
                batalEdit();
            } catch (err) {
                console.error("Gagal mengedit:", err);
                batalEdit();
                showCustomAlert("Gagal menyimpan perubahan.", true);
            }
            if (overlay) overlay.classList.add('hidden');
        };

        window.renderLeaderboard = () => {
            const currentTahun = document.getElementById('filter-tahun')?.value || '2025/2026';
            const selectedBulan = document.getElementById('leaderboard-bulan')?.value || 'ALL';

            const listUnggulan = document.getElementById('list-unggulan');
            const listBimbingan = document.getElementById('list-bimbingan');

            if (listUnggulan) listUnggulan.innerHTML = '';
            if (listBimbingan) listBimbingan.innerHTML = '';

            let activeStudents = studentsData.map(st => {
                let periodPoin = 0;

                if (selectedBulan === 'ALL') {
                    periodPoin = st.poin || 0;
                } else {
                    if (st.point_history && Array.isArray(st.point_history)) {
                        st.point_history.forEach(item => {
                            if (item.category !== 'Akademik' && item.date) {
                                const parts = item.date.split('/');
                                if (parts.length === 3) {
                                    const historyMonth = parseInt(parts[1]);
                                    if (historyMonth === parseInt(selectedBulan)) {
                                        periodPoin += (item.pointChange || 0);
                                    }
                                }
                            }
                        });
                    }
                }

                return {
                    ...st,
                    calculatedKelas: calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun),
                    periodPoin: periodPoin
                };
            }).filter(st => st.calculatedKelas !== 'Lulus' && st.calculatedKelas !== 'Belum Masuk');

            const sortedDesc = [...activeStudents].sort((a, b) => (b.periodPoin || 0) - (a.periodPoin || 0));
            const sortedAsc = [...activeStudents].sort((a, b) => (a.periodPoin || 0) - (b.periodPoin || 0));

            const topPositif = sortedDesc.filter(st => (st.periodPoin || 0) > 0).slice(0, 10);
            if (topPositif.length === 0 && listUnggulan) {
                listUnggulan.innerHTML = `<div class="text-center py-8"><p class="text-sm text-gray-400 font-bold">Belum ada siswa dengan poin positif ${selectedBulan === 'ALL' ? 'di tahun ini' : 'di bulan ini'}.</p></div>`;
            } else if (listUnggulan) {
                topPositif.forEach((st, idx) => {
                    listUnggulan.insertAdjacentHTML('beforeend', `
                        <div class="flex justify-between items-center p-3 hover:bg-green-50 rounded-2xl transition-all cursor-pointer border border-transparent hover:border-green-100 group" onclick="openStudentEditor('${st.docId}')">
                            <div class="flex items-center gap-4">
                                <div class="w-8 h-8 rounded-full bg-green-100 text-green-700 font-black flex items-center justify-center text-xs group-hover:scale-110 transition-transform">${idx + 1}</div>
                                <div>
                                    <p class="font-bold text-gray-800 text-sm">${formatNama(st.nama)}</p>
                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Kelas ${st.calculatedKelas}</p>
                                </div>
                            </div>
                            <span class="bg-green-100 text-green-700 px-4 py-1.5 rounded-full font-black text-sm">+${st.periodPoin}</span>
                        </div>
                    `);
                });
            }

            const topNegatif = sortedAsc.filter(st => (st.periodPoin || 0) < 0).slice(0, 15);
            if (topNegatif.length === 0 && listBimbingan) {
                listBimbingan.innerHTML = `<div class="text-center py-8"><p class="text-sm text-gray-400 font-bold">Alhamdulillah, tidak ada siswa yang berada di poin negatif ${selectedBulan === 'ALL' ? 'di tahun ini' : 'di bulan ini'}.</p></div>`;
            } else if (listBimbingan) {
                topNegatif.forEach((st, idx) => {
                    listBimbingan.insertAdjacentHTML('beforeend', `
                        <div class="flex justify-between items-center p-3 hover:bg-red-50 rounded-2xl transition-all cursor-pointer border border-transparent hover:border-red-100 group" onclick="openStudentEditor('${st.docId}')">
                            <div class="flex items-center gap-4">
                                <div class="w-8 h-8 rounded-full bg-red-100 text-red-700 font-black flex items-center justify-center text-xs group-hover:scale-110 transition-transform">${idx + 1}</div>
                                <div>
                                    <p class="font-bold text-gray-800 text-sm">${formatNama(st.nama)}</p>
                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Kelas ${st.calculatedKelas}</p>
                                </div>
                            </div>
                            <span class="bg-red-100 text-red-700 px-4 py-1.5 rounded-full font-black text-sm">${st.periodPoin}</span>
                        </div>
                    `);
                });
            }
        };

        const getDisplayDateFromInput = () => {
            const dateInput = document.getElementById('input-tanggal-aksi');
            const dateVal = dateInput ? dateInput.value : '';
            let displayDate = new Date().toLocaleDateString('id-ID');
            if (dateVal) {
                const [y, m, d] = dateVal.split('-');
                displayDate = `${parseInt(d)}/${parseInt(m)}/${y}`;
            }
            return displayDate;
        };

        window.openStudentEditor = async (docId) => {
            const currentTahun = document.getElementById('filter-tahun')?.value || '2025/2026';
            const st = studentsData.find(s => s.docId === docId);
            if (!st) {
                showCustomAlert("Data siswa tidak ditemukan. Coba muat ulang halaman.", true);
                return;
            }
            await autoFixStudentData(st);

            const calculatedKelas = calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', currentTahun);

            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');

            const dateInput = document.getElementById('input-tanggal-aksi');
            if (dateInput) dateInput.value = `${year}-${month}-${day}`;

            currentStudentId = docId;

            const titleEl = document.getElementById('editor-title');
            const nisEl = document.getElementById('editor-nis');
            const badgeEl = document.getElementById('editor-badge-kelas');
            const poinEl = document.getElementById('guru-view-poin');

            if (titleEl) titleEl.innerText = formatNama(st.nama);
            if (nisEl) nisEl.innerText = `ID / NIS: ${st.docId}`;
            if (badgeEl) badgeEl.innerText = `KELAS ${calculatedKelas}`;
            if (poinEl) poinEl.innerText = st.poin !== undefined ? st.poin : 0;

            const grid = document.getElementById('subjects-grid');
            if (grid) {
                grid.innerHTML = '';
                st.subjects.forEach((sub, idx) => {
                    grid.insertAdjacentHTML('beforeend', `
                        <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-purple-200 transition-colors">
                            <div class="flex justify-between items-center mb-3">
                                <h4 class="font-bold text-gray-800 text-sm">${sub.name}</h4>
                                <span class="text-[9px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md">${sub.last_updated_date ? 'Update: ' + sub.last_updated_date : 'Belum Dinilai'}</span>
                            </div>
                            <div class="grid grid-cols-4 gap-2 mb-3">
                                <div>
                                    <p class="text-[9px] font-bold text-gray-500 uppercase text-center mb-1">Harian</p>
                                    <input type="number" value="${sub.score_harian || 0}" onchange="updateSubjectScore(${idx}, 'harian', this.value)" class="w-full p-1.5 text-center font-black text-purple-700 bg-purple-50 border-none rounded-lg text-xs" placeholder="0">
                                </div>
                                <div>
                                    <p class="text-[9px] font-bold text-gray-500 uppercase text-center mb-1">Mingguan</p>
                                    <input type="number" value="${sub.score_uh || 0}" onchange="updateSubjectScore(${idx}, 'uh', this.value)" class="w-full p-1.5 text-center font-black text-purple-700 bg-purple-50 border-none rounded-lg text-xs" placeholder="0">
                                </div>
                                <div>
                                    <p class="text-[9px] font-bold text-gray-500 uppercase text-center mb-1">PTS</p>
                                    <input type="number" value="${sub.score_pts || 0}" onchange="updateSubjectScore(${idx}, 'pts', this.value)" class="w-full p-1.5 text-center font-black text-purple-700 bg-purple-50 border-none rounded-lg text-xs" placeholder="0">
                                </div>
                                <div>
                                    <p class="text-[9px] font-bold text-gray-500 uppercase text-center mb-1">PAS</p>
                                    <input type="number" value="${sub.score_pas || 0}" onchange="updateSubjectScore(${idx}, 'pas', this.value)" class="w-full p-1.5 text-center font-black text-purple-700 bg-purple-50 border-none rounded-lg text-xs" placeholder="0">
                                </div>
                            </div>
                            <input type="text" value="${sub.note || ''}" onchange="updateSubjectNote(${idx}, this.value)" placeholder="Catatan/Materi yang dinilai..." class="w-full p-2.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-xl border-none focus:bg-white focus:ring-1 focus:ring-purple-500">
                        </div>
                    `);
                });
            }

            const filterEl = document.getElementById('guru-timeline-filter');
            if (filterEl) filterEl.value = 'ALL';
            window.applyTimelineFilter('guru');

            switchTab('editor');
        };

        window.updateSubjectScore = async (idx, type, val) => {
            const stIdx = studentsData.findIndex(s => s.docId === currentStudentId);
            let st = studentsData[stIdx];
            const subjectName = st.subjects[idx].name;
            const scoreVal = parseInt(val) || 0;

            const oldVal = st.subjects[idx][`score_${type}`] || 0;
            if (oldVal === scoreVal) return;

            st.subjects[idx][`score_${type}`] = scoreVal;
            st.subjects[idx].last_updated_date = getDisplayDateFromInput();

            let typeLabel = type.toUpperCase();
            if (type === 'harian') typeLabel = 'Harian';
            if (type === 'uh') typeLabel = 'Mingguan (UH)';

            const displayDate = getDisplayDateFromInput();
            const newEvent = {
                id: Date.now(),
                date: displayDate,
                time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                category: 'Akademik',
                desc: `Nilai ${typeLabel} ${subjectName} diperbarui: ${scoreVal}`,
                pointChange: 0,
                icon: '📚'
            };

            if (!st.point_history) st.point_history = [];
            st.point_history.unshift(newEvent);
            if (st.point_history.length > 300) st.point_history.pop();

            await setDoc(doc(db, 'students', currentStudentId), st);
            window.applyTimelineFilter('guru');
        };

        window.updateSubjectNote = async (idx, val) => {
            const stIdx = studentsData.findIndex(s => s.docId === currentStudentId);
            let st = studentsData[stIdx];
            const subjectName = st.subjects[idx].name;

            const oldVal = st.subjects[idx].note || '';
            if (oldVal === val) return;

            st.subjects[idx].note = val;
            st.subjects[idx].last_updated_date = getDisplayDateFromInput();

            const displayDate = getDisplayDateFromInput();
            const newEvent = {
                id: Date.now(),
                date: displayDate,
                time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                category: 'Akademik',
                desc: `Catatan ${subjectName} diperbarui: "${val || 'Dikosongkan'}"`,
                pointChange: 0,
                icon: '📝'
            };

            if (!st.point_history) st.point_history = [];
            st.point_history.unshift(newEvent);
            if (st.point_history.length > 300) st.point_history.pop();

            await setDoc(doc(db, 'students', currentStudentId), st);
            window.applyTimelineFilter('guru');
        };

        window.quickTrackEvent = async (category, desc, pointVal, icon) => {
            const stIdx = studentsData.findIndex(s => s.docId === currentStudentId);
            let st = studentsData[stIdx];

            const displayDate = getDisplayDateFromInput();

            const newEvent = {
                id: Date.now(), date: displayDate, time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                category: category, desc: desc, pointChange: pointVal, icon: icon
            };

            st.point_history.unshift(newEvent);
            if (st.point_history.length > 300) st.point_history.pop();
            st.poin = (st.poin || 0) + pointVal;

            await setDoc(doc(db, 'students', currentStudentId), st);
            window.applyTimelineFilter('guru');
        };

        window.tambahTransaksiPoin = async () => {
            const jenisInput = document.getElementById('poin-jenis');
            const angkaInput = document.getElementById('poin-angka');
            const catatanInput = document.getElementById('poin-catatan');

            const jenis = jenisInput ? jenisInput.value : 'plus';
            const angka = angkaInput ? parseInt(angkaInput.value) : 0;
            const catatan = catatanInput ? catatanInput.value : '';

            if (!angka || !catatan) {
                showCustomAlert("Jumlah angka poin dan catatan keterangan wajib diisi!", true);
                return;
            }

            const pointVal = jenis === 'plus' ? Math.abs(angka) : -Math.abs(angka);
            await quickTrackEvent('Buku Poin / Evaluasi', catatan, pointVal, jenis === 'plus' ? '⭐' : '⚠️');

            if (angkaInput) angkaInput.value = '';
            if (catatanInput) catatanInput.value = '';
        };

        window.updateOrtuView = () => {
            if (window.currentParentData) {
                loadParentDashboard(window.currentParentData);
            }
        };

        function loadParentDashboard(st) {
            try {
                const errorBox = document.getElementById('ortu-error-box');
                const contentBox = document.getElementById('ortu-content-box');
                if (errorBox) errorBox.classList.add('hidden');
                if (contentBox) contentBox.classList.remove('hidden');

                const ortuTahunInput = document.getElementById('ortu-filter-tahun');
                const ortuTahun = ortuTahunInput ? ortuTahunInput.value : '2025/2026';
                const calculatedKelas = calculateCurrentKelas(st.base_kelas || st.kelas, st.base_tahun || '2025/2026', ortuTahun);

                const viewNama = document.getElementById('view-ortu-nama');
                const viewKelas = document.getElementById('view-ortu-kelas');
                const viewId = document.getElementById('view-ortu-id');
                const viewPoin = document.getElementById('ortu-poin');

                if (viewNama) viewNama.innerText = formatNama(st.nama) || "Tanpa Nama";
                if (viewKelas) viewKelas.innerText = calculatedKelas;
                if (viewId) viewId.innerText = st.docId || "-";
                if (viewPoin) viewPoin.innerText = st.poin !== undefined ? st.poin : 0;

                let totalScore = 0;
                let scoredSubjectsCount = 0;
                let wafaScore = 0;

                if (st.subjects && Array.isArray(st.subjects)) {
                    st.subjects.forEach(sub => {
                        const scores = [sub.score_harian || 0, sub.score_uh || 0, sub.score_pts || 0, sub.score_pas || 0];
                        scores.forEach(s => {
                            if (s > 0) {
                                totalScore += s;
                                scoredSubjectsCount++;
                            }
                        });
                        if (sub.name.toLowerCase().includes('wafa') || sub.name.toLowerCase().includes('tahfidz')) {
                            wafaScore = sub.score_harian || sub.score_uh || sub.score_pts || sub.score_pas || 0;
                        }
                    });
                }
                const avgAkademik = scoredSubjectsCount > 0 ? Math.round(totalScore / scoredSubjectsCount) : 0;

                const history = st.point_history || [];
                let positiveCount = 0;
                const validCharacterHistory = history.filter(item => item.category !== 'Akademik');
                validCharacterHistory.forEach(item => {
                    if (item.pointChange > 0) positiveCount++;
                });
                const characterTrend = validCharacterHistory.length > 0 ? Math.round((positiveCount / validCharacterHistory.length) * 100) : 100;

                const valAkad = document.getElementById('stat-akademik-val');
                const barAkad = document.getElementById('stat-akademik-bar');
                if (valAkad) valAkad.innerText = `${avgAkademik}%`;
                if (barAkad) barAkad.style.width = `${avgAkademik}%`;

                const valHafal = document.getElementById('stat-hafalan-val');
                const barHafal = document.getElementById('stat-hafalan-bar');
                if (valHafal) valHafal.innerText = `${wafaScore}%`;
                if (barHafal) barHafal.style.width = `${wafaScore}%`;

                const valKar = document.getElementById('stat-karakter-val');
                const barKar = document.getElementById('stat-karakter-bar');
                if (valKar) valKar.innerText = `${characterTrend}%`;
                if (barKar) barKar.style.width = `${characterTrend}%`;

                const tbody = document.getElementById('ortu-subjects-body');
                if (tbody) {
                    tbody.innerHTML = '';
                    if (st.subjects && Array.isArray(st.subjects) && st.subjects.length > 0) {
                        st.subjects.forEach(sub => {
                            tbody.insertAdjacentHTML('beforeend', `
                                <tr class="hover:bg-purple-50/30 transition-colors">
                                    <td class="px-4 py-4">
                                        <p class="font-extrabold text-gray-800">${sub.name || '-'}</p>
                                        <p class="text-[9px] font-bold text-gray-400 mt-1">${sub.last_updated_date ? 'Diperbarui: ' + sub.last_updated_date : 'Belum dinilai'}</p>
                                    </td>
                                    <td class="px-3 py-4 text-center font-black text-sm text-purple-600 bg-purple-50/20">${sub.score_harian || 0}</td>
                                    <td class="px-3 py-4 text-center font-black text-sm text-purple-600 bg-purple-50/40">${sub.score_uh || 0}</td>
                                    <td class="px-3 py-4 text-center font-black text-sm text-purple-600 bg-purple-50/60">${sub.score_pts || 0}</td>
                                    <td class="px-3 py-4 text-center font-black text-sm text-purple-600 bg-purple-50/80">${sub.score_pas || 0}</td>
                                    <td class="px-4 py-4 text-gray-600 font-medium text-xs">${sub.note || '<span class="text-gray-300 italic">Tidak ada catatan</span>'}</td>
                                </tr>
                            `);
                        });
                    } else {
                        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400 font-bold">Data nilai belum diinput guru.</td></tr>';
                    }
                }

                const ortuTugasList = document.getElementById('ortu-tugas-list');
                if (ortuTugasList) {
                    ortuTugasList.innerHTML = '';
                    const myTasks = assignmentsData
                        .filter(t => t.tahun_ajaran === ortuTahun && (t.kelas === 'ALL' || t.kelas === calculatedKelas))
                        .sort((a, b) => new Date(a.tenggat) - new Date(b.tenggat));

                    if (myTasks.length === 0) {
                        ortuTugasList.innerHTML = '<div class="text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200"><p class="text-gray-400 font-bold text-sm">Alhamdulillah, tidak ada tugas / PR yang aktif.</p></div>';
                    } else {
                        myTasks.forEach(t => {
                            const d = new Date(t.tenggat).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                            const isOverdue = new Date(t.tenggat) < new Date(new Date().setHours(0, 0, 0, 0));
                            const colorClass = isOverdue ? 'text-red-500' : 'text-purple-600';

                            ortuTugasList.insertAdjacentHTML('beforeend', `
                                <div class="p-4 border border-gray-100 rounded-2xl bg-white shadow-sm flex items-start gap-4">
                                    <div class="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center text-xl shrink-0">📝</div>
                                    <div>
                                        <span class="bg-purple-100 text-purple-700 text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-widest">${t.mapel}</span>
                                        <h4 class="font-bold text-gray-900 mt-1">${t.judul}</h4>
                                        <p class="text-xs ${colorClass} font-bold mt-1">Tenggat: ${d} ${isOverdue ? '(Melewati Tenggat)' : ''}</p>
                                    </div>
                                </div>
                            `);
                        });
                    }
                }

                const filterElOrtu = document.getElementById('ortu-timeline-filter');
                if (filterElOrtu && filterElOrtu.value === '') filterElOrtu.value = 'ALL';
                window.applyTimelineFilter('ortu');

            } catch (err) {
                console.error("Kesalahan Rendering Visual:", err);
                tampilkanErrorOrtu("Gangguan Visual", "Maaf, sistem mendeteksi ketidakcocokan data. Silakan hubungi admin sekolah.");
            }
        }

        window.handleFileUpload = async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const overlay = document.getElementById('loading-overlay');
            const overlayText = document.getElementById('loading-text');
            if (overlay) overlay.classList.remove('hidden');
            if (overlayText) overlayText.innerText = "Mengimpor & Membaca CSV...";

            const tahunInput = document.getElementById('filter-tahun');
            const currentTahun = tahunInput ? tahunInput.value : '2025/2026';
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
                            subjects: subjectsList.map(name => ({ name: name, score_harian: 0, score_uh: 0, score_pts: 0, score_pas: 0, note: '', last_updated_date: '' }))
                        };
                        await setDoc(studentRef, data);
                        newCount++;
                    }
                }
            }
            if (overlay) overlay.classList.add('hidden');
            const csvInput = document.getElementById('csv-input');
            if (csvInput) csvInput.value = "";
            showCustomAlert(`Selesai! ${newCount} siswa baru didaftarkan, ${updateCount} siswa lama berhasil diperbarui untuk tahun ${currentTahun}.`, false);
        };
