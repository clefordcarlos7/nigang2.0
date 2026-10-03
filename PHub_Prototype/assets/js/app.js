// Initial Mock Database State
let rooms = [
    { id: 1, number: 'Room 101', type: 'Private', capacity: 1, status: 'Available', staff: 'Unassigned' },
    { id: 2, number: 'Room 102', type: 'Semi-Private', capacity: 1, status: 'Occupied', staff: 'Dr. Santos (Doctor)' },
    { id: 3, number: 'Room 103', type: 'ICU', capacity: 1, status: 'Cleaning', staff: 'Unassigned' },
    { id: 4, number: 'Room 104', type: 'Ward', capacity: 8, status: 'Available', staff: 'Unassigned' }
];

let patients = [
    { id: 1, name: 'Juan Dela Cruz', room: 'Room 102', admissionDate: '2026-10-01' }
];

let cleaningSchedules = [
    { id: 1, room: 'Room 103', time: '2026-10-03 14:00 (Google Calendar API)', status: 'Pending Cleaning' }
];

const appDataStorageKey = 'phub.data';
const sessionStorageKey = 'phub.session';
const expandedWardRooms = new Set();

function normalizeStaffAssignments(staff) {
    if (Array.isArray(staff)) {
        return staff.filter(member =>
            member &&
            Number.isInteger(member.id) &&
            typeof member.name === 'string' &&
            typeof member.role === 'string'
        );
    }
    if (typeof staff !== 'string' || staff === 'Unassigned') return [];

    const match = staff.match(/^(.*?)\s+\((Doctor|Nurse)\)$/);
    return [{
        id: 1,
        name: match ? match[1] : staff,
        role: match ? match[2] : 'Staff'
    }];
}

function migrateRoomDoctorsToPatients() {
    rooms.forEach(room => {
        const roomStaff = normalizeStaffAssignments(room.staff);
        const legacyDoctors = roomStaff.filter(member => member.role === 'Doctor');
        room.staff = roomStaff.filter(member => member.role !== 'Doctor');

        const roomPatients = patients.filter(patient => patient.room === room.number);
        roomPatients.forEach(patient => {
            if (!Array.isArray(patient.doctors)) patient.doctors = [];
            legacyDoctors.forEach(doctor => {
                const alreadyAssigned = patient.doctors.some(member =>
                    member.name.toLowerCase() === doctor.name.toLowerCase()
                );
                if (!alreadyAssigned) {
                    patient.doctors.push({ ...doctor, id: nextId(patient.doctors) });
                }
            });
        });
    });

    patients.forEach(patient => {
        if (!Array.isArray(patient.doctors)) patient.doctors = [];
    });
}

function getRoomPatients(room) {
    return patients.filter(patient => patient.room === room.number);
}

function getAvailableBedNumber(room) {
    for (let bedNumber = 1; bedNumber <= getRoomCapacity(room); bedNumber++) {
        const occupied = patients.some(patient => patient.room === room.number && patient.bedNumber === bedNumber);
        const cleaning = cleaningSchedules.some(schedule => schedule.room === room.number && schedule.bedNumber === bedNumber);
        if (!occupied && !cleaning) return bedNumber;
    }
    return null;
}

function assignMissingBedNumbers() {
    cleaningSchedules.forEach(schedule => {
        if (!Number.isInteger(schedule.bedNumber)) schedule.bedNumber = 1;
    });

    patients.forEach(patient => {
        const room = rooms.find(item => item.number === patient.room);
        if (!room || Number.isInteger(patient.bedNumber)) return;
        patient.bedNumber = getAvailableBedNumber(room);
    });
}

function getRoomCapacity(room) {
    return room.number === 'Room 104' ? 8 : Math.max(1, Number(room.capacity) || 1);
}

function getRoomStatus(room) {
    if (room.status === 'Maintenance') return 'Maintenance';
    const hasBedCleaning = cleaningSchedules.some(schedule => schedule.room === room.number);
    if (room.status === 'Cleaning' && !hasBedCleaning) return 'Cleaning';
    const occupiedBeds = getRoomPatients(room).length;
    const cleaningBeds = cleaningSchedules.filter(schedule => schedule.room === room.number).length;
    if (occupiedBeds + cleaningBeds >= getRoomCapacity(room)) {
        return occupiedBeds === 0 ? 'Cleaning' : 'Occupied';
    }
    return 'Available';
}

