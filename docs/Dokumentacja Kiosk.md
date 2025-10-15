# Dokumentacja systemu zarządzania kioskami

Data: 2025-10-15
Repo: Kiosk-reklamowy-Raspi5

## 1. Opis projektu
System umożliwia zarządzanie siecią kiosków (np. Raspberry Pi) z poziomu panelu WWW. Umożliwia:
- Rejestrację i edycję kiosków (MAC, S/N, IP, nazwa)
- Podgląd statusu online/offline i ostatniego połączenia
- Zarządzanie plikami na kioskach przez FTP (listowanie, upload, download, usuwanie, tworzenie folderów, edycja plików tekstowych)
- Zdalny restart usługi kiosku przez SSH (klucz RSA)
- Zdalne obracanie ekranu przez SSH (xrandr)
- Edycję playlisty (praca z plikami na kiosku, np. schedule.json)
- Logowanie i autoryzację przez JWT

## 2. Architektura
- Frontend (folder `frontend/`):
  - `index.html`, `login.html`, CSS (style, ssh-styles), JS: `config.js`, `api.js`, `main.js`, `playlist.js`, `login.js`.
  - Aplikacja SPA bez frameworka, komunikacja z API przez `ApiClient` (fetch + JWT Bearer).
- Backend API (folder `backend/`):
  - `app.py`: Flask + CORS, SQLite, JWT, bcrypt, paramiko, ftplib, dotenv.
  - Endpoints: auth, kiosks CRUD, device IP report, settings, FTP operacje, SSH akcje.
  - `requirements.txt`: Flask, Flask-Cors, SQLAlchemy (niewykorzystywane aktywnie), python-dotenv, requests, paramiko.
  - `migrate_passwords.py`: migracja haseł użytkowników do bcrypt.
  - `ssh_keys/kiosk_id_rsa`: klucz prywatny SSH używany do połączeń z kioskami.
- Baza danych (folder `database/`):
  - SQLite: `kiosks.db`, schema w `schema.sql` z tabelami: `kiosks`, `settings`, `users`.
- Skrypty na kioski (folder `Do Kiosku/`):
  - `ipdoapi.py`: cykliczne raportowanie IP do API dla danego S/N (PUT /api/device/<sn>/ip).
  - `ipdoapi.service`: jednostka systemd uruchamiająca powyższy skrypt.
  - `instalator.sh`: instalacja vsftpd, noVNC+x11vnc i kopiowanie plików na urządzenie.
- Dodatkowo: `app.py` w katalogu głównym to niezależny mini-serwer PDF (nie powiązany z panelem zarządzania).

## 3. Baza danych
Schema (skrócona):
- `kiosks(id, mac_address UNIQUE, serial_number UNIQUE, ip_address, last_connection, status, name, ftp_username, ftp_password, created_at, updated_at)`
- `settings(key PRIMARY KEY, value, created_at, updated_at)` — domyślne wpisy: defaultFtpPort, defaultFtpPath, refreshInterval, defaultSshUsername, defaultSshPort
- `users(id, username UNIQUE, password, created_at, updated_at)`

Inicjalizacja bazy wykonywana jest automatycznie przy starcie `backend/app.py` (wykonanie `schema.sql`). Dodatkowo przy pierwszym uruchomieniu dodawany jest domyślny użytkownik `admin` z hasłem `admin` (bcrypt).

## 4. Backend API — endpoints
Adres bazowy: http://<HOST>:5000
Większość endpointów (poza logowaniem, raportowaniem IP i pobieraniem pliku przez GET) wymaga nagłówka Authorization: Bearer <JWT>.

- Auth
  - POST `/api/auth/login` — body: { username, password } → { success, token }
- Settings
  - GET `/api/settings` → map klucz→wartość
  - POST `/api/settings` — body: map ustawień do zapisania (stringi). Hasła mogą być wstępnie zaszyfrowane po stronie frontu (XOR+Base64), backend deszyfruje przy użyciu zgodnego klucza.
- Kiosks
  - GET `/api/kiosks` → lista kiosków. Przed zwróceniem danych backend automatycznie ustawia status offline dla tych, które nie raportowały się > 1 min.
  - POST `/api/kiosks` — body: { mac_address, serial_number, name?, ftp_username?, ftp_password? }
  - PUT `/api/kiosks/{id}` — częściowa aktualizacja pól (name, mac_address, serial_number, ftp_username, ftp_password)
  - DELETE `/api/kiosks/{id}`
- Device IP report (bez auth)
  - POST/PUT `/api/device/{serial_number}/ip` — body: { ip_address?, mac_address? } (ip fallback: remote_addr). Aktualizuje IP, last_connection, status=online; odrzuca dla nieznanego S/N (404).
- FTP (wymaga danych serwera, zwykle IP kiosku + konto FTP)
  - POST `/api/ftp/connect` — { hostname, port?, username, password }
  - POST `/api/ftp/files` — { hostname, port?, username, password, path? } → listowanie katalogu
  - POST `/api/ftp/upload` — { hostname, port?, username, password, path, file_name, file_data(base64) }
  - POST `/api/ftp/delete` — { hostname, port?, username, password, path, is_directory? }
  - POST `/api/ftp/delete-multiple` — { hostname, port?, username, password, files: [{path, isDirectory}] }
  - GET `/api/ftp/download` — query: hostname, port, username, password, path → zwraca plik jako attachment
  - POST `/api/ftp/mkdir` — { hostname, port?, username, password, path, folder_name }
  - GET `/api/kiosks/{id}/ftp-credentials` — zwraca dane FTP zapisane przy kiosku (ip, user, pass)
  - POST `/api/ftp/get-file-content` — { hostname, port?, username, password, path }
  - POST `/api/ftp/put-file-content` — { hostname, port?, username, password, path, content }
