/**
 * Funkcje obsługujące sekcję Playlist
 */

let playlistFtp = {
    connection: null,
    files: [],
    scheduleData: null,
    currentKiosk: null,
    isLoading: false
};

/**
 * Konfiguracja interfejsu Playlist
 */
function setupPlaylistUI() {
    // Obsługa selektora kiosków
    const kioskSelect = document.getElementById('playlist-kiosk-select');
    kioskSelect.addEventListener('change', handleKioskSelection);

    // Obsługa przycisków
    document.getElementById('refresh-playlist-files').addEventListener('click', loadPlaylistFiles);
    document.getElementById('save-playlist').addEventListener('click', saveScheduleFile);
    document.getElementById('add-playlist-item').addEventListener('click', addScheduleItem);

    // Wypełnij selektor kiosków danymi
    updatePlaylistKioskSelector();
}

/**
 * Aktualizacja selektora kiosków w sekcji Playlist
 */
async function updatePlaylistKioskSelector() {
    try {
        const kiosks = await api.getKiosks();
        const kioskSelect = document.getElementById('playlist-kiosk-select');
        
        // Wyczyść istniejące opcje, pozostawiając tylko placeholder
        kioskSelect.innerHTML = '<option value="" disabled selected>Wybierz kiosk...</option>';
        
        // Dodaj opcje dla każdego kiosku
        kiosks.forEach(kiosk => {
            const option = document.createElement('option');
            option.value = kiosk.id;
            option.textContent = kiosk.name || `Kiosk ${kiosk.id}`;
            if (kiosk.status === 'offline') {
                option.disabled = true;
                option.textContent += ' (offline)';
            }
            kioskSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Błąd podczas pobierania listy kiosków:', error);
        showToast('Nie udało się pobrać listy kiosków', 'error');
    }
}

/**
 * Obsługa wyboru kiosku w selektorze
 */
async function handleKioskSelection(event) {
    const kioskId = event.target.value;
    if (!kioskId) return;
    
    try {
        // Pokaż container playlisty
        document.getElementById('playlist-container').classList.remove('hidden');
        
        // Pokaż komunikat o ładowaniu
        setPlaylistLoadingStatus(true, 'Pobieranie danych kiosku...');
        
        // Pobierz dane kiosku
        const kiosks = await api.getKiosks();
        const currentKiosk = kiosks.find(k => k.id.toString() === kioskId.toString());
        
        if (!currentKiosk) {
            showToast('Nie znaleziono wybranego kiosku', 'error');
            setPlaylistLoadingStatus(false);
            return;
        }
        
        playlistFtp.currentKiosk = currentKiosk;
        
        // Pobierz dane logowania FTP dla kiosku
        const ftpCredentials = await api.getKioskFtpCredentials(kioskId);
          // Ustaw dane połączenia FTP
        playlistFtp.connection = {
            hostname: currentKiosk.ip_address,
            port: 21, // Domyślny port FTP
            username: ftpCredentials.username || 'kiosk',
            password: ftpCredentials.password || 'kiosk'
        };
        
        // Załaduj pliki
        await loadPlaylistFiles();
    } catch (error) {
        console.error('Błąd podczas pobierania danych kiosku:', error);
        showToast('Nie udało się pobrać danych kiosku', 'error');
        setPlaylistLoadingStatus(false);
    }
}

/**
 * Ładowanie plików z kiosku
 */
async function loadPlaylistFiles() {
    if (!playlistFtp.connection || !playlistFtp.currentKiosk) {
        showToast('Brak połączenia z kioskiem', 'error');
        return;
    }
    
    try {
        setPlaylistLoadingStatus(true, 'Pobieranie listy plików...');
        
        // Pobierz listę plików z domyślnego katalogu
        const mediaPath = '/';
        const result = await api.listFtpFiles(playlistFtp.connection, mediaPath);
        
        if (result && Array.isArray(result)) {
            // Konwertuj format danych is_directory na type
            const formattedFiles = result.map(file => ({
                ...file,
                type: file.is_directory ? 'directory' : 'file'
            }));
            
            console.log('Sformatowane pliki:', formattedFiles);
            playlistFtp.files = formattedFiles;
            renderPlaylistFiles(formattedFiles);
            checkForScheduleFile(formattedFiles);
        } else {
            console.error('Nieprawidłowa odpowiedź API:', result);
            showToast('Nie udało się pobrać listy plików', 'error');
        }
    } catch (error) {
        console.error('Błąd podczas pobierania plików:', error);
        showToast('Błąd połączenia FTP: ' + error.message, 'error');
    } finally {
        setPlaylistLoadingStatus(false);
    }
}

/**
 * Renderowanie listy plików w panelu
 */
function renderPlaylistFiles(files) {
    const tbody = document.getElementById('playlist-files-body');
    tbody.innerHTML = '';
    
    if (!files || files.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.textContent = 'Brak plików w katalogu';
        cell.style.textAlign = 'center';
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }
    
    // Sortuj pliki - najpierw katalogi, potem pliki
    files.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
    });
    
    // Dodaj pliki do tabeli
    files.forEach(file => {
        const row = document.createElement('tr');
        
        // Nadanie klasy dla typów plików
        if (isVideoFile(file.name)) {
            row.classList.add('video-file');
        }
        if (file.name === 'schedule.json') {
            row.classList.add('schedule-file');
        }
        
        // Nazwa
        const nameCell = document.createElement('td');
        const nameSpan = document.createElement('div');
        nameSpan.className = 'file-name';
        
        // Dodanie ikony odpowiedniej dla typu pliku
        let icon = 'fa-file';
        if (file.type === 'directory') icon = 'fa-folder';
        else if (isVideoFile(file.name)) icon = 'fa-file-video';
        else if (isImageFile(file.name)) icon = 'fa-file-image';
        else if (file.name.endsWith('.json')) icon = 'fa-file-code';
        
        nameSpan.innerHTML = `<i class="fas ${icon}"></i> ${file.name}`;
        nameCell.appendChild(nameSpan);
        row.appendChild(nameCell);
        
        // Typ
        const typeCell = document.createElement('td');
        typeCell.textContent = file.type === 'directory' ? 'Katalog' : 'Plik';
        row.appendChild(typeCell);
        
        // Rozmiar
        const sizeCell = document.createElement('td');
        sizeCell.textContent = file.type === 'directory' ? '-' : formatFileSize(file.size);
        row.appendChild(sizeCell);
        
        // Akcje
        const actionsCell = document.createElement('td');
        actionsCell.className = 'file-actions';
        
        if (file.name === 'schedule.json') {
            // Przycisk edycji dla pliku schedule.json
            const editBtn = document.createElement('button');
            editBtn.classList.add('btn', 'primary');
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title = 'Edytuj playlistę';
            editBtn.addEventListener('click', () => {
                loadScheduleFile('schedule.json');
            });
            actionsCell.appendChild(editBtn);
        } else if (isVideoFile(file.name)) {
            // Przycisk dodania do playlisty dla plików wideo
            const addToPlaylistBtn = document.createElement('button');
            addToPlaylistBtn.classList.add('btn', 'primary');
            addToPlaylistBtn.innerHTML = '<i class="fas fa-plus"></i>';
            addToPlaylistBtn.title = 'Dodaj do playlisty';
            addToPlaylistBtn.addEventListener('click', () => {
                addVideoToPlaylist(file.name);
            });
            actionsCell.appendChild(addToPlaylistBtn);
        }
        
        row.appendChild(actionsCell);
        tbody.appendChild(row);
    });
}