function canChangeRoomStatus(room) {
    return getRoomStatus(room) === 'Available' &&
        getRoomPatients(room).length === 0 &&
        !cleaningSchedules.some(schedule => schedule.room === room.number);
}

function getBedStatus(room, bedNumber) {
    if (room.status === 'Maintenance') return 'Maintenance';
    if (cleaningSchedules.some(schedule =>
        schedule.room === room.number && schedule.bedNumber === bedNumber
    )) {
        return 'Cleaning';
    }
    if (patients.some(patient =>
        patient.room === room.number && patient.bedNumber === bedNumber
    )) {
        return 'Occupied';
    }
    return 'Available';
}

function canAdmitToRoom(room) {
    const hasBedCleaning = cleaningSchedules.some(schedule => schedule.room === room.number);
    const hasRoomLevelCleaning = room.status === 'Cleaning' && !hasBedCleaning;
    return room.status !== 'Maintenance' && !hasRoomLevelCleaning &&
        getAvailableBedNumber(room) !== null;
}

function loadAppData() {
    rooms = rooms.map(room => ({ ...room, staff: normalizeStaffAssignments(room.staff) }));
    const stored = localStorage.getItem(appDataStorageKey);
    if (!stored) {
        assignMissingBedNumbers();
        return;
    }

    const data = JSON.parse(stored);
    if (!data || !Array.isArray(data.rooms) || !Array.isArray(data.patients) || !Array.isArray(data.cleaningSchedules)) {
        throw new Error('Saved PHub data is invalid. The saved room, patient, or cleaning data must be repaired or cleared.');
    }

    rooms = data.rooms.map(room => ({
        ...room,
        capacity: room.number === 'Room 104' ? 8 : Math.max(1, Number(room.capacity) || 1),
        staff: normalizeStaffAssignments(room.staff)
    }));
    patients = data.patients;
    cleaningSchedules = data.cleaningSchedules;
    assignMissingBedNumbers();
    migrateRoomDoctorsToPatients();
}

function saveAppData() {
    try {
        localStorage.setItem(appDataStorageKey, JSON.stringify({ rooms, patients, cleaningSchedules }));
        document.getElementById('storage-error').textContent = '';
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown browser storage error.';
        document.getElementById('storage-error').textContent = `Changes could not be saved in this browser: ${message}`;
        console.error(err);
    }
}

function nextId(items) {
    return items.reduce((highest, item) => Math.max(highest, item.id || 0), 0) + 1;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

// DOM Elements
const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const registerForm = document.getElementById('register-form');
const registerError = document.getElementById('register-error');
const registrationAccessForm = document.getElementById('registration-access-form');
const registrationAccessError = document.getElementById('registration-access-error');
const showLoginBtn = document.getElementById('show-login-btn');
const showRegisterBtn = document.getElementById('show-register-btn');
const logoutBtn = document.getElementById('logout-btn');
const userRoleBadge = document.getElementById('user-role-badge');
const staffRoleSelect = document.getElementById('staff-role-select');
const accountsStorageKey = 'phub.accounts';
const registrationInviteCode = 'admin123';
let registrationUnlocked = false;

try {
    loadAppData();
    migrateRoomDoctorsToPatients();
    rooms.forEach(room => {
        if (room.status === 'Cleaning' &&
            !cleaningSchedules.some(schedule => schedule.room === room.number)) {
            scheduleRoomCleaning(room);
        }
    });
    saveAppData();
} catch (err) {
    loginError.textContent = err instanceof Error ? err.message : 'Could not load saved PHub data.';
    console.error(err);
}

function getAccounts() {
    const storedAccounts = localStorage.getItem(accountsStorageKey);
    if (!storedAccounts) return [];

    const accounts = JSON.parse(storedAccounts);
    if (!Array.isArray(accounts)) {
        throw new Error('Saved account data is invalid. Clear this browser’s PHub account data and try again.');
    }
    return accounts;
}

function requireSecureCrypto() {
    if (!window.crypto || !window.crypto.subtle || !window.crypto.getRandomValues) {
        throw new Error('Secure account creation requires a modern browser. Open PHub through HTTPS or a local development server.');
    }
}

async function hashPassword(password, salt) {
    requireSecureCrypto();
    const key = await window.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await window.crypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt,
        iterations: 150000,
        hash: 'SHA-256'
    }, key, 256);
    return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
    if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(hex)) {
        throw new Error('Saved account data is invalid. Clear this browser’s PHub account data and try again.');
    }
    return new Uint8Array(hex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
}