- SSH akcje
  - POST `/api/kiosks/{id}/restart-service` — restart usługi `kiosk.service` przez SSH z użyciem klucza `backend/ssh_keys/kiosk_id_rsa` (user i port z settings lub body)
  - POST `/api/kiosks/{id}/rotate-display` — { orientation: 'right' | '0' | 'normal' } → wykonuje `xrandr` na DISPLAY=:0

Uwaga bezpieczeństwa: Hasła do FTP mogą być przechowywane w bazie w postaci jawnej. Rozważ przechowywanie sekretów w bezpiecznym magazynie lub szyfrowanie na serwerze.

## 5. Frontend — kluczowe pliki
- `frontend/js/api.js` — klient API (ustaw bazowy URL na adres serwera backendu). Obsługa JWT, błędów, metody dla Kiosków, Ustawień, FTP, SSH, edytora.
- `frontend/js/config.js` — konfiguracja, proste szyfrowanie wrażliwych pól (XOR+Base64) z kluczem zgodnym z backendem.
- `frontend/js/main.js` — logika interfejsu: dashboard, CRUD kiosków, kafelki FTP, drag&drop, edytor tekstu, restart usługi, VNC/SSH placeholders.
- `frontend/js/login.js` — logowanie i zapis tokenu w localStorage.

## 6. Uruchomienie środowiska developerskiego
Windows/PowerShell:
1) Utwórz i aktywuj venv oraz zainstaluj zależności:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```
2) Uruchom backend:
```powershell
python backend/app.py
```
3) Otwórz `frontend/index.html` w przeglądarce (lub hostuj lokalnie) i upewnij się, że adresy w `frontend/js/api.js` i `frontend/js/login.js` wskazują na IP serwera backendu.

Zmienne środowiskowe (opcjonalnie): `backend/.env`
- `DATABASE_PATH=../database/kiosks.db`
- `FLASK_ENV=development`
- `FLASK_DEBUG=1`
- `SECRET_KEY=...`

## 7. Wdrożenie na Raspberry Pi (kiosk)
Cel: kiosk okresowo wysyła swój IP do API i udostępnia pliki przez FTP/VNC.

Na urządzeniu:
- Skopiuj z folderu `Do Kiosku/` pliki `ipdoapi.py` i `ipdoapi.service` na urządzenie (instalator `instalator.sh` pomaga w kopiowaniu i konfiguracji).
- W `ipdoapi.py` ustaw `API_BASE_URL` na adres serwera API (instalator potrafi podmienić IP przez sed).
- Zainstaluj i skonfiguruj vsftpd (skrypt `instalator.sh`):
  - Tworzy katalog `/home/kiosk/MediaPionowe`, ustawia uprawnienia, dodaje konfigurację pasv i chroot.
- Zainstaluj noVNC + x11vnc (skrypt `instalator.sh`):
  - Tworzy usługi systemd `x11vnc.service` i `novnc.service`.
- Uruchom i włącz usługi systemd: `ipdoapi.service`, `vsftpd`, `x11vnc`, `novnc`.

Backend — SSH:
- Umieść klucz prywatny `backend/ssh_keys/kiosk_id_rsa` (bez hasła lub z agentem) i zapewnij odpowiedni publiczny klucz na urządzeniach w `~/.ssh/authorized_keys` dla użytkownika (np. `kiosk`).
- W `settings` ustaw `defaultSshUsername` i `defaultSshPort`.

## 8. Bezpieczeństwo i dobre praktyki
- Ustaw inne `JWT_SECRET_KEY` i klucz szyfrowania niż domyślne; przechowuj w zmiennych środowiskowych.
- Ogranicz CORS do dozwolonych originów w produkcji.
- Rozważ odsunięcie operacji FTP na SFTP (paramiko) lub FTPS; obecnie używany jest plain FTP.
- Nie przechowuj haseł w settings w formie jawnej; jeśli musisz, szyfruj po stronie serwera.
- Wymuś HTTPS dla panelu i API w środowisku produkcyjnym.

## 9. Typowe problemy i diagnostyka
- Brak połączenia z FTP: sprawdź firewall, tryb pasywny (pasv_min/max), poprawność user/pass, katalog `local_root`.
- SSH restart/rotate-display zwraca błąd: upewnij się, że klucz prywatny jest poprawny, użytkownik ma sudo lub dostęp do DISPLAY=:0, a `paramiko` jest zainstalowane na serwerze backendu.
- Raport IP nie działa: sprawdź `API_BASE_URL` w `ipdoapi.py`, łączność sieciową, czy S/N istnieje w bazie.
- 401 w panelu: wygasły token — zaloguj się ponownie.

## 10. Licencja i autorzy
Repozytorium nie zawiera pliku licencji. Dodaj licencję wedle potrzeb.

Autor: Kosmaliczi (wg metadanych repo).
