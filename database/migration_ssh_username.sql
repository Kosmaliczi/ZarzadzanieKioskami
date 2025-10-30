-- Migracja: Zmiana domyślnego użytkownika SSH z 'kiosk' na 'root'
-- Data: 2025-10-17
-- Powód: LibreELEC używa użytkownika 'root' zamiast 'kiosk'

-- Aktualizacja domyślnego użytkownika SSH
UPDATE settings SET value = 'root' WHERE key = 'defaultSshUsername';

-- Informacja:
-- LibreELEC: użytkownik 'root', port 22 (SFTP), usługa: ipdoapi.service
-- Debian/Raspbian: użytkownik 'kiosk', port 21 (FTP), usługa: kiosk.service
-- Backend automatycznie wykrywa typ systemu i odpowiednio restartuje usługę
