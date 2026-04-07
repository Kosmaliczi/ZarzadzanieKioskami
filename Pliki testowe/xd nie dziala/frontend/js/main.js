/**
 * Główny plik JavaScript do obsługi interfejsu zarządzania kioskami
 */

// Zmienne globalne
let kiosksData = [];
let recentActivities = [];
let ftp = {
    currentPath: '/',
    pathHistory: ['/'],
    connection: null
};

// Zmienne globalne dla FTP
let selectedKiosk = null;
let selectedFiles = [];
let lastActiveSection = 'dashboard'; // Zapamiętaj ostatnio aktywną sekcję
let kiosksRefreshInterval = null; // Interwał odświeżania listy kiosków

// Załaduj konfigurację po załadowaniu DOM
document.addEventListener('DOMContentLoaded', async function() {
    // Sprawdź, czy użytkownik jest zalogowany
    if (localStorage.getItem('isLoggedIn') !== 'true') {
        window.location.href = 'login.html';
        return;
    }
    
    try {
        // Załaduj konfigurację z bazy danych
        await loadConfig();
        
        // Inicjalizuj interfejs
        initUI();
        
        // Załaduj dane
        refreshData();
        
        // Przywróć ostatnio aktywną sekcję
        const savedSection = localStorage.getItem('activeSection');
        if (savedSection) {
            switchSection(savedSection);
        }
        
        // Ustaw interwał odświeżania
        setInterval(refreshData, CONFIG.refreshInterval);
    } catch (error) {
        console.error('Błąd podczas inicjalizacji aplikacji:', error);
        
        // W przypadku błędu, spróbuj zainicjować interfejs bez czekania na ustawienia
        initUI();
        
        // Pokaż komunikat o błędzie
        setTimeout(() => {
            showToast('Wystąpił błąd podczas ładowania ustawień. Używane są ustawienia domyślne.', 'error');
        }, 1000);
    }
});

/**
 * Inicjalizacja interfejsu użytkownika
 */
function initUI() {
    // Wyświetl nazwę zalogowanego użytkownika
    const username = localStorage.getItem('username');
    if (username) {
        document.getElementById('username-text').textContent = username;
    }

    // Obsługa przycisku wylogowania
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            // Usuń dane logowania z localStorage
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('username');
            
            // Przekieruj na stronę logowania
            window.location.href = 'login.html';
        });
    }

    // Obsługa nawigacji
    const navLinks = document.querySelectorAll('nav ul li a');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.getAttribute('data-section');
            switchSection(section);
        });
    });

    // Obsługa modali
    setupModals();

    // Obsługa formularzy
    setupForms();

    // Obsługa FTP UI
    setupFtpUI();

    // Obsługa Playlist UI
    setupPlaylistUI();

    // Aktualizuj datę z dodaną godziną i sekundami
    updateDateTime();
    // Aktualizuj datę co sekundę
    setInterval(updateDateTime, 1000);

    // Załaduj ustawienia do formularzy
    loadSettingsToForms();
}

/**
 * Funkcja aktualizująca datę i godzinę w nagłówku
 */
