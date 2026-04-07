CREATE TABLE IF NOT EXISTS kiosks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac_address VARCHAR(20) NOT NULL UNIQUE,
    serial_number VARCHAR(30) NOT NULL UNIQUE,
    ip_address VARCHAR(15),
    last_connection DATETIME,
    status VARCHAR(20) DEFAULT 'offline',
    name VARCHAR(100),
    ftp_username VARCHAR(100),
    ftp_password VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kiosks_mac ON kiosks(mac_address);
CREATE INDEX IF NOT EXISTS idx_kiosks_serial ON kiosks(serial_number);

-- Tabela ustawień aplikacji
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Domyślne wartości dla ustawień (zostaną dodane tylko jeśli nie istnieją)
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultFtpPort', '21');
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultFtpPath', '/');
INSERT OR IGNORE INTO settings (key, value) VALUES ('refreshInterval', '30000');

-- Domyślne wartości dla danych logowania SSH (zostaną dodane tylko jeśli nie istnieją)
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultSshUsername', 'kiosk'); -- Nazwa użytkownika SSH jest ustawiona na stałe jako "kiosk"
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultSshPassword', 'kiosk'); -- Puste hasło, będzie ustawiane przez interfejs i szyfrowane
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultSshPort', '22');

-- Tabela użytkowników
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
