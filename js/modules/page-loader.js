export const loadPartial = async (filePath) => {
    const cacheBuster = `?v=${new Date().getTime()}`;
    const response = await fetch(filePath + cacheBuster);
    if (!response.ok) {
        throw new Error(`Failed to load partial: ${filePath}`);
    }
    return response.text();
};

export const renderAppFragments = async () => {
    const root = document.getElementById('app-root');
    if (!root) return;

    // Gunakan path absolut dari root domain untuk keamanan di Vercel
    const loadingHtml = await loadPartial('/partials/loading.html');
    const loginHtml = await loadPartial('/partials/login-screen.html');
    const ortuHtml = await loadPartial('/partials/ortu-setup-screen.html');
    const mainHtml = await loadPartial('/partials/main-app.html');
    const modalsHtml = await loadPartial('/partials/body-modals.html');

    root.innerHTML = loadingHtml + loginHtml + ortuHtml + mainHtml + modalsHtml;
};

export const registerStudentTableEvents = () => {
    const studentTableBody = document.getElementById('student-table-body');
    if (!studentTableBody) return;

    studentTableBody.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) return;

        const actionButton = target.closest('[data-student-action]');
        if (actionButton) {
            event.preventDefault();
            event.stopPropagation();
            const docId = actionButton.getAttribute('data-student-id');
            if (!docId) return;

            if (actionButton.dataset.studentAction === 'profile') {
                window.openStudentEditor(docId);
            } else if (actionButton.dataset.studentAction === 'edit') {
                window.bukaEditSiswa(docId);
            } else if (actionButton.dataset.studentAction === 'delete') {
                window.hapusSiswa(docId);
            }
            return;
        }

        if (target.closest('[data-row-action-block], button, a, input, select, textarea')) return;

        const row = target.closest('tr[data-student-id]');
        if (row) {
            window.openStudentEditor(row.dataset.studentId);
        }
    });
};
