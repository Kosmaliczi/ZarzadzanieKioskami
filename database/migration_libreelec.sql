-- Migracja bazy danych dla obsługi LibreELEC (SFTP)
-- Data: 2025-10-17
-- Dodaje domyślne ustawienia dla różnych typów kiosków

-- Dodanie domyślnych ustawień dla LibreELEC
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultLibreelecUser', 'root');
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultLibreelecPort', '22');
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultLibreelecPath', '/storage/MediaPionowe');

-- Dodanie informacji o domyślnych ustawieniach Debian (dla porównania)
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultDebianUser', 'kiosk');
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultDebianPort', '21');
INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultDebianPath', '/home/kiosk/MediaPionowe');

-- Komentarz: 
-- Port 21 = FTP (vsftpd, Debian/Raspbian)
-- Port 22 = SFTP (SSH, LibreELEC)
-- Backend automatycznie wybiera odpowiedni protokół na podstawie numeru portu