function updateDateTime() {
    document.getElementById('current-date').textContent = new Date().toLocaleString('pl-PL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * Przełączanie sekcji
 */
function switchSection(sectionId) {
    // Zapisz aktywną sekcję do zmiennej globalnej
    lastActiveSection = sectionId;
    
    // Zapisz aktywną sekcję w localStorage
    localStorage.setItem('activeSection', sectionId);
    
    // Usuń klasę aktywną ze wszystkich sekcji i linków
    document.querySelectorAll('section').forEach(section => {
        section.classList.remove('active-section');
    });
    document.querySelectorAll('nav ul li a').forEach(link => {
        link.classList.remove('active');
    });

    // Dodaj klasę aktywną do wybranej sekcji i linku
    document.getElementById(sectionId).classList.add('active-section');
    document.querySelector(`nav ul li a[data-section="${sectionId}"]`).classList.add('active');
}

/**
 * Konfiguracja modali
 */
function setupModals() {
    // Modal dodawania kiosku
    const addKioskModal = document.getElementById('add-kiosk-modal');
    const addKioskBtn = document.getElementById('add-kiosk-btn');
    const closeAddKiosk = addKioskModal.querySelector('.close');
    const cancelAddKiosk = document.getElementById('cancel-add-kiosk');

    addKioskBtn.addEventListener('click', () => {
        addKioskModal.style.display = 'block';
    });

    closeAddKiosk.addEventListener('click', () => {
        addKioskModal.style.display = 'none';
    });

    cancelAddKiosk.addEventListener('click', () => {
        addKioskModal.style.display = 'none';
    });

    // Modal edycji kiosku
    const editKioskModal = document.getElementById('edit-kiosk-modal');
    const closeEditKiosk = editKioskModal.querySelector('.close');
    const cancelEditKiosk = document.getElementById('cancel-edit-kiosk');

    closeEditKiosk.addEventListener('click', () => {
        editKioskModal.style.display = 'none';
    });

    cancelEditKiosk.addEventListener('click', () => {
        editKioskModal.style.display = 'none';
    });

    // Zamknij modal po kliknięciu poza nim
    window.addEventListener('click', (e) => {
        if (e.target === addKioskModal) {
            addKioskModal.style.display = 'none';
        }
        if (e.target === editKioskModal) {
            editKioskModal.style.display = 'none';
        }
    });
}

/**
 * Konfiguracja formularzy
 */
function setupForms() {
    // Formularz dodawania kiosku
    const addKioskForm = document.getElementById('submit-add-kiosk');
    addKioskForm.addEventListener('click', async () => {
        const kioskName = document.getElementById('kiosk-name').value;
        const kioskMac = document.getElementById('kiosk-mac').value;
        const kioskSn = document.getElementById('kiosk-sn').value;
        const kioskFtpUsername = document.getElementById('kiosk-ftp-username').value || '';
        const kioskFtpPassword = document.getElementById('kiosk-ftp-password').value || '';

        if (!kioskName || !kioskMac || !kioskSn) {
            showToast('Wypełnij wszystkie wymagane pola', 'error');
            return;
        }

        try {
            // Wyłącz przycisk na czas wysyłania, aby uniknąć wielokrotnego kliknięcia
            addKioskForm.disabled = true;
            addKioskForm.textContent = 'Dodawanie...';
            
            const result = await api.addKiosk({
                name: kioskName,
                mac_address: kioskMac,
                serial_number: kioskSn,
                ftp_username: kioskFtpUsername,
                ftp_password: kioskFtpPassword
            });

            document.getElementById('add-kiosk-modal').style.display = 'none';
            showToast('Kiosk został dodany pomyślnie', 'success');
            
            // Dodaj aktywność
            addActivity(`Dodano nowy kiosk: ${kioskName}`);

            // Odśwież dane
            refreshData();

            // Zresetuj formularz
            document.getElementById('kiosk-name').value = '';
            document.getElementById('kiosk-mac').value = '';
            document.getElementById('kiosk-sn').value = '';
            document.getElementById('kiosk-ftp-username').value = '';
            document.getElementById('kiosk-ftp-password').value = '';

        } catch (error) {
            console.error('Błąd podczas dodawania kiosku:', error);
            showToast(error.message || 'Wystąpił błąd podczas dodawania kiosku', 'error');
        } finally {
            // Przywróć przycisk do normalnego stanu
            addKioskForm.disabled = false;
            addKioskForm.textContent = 'Dodaj';
        }
    });

    // Formularz edycji kiosku
    const editKioskForm = document.getElementById('submit-edit-kiosk');
    editKioskForm.addEventListener('click', async () => {
        const kioskId = document.getElementById('edit-kiosk-id').value;
        const kioskName = document.getElementById('edit-kiosk-name').value;
        const kioskMac = document.getElementById('edit-kiosk-mac').value;
        const kioskSn = document.getElementById('edit-kiosk-sn').value;
        const kioskFtpUsername = document.getElementById('edit-kiosk-ftp-username').value;
        const kioskFtpPassword = document.getElementById('edit-kiosk-ftp-password').value;

        if (!kioskName || !kioskMac || !kioskSn) {
            showToast('Wypełnij wszystkie wymagane pola', 'error');
            return;
        }

        // Przygotuj dane do aktualizacji
        const updateData = {
            name: kioskName,
            mac_address: kioskMac,
            serial_number: kioskSn,
            ftp_username: kioskFtpUsername
        };

        // Dodaj hasło tylko jeśli zostało zmienione (nie jest puste)
        if (kioskFtpPassword) {
            updateData.ftp_password = kioskFtpPassword;
        }

        try {
            const result = await api.updateKiosk(kioskId, updateData);

            document.getElementById('edit-kiosk-modal').style.display = 'none';
            showToast('Kiosk został zaktualizowany pomyślnie', 'success');
            
            // Dodaj aktywność
            addActivity(`Zaktualizowano kiosk: ${kioskName}`);

            // Odśwież dane
            refreshData();

        } catch (error) {
            showToast(error.message, 'error');
        }
    });

    // Formularz ustawień
    const saveSettings = document.getElementById('save-settings-btn');
    saveSettings.addEventListener('click', async () => {
        const refreshInterval = document.getElementById('setting-refresh-interval').value * 1000;
        
        // Ustawienia portów
        const ftpPort = parseInt(document.getElementById('setting-ftp-port').value, 10);
        const sshPort = parseInt(document.getElementById('setting-ssh-port').value, 10);
        
        // Domyślna ścieżka FTP
        const ftpPath = document.getElementById('setting-ftp-path').value;

        // Walidacja portów
        if (isNaN(ftpPort) || ftpPort < 1 || ftpPort > 65535) {
            showToast('Port FTP musi być liczbą między 1 a 65535', 'error');
            return;
        }
        
        if (isNaN(sshPort) || sshPort < 1 || sshPort > 65535) {
            showToast('Port SSH musi być liczbą między 1 a 65535', 'error');
            return;
        }        // Domyślne dane logowania FTP
        const defaultFtpUsername = document.getElementById('setting-ftp-username').value;
        const defaultFtpPassword = document.getElementById('setting-ftp-password').value;
        // Domyślne dane logowania SSH
        // Nazwa użytkownika SSH jest zawsze ustawiona na "kiosk"
        const defaultSshUsername = "kiosk";
        const defaultSshPassword = document.getElementById('setting-ssh-password').value;

        // Wyświetl komunikat diagnostyczny
        console.log(`Zapisywanie hasła SSH o długości: ${defaultSshPassword.length}`);

        try {
            // Zapisz ustawienia w bazie danych używając funkcji updateConfig, która szyfruje wrażliwe dane
            await updateConfig('refreshInterval', refreshInterval);
            
            // Zapisz ustawienia portów
            await updateConfig('defaultFtpPort', ftpPort);
            await updateConfig('defaultSshPort', sshPort);
            
            // Zapisz ścieżkę FTP
            await updateConfig('defaultFtpPath', ftpPath);
            
            // Zapisz domyślne dane logowania FTP - hasło zostanie automatycznie zaszyfrowane przez updateConfig
            await updateConfig('defaultFtpUsername', defaultFtpUsername);
            await updateConfig('defaultFtpPassword', defaultFtpPassword);
            
            // Zapisz domyślne dane logowania SSH - hasło zostanie automatycznie zaszyfrowane przez updateConfig
            await updateConfig('defaultSshUsername', defaultSshUsername);
            await updateConfig('defaultSshPassword', defaultSshPassword);
            
            // Aktualizuj lokalną konfigurację w pamięci
            CONFIG.refreshInterval = refreshInterval;
            CONFIG.defaultFtpPort = ftpPort;
            CONFIG.defaultSshPort = sshPort;
            CONFIG.defaultFtpPath = ftpPath;
            CONFIG.defaultFtpUsername = defaultFtpUsername;
            CONFIG.defaultFtpPassword = defaultFtpPassword;
            CONFIG.defaultSshUsername = defaultSshUsername;
            CONFIG.defaultSshPassword = defaultSshPassword; // Tu przechowujemy niezaszyfrowane hasło w pamięci
            
            // Aktualizuj bieżące ustawienia FTP
            document.getElementById('ftp-port').value = ftpPort;
            
            // Aktualizuj pola formularza FTP danymi logowania
            if (defaultFtpUsername) {
                document.getElementById('ftp-username').value = defaultFtpUsername;
            }
            
            if (defaultFtpPassword) {
                document.getElementById('ftp-password').value = defaultFtpPassword;
            }
            
            // Aktualizuj zmienne globalne
            ftp.currentPath = ftpPath;
            ftp.pathHistory = [ftpPath];

            showToast('Ustawienia zostały zapisane pomyślnie', 'success');
            
            // Dodaj aktywność
            addActivity('Zaktualizowano ustawienia aplikacji');
            
        } catch (error) {
            showToast(`Błąd zapisywania ustawień: ${error.message}`, 'error');
        }
    });

    // Formularz FTP
    const ftpConnectBtn = document.getElementById('ftp-connect-btn');
    ftpConnectBtn.addEventListener('click', async () => {
        const hostname = document.getElementById('ftp-hostname').value;
        const port = document.getElementById('ftp-port').value;
        const username = document.getElementById('ftp-username').value;
        const password = document.getElementById('ftp-password').value;

        if (!hostname || !username || !password) {
            showToast('Wypełnij wszystkie wymagane pola', 'error');
            return;
        }

        try {
            // Testuj połączenie
            await api.testFtpConnection({
                hostname,
                port,
                username,
                password
            });

            // Zapisz dane połączenia
            ftp.connection = {
                hostname,
                port,
                username,
                password
            };

            showToast('Połączenie FTP udane', 'success');
            addActivity(`Połączono z serwerem FTP: ${hostname}`);

            // Pokaż przeglądarkę plików
            document.querySelector('.ftp-browser').classList.remove('hidden');
            
            // Ukryj formularz połączenia FTP
            document.getElementById('ftp-connection-form').classList.add('hidden');
            
            // Upewnij się, że kafelki kiosków są ukryte
            document.getElementById('ftp-kiosk-tiles').classList.add('hidden');
            
            // Załaduj pliki
            loadFtpFiles('/');

            // Dodaj informację o aktualnie połączonym kiosku
            const connInfoElement = document.getElementById('ftp-connected-kiosk');
            if (connInfoElement) {
                connInfoElement.textContent = `Połączono z: ${selectedKiosk.name || 'Kiosk ' + selectedKiosk.id}`;
                connInfoElement.classList.remove('hidden');
            }

        } catch (error) {
            showToast(error.message, 'error');
        }
    });

    // Obsługa nawigacji FTP
    const ftpBackBtn = document.getElementById('ftp-back-btn');
    ftpBackBtn.addEventListener('click', () => {
        if (ftp.pathHistory.length > 1) {
            ftp.pathHistory.pop(); // Usuń bieżącą ścieżkę
            const previousPath = ftp.pathHistory[ftp.pathHistory.length - 1];
            loadFtpFiles(previousPath);
        }
    });

    const ftpRefreshBtn = document.getElementById('ftp-refresh-btn');
    ftpRefreshBtn.addEventListener('click', () => {
        loadFtpFiles(ftp.currentPath);
    });
}

/**
 * Funkcje FTP
 */

/**
 * Normalizuje ścieżkę FTP, zamieniając backslashe na forward slashe
 * @param {string} path - Ścieżka do znormalizowania
 * @returns {string} - Znormalizowana ścieżka
 */
function normalizeFtpPath(path) {
    // Zamienia wszystkie backslashe na forward slashe
    return path.replace(/\\/g, '/');
}

function loadFtpKiosks() {
    const kiosksContainer = document.getElementById('ftp-kiosk-tiles');
    
    // Wyczyść kontener
    kiosksContainer.innerHTML = '';
    
    // Jeśli brak kiosków
    if (kiosksData.length === 0) {
        const emptyElement = document.createElement('div');
        emptyElement.className = 'kiosk-tile-empty';
        emptyElement.textContent = 'Brak dostępnych kiosków. Dodaj kioski w sekcji "Kioski".';
        kiosksContainer.appendChild(emptyElement);
        return;
    }
    
    // Filtrowanie kiosków
    const searchQuery = document.getElementById('ftp-search').value.toLowerCase();
    let filteredKiosks = kiosksData;
    
    if (searchQuery) {
        filteredKiosks = kiosksData.filter(kiosk => {
            return (kiosk.name && kiosk.name.toLowerCase().includes(searchQuery)) ||
                   (kiosk.serial_number && kiosk.serial_number.toLowerCase().includes(searchQuery)) ||
                   (kiosk.mac_address && kiosk.mac_address.toLowerCase().includes(searchQuery)) ||
                   (kiosk.ip_address && kiosk.ip_address.toLowerCase().includes(searchQuery));
        });
    }
    
    // Generuj kafelki dla kiosków
    filteredKiosks.forEach(kiosk => {
        const tileElement = document.createElement('div');
        tileElement.className = 'kiosk-tile';
        tileElement.setAttribute('data-kiosk-id', kiosk.id);
        
        const headerElement = document.createElement('div');
        headerElement.className = 'kiosk-tile-header';
        
        const titleElement = document.createElement('h3');
        titleElement.textContent = kiosk.name || `Kiosk ${kiosk.id}`;
        
        const statusElement = document.createElement('div');
        statusElement.className = `kiosk-tile-status ${kiosk.status}`;
        
        headerElement.appendChild(titleElement);
        headerElement.appendChild(statusElement);
        
        const infoElement = document.createElement('div');
        infoElement.className = 'kiosk-tile-info';
        
        const ipElement = document.createElement('p');
        const ipLabel = document.createElement('span');
        ipLabel.textContent = 'IP:';
        const ipValue = document.createElement('span');
        ipValue.textContent = kiosk.ip_address || 'Brak';
        ipElement.appendChild(ipLabel);
        ipElement.appendChild(ipValue);
        
        const snElement = document.createElement('p');
        const snLabel = document.createElement('span');
        snLabel.textContent = 'S/N:';
        const snValue = document.createElement('span');
        snValue.textContent = kiosk.serial_number;
        snElement.appendChild(snLabel);
        snElement.appendChild(snValue);
        
        const macElement = document.createElement('p');
        const macLabel = document.createElement('span');
        macLabel.textContent = 'MAC:';
        const macValue = document.createElement('span');
        macValue.textContent = kiosk.mac_address;
        macElement.appendChild(macLabel);
        macElement.appendChild(macValue);
        
        const lastConnElement = document.createElement('p');
        const lastConnLabel = document.createElement('span');
        lastConnLabel.textContent = 'Ostatnie połączenie:';
        const lastConnValue = document.createElement('span');
        lastConnValue.textContent = kiosk.last_connection ? formatDate(kiosk.last_connection) : 'Nigdy';
        lastConnElement.appendChild(lastConnLabel);
        lastConnElement.appendChild(lastConnValue);
        
        infoElement.appendChild(ipElement);
        infoElement.appendChild(snElement);
        infoElement.appendChild(macElement);
        infoElement.appendChild(lastConnElement);
        
        // Dodaj przyciski akcji
        const actionsElement = document.createElement('div');
        actionsElement.className = 'kiosk-tile-actions';
        
        // Przycisk FTP
        const ftpBtn = document.createElement('button');
        ftpBtn.className = 'btn';
        ftpBtn.innerHTML = '<i class="fas fa-server"></i> FTP';
        ftpBtn.title = 'Połącz przez FTP';
        ftpBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Zatrzymaj propagację, aby nie aktywować kafelka
            selectKiosk(kiosk);
        });
        actionsElement.appendChild(ftpBtn);
        
        // Przycisk restartu usługi
        const restartBtn = document.createElement('button');
        restartBtn.className = 'btn';
        restartBtn.innerHTML = '<i class="fas fa-sync"></i> Restart';
        restartBtn.title = 'Restart usługi';
        restartBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Zatrzymaj propagację, aby nie aktywować kafelka
            restartKioskService(kiosk);
        });
        actionsElement.appendChild(restartBtn);
                
        // Przycisk SSH
        const sshBtn = document.createElement('button');
        sshBtn.className = 'btn';
        sshBtn.innerHTML = '<i class="fas fa-terminal"></i> SSH';
        sshBtn.title = 'Połącz przez SSH';
        sshBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Zatrzymaj propagację, aby nie aktywować kafelka
            connectSSH(kiosk);
        });
        actionsElement.appendChild(sshBtn);
        
        // Przycisk VNC
        const vncBtn = document.createElement('button');
        vncBtn.className = 'btn vnc';
        vncBtn.innerHTML = '<i class="fas fa-desktop"></i> VNC';
        vncBtn.title = 'Połącz przez NoVNC';
        vncBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Zatrzymaj propagację, aby nie aktywować kafelka
            connectVNC(kiosk);
        });
        actionsElement.appendChild(vncBtn);

        infoElement.appendChild(actionsElement);
        
        tileElement.appendChild(headerElement);
        tileElement.appendChild(infoElement);
        
        // Dodaj obsługę kliknięcia dla całego kafelka
        tileElement.addEventListener('click', () => {
            selectKiosk(kiosk);
        });
        
        kiosksContainer.appendChild(tileElement);
    });
}

