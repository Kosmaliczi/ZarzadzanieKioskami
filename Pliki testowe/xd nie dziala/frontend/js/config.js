/**
 * Konfiguracja aplikacji do zarządzania kioskami
 */
const CONFIG = {
    // Interwał odświeżania danych (w milisekundach)
    refreshInterval: 30000,
    
    // Czas pokazywania powiadomień toast (w milisekundach)
    toastDuration: 5000,
    
    // Maksymalna liczba aktywności pokazywana na liście
    maxRecentActivities: 10,
    
    // Ustawienia domyślnych portów
    defaultFtpPort: 21,
    defaultSshPort: 22,
    
    // Domyślna ścieżka dla FTP
    defaultFtpPath: '/'
};

// Klucz do szyfrowania i deszyfrowania (to będzie używane tylko w aplikacji klienckiej)
const ENCRYPTION_KEY = 'kiosk-manager-secure-key-2025';

/**
 * Szyfruje dane używając podstawowego szyfrowania
 * @param {string} text - Tekst do zaszyfrowania
 * @returns {string} - Zaszyfrowany tekst (base64)
 */
function encryptData(text) {
    // Jeśli nie ma tekstu do zaszyfrowania, zwróć pusty ciąg
    if (!text) return '';
    
    try {
        // Proste szyfrowanie XOR z kluczem
        const result = [];
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
            result.push(String.fromCharCode(charCode));
        }
        
        // Konwersja do Base64 dla bezpiecznego przechowywania
        return btoa(result.join(''));
    } catch (e) {
        console.error('Błąd podczas szyfrowania:', e);
        return '';
    }
}

/**
 * Deszyfruje dane zaszyfrowane przez encryptData
 * @param {string} encryptedText - Zaszyfrowany tekst (base64)
 * @returns {string} - Odszyfrowany tekst
 */
function decryptData(encryptedText) {
    // Jeśli nie ma tekstu do odszyfrowania, zwróć pusty ciąg
    if (!encryptedText) return '';
    
    try {
        // Dekodowanie Base64
        const encryptedString = atob(encryptedText);
        
        // Deszyfrowanie XOR z kluczem
        const result = [];
        for (let i = 0; i < encryptedString.length; i++) {
            const charCode = encryptedString.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
            result.push(String.fromCharCode(charCode));
        }
        
        return result.join('');
    } catch (e) {
        console.error('Błąd podczas deszyfrowania:', e);
        return '';
    }
}

/**
 * Szyfruje wrażliwe dane w obiekcie ustawień
 * @param {object} settings - obiekt z ustawieniami do zaszyfrowania
 * @returns {object} - obiekt z zaszyfrowanymi wrażliwymi danymi
 */
function encryptSettingsValues(settings) {
    const encryptedSettings = {...settings};
    
    // Lista kluczy zawierających wrażliwe dane, które należy zaszyfrować
    const sensitiveKeys = [
        'defaultSshPassword',
        'defaultFtpPassword'
    ];
    
    // Wymuszenie nazwy użytkownika SSH jako "kiosk"
    if ('defaultSshUsername' in encryptedSettings) {
        encryptedSettings['defaultSshUsername'] = 'kiosk';
    }
    
    // Szyfruj tylko te klucze, które znajdują się w obiekcie ustawień
    sensitiveKeys.forEach(key => {
        if (key in encryptedSettings && encryptedSettings[key]) {
            // Logowanie przed szyfrowaniem
            console.log(`Szyfrowanie klucza ${key}. Oryginalna wartość ma długość: ${encryptedSettings[key].length}`);
            
            encryptedSettings[key] = encryptData(encryptedSettings[key]);
            
            // Logowanie po szyfrowaniu
            console.log(`Zaszyfrowano dane dla klucza ${key}. Zaszyfrowana wartość: ${encryptedSettings[key].substr(0, 10)}...`);
        } else {
            console.log(`Pominięto szyfrowanie dla klucza ${key} - brak wartości lub klucza`);
        }
    });
    
    return encryptedSettings;
}

/**
 * Funkcja do aktualizacji konfiguracji
 * @param {string} key - klucz ustawienia
 * @param {any} value - wartość ustawienia
 * @returns {Promise<boolean>} - Promise czy aktualizacja się powiodła
 */
async function updateConfig(key, value) {
    if (key in CONFIG) {
        // Aktualizuj wartość lokalnie
        CONFIG[key] = value;
        
        try {
            // Zapisz w bazie danych
            const settings = {};
            
            // W przypadku hasła SSH i FTP nie szyfrujemy tutaj, 
            // ponieważ zostanie to zrobione w funkcji api.saveSettings
            settings[key] = value;
            console.log(`Przygotowano dane dla ${key} do zapisu`);
            
            await api.saveSettings(settings);
            
            // Zapisz kopię w localStorage dla trybu offline
            saveConfigToLocalStorage();
            
            return true;
        } catch (error) {
            console.error('Błąd podczas zapisywania ustawień w bazie danych:', error);
            
            // Zapisz lokalnie jeśli błąd
            saveConfigToLocalStorage();
            
            return false;
        }
    }
    return false;
}

/**
 * Zapisuje konfigurację do localStorage (jako kopię zapasową)
 */
function saveConfigToLocalStorage() {
    localStorage.setItem('kioskConfig', JSON.stringify(CONFIG));
}

/**
 * Ładuje ustawienia z bazy danych
 * @returns {Promise<void>}
 */
async function loadConfig() {
    try {
        // Próbuj pobrać ustawienia z bazy danych
        const settings = await api.getSettings();
        
        // Aktualizuj konfigurację
        Object.keys(settings).forEach(key => {
            if (key in CONFIG) {
                // Deszyfruj hasła i wrażliwe dane
                if (key === 'defaultSshPassword' || key === 'defaultFtpPassword') {
                    try {
                        CONFIG[key] = decryptData(settings[key]);
                        console.log(`Odszyfrowano dane dla ${key}`);
                    } catch (decryptError) {
                        console.error(`Błąd podczas deszyfrowania ${key}:`, decryptError);
                        // Jeśli nie możemy odszyfrować, użyj oryginalnej wartości
                        CONFIG[key] = settings[key];
                    }
                }
                // Konwersja wartości na odpowiedni typ dla pozostałych ustawień
                else if (typeof CONFIG[key] === 'number') {
                    CONFIG[key] = Number(settings[key]);
                } else {
                    CONFIG[key] = settings[key];
                }
            }
        });
        
        console.log('Załadowano ustawienia z bazy danych');
        
        // Zapisz kopię w localStorage
        saveConfigToLocalStorage();
    } catch (error) {
        console.error('Błąd podczas ładowania ustawień z bazy danych:', error);
        
        // W razie błędu wczytaj z localStorage
        loadConfigFromLocalStorage();
        
        console.log('Załadowano ustawienia z localStorage (tryb offline)');
    }
}

/**
 * Ładuje konfigurację z localStorage (dla trybu offline)
 */
function loadConfigFromLocalStorage() {
    const savedConfig = localStorage.getItem('kioskConfig');
    if (savedConfig) {
        try {
            const parsedConfig = JSON.parse(savedConfig);
            Object.keys(parsedConfig).forEach(key => {
                if (key in CONFIG) {
                    CONFIG[key] = parsedConfig[key];
                }
            });
        } catch (e) {
            console.error('Błąd podczas ładowania konfiguracji z localStorage:', e);
        }
    }
}