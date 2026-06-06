export const showCustomAlert = (message, isError = false) => {
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

export const closeGlobalAlert = () => {
    const modalEl = document.getElementById('global-alert-modal');
    if (modalEl) modalEl.classList.add('hidden');
};

export const showLoading = (message) => {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    if (overlay) overlay.classList.remove('hidden');
    if (text) text.innerText = message;
};

export const hideLoading = () => {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
};

export const switchTab = (mode) => {
    const sections = ['dashboard', 'leaderboard', 'tugas', 'editor', 'viewer', 'kurikulum'];

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
};

export const toggleModal = (modalId, show = true) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        if (show) modal.classList.remove('hidden');
        else modal.classList.add('hidden');
    }
};