async function selectKiosk(kiosk) {
    selectedKiosk = kiosk;
    
    // Ustaw dane kiosku w formularzu
    document.getElementById('selected-kiosk-name').textContent = kiosk.name || `Kiosk ${kiosk.id}`;
    document.getElementById('selected-kiosk-id').value = kiosk.id;
    
    if (kiosk.ip_address) {
        document.getElementById('ftp-hostname').value = kiosk.ip_address;
    }
    
    // Ustaw domyślny port FTP
    document.getElementById('ftp-port').value = CONFIG.defaultFtpPort || 21;
    
    // Pokaż wskaźnik ładowania w polach formularza
    document.getElementById('ftp-username').value = 'Ładowanie...';
    document.getElementById('ftp-password').value = 'Ładowanie...';
    
    try {
        // Pobierz dane logowania FTP z bazy danych dla tego kiosku
        const credentials = await api.getKioskFtpCredentials(kiosk.id);
        
        // Wypełnij dane logowania z bazy danych (jeśli są dostępne)
        if (credentials.ftp_username) {
            document.getElementById('ftp-username').value = credentials.ftp_username;
        } else if (CONFIG.defaultFtpUsername) {
            // Użyj domyślnych wartości, jeśli dane kiosku są puste
            document.getElementById('ftp-username').value = CONFIG.defaultFtpUsername;
        } else {
            document.getElementById('ftp-username').value = '';
        }
        
        if (credentials.ftp_password) {
            document.getElementById('ftp-password').value = credentials.ftp_password;
        } else if (CONFIG.defaultFtpPassword) {
            // Użyj domyślnych wartości, jeśli dane kiosku są puste
            document.getElementById('ftp-password').value = CONFIG.defaultFtpPassword;
        } else {
            document.getElementById('ftp-password').value = '';
        }
        
    } catch (error) {
        console.error('Błąd podczas pobierania danych logowania FTP:', error);
        
        // W przypadku błędu, użyj domyślnych danych logowania
        if (CONFIG.defaultFtpUsername) {
            document.getElementById('ftp-username').value = CONFIG.defaultFtpUsername;
        } else {
            document.getElementById('ftp-username').value = '';
        }
        
        if (CONFIG.defaultFtpPassword) {
            document.getElementById('ftp-password').value = CONFIG.defaultFtpPassword;
        } else {
            document.getElementById('ftp-password').value = '';
        }
    }
    
    // Pokaż formularz połączenia, ukryj listę kiosków
    document.getElementById('ftp-kiosk-tiles').classList.add('hidden');
    document.getElementById('ftp-connection-form').classList.remove('hidden');
}

function setupFtpUI() {
    // Obsługa wyszukiwania kiosków
    document.getElementById('ftp-search').addEventListener('input', debounce(() => {
        loadFtpKiosks();
    }, 300));
    
    // Obsługa przycisku powrotu do listy kiosków
    document.getElementById('ftp-back-to-kiosks').addEventListener('click', () => {
        document.getElementById('ftp-connection-form').classList.add('hidden');
        document.getElementById('ftp-kiosk-tiles').classList.remove('hidden');
    });
    
    // Obsługa rozłączenia FTP
    document.getElementById('ftp-disconnect-btn').addEventListener('click', () => {
        document.getElementById('ftp-browser').classList.add('hidden');
        document.getElementById('ftp-kiosk-tiles').classList.remove('hidden');
        ftp.pathHistory = ['/'];
        ftp.currentPath = '/';
    });
    
    // Obsługa przycisku upload
    document.getElementById('ftp-upload-btn').addEventListener('click', () => {
        document.getElementById('ftp-file-upload').click();
    });
    
    // Obsługa faktycznego upload pliku
    document.getElementById('ftp-file-upload').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFtpFile(e.target.files[0]);
        }
    });
    
    // Obsługa przycisku nowego folderu
    document.getElementById('ftp-new-folder-btn').addEventListener('click', () => {
        const folderName = prompt('Podaj nazwę nowego folderu:');
        if (folderName) {
            createFtpFolder(folderName);
        }
    });
    
    // Obsługa zaznaczania wszystkich plików
    document.getElementById('select-all-files').addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('#ftp-files-body input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = e.target.checked;
        });
        updateSelectedFiles();
    });
    
    // Obsługa przycisku usuwania
    document.getElementById('ftp-delete-btn').addEventListener('click', () => {
        if (selectedFiles.length > 0) {
            const confirmMessage = `Czy na pewno chcesz usunąć ${selectedFiles.length} ${selectedFiles.length === 1 ? 'element' : 'elementów'}?`;
            if (confirm(confirmMessage)) {
                deleteSelectedFiles();
            }
        }
    });
    
    // Obsługa przycisku "W górę" - przejście do katalogu nadrzędnego
    document.getElementById('ftp-up-btn').addEventListener('click', () => {
        navigateToParentDirectory();
    });
    
    // Obsługa wpisania ścieżki ręcznie i naciśnięcia Enter
    document.getElementById('ftp-path').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const newPath = document.getElementById('ftp-path').value.trim();
            if (newPath) {
                loadFtpFiles(newPath);
            }
        }
    });
    
    // Obsługa przycisku "Przejdź" do ścieżki
    document.getElementById('ftp-go-btn').addEventListener('click', () => {
        const newPath = document.getElementById('ftp-path').value.trim();
        if (newPath) {
            loadFtpFiles(newPath);
        }
    });
    
    // Obsługa przycisku "Wstecz" w nawigacji
    document.getElementById('ftp-back-btn').addEventListener('click', () => {
        if (ftp.pathHistory.length > 1) {
            ftp.pathHistory.pop(); // Usuń bieżącą ścieżkę
            const previousPath = ftp.pathHistory[ftp.pathHistory.length - 1];
            // Nie dodawaj tej ścieżki do historii ponownie, więc używamy specjalnej flagi
            loadFtpFiles(previousPath, false);
        }
    });
    
    // Obsługa Drag and Drop
    setupDragAndDrop();
}