/**
 * Sprawdzanie, czy plik jest plikiem wideo
 */
function isVideoFile(filename) {
    const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
    return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}

/**
 * Sprawdzanie, czy plik jest obrazem
 */
function isImageFile(filename) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    return imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}

/**
 * Sprawdzanie, czy w katalogu jest plik schedule.json
 */
function checkForScheduleFile(files) {
    const scheduleFile = files.find(file => file.name === 'schedule.json');
    
    const scheduleItemsContainer = document.getElementById('schedule-items-container');
    const playlistStatus = document.getElementById('playlist-status');
    
    if (scheduleFile) {
        playlistStatus.innerHTML = '<p>Kliknij na plik schedule.json po lewej stronie, aby go załadować</p>';
    } else {
        playlistStatus.innerHTML = `
            <p>Nie znaleziono pliku schedule.json.</p>
            <button id="create-schedule-file" class="btn primary">Utwórz nowy plik</button>
        `;
        
        // Obsługa przycisku tworzenia nowego pliku
        document.getElementById('create-schedule-file').addEventListener('click', createNewScheduleFile);
    }
}

/**
 * Tworzenie nowego pliku schedule.json
 */
async function createNewScheduleFile() {
    if (!playlistFtp.connection) return;
    
    try {
        setPlaylistLoadingStatus(true, 'Tworzenie pliku schedule.json...');
        
        // Tworzymy nowy pusty plik schedule.json
        const emptySchedule = '{}';
        await api.putFileContent(
            playlistFtp.connection,
            '/schedule.json',
            emptySchedule
        );
        
        showToast('Plik schedule.json został utworzony', 'success');
        
        // Odśwież listę plików
        await loadPlaylistFiles();
        
        // Załaduj pusty plik schedule
        loadScheduleFile('/schedule.json');
    } catch (error) {
        console.error('Błąd podczas tworzenia pliku schedule.json:', error);
        showToast('Nie udało się utworzyć pliku schedule.json', 'error');
    } finally {
        setPlaylistLoadingStatus(false);
    }
}