function enterDashboard(user) {
    loginError.textContent = '';
    registerError.textContent = '';
    loginContainer.classList.add('hidden');
    dashboardContainer.classList.remove('hidden');
    userRoleBadge.textContent = `Role: ${user.role}`;
    document.getElementById('account-name').textContent = user.fullName || user.user;
    document.getElementById('account-username').textContent = user.user;
    document.getElementById('account-role').textContent = user.role;
    document.getElementById('account-created').textContent = user.createdAt
        ? new Date(user.createdAt).toLocaleDateString()
        : 'Existing staff account';
    try {
        localStorage.setItem(sessionStorageKey, JSON.stringify(user));
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown browser storage error.';
        document.getElementById('storage-error').textContent = `Your sign-in will not survive a refresh: ${message}`;
        console.error(err);
    }
    renderAll();
}

function setAuthMode(mode) {
    const isLogin = mode === 'login';
    const registrationFormUnlocked = !isLogin && registrationUnlocked;
    loginForm.classList.toggle('hidden', !isLogin);
    registrationAccessForm.classList.toggle('hidden', isLogin || registrationFormUnlocked);
    registerForm.classList.toggle('hidden', !registrationFormUnlocked);
    showLoginBtn.classList.toggle('active', isLogin);
    showRegisterBtn.classList.toggle('active', !isLogin);
    showLoginBtn.setAttribute('aria-selected', String(isLogin));
    showRegisterBtn.setAttribute('aria-selected', String(!isLogin));
    loginError.textContent = '';
    registerError.textContent = '';
    registrationAccessError.textContent = '';
}

showLoginBtn.addEventListener('click', () => setAuthMode('login'));
showRegisterBtn.addEventListener('click', () => setAuthMode('register'));

registrationAccessForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const submittedCode = document.getElementById('registration-access-code').value;
    if (submittedCode !== registrationInviteCode) {
        registrationAccessError.textContent = 'Invalid administrator invite code.';
        return;
    }

    registrationUnlocked = true;
    registrationAccessForm.reset();
    setAuthMode('register');
    document.getElementById('register-name').focus();
});

// Tabs Switching
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// Sign in to registered browser accounts or legacy accounts in data/legacy-credentials.txt.
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('username').value.trim();
    const normalizedUsername = usernameInput.toLowerCase();
    const passwordInput = document.getElementById('password').value;

    try {
        const account = getAccounts().find(saved => saved.username === normalizedUsername);
        if (account) {
            const submittedHash = await hashPassword(passwordInput, hexToBytes(account.salt));
            if (submittedHash !== account.passwordHash) {
                loginError.textContent = 'Invalid username or password.';
                return;
            }
            enterDashboard({
                user: account.username,
                fullName: account.fullName,
                role: account.role,
                createdAt: account.createdAt
            });
            return;
        }

        const response = await fetch('data/legacy-credentials.txt');
        if (!response.ok) {
            throw new Error(`Could not load existing staff accounts (HTTP ${response.status}).`);
        }
        const text = await response.text();
        const lines = text.split('\n');
        
        let authenticatedUser = null;
        for (const line of lines) {
            const [user, pass, role] = line.trim().split(',').map(value => value.trim());
            if (user && pass && role && user === usernameInput && pass === passwordInput) {
                authenticatedUser = { user, role };
                break;
            }
        }

        if (authenticatedUser) {
            enterDashboard(authenticatedUser);
        } else {
            loginError.textContent = 'Invalid username or password.';
        }
    } catch (err) {
        loginError.textContent = err instanceof Error
            ? `${err.message} If this is a new account, register first.`
            : 'Sign-in failed. Please try again.';
        console.error(err);
    }
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.textContent = '';
    if (!registrationUnlocked) {
        registerError.textContent = 'Enter the administrator invite code to register.';
        return;
    }

    const fullName = document.getElementById('register-name').value.trim();
    const username = document.getElementById('register-username').value.trim().toLowerCase();
    const role = document.getElementById('register-role').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;

    if (password.length < 8) {
        registerError.textContent = 'Password must be at least 8 characters long.';
        return;
    }
    if (password !== confirmPassword) {
        registerError.textContent = 'Passwords do not match.';
        return;
    }
    if (!['Nurse', 'Doctor'].includes(role)) {
        registerError.textContent = 'Choose a valid staff role.';
        return;
    }

    try {
        const accounts = getAccounts();
        if (accounts.some(account => account.username === username)) {
            registerError.textContent = 'That username is already registered.';
            return;
        }

        requireSecureCrypto();
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const account = {
            username,
            fullName,
            role,
            salt: Array.from(salt, byte => byte.toString(16).padStart(2, '0')).join(''),
            passwordHash: await hashPassword(password, salt),
            createdAt: new Date().toISOString()
        };
        accounts.push(account);
        localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
        registerForm.reset();
        enterDashboard({
            user: account.username,
            fullName: account.fullName,
            role: account.role,
            createdAt: account.createdAt
        });
    } catch (err) {
        registerError.textContent = err instanceof Error
            ? err.message
            : 'Account creation failed. Please try again.';
        console.error(err);
    }
});