/**
 * Konfiguracja funkcjonalności drag and drop dla strefy FTP
 */
function setupDragAndDrop() {
    const dropZone = document.getElementById('ftp-drop-zone');
    if (!dropZone) return;
    
    // Zapobieganie domyślnym zachowaniom przeglądarki
    const preventDefaults = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    
    // Zdarzenia, które musimy obsłużyć
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });
    
    // Dodanie efektu wizualnego przy przeciąganiu
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('drag-over');
        }, false);
    });
    
    // Usunięcie efektu wizualnego gdy przeciąganie kończy się
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('drag-over');
        }, false);
    });
    
    // Obsługa upuszczenia plików
    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleDroppedFiles(files);
        }
    }, false);
    
    // Obsługa upuszczenia plików również na tabelę plików
    const ftpFilesTable = document.getElementById('ftp-files-table');
    if (ftpFilesTable) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            ftpFilesTable.addEventListener(eventName, preventDefaults, false);
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            ftpFilesTable.addEventListener(eventName, () => {
                dropZone.classList.add('drag-over');
            }, false);
        });
        
        ftpFilesTable.addEventListener('drop', (e) => {
            dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleDroppedFiles(files);
            }
        }, false);
    }
}

/**
 * Obsługa upuszczonych plików
 * @param {FileList} files - Lista upuszczonych plików
 */
async function handleDroppedFiles(files) {
    if (!ftp.connection) {
        showToast('Brak połączenia FTP. Nie można przesłać plików.', 'error');
        return;
    }
    
    if (files.length === 0) return;
    
    // Dodanie klasy uploading do strefy drop
    const dropZone = document.getElementById('ftp-drop-zone');
    if (dropZone) {
        dropZone.classList.add('uploading');
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    showToast(`Rozpoczęto przesyłanie ${files.length} ${files.length === 1 ? 'pliku' : 'plików'}...`, 'info');
    
    // Przetwarzanie każdego pliku
    const uploadPromises = Array.from(files).map(async (file) => {
        try {
            await uploadDroppedFile(file);
            successCount++;
            return { file: file.name, success: true };
        } catch (error) {
            errorCount++;
            console.error(`Błąd podczas przesyłania pliku ${file.name}:`, error);
            return { file: file.name, success: false, error: error.message };
        }
    });
    
    try {
        // Czekaj na zakończenie wszystkich przesyłań
        const results = await Promise.all(uploadPromises);
        
        // Pokaż odpowiedni komunikat
        if (errorCount === 0) {
            showToast(`Pomyślnie przesłano ${successCount} ${successCount === 1 ? 'plik' : 'plików'}`, 'success');
        } else {
            showToast(`Przesłano ${successCount} ${successCount === 1 ? 'plik' : 'plików'}, ale ${errorCount} ${errorCount === 1 ? 'plik nie mógł' : 'plików nie mogło'} zostać przesłanych`, 'warning');
        }
        
        // Odśwież listę plików
        loadFtpFiles(ftp.currentPath);
        
        // Dodaj informację o aktywności
        addActivity(`Przesłano ${successCount} ${successCount === 1 ? 'plik' : 'plików'} do ${ftp.currentPath} na kiosku ${selectedKiosk.name || selectedKiosk.id}`);
    } catch (error) {
        showToast(`Wystąpił błąd podczas przesyłania plików: ${error.message}`, 'error');
    } finally {
        // Usuń klasę uploading
        if (dropZone) {
            dropZone.classList.remove('uploading');
        }
    }
}

/**
 * Przesyła pojedynczy plik do serwera FTP
 * @param {File} file - Plik do przesłania
 * @returns {Promise} - Promise z wynikiem operacji
 */
function uploadDroppedFile(file) {
    return new Promise((resolve, reject) => {
        // Odczytujemy plik jako base64
        const reader = new FileReader();
        
        reader.onload = async function(event) {
            try {
                // Przesyłamy dane pliku wraz z danymi połączenia FTP
                const result = await api.uploadFtpFile(
                    ftp.connection,
                    ftp.currentPath,
                    event.target.result,
                    file.name
                );
                
                resolve(result);
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = function(error) {
            reject(new Error(`Nie można odczytać pliku: ${error}`));
        };
        
        // Rozpocznij odczyt pliku jako URL danych (base64)
        reader.readAsDataURL(file);
    });
}

/**
 * Funkcja do nawigacji do katalogu nadrzędnego
 */
function navigateToParentDirectory() {
    if (ftp.currentPath === '/') {
        // Jesteśmy już w katalogu głównym, nic nie robimy
        return;
    }
    
    // Podziel ścieżkę na segmenty
    const pathSegments = ftp.currentPath.split('/').filter(segment => segment.length > 0);
    
    // Usuń ostatni segment (bieżący katalog)
    pathSegments.pop();
    
    // Zbuduj nową ścieżkę
    let parentPath = '/' + pathSegments.join('/');

    
    // Przejdź do katalogu nadrzędnego
    loadFtpFiles(parentPath);
}

/**
 * Ładuje pliki z serwera FTP
 * @param {string} path - Ścieżka do katalogu na serwerze FTP
 * @param {boolean} addToHistory - Czy dodać tę ścieżkę do historii (domyślnie true)
 */
async function loadFtpFiles(path, addToHistory = true) {
    if (!ftp.connection) {
        showToast('Brak połączenia FTP', 'error');
        return;
    }
    
    try {
        // Aktualizuj bieżącą ścieżkę
        ftp.currentPath = path;
        document.getElementById('ftp-path').value = path;
        
        // Jeśli to nowa ścieżka i mamy dodać do historii, dodaj ją
        if (addToHistory && (ftp.pathHistory.length === 0 || ftp.pathHistory[ftp.pathHistory.length - 1] !== path)) {
            ftp.pathHistory.push(path);
        }
        
        // Włącz/wyłącz przyciski nawigacji
        updateNavigationButtons();
        
        // Pokaż przeglądarkę plików i upewnij się, że kafelki kiosków są ukryte
        document.querySelector('.ftp-browser').classList.remove('hidden');
        document.getElementById('ftp-connection-form').classList.add('hidden');
        document.getElementById('ftp-kiosk-tiles').classList.add('hidden');
        
        // Pokaż wskaźnik ładowania
        const tbody = document.getElementById('ftp-files-body');
        tbody.innerHTML = '';
        const loadingRow = document.createElement('tr');
        const loadingCell = document.createElement('td');
        loadingCell.colSpan = 6;
        loadingCell.textContent = 'Ładowanie zawartości katalogu...';
        loadingCell.style.textAlign = 'center';
        loadingRow.appendChild(loadingCell);
        tbody.appendChild(loadingRow);
        
        // Upewnij się, że dane logowania są kompletne
        if (!ftp.connection.username || !ftp.connection.password) {
            console.error('Brak danych logowania FTP');
            showToast('Brak danych logowania FTP', 'error');
            return;
        }
        
        // Przygotuj dane do zapytania - upewnij się, że wszystkie dane są przesyłane
        const requestData = {
            hostname: ftp.connection.hostname,
            port: ftp.connection.port,
            username: ftp.connection.username,
            password: ftp.connection.password,
            path: path
        };
        
        console.log('Wysyłanie zapytania FTP dla ścieżki:', path);
        console.log('Dane połączenia:', JSON.stringify({
            hostname: requestData.hostname,
            port: requestData.port,
            username: requestData.username,
            password: '********' // Zamiast hasła wyświetlamy gwiazdki ze względów bezpieczeństwa
        }));
        
        try {
            // Zaktualizuj listę plików
            const files = await api.getFtpFiles(requestData);
            
            console.log('Otrzymano odpowiedź FTP:', files);
            
            // Sprawdź, czy otrzymaliśmy poprawną odpowiedź
            if (!files || !Array.isArray(files)) {
                console.error('Nieprawidłowa odpowiedź z API FTP:', files);
                showToast('Otrzymano nieprawidłowe dane z serwera', 'error');
                return;
            }
            
            // Pokaż listę plików
            displayFtpFiles(files);
        } catch (error) {
            console.error('Błąd podczas ładowania plików FTP:', error);
            showToast(error.message, 'error');
            
            // Wyczyść listę plików w przypadku błędu
            const tbody = document.getElementById('ftp-files-body');
            tbody.innerHTML = '';
            const errorRow = document.createElement('tr');
            const errorCell = document.createElement('td');
            errorCell.colSpan = 6;
            errorCell.textContent = `Błąd: ${error.message}`;
            errorCell.style.textAlign = 'center';
            errorCell.style.color = 'var(--danger-color)';
            errorRow.appendChild(errorCell);
            tbody.appendChild(errorRow);
        }
    } catch (error) {
        console.error('Nieoczekiwany błąd podczas ładowania plików FTP:', error);
        showToast(`Nieoczekiwany błąd: ${error.message}`, 'error');
    }
}

/**
 * Wyświetla pliki FTP w tabeli
 */
function displayFtpFiles(files) {
    const tbody = document.getElementById('ftp-files-body');
    tbody.innerHTML = '';
    
    // Zresetuj zaznaczenie plików
    selectedFiles = [];
    document.getElementById('select-all-files').checked = false;
    document.getElementById('ftp-delete-btn').classList.add('hidden');
    
    if (files.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.textContent = 'Katalog jest pusty';
        cell.style.textAlign = 'center';
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }
    
    // Sortuj pliki - najpierw katalogi, potem pliki
    files.sort((a, b) => {
        if (a.is_directory && !b.is_directory) return -1;
        if (!a.is_directory && b.is_directory) return 1;
        return a.name.localeCompare(b.name);
    });
    
    // Dodaj pliki do tabeli
    files.forEach(file => {
        const row = document.createElement('tr');
        
        // Checkbox
        const checkboxCell = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('data-name', file.name);
        checkbox.setAttribute('data-path', normalizeFtpPath(file.path));
        checkbox.setAttribute('data-is-directory', file.is_directory);
        checkbox.addEventListener('change', updateSelectedFiles);
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);
        
        // Nazwa
        const nameCell = document.createElement('td');
        const nameLink = document.createElement(file.is_directory ? 'a' : 'span');
        nameLink.textContent = file.name;
        
        if (file.is_directory) {
            nameLink.href = '#';
            nameLink.addEventListener('click', (e) => {
                e.preventDefault();
                loadFtpFiles(normalizeFtpPath(file.path));
            });
        }
        
        nameCell.appendChild(nameLink);
        row.appendChild(nameCell);
        
        // Typ
        const typeCell = document.createElement('td');
        typeCell.textContent = file.is_directory ? 'Katalog' : 'Plik';
        row.appendChild(typeCell);
        
        // Rozmiar
        const sizeCell = document.createElement('td');
        sizeCell.textContent = file.is_directory ? '-' : formatSize(file.size);
        row.appendChild(sizeCell);
        
        // Data modyfikacji
        const modifiedCell = document.createElement('td');
        modifiedCell.textContent = file.modified;
        row.appendChild(modifiedCell);
        
        // Akcje
        const actionsCell = document.createElement('td');
        
        if (!file.is_directory) {
            // Przycisk pobierania
            const downloadBtn = document.createElement('button');
            downloadBtn.classList.add('btn');
            downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
            downloadBtn.title = 'Pobierz';
            downloadBtn.addEventListener('click', () => {
                downloadFtpFile(file);
            });
            actionsCell.appendChild(downloadBtn);
        }
        
        // Przycisk usuwania
        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('btn', 'danger');
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Usuń';
        deleteBtn.addEventListener('click', () => {
            deleteFtpFile(file);
        });
        actionsCell.appendChild(deleteBtn);
        
        row.appendChild(actionsCell);
        
        tbody.appendChild(row);
    });
}

/**
 * Pobiera plik z serwera FTP
 * @param {object} file - obiekt pliku do pobrania
 */
function downloadFtpFile(file) {
    if (!ftp.connection) {
        showToast('Brak połączenia FTP. Nie można pobrać pliku.', 'error');
        return;
    }

    if (file.is_directory) {
        showToast('Nie można pobrać katalogu. Wybierz plik.', 'warning');
        return;
    }

    showToast(`Pobieranie pliku ${file.name}...`, 'info');
    
    try {
        // Pobierz URL do pliku - teraz funkcja downloadFtpFile zwraca URL bezpośrednio
        const downloadUrl = api.downloadFtpFile(
            ftp.connection,
            normalizeFtpPath(file.path)
        );

        // Tworzenie ukrytego linku do pobrania i kliknięcie w niego
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = file.name;  // Ustawia nazwę pliku do pobrania
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Dodaj informację o aktywności po krótkim czasie
        // (żeby dać czas na rozpoczęcie pobierania)
        setTimeout(() => {
            addActivity(`Pobrano plik ${file.name} z ${ftp.currentPath} na kiosku ${selectedKiosk.name || selectedKiosk.id}`);
        }, 1000);
    } catch (error) {
        console.error('Błąd podczas pobierania pliku:', error);
        showToast(`Błąd podczas pobierania pliku: ${error.message}`, 'error');
    }
}

/**
 * Usuwa pojedynczy plik lub katalog z serwera FTP
 */
async function deleteFtpFile(file) {
    const confirmMessage = `Czy na pewno chcesz usunąć ${file.is_directory ? 'katalog' : 'plik'} ${file.name}?`;
    if (confirm(confirmMessage)) {
        showToast(`Usuwanie ${file.is_directory ? 'katalogu' : 'pliku'} ${file.name}...`, 'info');
        
        try {
            // Wywołanie API do usunięcia pliku
            await api.deleteFtpFile(
                ftp.connection,
                normalizeFtpPath(file.path),
                file.is_directory
            );
            
            showToast(`${file.is_directory ? 'Katalog' : 'Plik'} ${file.name} został usunięty pomyślnie`, 'success');
            
            // Odśwież listę plików
            loadFtpFiles(ftp.currentPath);
            
            // Dodaj informację o aktywności
            addActivity(`Usunięto ${file.is_directory ? 'katalog' : 'plik'} ${file.name} z ${ftp.currentPath} na kiosku ${selectedKiosk.name || selectedKiosk.id}`);
        } catch (error) {
            console.error('Błąd podczas usuwania pliku:', error);
            showToast(`Błąd podczas usuwania: ${error.message}`, 'error');
        }
    }
}

function updateSelectedFiles() {
    selectedFiles = [];
    const checkboxes = document.querySelectorAll('#ftp-files-body input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
        selectedFiles.push({
            name: checkbox.getAttribute('data-name'),
            path: checkbox.getAttribute('data-path'),
            isDirectory: checkbox.getAttribute('data-is-directory') === 'true'
        });
    });
    
    // Pokaż/ukryj przycisk usuwania
    const deleteBtn = document.getElementById('ftp-delete-btn');
    if (selectedFiles.length > 0) {
        deleteBtn.classList.remove('hidden');
    } else {
        deleteBtn.classList.add('hidden');
    }
}

function uploadFtpFile(file) {
    // Pokaż powiadomienie o rozpoczęciu przesyłania
    showToast(`Przesyłanie pliku ${file.name} do ${ftp.currentPath}...`, 'info');
    
    // Odczytujemy plik jako base64
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            // Przesyłamy dane pliku wraz z danymi połączenia FTP
            const result = await api.uploadFtpFile(
                ftp.connection,
                ftp.currentPath,
                event.target.result,
                file.name
            );
            
            // Wyświetl komunikat o sukcesie
            showToast(`Plik ${file.name} został przesłany pomyślnie`, 'success');
            
            // Odśwież listę plików
            loadFtpFiles(ftp.currentPath);
            
            // Dodaj informację o aktywności
            addActivity(`Przesłano plik ${file.name} do ${ftp.currentPath} na kiosku ${selectedKiosk.name || selectedKiosk.id}`);
        } catch (error) {
            console.error('Błąd podczas przesyłania pliku:', error);
            showToast(`Błąd podczas przesyłania pliku: ${error.message}`, 'error');
        }
    };
    
    reader.onerror = function(error) {
        console.error('Błąd odczytu pliku:', error);
        showToast(`Nie można odczytać pliku: ${error}`, 'error');
    };
    
    // Rozpocznij odczyt pliku jako URL danych (base64)
    reader.readAsDataURL(file);
}

