import { formatNama, escapeHtml, calculateCurrentKelas } from "./utils.js";
import { switchTab } from "./ui-manager.js";

export const updateDashboardSummary = (students) => {
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

export const renderTimeline = (history, elementId) => {
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

export const renderDashboardTable = (students, query, currentTahun) => {
    const tbody = document.getElementById('student-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (students.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400 font-bold">Tidak ada siswa yang ditemukan.</td></tr>`;
        return;
    }

    students.forEach((st, index) => {
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

export const renderLeaderboard = (studentsData, currentTahun, selectedBulan) => {
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
                <div class="flex justify-between items-center p-3 hover:bg-green-50 rounded-2xl transition-all cursor-pointer border border-transparent hover:border-green-100 group" onclick="window.openStudentEditor('${st.docId}')">
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
                <div class="flex justify-between items-center p-3 hover:bg-red-50 rounded-2xl transition-all cursor-pointer border border-transparent hover:border-red-100 group" onclick="window.openStudentEditor('${st.docId}')">
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

export const loadParentDashboard = (st, assignmentsData, ortuTahun) => {
    try {
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
                const scores = [
                    sub.score_harian || 0, 
                    sub.score_tugas || 0, 
                    sub.score_uh || 0, 
                    sub.score_pts || 0, 
                    sub.score_pas || 0,
                    sub.score_pat || 0
                ];
                scores.forEach(s => {
                    if (s > 0) {
                        totalScore += s;
                        scoredSubjectsCount++;
                    }
                });
                if (sub.name.toLowerCase().includes('wafa') || sub.name.toLowerCase().includes('tahfidz')) {
                    wafaScore = sub.score_harian || sub.score_tugas || sub.score_uh || sub.score_pts || sub.score_pas || sub.score_pat || 0;
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

        const updateBar = (valId, barId, val) => {
            const valEl = document.getElementById(valId);
            const barEl = document.getElementById(barId);
            if (valEl) valEl.innerText = `${val}%`;
            if (barEl) barEl.style.width = `${val}%`;
        };

        updateBar('stat-akademik-val', 'stat-akademik-bar', avgAkademik);
        updateBar('stat-hafalan-val', 'stat-hafalan-bar', wafaScore);
        updateBar('stat-karakter-val', 'stat-karakter-bar', characterTrend);

        // --- RENDER RAT CHART (Tugas vs UH vs PAS/PAT) ---
        const ratCanvas = document.getElementById('ratChart');
        if (ratCanvas && window.Chart) {
            if (window.ratChartInstance) {
                window.ratChartInstance.destroy();
            }

            const chartLabels = [];
            const dataTugas = [];
            const dataUH = [];
            const dataRAT = [];

            if (st.subjects && Array.isArray(st.subjects)) {
                st.subjects.forEach(sub => {
                    chartLabels.push(sub.name || 'Mapel');
                    dataTugas.push(sub.score_tugas || 0);
                    dataUH.push(sub.score_uh || 0);
                    dataRAT.push(sub.score_pas || sub.score_pat || 0); // The Real Assessment
                });
            }

            window.ratChartInstance = new Chart(ratCanvas, {
                type: 'bar',
                data: {
                    labels: chartLabels,
                    datasets: [
                        {
                            label: 'Nilai Tugas',
                            data: dataTugas,
                            backgroundColor: '#93c5fd', // blue-300
                            borderRadius: 4
                        },
                        {
                            label: 'Ulangan Harian (UH)',
                            data: dataUH,
                            backgroundColor: '#fcd34d', // amber-300
                            borderRadius: 4
                        },
                        {
                            label: 'Real Assessment (PAS/PAT)',
                            data: dataRAT,
                            backgroundColor: '#10b981', // emerald-500
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            grid: { color: '#f1f5f9' }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { font: { size: 10 } }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                font: { size: 10, family: "'Inter', sans-serif", weight: 'bold' },
                                usePointStyle: true,
                                boxWidth: 8
                            }
                        },
                        tooltip: {
                            backgroundColor: '#1e293b',
                            titleFont: { family: "'Inter', sans-serif", size: 12 },
                            bodyFont: { family: "'Inter', sans-serif", size: 12 },
                            padding: 12,
                            cornerRadius: 8
                        }
                    }
                }
            });
        }
        // --- END RAT CHART ---

        const tbody = document.getElementById('ortu-subjects-body');
        if (tbody) {
            tbody.innerHTML = '';
            if (st.subjects && Array.isArray(st.subjects) && st.subjects.length > 0) {
                st.subjects.forEach(sub => {
                    tbody.insertAdjacentHTML('beforeend', `
                        <tr class="hover:bg-indigo-50/30 transition-colors">
                            <td class="px-4 py-4">
                                <p class="font-extrabold text-gray-800">${sub.name || '-'}</p>
                                <p class="text-[9px] font-bold text-gray-400 mt-1">${sub.last_updated_date ? 'Diperbarui: ' + sub.last_updated_date : 'Belum dinilai'}</p>
                            </td>
                            <td class="px-3 py-4 text-center font-black text-sm text-indigo-600 bg-indigo-50/20">${sub.score_harian || 0}</td>
                            <td class="px-3 py-4 text-center font-black text-sm text-indigo-600 bg-indigo-50/40">${sub.score_tugas || 0}</td>
                            <td class="px-3 py-4 text-center font-black text-sm text-indigo-600 bg-indigo-50/60">${sub.score_uh || 0}</td>
                            <td class="px-3 py-4 text-center font-black text-sm text-indigo-600 bg-indigo-50/80">${sub.score_pas || 0}</td>
                            <td class="px-3 py-4 text-center font-black text-sm text-indigo-600 bg-indigo-100/80">${sub.score_pat || 0}</td>
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

    } catch (err) {
        console.error("Kesalahan Rendering Visual:", err);
    }
};
