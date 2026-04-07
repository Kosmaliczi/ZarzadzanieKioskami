/**
 * API Client do komunikacji z backendem
 */
class ApiClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * Wykonuje zapytanie do API
     * @param {string} endpoint - ścieżka endpoint
     * @param {string} method - metoda HTTP (GET, POST, PUT, DELETE)
     * @param {object} data - dane do wysłania (opcjonalne)
     * @returns {Promise} - promise z odpowiedzią
     */
    async fetchApi(endpoint, method = 'GET', data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (data && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);
            const result = await response.json();

            if (!response.ok) {
                throw new ApiError(result.error || 'Wystąpił błąd podczas komunikacji z API', response.status);
            }

            // Dodajemy informację, czy należy odświeżać interfejs po tej operacji
            result.noRefresh = response.headers.get('X-No-Refresh') === 'true' || result.no_refresh === true;

            return result;
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            } else {
                throw new ApiError(error.message || 'Błąd sieci', 0);
            }
        }
    }

    // Metody dla kiosków
    async getKiosks() {
        return this.fetchApi('/api/kiosks');
    }

    async addKiosk(kioskData) {
        return this.fetchApi('/api/kiosks', 'POST', kioskData);
    }

    async updateKiosk(kioskId, kioskData) {
        return this.fetchApi(`/api/kiosks/${kioskId}`, 'PUT', kioskData);
    }

    async deleteKiosk(kioskId) {
        return this.fetchApi(`/api/kiosks/${kioskId}`, 'DELETE');
    }

    // Metody dla ustawień
    async getSettings() {
        return this.fetchApi('/api/settings');
    }

    async saveSettings(settings) {
        // Jeśli mamy dostęp do funkcji szyfrowania, zaszyfruj wrażliwe dane
        if (typeof encryptSettingsValues === 'function') {
            settings = encryptSettingsValues(settings);
        }
        return this.fetchApi('/api/settings', 'POST', settings);
    }

    // Nowa metoda do zmiany portu noVNC
    async updateNoVncPort(port) {
        const settings = {
            defaultNoVncPort: port
        };
        return this.saveSettings(settings);
    }

    // Metody dla FTP
    async testFtpConnection(connectionData) {
        return this.fetchApi('/api/ftp/connect', 'POST', connectionData);
    }

    async listFtpFiles(connectionData, path = '/home/kiosk/MediaPionowe') {
        const data = { ...connectionData, path };
        return this.fetchApi('/api/ftp/files', 'POST', data);
    }

    // Nowa metoda do pobierania danych logowania FTP dla kiosku
    async getKioskFtpCredentials(kioskId) {
        return this.fetchApi(`/api/kiosks/${kioskId}/ftp-credentials`);
    }

    // Nowa metoda do przesyłania plików przez FTP
    async uploadFtpFile(connectionData, filePath, fileData, fileName) {
        const data = {
            ...connectionData,
            path: filePath,
            file_name: fileName,
            file_data: fileData
        };
        return this.fetchApi('/api/ftp/upload', 'POST', data);
    }

    // Nowa metoda do tworzenia katalogów na serwerze FTP
    async createFtpDirectory(connectionData, path, folderName) {
        const data = {
            ...connectionData,
            path,
            folder_name: folderName
        };
        return this.fetchApi('/api/ftp/mkdir', 'POST', data);
    }

    // Nowa metoda do usuwania pojedynczego pliku przez FTP
    async deleteFtpFile(connectionData, filePath, isDirectory = false) {
        const data = {
            ...connectionData,
            path: filePath,
            is_directory: isDirectory
        };
        return this.fetchApi('/api/ftp/delete', 'POST', data);
    }

    // Nowa metoda do usuwania wielu plików przez FTP
    async deleteFtpFiles(connectionData, files) {
        const data = {
            ...connectionData,
            files: files
        };
        return this.fetchApi('/api/ftp/delete-multiple', 'POST', data);
    }

    // Nowa metoda do pobierania plików przez FTP
    downloadFtpFile(connectionData, filePath) {
        // Tworzymy URL z parametrami, ponieważ będziemy korzystać z otwarcia URL zamiast fetch
        const params = new URLSearchParams();
        params.append('hostname', connectionData.hostname);
        params.append('port', connectionData.port);
        params.append('username', connectionData.username);
        params.append('password', connectionData.password);
        params.append('path', filePath);
        
        // Zwróć URL do bezpośredniego pobrania
        return `${this.baseUrl}/api/ftp/download?${params.toString()}`;
    }

    // Alias dla listFtpFiles, żeby obsłużyć wywołania getFtpFiles
    async getFtpFiles(connectionData) {
        return this.listFtpFiles(connectionData, connectionData.path || '/home/kiosk/MediaPionowe');
    }

    // Symuluj urządzenie zgłaszające swoje IP
    async deviceReportIp(serialNumber, macAddress = null, ipAddress = null) {
        const data = {};
        if (macAddress) {
            data.mac_address = macAddress;
        }
        if (ipAddress) {
            data.ip_address = ipAddress;
        }
        return this.fetchApi(`/api/device/${serialNumber}/ip`, 'POST', data);
    }
    
    /**
     * Restartuje usługę na kiosku
     * @param {number} kioskId - ID kiosku do zrestartowania
     * @param {object} credentials - dane uwierzytelniające SSH
     * @returns {Promise} - promise z odpowiedzią
     */
    async restartKioskService(kioskId, credentials = null) {
        const data = credentials || {}; // Jeśli nie podano danych, używamy pustego obiektu
        return this.fetchApi(`/api/kiosks/${kioskId}/restart-service`, 'POST', data);
    }

    /**
     * Pobiera zawartość pliku z serwera FTP
     * @param {object} connectionData - dane połączenia FTP
     * @param {string} filePath - ścieżka do pliku
     * @returns {Promise} - promise z odpowiedzią zawierającą zawartość pliku
     */
    async getFileContent(connectionData, filePath) {
        const data = { ...connectionData, path: filePath };
        return this.fetchApi('/api/ftp/get-file-content', 'POST', data);
    }

    /**
     * Zapisuje zawartość pliku na serwer FTP
     * @param {object} connectionData - dane połączenia FTP
     * @param {string} filePath - ścieżka do pliku
     * @param {string} content - zawartość pliku
     * @returns {Promise} - promise z odpowiedzią
     */
    async putFileContent(connectionData, filePath, content) {
        const data = { ...connectionData, path: filePath, content };
        return this.fetchApi('/api/ftp/put-file-content', 'POST', data);
    }
}

/**
 * Klasa błędu API
 */
class ApiError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
    }
}

// Inicjalizacja klienta API z bezpośrednim adresem localhost
const api = new ApiClient('http://192.168.0.105:5000');