/**
 * Tworzy nowy katalog na serwerze FTP
 * @param {string} folderName - nazwa nowego katalogu
 */
async function createFtpFolder(folderName) {
    if (!ftp.connection) {
        showToast('Brak połączenia FTP. Nie można utworzyć folderu.', 'error');
        return;
    }
    
    if (!folderName) {
        showToast('Nie podano nazwy folderu', 'error');
        return;
    }
    
    showToast(`Tworzenie folderu ${folderName} w ${ftp.currentPath}...`, 'info');
    
    try {
        // Wywołanie API do utworzenia katalogu
        await api.createFtpDirectory(
            ftp.connection,
            ftp.currentPath,
            folderName
        );
        
        showToast(`Folder ${folderName} został utworzony pomyślnie`, 'success');
        
        // Odśwież listę plików
        loadFtpFiles(ftp.currentPath);
        
        // Dodaj informację o aktywności
        addActivity(`Utworzono folder ${folderName} w ${ftp.currentPath} na kiosku ${selectedKiosk.name || selectedKiosk.id}`);
    } catch (error) {
        console.error('Błąd podczas tworzenia folderu:', error);
        showToast(`Błąd podczas tworzenia folderu: ${error.message}`, 'error');
    }
}

/**
 * Usuwa zaznaczone pliki lub katalogi
 */