/**
 * Ładowanie pliku schedule.json
 */
async function loadScheduleFile(filePath) {
    if (!playlistFtp.connection) return;
    
    try {
        setPlaylistLoadingStatus(true, 'Pobieranie pliku schedule.json...');
        
        // Użyj pełnej ścieżki, dodając / jeśli nie zaczyna się od /
        const fullPath = filePath.startsWith('/') ? filePath : '/' + filePath;
        const result = await api.getFileContent(playlistFtp.connection, fullPath);
        
        if (result && result.content) {
            try {
                // Parsowanie zawartości JSON
                const scheduleData = JSON.parse(result.content);
                playlistFtp.scheduleData = scheduleData;
                
                // Wyświetlenie danych w edytorze
                renderScheduleEditor(scheduleData);
                
                console.log('Dane playlisty załadowane:', scheduleData);
                
                // Explicite zmień stan ładowania na false po zakończeniu
                playlistFtp.isLoading = false;
            } catch (parseError) {
                console.error('Błąd parsowania JSON:', parseError);
                showToast('Plik schedule.json zawiera nieprawidłowy format JSON', 'error');
                
                // Jeśli plik jest pusty lub nieprawidłowy, inicjalizujemy pusty obiekt
                playlistFtp.scheduleData = {};
                renderScheduleEditor({});
            }
        } else {
            showToast('Nie udało się pobrać pliku schedule.json', 'error');
            // Zresetuj dane, żeby UI wiedział, że nie mamy danych
            playlistFtp.scheduleData = null;
        }
    } catch (error) {
        console.error('Błąd podczas pobierania pliku schedule.json:', error);
        showToast('Błąd podczas pobierania pliku schedule.json: ' + error.message, 'error');
        // Zresetuj dane, żeby UI wiedział, że nie mamy danych
        playlistFtp.scheduleData = null;
    } finally {
        // Upewnij się, że stan ładowania jest zawsze wyłączony na koniec
        setPlaylistLoadingStatus(false);
    }
}

/**
 * Dodanie elementu playlisty do interfejsu
 */
function addScheduleItemToUI(filename, frequency) {
    const scheduleItemsContainer = document.getElementById('schedule-items-container');
    
    console.log('Dodawanie elementu playlisty:', filename, frequency);
    
    const itemElement = document.createElement('div');
    itemElement.className = 'schedule-item';
    
    // Dodajemy atrybuty drag & drop
    itemElement.setAttribute('draggable', 'true');
    itemElement.setAttribute('data-filename', filename);
    
    // Sprawdź, czy plik istnieje w katalogu
    const fileExists = playlistFtp.files.some(file => file.name === filename);
    const fileClass = fileExists ? 'file-exists' : 'file-missing';
    
    itemElement.innerHTML = `
        <div class="drag-handle">
            <i class="fas fa-grip-lines"></i>
        </div>
        <div class="schedule-item-filename ${fileClass}">
            <input type="text" value="${filename}" class="filename-input" 
                placeholder="Nazwa pliku" ${fileExists ? 'readonly' : ''}>
        </div>
        <div class="schedule-item-frequency">
            <input type="number" value="${frequency}" min="1" class="frequency-input" 
                placeholder="Częstotliwość">
        </div>
        <div class="schedule-item-controls">
            ${fileExists ? 
                '<button class="btn primary file-picker-btn"><i class="fas fa-file-video"></i></button>' : 
                '<button class="btn warning file-picker-btn"><i class="fas fa-exclamation-triangle"></i></button>'
            }
            <button class="btn danger remove-item-btn"><i class="fas fa-trash"></i></button>
        </div>
    `;
    
    // Obsługa przycisku wyboru pliku
    const filePickerBtn = itemElement.querySelector('.file-picker-btn');
    filePickerBtn.addEventListener('click', function() {
        showFilePickerForItem(itemElement);
    });
    
    // Obsługa przycisku usuwania
    const removeBtn = itemElement.querySelector('.remove-item-btn');
    removeBtn.addEventListener('click', function() {
        itemElement.remove();
    });
    
    // Dodanie obsługi zdarzeń drag & drop
    setupDragAndDropForItem(itemElement);
    
    // Dodaj element na początek kontenera
    if (scheduleItemsContainer.firstChild) {
        scheduleItemsContainer.insertBefore(itemElement, scheduleItemsContainer.firstChild);
    } else {
        scheduleItemsContainer.appendChild(itemElement);
    }
    
    console.log('Element playlisty dodany, liczba elementów:', document.querySelectorAll('.schedule-item').length);
}