logoutBtn.addEventListener('click', () => {
    registrationUnlocked = false;
    try {
        localStorage.removeItem(sessionStorageKey);
    } catch (err) {
        loginError.textContent = 'Could not clear the saved sign-in. Please close this browser tab.';
        console.error(err);
    }
    dashboardContainer.classList.add('hidden');
    loginContainer.classList.remove('hidden');
    loginForm.reset();
    setAuthMode('login');
});

try {
    const savedSession = localStorage.getItem(sessionStorageKey);
    if (savedSession) {
        const user = JSON.parse(savedSession);
        if (!user || typeof user.user !== 'string' || typeof user.role !== 'string') {
            throw new Error('Saved sign-in data is invalid. Please sign in again.');
        }
        enterDashboard(user);
    }
} catch (err) {
    loginError.textContent = err instanceof Error ? err.message : 'Could not restore your saved sign-in.';
    try {
        localStorage.removeItem(sessionStorageKey);
    } catch (storageErr) {
        console.error(storageErr);
    }
    console.error(err);
}

// Render Functions
function renderAll() {
    renderRooms();
    renderPatients();
    renderCleaning();
    populateSelectDropdowns();
}

function renderRooms() {
    const tbody = document.querySelector('#rooms-table tbody');
    tbody.innerHTML = '';
    rooms.forEach(room => {
        const isWard = room.number === 'Room 104';
        const isExpanded = expandedWardRooms.has(room.id);
        const roomPatients = getRoomPatients(room);
        const occupiedBeds = roomPatients.length;
        const cleaningBeds = cleaningSchedules.filter(schedule => schedule.room === room.number).length;
        const availableBeds = getRoomCapacity(room) - occupiedBeds - cleaningBeds;
        const statusDisplay = isWard
            ? `<div class="ward-summary">
                <span class="status-badge status-occupied">${occupiedBeds} occupied</span>
                <span class="status-badge status-cleaning">${cleaningBeds} cleaning</span>
                <span class="status-badge status-available">${availableBeds} available</span>
            </div>`
            : `<span class="status-badge status-${getRoomStatus(room).toLowerCase()}">${getRoomStatus(room)}</span>`;
        const patientDisplay = isWard
            ? `${occupiedBeds} patient${occupiedBeds === 1 ? '' : 's'}`
            : roomPatients.length
                ? `<ul class="room-staff-list">${roomPatients.map(patient =>
                    `<li>${escapeHtml(patient.name)}</li>`
                ).join('')}</ul>`
                : 'None';

        tbody.innerHTML += `
            <tr>
                <td>${room.number}</td>
                <td>${room.type}</td>
                <td>${statusDisplay}</td>
                <td>${patientDisplay}</td>
                <td>${occupiedBeds}/${getRoomCapacity(room)}</td>
                <td>${room.staff.length
                    ? `<ul class="room-staff-list">${room.staff.map(member =>
                        `<li>${escapeHtml(member.name)} (${escapeHtml(member.role)})</li>`
                    ).join('')}</ul>`
                    : 'Unassigned'}</td>
                <td class="room-actions">
                    ${isWard
                        ? `<button class="btn secondary-btn ward-toggle-btn" onclick="toggleWardBeds(${room.id})" aria-expanded="${isExpanded}" aria-controls="ward-beds-${room.id}">${isExpanded ? 'Hide Beds' : 'View Beds'}</button>`
                        : ''}
                    ${getRoomStatus(room) === 'Maintenance'
                        ? `<button class="btn primary-btn" onclick="completeRoomMaintenance(${room.id})">Mark Available</button>`
                        : `<button class="btn secondary-btn" onclick="openRoomModal(${room.id})">${canChangeRoomStatus(room) ? 'Update Status' : 'Manage Staff'}</button>`}
                </td>
            </tr>
        `;

        if (isWard && isExpanded) {
            const bedCards = Array.from({ length: getRoomCapacity(room) }, (_, index) => {
                const bedNumber = index + 1;
                const status = getBedStatus(room, bedNumber);
                const patient = roomPatients.find(item => item.bedNumber === bedNumber);
                return `<article class="ward-bed-card">
                    <div class="ward-bed-heading">
                        <h3>Bed ${bedNumber}</h3>
                        <span class="status-badge status-${status.toLowerCase()}">${status}</span>
                    </div>
                    <p class="ward-bed-patient">${patient ? escapeHtml(patient.name) : 'No patient assigned'}</p>
                    ${patient
                        ? `<p class="ward-bed-doctors">${patient.doctors.length
                            ? `Doctor${patient.doctors.length > 1 ? 's' : ''}: ${patient.doctors.map(doctor => escapeHtml(doctor.name)).join(', ')}`
                            : 'No doctor assigned'}</p>`
                        : ''}
                </article>`;
            }).join('');
            tbody.innerHTML += `
                <tr class="ward-details-row">
                    <td colspan="7">
                        <section id="ward-beds-${room.id}" class="ward-details" aria-label="Room 104 bed details">
                            <h3>Room 104 Bed Status</h3>
                            <div class="ward-bed-grid">${bedCards}</div>
                        </section>
                    </td>
                </tr>
            `;
        }
    });
}