async function deleteSelectedFiles() {
    if (selectedFiles.length === 0) {
        showToast('Nie wybrano żadnych plików do usunięcia', 'warning');
        return;
    }
    
    const confirmMessage = `Czy na pewno chcesz usunąć ${selectedFiles.length} ${selectedFiles.length === 1 ? 'element' : 'elementów'}?`;
    if (confirm(confirmMessage)) {
        showToast(`Usuwanie ${selectedFiles.length} ${selectedFiles.length === 1 ? 'elementu' : 'elementów'}...`, 'info');
        
        try {
            // Wywołanie API do usunięcia wielu plików
            const result = await api.deleteFtpFiles(
                ftp.connection,
                selectedFiles
            );
            
            // Sprawdź wyniki usuwania i pokaż odpowiedni komunikat
            const hadErrors = result.results && result.results.some(r => !r.success);
            
            if (hadErrors) {
                const successCount = result.results.filter(r => r.success).length;
                const errorCount = selectedFiles.length - successCount;
                
                showToast(`Usunięto pomyślnie ${successCount} ${successCount === 1 ? 'element' : 'elementów'}, ale ${errorCount} ${errorCount === 1 ? 'element nie mógł' : 'elementów nie mogło'} zostać usuniętych`, 'warning');
            } else {
                showToast(`Pomyślnie usunięto ${selectedFiles.length} ${selectedFiles.length === 1 ? 'element' : 'elementów'}`, 'success');
            }
            
            // Odśwież listę plików
            loadFtpFiles(ftp.currentPath);
            
            // Dodaj informację o aktywności
            addActivity(`Usunięto ${selectedFiles.length} ${selectedFiles.length === 1 ? 'element' : 'elementów'} z ${ftp.currentPath} na kiosku ${selectedKiosk.name || selectedKiosk.id}`);
            
            // Zresetuj zaznaczenie
            selectedFiles = [];
            document.getElementById('select-all-files').checked = false;
            document.getElementById('ftp-delete-btn').classList.add('hidden');
        } catch (error) {
            console.error('Błąd podczas usuwania plików:', error);
            showToast(`Błąd podczas usuwania plików: ${error.message}`, 'error');
        }
    }
}

