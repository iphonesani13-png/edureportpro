export const parseDate = (dateStr) => {
    if (!dateStr) return new Date();
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return new Date();
};

export const formatNama = (str) => {
    if (!str) return "";
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

export const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));

export const calculateCurrentKelas = (baseKelas, baseTahun, viewTahun) => {
    if (!baseKelas || !baseTahun || !viewTahun) return baseKelas || '-';
    const baseYearInt = parseInt(baseTahun.split('/')[0], 10);
    const viewYearInt = parseInt(viewTahun.split('/')[0], 10);

    if (isNaN(baseYearInt) || isNaN(viewYearInt)) return baseKelas;

    const diff = viewYearInt - baseYearInt;
    if (diff === 0) return baseKelas;

    const match = baseKelas.match(/^(\d+)(.*)$/);
    if (!match) return baseKelas;

    let newGrade = parseInt(match[1], 10) + diff;
    let suffix = match[2];

    if (newGrade > 9) return 'Lulus';
    if (newGrade < 7) return 'Belum Masuk';

    if (newGrade > 7) {
        suffix = '';
    }

    return newGrade + suffix;
};

export const getActiveTahun = () => {
    const saved = localStorage.getItem('tahun_ajaran');
    if (saved) return saved;
    const now = new Date();
    const y = now.getFullYear();
    const startYear = now.getMonth() < 6 ? y - 1 : y;
    return `${startYear}/${startYear + 1}`;
};