/**
 * Konfiguracja funkcji drag & drop dla elementu playlisty
 */
function setupDragAndDropForItem(item) {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', handleDrop);
}

/**
 * Obsługa rozpoczęcia przeciągania
 */
function handleDragStart(e) {
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.getAttribute('data-filename'));
    
    // Dodaj klasę do wszystkich elementów playlisty, aby pokazać, że można upuścić
    document.querySelectorAll('.schedule-item').forEach(item => {
        if (item !== this) {
            item.classList.add('drop-target');
        }
    });
}

/**
 * Obsługa zakończenia przeciągania
 */
function handleDragEnd(e) {
    this.classList.remove('dragging');
    
    // Usuń klasę drop-target ze wszystkich elementów
    document.querySelectorAll('.schedule-item').forEach(item => {
        item.classList.remove('drop-target');
        item.classList.remove('drop-hover');
    });
}

/**
 * Obsługa zdarzenia dragover (kiedy element jest przeciągany nad celem)
 */
function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

/**
 * Obsługa zdarzenia dragenter (kiedy element wchodzi na obszar celu)
 */
function handleDragEnter(e) {
    this.classList.add('drop-hover');
}

/**
 * Obsługa zdarzenia dragleave (kiedy element opuszcza obszar celu)
 */
function handleDragLeave(e) {
    this.classList.remove('drop-hover');
}

/**
 * Obsługa upuszczenia elementu
 */
function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault();
    
    // Usuń klasę drop-hover
    this.classList.remove('drop-hover');
    
    // Pobierz dane elementu przeciąganego
    const draggedFilename = e.dataTransfer.getData('text/plain');
    const draggingElement = document.querySelector(`.schedule-item[data-filename="${draggedFilename}"]`);
    
    // Jeśli przeciągany element to ten sam element, na który upuszczamy, nic nie robimy
    if (draggingElement === this) {
        return false;
    }
    
    // Pobierz kontener
    const container = document.getElementById('schedule-items-container');
    
    // Określ, czy wstawić przed czy po elemencie docelowym
    const rect = this.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const isBelow = y > rect.height / 2;
    
    // Wstawienie elementu w odpowiednie miejsce
    if (isBelow) {
        // Wstawienie po elemencie docelowym
        if (this.nextElementSibling) {
            container.insertBefore(draggingElement, this.nextElementSibling);
        } else {
            container.appendChild(draggingElement);
        }
    } else {
        // Wstawienie przed elementem docelowym
        container.insertBefore(draggingElement, this);
    }
    
    return false;
}

/**
 * Renderowanie edytora playlisty
 */
function renderScheduleEditor(scheduleData) {
    const scheduleItemsContainer = document.getElementById('schedule-items-container');
    const playlistStatus = document.getElementById('playlist-status');
    
    console.log('Renderowanie edytora playlisty', scheduleData);
    
    // Wyczyść kontener
    scheduleItemsContainer.innerHTML = '';
    
    // Explicite ukryj komunikat ładowania i pokaż kontener elementów
    scheduleItemsContainer.classList.remove('hidden');
    playlistStatus.classList.add('hidden');
    
    // Jeśli scheduleData jest pusty obiekt lub tablica, wyświetl komunikat
    if (Object.keys(scheduleData).length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'playlist-empty-message';
        emptyMessage.textContent = 'Playlista jest pusta. Kliknij "Dodaj element", aby rozpocząć.';
        scheduleItemsContainer.appendChild(emptyMessage);
        return;
    }
    
    // Renderuj elementy playlisty - sortuj według nazwy pliku dla lepszej organizacji
    const sortedEntries = Object.entries(scheduleData).sort((a, b) => a[0].localeCompare(b[0]));
    sortedEntries.forEach(([filename, frequency]) => {
        addScheduleItemToUI(filename, frequency);
    });
}

/**
 * Dodanie nowego elementu do playlisty
 */