// Pomocnicza funkcja debounce
function debounce(func, delay) {
    let timeout;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

/**
 * Porównuje dwa zestawy danych kiosków ignorując zmiany w adresach IP
 * @param {Array} oldData - Stare dane kiosków
 * @param {Array} newData - Nowe dane kiosków
 * @returns {Boolean} - true jeśli dane się zmieniły pomijając adresy IP
 */
function hasDataChangedExcludingIp(oldData, newData) {
    // Sprawdź czy liczba kiosków jest taka sama
    if (!oldData || !newData || oldData.length !== newData.length) {
        return true;
    }
    
    // Utwórz kopie danych z usuniętymi adresami IP
    const oldDataWithoutIp = oldData.map(kiosk => {
        const newKiosk = {...kiosk};
        delete newKiosk.ip_address;
        return newKiosk;
    });
    
    const newDataWithoutIp = newData.map(kiosk => {
        const newKiosk = {...kiosk};
        delete newKiosk.ip_address;
        return newKiosk;
    });
    
    // Porównaj dane bez adresów IP
    return JSON.stringify(oldDataWithoutIp) !== JSON.stringify(newDataWithoutIp);
}

/**
 * Dodaje nową aktywność do listy
 * @param {string} action - Opis akcji
 */
function addActivity(action) {
    const activity = {
        action,
        time: new Date().toISOString()
    };
    
    // Dodaj do listy aktywności
    recentActivities.unshift(activity);
    
    // Ogranicz listę do maksymalnej liczby elementów
    if (recentActivities.length > CONFIG.maxRecentActivities) {
        recentActivities = recentActivities.slice(0, CONFIG.maxRecentActivities);
    }
    
    // Zapisz w localStorage
    localStorage.setItem('recentActivities', JSON.stringify(recentActivities));
    
    // Zaktualizuj widok aktywności, jeśli jest widoczny
    updateActivitiesListOnly();
}

/**
 * Odświeżanie danych z backendu
 */
async function refreshData() {
    try {
        // Pobierz dane kiosków bez ingerencji w aktywną sekcję
        const response = await api.getKiosks();
        
        // Sprawdź, czy odpowiedź jest w nowym formacie (ma właściwość kiosks i no_refresh)
        if (response.kiosks && response.no_refresh === true) {
            // Jeśli tak, to aktualizujemy dane w pamięci bez odświeżania interfejsu
            kiosksData = response.kiosks;
            console.log("Odebrano odpowiedź z flagą no_refresh - pomijanie odświeżania UI");
            return;
        }
        
        // W przeciwnym przypadku traktujemy odpowiedź jako standardową tablicę kiosków
        const newKiosksData = Array.isArray(response) ? response : (response.kiosks || []);
        
        // Sprawdź, czy odpowiedź zawiera flagę noRefresh (dla kompatybilności wstecznej)
        if (response.noRefresh) {
            kiosksData = newKiosksData;
            console.log("Odebrano odpowiedź z flagą noRefresh - pomijanie odświeżania UI");
            return;
        }
        
        // Sprawdź, czy dane się zmieniły pomijając zmiany IP
        const dataChangedExcludingIp = hasDataChangedExcludingIp(kiosksData, newKiosksData);
        
        // Zaktualizuj dane w pamięci zawsze (by aktualizować IP)
        kiosksData = newKiosksData;
        
        // Aktualizuj interfejs tylko jeśli zmieniło się coś więcej niż IP
        if (dataChangedExcludingIp) {
            // Aktualizuj tylko potrzebne elementy DOM bez zmiany aktywnej sekcji
            updateDashboardStatsOnly();
            updateKiosksTableOnly();
            loadFtpKiosksOnly();
        }
    } catch (error) {
        console.error('Błąd podczas odświeżania danych:', error);
        showToast(`Błąd podczas odświeżania danych: ${error.message}`, 'error');
    }
}

/**
 * Aktualizuje tylko liczniki na dashboardzie bez ingerencji w resztę UI
 */
function updateDashboardStatsOnly() {
    const totalKiosks = kiosksData.length;
    const onlineKiosks = kiosksData.filter(kiosk => kiosk.status === 'online').length;
    const offlineKiosks = totalKiosks - onlineKiosks;

    document.getElementById('total-kiosks').textContent = totalKiosks;
    document.getElementById('online-kiosks').textContent = onlineKiosks;
    document.getElementById('offline-kiosks').textContent = offlineKiosks;
    
    // Aktualizuj aktywności bez przebudowy całego dashboardu
    updateActivitiesListOnly();
}

/**
 * Aktualizuje tylko listę aktywności bez przebudowy całego UI
 */
function updateActivitiesListOnly() {
    const activitiesList = document.getElementById('recent-activity-list');
    
    // Załaduj aktywności z localStorage, jeśli lista jest pusta
    if (recentActivities.length === 0) {
        const savedActivities = localStorage.getItem('recentActivities');
        if (savedActivities) {
            try {
                recentActivities = JSON.parse(savedActivities);
            } catch (e) {
                console.error('Błąd podczas ładowania aktywności:', e);
            }
        }
    }

    // Wyczyść listę i dodaj nowe elementy
    activitiesList.innerHTML = '';

    if (recentActivities.length === 0) {
        const emptyEl = document.createElement('p');
        emptyEl.textContent = 'Brak danych o aktywności';
        activitiesList.appendChild(emptyEl);
        return;
    }

    // Wypełnij listę aktywnościami
    recentActivities.forEach(activity => {
        const activityEl = document.createElement('div');
        activityEl.classList.add('activity-item');

        const actionEl = document.createElement('div');
        actionEl.classList.add('activity-action');
        actionEl.textContent = activity.action;

        const timeEl = document.createElement('div');
        timeEl.classList.add('activity-time');
        timeEl.textContent = formatDate(activity.time);

        activityEl.appendChild(actionEl);
        activityEl.appendChild(timeEl);
        activitiesList.appendChild(activityEl);
    });
}


/**
 * Ukrywa wszystkie otwarte menu rozwijane
 */
function hideAllDropdowns() {
    const dropdowns = document.querySelectorAll('.dropdown-content');
    dropdowns.forEach(dropdown => {
        dropdown.classList.remove('show');
    });
}

// Dodaj nasłuchiwanie kliknięć na dokumencie, aby ukryć dropdown po kliknięciu poza nim
document.addEventListener('click', hideAllDropdowns);

/**
 * Aktualizuje tylko tabelę kiosków bez ingerencji w resztę UI
 */
function updateKiosksTableOnly() {
    const tableBody = document.getElementById('kiosks-table-body');
    if (!tableBody) return; // Jeśli element nie istnieje, zakończ
    
    // Zamknij wszystkie otwarte menu rozwijane
    
    tableBody.innerHTML = '';

    if (kiosksData.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 8;
        cell.textContent = 'Brak danych o kioskach';
        cell.style.textAlign = 'center';
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
    }

    kiosksData.forEach(kiosk => {
        const row = document.createElement('tr');
        
        // ID
        const idCell = document.createElement('td');
        idCell.textContent = kiosk.id;
        row.appendChild(idCell);
        
        // Nazwa
        const nameCell = document.createElement('td');
        nameCell.textContent = kiosk.name || '-';
        row.appendChild(nameCell);
        
        // MAC
        const macCell = document.createElement('td');
        macCell.textContent = kiosk.mac_address;
        row.appendChild(macCell);
        
        // S/N
        const snCell = document.createElement('td');
        snCell.textContent = kiosk.serial_number;
        row.appendChild(snCell);
        
        // IP
        const ipCell = document.createElement('td');
        ipCell.textContent = kiosk.ip_address || '-';
        row.appendChild(ipCell);
        
        // Status
        const statusCell = document.createElement('td');
        const statusSpan = document.createElement('span');
        statusSpan.classList.add('status', kiosk.status === 'online' ? 'online' : 'offline');
        statusSpan.textContent = kiosk.status === 'online' ? 'Online' : 'Offline';
        statusCell.appendChild(statusSpan);
        row.appendChild(statusCell);
        
        // Ostatnie połączenie
        const lastConnCell = document.createElement('td');
        lastConnCell.textContent = kiosk.last_connection ? formatDate(kiosk.last_connection) : '-';
        row.appendChild(lastConnCell);
        
       // Akcje
       const actionsCell = document.createElement('td');
        
       // Przycisk edycji
       const editBtn = document.createElement('button');
       editBtn.classList.add('btn');
       editBtn.innerHTML = '<i class="fas fa-edit"></i>';
       editBtn.title = 'Edytuj';
       editBtn.addEventListener('click', () => {
           openEditKioskModal(kiosk);
       });
       actionsCell.appendChild(editBtn);
       
       // Przycisk restartu usługi
       const restartBtn = document.createElement('button');
       restartBtn.classList.add('btn');
       restartBtn.innerHTML = '<i class="fas fa-sync"></i>';
       restartBtn.title = 'Restart usługi';
       restartBtn.addEventListener('click', () => {
           restartKioskService(kiosk);
       });
       actionsCell.appendChild(restartBtn);
       
       // Przycisk SSH
       const sshBtn = document.createElement('button');
       sshBtn.classList.add('btn');
       sshBtn.innerHTML = '<i class="fas fa-terminal"></i>';
       sshBtn.title = 'Połącz przez SSH';
       sshBtn.addEventListener('click', () => {
           connectSSH(kiosk);
       });
       actionsCell.appendChild(sshBtn);
       
       // Przycisk VNC
       const vncBtn = document.createElement('button');
       vncBtn.classList.add('btn', 'vnc');
       vncBtn.innerHTML = '<i class="fas fa-desktop"></i>';
       vncBtn.title = 'Połącz przez VNC';
       vncBtn.addEventListener('click', () => {
           connectVNC(kiosk);
       });
       actionsCell.appendChild(vncBtn);
       
       // Przycisk usuwania
       const deleteBtn = document.createElement('button');
       deleteBtn.classList.add('btn', 'danger');
       deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
       deleteBtn.title = 'Usuń';
       deleteBtn.addEventListener('click', () => {
           deleteKiosk(kiosk.id, kiosk.name || kiosk.mac_address);
       });
       actionsCell.appendChild(deleteBtn);

       row.appendChild(actionsCell);
       
       tableBody.appendChild(row);
   });
}

/**
* Aktualizuje tylko kafelki kiosków w FTP bez ingerencji w resztę UI
*/
function loadFtpKiosksOnly() {
   const kiosksContainer = document.getElementById('ftp-kiosk-tiles');
   if (!kiosksContainer) return; // Jeśli element nie istnieje, zakończ
   
   // Wyczyść kontener
   kiosksContainer.innerHTML = '';
   
   // Jeśli brak kiosków
   if (kiosksData.length === 0) {
       const emptyElement = document.createElement('div');
       emptyElement.className = 'kiosk-tile-empty';
       emptyElement.textContent = 'Brak dostępnych kiosków. Dodaj kioski w sekcji "Kioski".';
       kiosksContainer.appendChild(emptyElement);
       return;
   }
   
   // Filtrowanie kiosków
   const searchQuery = document.getElementById('ftp-search')?.value.toLowerCase() || '';
   let filteredKiosks = kiosksData;
   
   if (searchQuery) {
       filteredKiosks = kiosksData.filter(kiosk => {
           return (kiosk.name && kiosk.name.toLowerCase().includes(searchQuery)) ||
                  (kiosk.serial_number && kiosk.serial_number.toLowerCase().includes(searchQuery)) ||
                  (kiosk.mac_address && kiosk.mac_address.toLowerCase().includes(searchQuery)) ||
                  (kiosk.ip_address && kiosk.ip_address.toLowerCase().includes(searchQuery));
       });
   }
   
   // Generuj kafelki dla kiosków
   filteredKiosks.forEach(kiosk => {
       const tileElement = document.createElement('div');
       tileElement.className = 'kiosk-tile';
       tileElement.setAttribute('data-kiosk-id', kiosk.id);
       
       const headerElement = document.createElement('div');
       headerElement.className = 'kiosk-tile-header';
       
       const titleElement = document.createElement('h3');
       titleElement.textContent = kiosk.name || `Kiosk ${kiosk.id}`;
       
       const statusElement = document.createElement('div');
       statusElement.className = `kiosk-tile-status ${kiosk.status}`;
       
       headerElement.appendChild(titleElement);
       headerElement.appendChild(statusElement);
       
       const infoElement = document.createElement('div');
       infoElement.className = 'kiosk-tile-info';
       
       const ipElement = document.createElement('p');
       const ipLabel = document.createElement('span');
       ipLabel.textContent = 'IP:';
       const ipValue = document.createElement('span');
       ipValue.textContent = kiosk.ip_address || 'Brak';
       ipElement.appendChild(ipLabel);
       ipElement.appendChild(ipValue);
       
       const snElement = document.createElement('p');
       const snLabel = document.createElement('span');
       snLabel.textContent = 'S/N:';
       const snValue = document.createElement('span');
       snValue.textContent = kiosk.serial_number;
       snElement.appendChild(snLabel);
       snElement.appendChild(snValue);
       
       const macElement = document.createElement('p');
       const macLabel = document.createElement('span');
       macLabel.textContent = 'MAC:';
       const macValue = document.createElement('span');
       macValue.textContent = kiosk.mac_address;
       macElement.appendChild(macLabel);
       macElement.appendChild(macValue);
       
       const lastConnElement = document.createElement('p');
       const lastConnLabel = document.createElement('span');
       lastConnLabel.textContent = 'Ostatnie połączenie:';
       const lastConnValue = document.createElement('span');
       lastConnValue.textContent = kiosk.last_connection ? formatDate(kiosk.last_connection) : 'Nigdy';
       lastConnElement.appendChild(lastConnLabel);
       lastConnElement.appendChild(lastConnValue);
       
       infoElement.appendChild(ipElement);
       infoElement.appendChild(snElement);
       infoElement.appendChild(macElement);
       infoElement.appendChild(lastConnElement);
        
        tileElement.appendChild(headerElement);
        tileElement.appendChild(infoElement);
        
        // Dodaj obsługę kliknięcia dla całego kafelka
        tileElement.addEventListener('click', () => {
            selectKiosk(kiosk);
        });
        
        kiosksContainer.appendChild(tileElement);
   });
}

/**
* Wyświetla powiadomienie toast
*/
function showToast(message, type = 'info') {
   const toastContainer = document.getElementById('toast-container');
   
   const toast = document.createElement('div');
   toast.classList.add('toast', type);
   
   const messageEl = document.createElement('div');
   messageEl.textContent = message;
   
   const closeBtn = document.createElement('button');
   closeBtn.innerHTML = '&times;';
   closeBtn.addEventListener('click', () => {
       toast.remove();
   });
   
   toast.appendChild(messageEl);
   toast.appendChild(closeBtn);
   toastContainer.appendChild(toast);
   
   // Automatyczne zamknięcie
   setTimeout(() => {
       toast.remove();
   }, CONFIG.toastDuration);
}

/**
* Formatuje datę
*/
function formatDate(dateStr) {
   const date = new Date(dateStr);
   return date.toLocaleString('pl-PL');
}

/**
* Formatuje rozmiar pliku
*/
function formatSize(size) {
   if (size < 1024) {
       return `${size} B`;
   } else if (size < 1024 * 1024) {
       return `${(size / 1024).toFixed(2)} KB`;
   } else if (size < 1024 * 1024 * 1024) {
       return `${(size / (1024 * 1024)).toFixed(2)} MB`;
   } else {
       return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
   }
}

/**
* Otwiera modal edycji kiosku
*/
function openEditKioskModal(kiosk) {
   document.getElementById('edit-kiosk-id').value = kiosk.id;
   document.getElementById('edit-kiosk-name').value = kiosk.name || '';
   document.getElementById('edit-kiosk-mac').value = kiosk.mac_address;
   document.getElementById('edit-kiosk-sn').value = kiosk.serial_number;
   document.getElementById('edit-kiosk-ftp-username').value = kiosk.ftp_username || '';
   document.getElementById('edit-kiosk-ftp-password').value = ''; // Hasło nie jest wyświetlane
   
   document.getElementById('edit-kiosk-modal').style.display = 'block';
}

/**
* Usuwa kiosk z systemu
* @param {number} kioskId - ID kiosku do usunięcia
* @param {string} kioskIdentifier - Nazwa lub inny identyfikator kiosku do wyświetlenia
*/
async function deleteKiosk(kioskId, kioskIdentifier) {
   // Potwierdzenie od użytkownika
   const confirmMessage = `Czy na pewno chcesz usunąć kiosk "${kioskIdentifier}"?`;
   if (!confirm(confirmMessage)) {
       return; // Użytkownik anulował
   }
   
  
   try {
       // Wywołaj API do usunięcia kiosku
       await api.deleteKiosk(kioskId);
       
       // Pokaż powiadomienie o sukcesie
       showToast(`Kiosk "${kioskIdentifier}" został usunięty pomyślnie`, 'success');
       
       // Dodaj aktywność
       addActivity(`Usunięto kiosk: ${kioskIdentifier}`);
       
       // Odśwież dane
       refreshData();
       
   } catch (error) {
       // Obsługa błędu
       showToast(`Błąd podczas usuwania kiosku: ${error.message}`, 'error');
       console.error('Błąd podczas usuwania kiosku:', error);
   }
}

/**
* Ładuje ustawienia z obiektu CONFIG do formularzy
*/
function loadSettingsToForms() {
   // Ustawienia główne aplikacji
   document.getElementById('setting-refresh-interval').value = CONFIG.refreshInterval / 1000;
   
   // Ustawienia portów
   document.getElementById('setting-ftp-port').value = CONFIG.defaultFtpPort || 21;
   document.getElementById('setting-ssh-port').value = CONFIG.defaultSshPort || 22;
   
   // Ustawienia FTP
   document.getElementById('setting-ftp-path').value = CONFIG.defaultFtpPath || '/';
   document.getElementById('setting-ftp-username').value = CONFIG.defaultFtpUsername || '';
   document.getElementById('setting-ftp-password').value = CONFIG.defaultFtpPassword || '';
   
   // Ustawienia SSH - nazwa użytkownika jest zawsze "kiosk"
   document.getElementById('setting-ssh-username').value = 'kiosk';
   document.getElementById('setting-ssh-password').value = CONFIG.defaultSshPassword || '';
   
   // Inicjalizacja pola portu FTP w formularzu połączenia
   document.getElementById('ftp-port').value = CONFIG.defaultFtpPort || 21;
   
   // Inicjalizacja zmiennych globalnych
   ftp.currentPath = CONFIG.defaultFtpPath || '/';
   ftp.pathHistory = [CONFIG.defaultFtpPath || '/'];
}

/**
* Aktualizuje stan przycisków nawigacji na podstawie bieżącej ścieżki
*/
function updateNavigationButtons() {
   // Przycisk "Wstecz" - aktywny tylko, gdy mamy historię dłuższą niż 1
   const backButton = document.getElementById('ftp-back-btn');
   backButton.disabled = ftp.pathHistory.length <= 1;
   
   // Przycisk "W górę" - aktywny tylko, gdy nie jesteśmy w katalogu głównym
   const upButton = document.getElementById('ftp-up-btn');
   upButton.disabled = ftp.currentPath === '/';
}

/**
 * Inicjuje połączenie SSH z kioskiem
 * @param {object} kiosk - obiekt kiosku
 */
function connectSSH(kiosk) {
   if (!kiosk.ip_address) {
       showToast('Brak adresu IP dla tego kiosku', 'error');
       return;
   }
     // Domyślny port SSH
   const sshPort = CONFIG.defaultSshPort || 22;
   
   // Nazwa użytkownika SSH jest zawsze ustawiona na "kiosk"
   const sshUsername = "kiosk";
   
   // Pokaż informacje o połączeniu
   console.log(`Łączenie przez SSH z ${kiosk.ip_address} jako użytkownik ${sshUsername}`);
   
   // Tworzenie URI dla SSH, format: ssh://użytkownik@adres_ip:port
   const sshUri = `ssh://${sshUsername}@${kiosk.ip_address}:${sshPort}`;
   
   try {
       // Pokaż komunikat o połączeniu
       showToast(`Łączenie przez SSH z kioskiem ${kiosk.name || 'Kiosk ' + kiosk.id} jako ${sshUsername}...`, 'info');
       
       // Próba otwarcia URI SSH - zostanie obsłużone przez domyślny klient SSH w systemie
       window.open(sshUri, '_blank');
       
       // Dodaj informację o aktywności
       addActivity(`Zainicjowano połączenie SSH z kioskiem: ${kiosk.name || kiosk.id}`);
   } catch (error) {
       console.error('Błąd podczas inicjowania połączenia SSH:', error);
       showToast(`Błąd połączenia SSH: ${error.message}`, 'error');
   }
}

/**
 * Inicjuje połączenie VNC z kioskiem używając NoVNC
 * @param {object} kiosk - obiekt kiosku
 */
function connectVNC(kiosk) {
   if (!kiosk.ip_address) {
       showToast('Brak adresu IP dla tego kiosku', 'error');
       return;
   }
   
   // Stały port VNC - 6080
   const vncPort = 6080;
   
   // Tworzymy URL dla połączenia NoVNC - używamy strony lokalnej zamiast serwera
   // Korzystamy bezpośrednio z adresu IP kiosku i portu VNC
   const vncUrl = `http://${kiosk.ip_address}:${vncPort}/vnc.html?host=${kiosk.ip_address}&port=${vncPort}&autoconnect=true`;
   
   try {
       // Otwórz stronę VNC w nowej karcie
       window.open(vncUrl, '_blank');
       
       // Dodaj informację o aktywności
       addActivity(`Zainicjowano połączenie VNC z kioskiem: ${kiosk.name || kiosk.id}`);
   } catch (error) {
       console.error('Błąd podczas inicjowania połączenia VNC:', error);
       showToast(`Błąd połączenia VNC: ${error.message}`, 'error');
   }
}

// Automatyczne odświeżanie listy kiosków co 30 sekund, gdy użytkownik jest w sekcji "kiosks"
setInterval(() => {
   const activeSection = localStorage.getItem('activeSection');
   if (activeSection === 'kiosks') {
       refreshData();
   }
}, 30000);

/**
 * Restartuje usługę na kiosku poprzez SSH
 * @param {object} kiosk - obiekt kiosku
 */
async function restartKioskService(kiosk) {
    if (!kiosk.ip_address) {
        showToast('Brak adresu IP dla tego kiosku. Nie można wykonać restartu.', 'error');
        return;
    }
      try {
        // Najpierw pobieramy aktualne ustawienia SSH z bazy danych
        const settings = await api.getSettings();
        
        // Pobierz nazwę usługi z ustawień
        const serviceName = 'kiosk';
        // Pobierz dane uwierzytelniające z bazy danych i odszyfruj je
        let username, password;
        // Nazwa użytkownika SSH jest zawsze ustawiona na "kiosk"
        username = 'kiosk';
        console.log('Użyto stałej nazwy użytkownika SSH: kiosk');
        
        if (settings.defaultSshPassword) {
            try {
                // Spróbuj odszyfrować hasło
                console.log(`Próba odszyfrowania hasła SSH. Zaszyfrowane hasło ma długość: ${settings.defaultSshPassword.length}`);
                password = decryptData(settings.defaultSshPassword);
                console.log(`Pobrano i odszyfrowano hasło SSH z bazy danych. Długość hasła: ${password.length}`);
            } catch (decryptError) {
                console.error('Błąd podczas odszyfrowywania hasła SSH:', decryptError);
                showToast('Błąd podczas odszyfrowywania hasła SSH. Sprawdź ustawienia.', 'error');
                return;
            }
        } else {
            console.error('Brak hasła SSH w bazie danych.');
            showToast('Brak hasła SSH w bazie danych. Sprawdź ustawienia.', 'error');
            return;
        }

        // Walidacja danych logowania
        if (!username || !password) {
            showToast('Brak kompletnych danych uwierzytelniających SSH. Sprawdź ustawienia.', 'error');
            return;
        }
        
        // Pokaż komunikat o trwającym restarcie
        showToast(`Trwa restart usługi ${serviceName} na kiosku ${kiosk.name || kiosk.id}...`, 'info');
        
        // Przekaż dane uwierzytelniające do API
        const result = await api.restartKioskService(kiosk.id, {
            username: username,
            password: password, // Odszyfrowane hasło
            service: serviceName
        });
        
        // Pokaż komunikat o sukcesie
        showToast(`Usługa ${serviceName} została pomyślnie zrestartowana na kiosku ${kiosk.name || kiosk.id}`, 'success');
        
        // Dodaj informację o aktywności
        addActivity(`Zrestartowano usługę ${serviceName} na kiosku ${kiosk.name || kiosk.id}`);
        
    } catch (error) {
        console.error('Błąd podczas restartowania usługi:', error);
        showToast(`Błąd podczas restartowania usługi: ${error.message}`, 'error');
    }
}