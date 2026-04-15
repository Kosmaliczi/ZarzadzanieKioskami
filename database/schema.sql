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
    media_path TEXT,
    text_file_path TEXT,
    playlist_target_file TEXT,
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
-- Użytkownik 'root' dla LibreELEC, 'kiosk' dla Debian
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultSshUsername', 'root');
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultSshPort', '22');

-- Tabela użytkowników
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabela uprawnień akcji per użytkownik
CREATE TABLE IF NOT EXISTS user_action_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, action),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_action_permissions_user ON user_action_permissions(user_id, action);

-- Tabela rezerwacji siłowni
CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(50),
    notes TEXT
);

-- Indeksy dla lepszej wydajności zapytań o rezerwacje
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_date_time ON reservations(date, start_time, end_time);

-- Tabele playlist (kolejki plików dla kiosków)
CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kiosk_id INTEGER NOT NULL,
    name VARCHAR(120) NOT NULL DEFAULT 'Default',
    order_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(kiosk_id, name),
    FOREIGN KEY(kiosk_id) REFERENCES kiosks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlists_kiosk ON playlists(kiosk_id);

CREATE TABLE IF NOT EXISTS playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type VARCHAR(20) DEFAULT 'file',
    file_size INTEGER DEFAULT 0,
    display_frequency INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, position);