function addScheduleItem() {
    if (!playlistFtp.files) {
        showToast('Najpierw pobierz listę plików', 'error');
        return;
    }
    
    // Znajdź pierwszy plik wideo na liście (jeśli istnieje)
    const videoFile = playlistFtp.files.find(file => isVideoFile(file.name));
    
    // Dodaj element do interfejsu
    addScheduleItemToUI(videoFile ? videoFile.name : '', 1);
    
    // Pokaż kontener elementów playlisty
    document.getElementById('schedule-items-container').classList.remove('hidden');
    document.getElementById('playlist-status').classList.add('hidden');
}

/**
 * Dodanie pliku wideo do playlisty
 * @param {string} filename - nazwa pliku wideo
 */
function addVideoToPlaylist(filename) {
    if (!playlistFtp.scheduleData) {
        // Jeśli jeszcze nie załadowano pliku schedule.json, najpierw próbujemy go znaleźć
        const scheduleFile = playlistFtp.files.find(file => file.name === 'schedule.json');
        
        if (scheduleFile) {
            // Załaduj plik schedule.json, a następnie dodaj wideo
            loadScheduleFile('schedule.json').then(() => {
                // Po załadowaniu dodaj wideo
                addScheduleItemToUI(filename, 1);
                
                // Pokaż kontener elementów playlisty
                document.getElementById('schedule-items-container').classList.remove('hidden');
                document.getElementById('playlist-status').classList.add('hidden');
            });
        } else {
            // Utwórz nowy plik i dodaj wideo
            createNewScheduleFile().then(() => {
                addScheduleItemToUI(filename, 1);
                
                // Pokaż kontener elementów playlisty
                document.getElementById('schedule-items-container').classList.remove('hidden');
                document.getElementById('playlist-status').classList.add('hidden');
            });
        }
    } else {
        // Po prostu dodaj wideo do istniejącej playlisty
        addScheduleItemToUI(filename, 1);
        
        // Pokaż kontener elementów playlisty
        document.getElementById('schedule-items-container').classList.remove('hidden');
        document.getElementById('playlist-status').classList.add('hidden');
        
        // Aktualizuj obiekt scheduleData, aby element był zapisany
        if (!playlistFtp.scheduleData[filename]) {
            playlistFtp.scheduleData[filename] = 1;
        }
    }
}

/**
 * Zapisanie pliku schedule.json
 */
async function saveScheduleFile() {
    if (!playlistFtp.connection) {
        showToast('Brak połączenia z kioskiem', 'error');
        return;
    }
    
    try {
        setPlaylistLoadingStatus(true, 'Zapisywanie playlisty...');
        
        // Zbierz dane z interfejsu
        const scheduleData = {};
        const scheduleItems = document.querySelectorAll('.schedule-item');
        
        scheduleItems.forEach(item => {
            const filename = item.querySelector('.filename-input').value.trim();
            const frequency = parseInt(item.querySelector('.frequency-input').value) || 1;
            
            if (filename) {
                scheduleData[filename] = frequency;
            }
        });
        
        // Zapisz dane do pliku
        const scheduleContent = JSON.stringify(scheduleData, null, 2);
        await api.putFileContent(
            playlistFtp.connection,
            '/schedule.json',
            scheduleContent
        );
        
        // Aktualizuj dane w pamięci
        playlistFtp.scheduleData = scheduleData;
        
        showToast('Playlista została zapisana', 'success');
        
        // Odśwież listę plików
        await loadPlaylistFiles();
    } catch (error) {
        console.error('Błąd podczas zapisywania playlisty:', error);
        showToast('Nie udało się zapisać playlisty: ' + error.message, 'error');
    } finally {
        setPlaylistLoadingStatus(false);
    }
}

/**
 * Ustawia status ładowania
 */
function setPlaylistLoadingStatus(isLoading, message = '') {
    playlistFtp.isLoading = isLoading;
    
    const statusElement = document.getElementById('playlist-status');
    const scheduleItemsContainer = document.getElementById('schedule-items-container');
    
    if (isLoading) {
        statusElement.classList.remove('hidden');
        scheduleItemsContainer.classList.add('hidden');
        statusElement.innerHTML = `
            <div class="loading-indicator">
                <i class="fas fa-spinner fa-spin"></i>
                <p>${message}</p>
            </div>
        `;
    } else {
        // Gdy ładowanie zakończone, ukrywamy komunikat ładowania
        // i pokazujemy kontener elementów playlisty, jeśli dane są dostępne
        if (playlistFtp.scheduleData) {
            scheduleItemsContainer.classList.remove('hidden');
            statusElement.classList.add('hidden');
        } else {
            // Jeśli nie ma danych, pokazujemy komunikat statusu
            statusElement.classList.remove('hidden');
        }
    }
}

/**
 * Formatowanie rozmiaru pliku
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