function completeRoomMaintenance(roomId) {
    const room = rooms.find(item => item.id === roomId);
    if (!room || getRoomStatus(room) !== 'Maintenance') return;

    room.status = 'Available';
    saveAppData();
    renderAll();
}

function toggleWardBeds(roomId) {
    if (expandedWardRooms.has(roomId)) {
        expandedWardRooms.delete(roomId);
    } else {
        expandedWardRooms.add(roomId);
    }
    renderRooms();
}

function renderPatients() {
    const tbody = document.querySelector('#patients-table tbody');
    tbody.innerHTML = '';
    patients.forEach(pat => {
        tbody.innerHTML += `
            <tr>
                <td>${pat.name}</td>
                <td>${pat.room}</td>
                <td>Bed ${pat.bedNumber}</td>
                <td>${pat.doctors.length
                    ? `<ul class="room-staff-list">${pat.doctors.map(doctor =>
                        `<li>${escapeHtml(doctor.name)}</li>`
                    ).join('')}</ul>`
                    : 'Unassigned'}</td>
                <td>${pat.admissionDate}</td>
                <td><button class="btn danger-btn" onclick="dischargePatient(${pat.id})">Discharge</button></td>
            </tr>
        `;
    });
}

function renderCleaning() {
    const tbody = document.querySelector('#cleaning-table tbody');
    tbody.innerHTML = '';
    cleaningSchedules.forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td>${item.room}</td>
                <td>Bed ${item.bedNumber}</td>
                <td>${item.time}</td>
                <td><span class="status-badge status-cleaning">${item.status}</span></td>
                <td><button class="btn primary-btn" onclick="acknowledgeCleaning(${item.id})">Acknowledge & Set Available</button></td>
            </tr>
        `;
    });
}

function scheduleRoomCleaning(room) {
    const now = Date.now();
    const cleaningTime = new Date(now + 3600000).toLocaleString() + ' (Google Calendar API)';
    let scheduledBeds = 0;

    for (let bedNumber = 1; bedNumber <= getRoomCapacity(room); bedNumber++) {
        if (getBedStatus(room, bedNumber) !== 'Available') continue;

        cleaningSchedules.push({
            id: nextId(cleaningSchedules),
            room: room.number,
            bedNumber,
            time: cleaningTime,
            status: 'Cleaning Scheduled'
        });
        scheduledBeds++;
    }

    return scheduledBeds;
}

function populateSelectDropdowns() {
    const availableRoomsSelect = document.getElementById('available-rooms-select');
    const staffRoomSelect = document.getElementById('staff-room-select');
    const staffPatientSelect = document.getElementById('staff-patient-select');
    
    availableRoomsSelect.innerHTML = '';
    staffRoomSelect.innerHTML = '';
    staffPatientSelect.innerHTML = '';

    rooms.forEach(room => {
        if (canAdmitToRoom(room)) {
            const occupancy = getRoomPatients(room).length;
            availableRoomsSelect.innerHTML += `<option value="${escapeHtml(room.number)}">${escapeHtml(room.number)} (${escapeHtml(room.type)}) - ${occupancy}/${getRoomCapacity(room)} beds</option>`;
        }
        staffRoomSelect.innerHTML += `<option value="${escapeHtml(room.number)}">${escapeHtml(room.number)}</option>`;
    });

    patients.forEach(patient => {
        staffPatientSelect.innerHTML += `<option value="${patient.id}">${escapeHtml(patient.name)} - ${escapeHtml(patient.room)} (Bed ${patient.bedNumber})</option>`;
    });

    document.querySelector('#admission-form button[type="submit"]').disabled = availableRoomsSelect.options.length === 0;
    updateStaffAssignmentTarget();
}

// Room Update Modal Logic
const roomModal = document.getElementById('room-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const roomUpdateForm = document.getElementById('room-update-form');

function openRoomModal(roomId) {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    const canChangeStatus = canChangeRoomStatus(room);
    document.getElementById('modal-room-id').value = room.id;
    document.getElementById('modal-room-no').value = room.number;
    const statusSelect = document.getElementById('modal-room-status');
    statusSelect.value = ['Available', 'Cleaning', 'Maintenance'].includes(room.status)
        ? room.status
        : 'Available';
    document.getElementById('room-status-error').textContent = canChangeStatus
        ? ''
        : 'Room status can only be changed when the room is empty and has no active cleaning tasks.';
    document.getElementById('room-status-group').classList.toggle('hidden', !canChangeStatus);
    document.getElementById('modal-room-status').disabled = !canChangeStatus;
    document.getElementById('save-room-changes-btn').classList.toggle('hidden', !canChangeStatus);
    renderModalStaff(room);
    roomModal.classList.remove('hidden');
}

function renderModalStaff(room) {
    const list = document.getElementById('modal-staff-list');
    if (!room.staff.length) {
        list.innerHTML = '<li>No staff assigned.</li>';
        return;
    }
    list.innerHTML = room.staff.map(member => `
        <li>
            <span>${escapeHtml(member.name)} (${escapeHtml(member.role)})</span>
            <button type="button" class="btn danger-btn unassign-staff-btn" data-staff-id="${member.id}">Unassign</button>
        </li>
    `).join('');
}

document.getElementById('modal-staff-list').addEventListener('click', event => {
    const button = event.target.closest('.unassign-staff-btn');
    if (!button) return;

    const roomId = Number(document.getElementById('modal-room-id').value);
    const room = rooms.find(item => item.id === roomId);
    if (!room) return;

    const staffId = Number(button.dataset.staffId);
    room.staff = room.staff.filter(member => member.id !== staffId);
    saveAppData();
    renderAll();
    renderModalStaff(room);
});

closeModalBtn.addEventListener('click', () => {
    roomModal.classList.add('hidden');
});

roomUpdateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parseInt(document.getElementById('modal-room-id').value);
    const room = rooms.find(r => r.id === id);
    if (!room) return;
    if (!canChangeRoomStatus(room)) {
        document.getElementById('room-status-error').textContent = 'Room status can only be changed when the room is empty and has no active cleaning tasks.';
        document.getElementById('room-status-group').classList.add('hidden');
        renderAll();
        return;
    }

    const newStatus = document.getElementById('modal-room-status').value;
    if (!['Available', 'Cleaning', 'Maintenance'].includes(newStatus)) {
        document.getElementById('room-status-error').textContent = 'Occupied status is set automatically when a patient is assigned to the room.';
        return;
    }

    if (newStatus === 'Cleaning') {
        const scheduledBeds = scheduleRoomCleaning(room);
        if (scheduledBeds === 0) {
            document.getElementById('room-status-error').textContent = 'There are no available beds to schedule for cleaning.';
            return;
        }
        room.status = 'Available';
    } else {
        room.status = newStatus;
    }
    saveAppData();
    roomModal.classList.add('hidden');
    renderAll();
});

// Manage Patient: Admission Flow
const admissionForm = document.getElementById('admission-form');
admissionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('patient-name').value;
    const roomNo = document.getElementById('available-rooms-select').value;
    const room = rooms.find(r => r.number === roomNo);
    if (!room || !canAdmitToRoom(room)) {
        document.getElementById('storage-error').textContent = 'That room has no available bed. Please choose another room.';
        renderAll();
        return;
    }
    const bedNumber = getAvailableBedNumber(room);

    patients.push({
        id: nextId(patients),
        name: name,
        room: roomNo,
        bedNumber,
        doctors: [],
        admissionDate: new Date().toISOString().split('T')[0]
    });

    room.status = getRoomPatients(room).length >= getRoomCapacity(room) ? 'Occupied' : 'Available';

    admissionForm.reset();
    saveAppData();
    renderAll();
});

// Discharge a patient and schedule cleaning for their bed.
function dischargePatient(patientId) {
    const patientIndex = patients.findIndex(p => p.id === patientId);
    if (patientIndex === -1) return;

    const patient = patients[patientIndex];
    const room = rooms.find(r => r.number === patient.room);

    if (room) {
        cleaningSchedules.push({
            id: nextId(cleaningSchedules),
            room: room.number,
            bedNumber: patient.bedNumber,
            time: new Date(Date.now() + 3600000).toLocaleString() + ' (Google Calendar API)',
            status: 'Cleaning Scheduled'
        });
    }

    patients.splice(patientIndex, 1);
    saveAppData();
    renderAll();
}

// Manage Staff Flow
const staffAssignmentForm = document.getElementById('staff-assignment-form');

function updateStaffAssignmentTarget() {
    const assigningDoctor = staffRoleSelect.value === 'Doctor';
    document.getElementById('staff-room-group').classList.toggle('hidden', assigningDoctor);
    document.getElementById('staff-room-select').required = !assigningDoctor;
    document.getElementById('staff-patient-group').classList.toggle('hidden', !assigningDoctor);
    document.getElementById('staff-patient-select').required = assigningDoctor;
    document.querySelector('#staff-tab .card h3').textContent = assigningDoctor
        ? 'Assign Doctor to Patient'
        : 'Assign Nurse to Room';
    document.getElementById('staff-assignment-submit').textContent = assigningDoctor
        ? 'Assign Doctor to Patient'
        : 'Assign Nurse to Room';
}

staffRoleSelect.addEventListener('change', updateStaffAssignmentTarget);

staffAssignmentForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const role = staffRoleSelect.value;
    const name = document.getElementById('staff-name').value.trim();

    if (role === 'Doctor') {
        const patientId = Number(document.getElementById('staff-patient-select').value);
        const patient = patients.find(item => item.id === patientId);
        if (!patient) return;

        const duplicate = patient.doctors.some(doctor =>
            doctor.name.toLowerCase() === name.toLowerCase()
        );
        if (!duplicate) {
            patient.doctors.push({ id: nextId(patient.doctors), name, role });
        }
    } else {
        const roomNo = document.getElementById('staff-room-select').value;
        const room = rooms.find(item => item.number === roomNo);
        if (!room) return;

        const duplicate = room.staff.some(member =>
            member.name.toLowerCase() === name.toLowerCase() && member.role === 'Nurse'
        );
        if (!duplicate) {
            room.staff.push({ id: nextId(room.staff), name, role: 'Nurse' });
        }
    }

    staffAssignmentForm.reset();
    updateStaffAssignmentTarget();
    saveAppData();
    renderAll();
});

// Cleaning acknowledgement makes only the cleaned bed available again.
function acknowledgeCleaning(scheduleId) {
    const index = cleaningSchedules.findIndex(s => s.id === scheduleId);
    if(index === -1) return;

    const item = cleaningSchedules[index];
    const room = rooms.find(r => r.number === item.room);
    cleaningSchedules.splice(index, 1);
    if (room && room.status !== 'Maintenance') {
        room.status = 'Available';
    }
    saveAppData();
    renderAll();
}