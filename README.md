# Kiosk Platform - Project README

Kompletna dokumentacja systemu Kiosk Platform obejmująca frontend, backend, bazę danych oraz procesy uruchomieniowe.

## Dokumentacja kioskow RP4 i RP5

Szczegolowa instrukcja pracy z odtwarzaczami kioskowymi znajduje sie w pliku:

- [DOKUMENTACJA_KIOSK_RP4_RP5.md](DOKUMENTACJA_KIOSK_RP4_RP5.md)

## 1. Cel systemu

Kiosk Platform to aplikacja do centralnego zarządzania kioskami i operacjami serwisowymi.
System realizuje:

- autoryzację użytkowników i role (user/admin),
- zarządzanie kioskami i ich statusem online/offline,
- operacje plikowe FTP/SFTP,
- zarządzanie playlistą i plikami,
- rezerwacje (sprawdzanie dostępności, tworzenie, anulowanie),
- zarządzanie użytkownikami,
- konfigurację parametrów operacyjnych (FTP/SSH, interwały itp.).

## 2. Zakres repozytorium

Repozytorium zawiera trzy główne warstwy:

- `backend/` - API aplikacji oraz logika biznesowa,
- `my-app/` - nowy frontend React + Vite,
- `database/` - SQLite i pliki SQL (schema + migracje).

Dodatkowo:

- `docker-compose.yml` - uruchamianie całego stacku w kontenerach.

## 3. Architektura wysokiego poziomu

1. Użytkownik korzysta z interfejsu React (`my-app`).
2. Frontend wysyła żądania do endpointów `/api/*`.
3. Backend realizuje logikę domenową i operacje na bazie SQLite.
4. Dla operacji plikowych backend łączy się z urządzeniami kiosk przez FTP lub SFTP.
5. Baza `database/kiosks.db` przechowuje dane kiosków, użytkowników, rezerwacji i ustawień.

## 4. Frontend (React + Vite)

### 4.1 Stack technologiczny

- React 19
- Vite 8
- Tailwind CSS 4
- Three.js + Vanta (animowane tło)
- Axios

### 4.2 Najważniejsze moduły

- `src/App.jsx` - shell aplikacji, routing widoków, logowanie i warstwa UI,
- `src/pages/` - moduły funkcjonalne (Dashboard, Kiosk, FTP, Playlist, Reservation, TextEditor, User, Settings),
- `src/hooks/` - hooki domenowe i API (`useApi`, `useMutation`, `useAsync`, `useApiManager`),
- `src/services/` - serwisy API (`AuthService`, `KioskService`, `FtpService`, `ReservationService`, `UserService`, `SettingsService`),
- `src/core/HttpClient.ts` - wspólny klient HTTP,
- `src/config/env.js` - konfiguracja URL API.

### 4.3 Integracja API

Frontend jest uruchamiany wewnątrz `ApiProvider` w `src/main.jsx`.
Wszystkie wywołania API przechodzą przez `ApiManager`, który centralnie udostępnia serwisy domenowe.

### 4.4 Zachowanie UI

- panel logowania i panel aplikacyjny są sterowane stanem sesji,
- tło Vanta Waves jest animowane, a kolor zmienia się cyklicznie,
- komponenty interfejsu korzystają ze wspólnych klas UI dla spójności.

## 5. Backend (Flask + warstwa Django Gateway)

Backend ma dwie współistniejące warstwy:

- **Flask (legacy + aktywna logika biznesowa):** `backend/app.py`
- **Django gateway (enterprise shell):** `backend/kiosk_platform/` i `backend/apps/`

### 5.1 Flask - odpowiedzialność

`backend/app.py` realizuje główne operacje systemu:

- autoryzacja JWT (`/api/auth/login`),
- kioski (`/api/kiosks` i endpointy szczegółowe),
- FTP/SFTP (`/api/ftp/*`),
- rezerwacje (`/api/reservations/*`),
- użytkownicy (`/api/users/*`),
- ustawienia (`/api/settings`),
- zmiana hasła (`/api/account/change-password`, `/api/users/<id>/change-password`).

### 5.2 Bezpieczeństwo backendu

- hasła użytkowników przechowywane jako hash bcrypt,
- autoryzacja oparta o JWT,
- role użytkowników (admin/user),
- dekoratory ochrony endpointów (`token_required`, `admin_required`).

### 5.3 Integracja FTP/SFTP

Backend rozróżnia protokół po porcie:

- port `21` -> FTP,
- port `22` -> SFTP.

Obsługa jest realizowana m.in. przez `sftp_handler.py` i funkcje połączeniowe w `app.py`.

### 5.4 SQLite i współbieżność

Backend korzysta z SQLite (`database/kiosks.db`) z ustawieniami wspierającymi współbieżność:

- `PRAGMA busy_timeout`,
- `journal_mode = WAL`,
- mechanizmy ograniczające spam locków w logach.

### 5.5 Django gateway

Część Django (`manage.py`, `kiosk_platform`, `apps/api_gateway`) umożliwia uruchomienie backendu w strukturze enterprise.
Żądania mogą być przekazywane do logiki Flask przez proxy w `apps/api_gateway/views.py`.

## 6. Baza danych

Główny schemat znajduje się w `database/schema.sql`.

Najważniejsze tabele:

- `kiosks` - dane kiosków i statusy,
- `settings` - konfiguracja systemu,
- `users` - konta i role,
- `reservations` - rezerwacje.

Migracje i skrypty pomocnicze:

- `database/migration_add_user_roles.sql`,
- `database/migration_libreelec.sql`,
- `database/migration_ssh_username.sql`,
- skrypty backendowe, np. `run_migration.py`, `migrate_passwords.py`.

## 7. Wymagania środowiskowe

- Python 3.11+
- Node.js 18+
- npm
- (opcjonalnie) Docker + Docker Compose

## 8. Konfiguracja i zmienne środowiskowe

### 8.1 Frontend

- `VITE_API_BASE_URL` - bazowy URL API (fallback: same-origin)
- `VITE_BACKEND_URL` - target proxy Vite (używany w `vite.config.js`)

### 8.2 Backend

- `KIOSK_DATABASE_PATH` - ścieżka do pliku bazy SQLite
- `DATABASE_PATH` - alternatywna nazwa zmiennej dla ścieżki DB
- `JWT_SECRET_KEY` - sekret podpisywania JWT (wymagany na produkcji)
- `KIOSK_ENCRYPTION_KEY` - klucz używany przez mechanizm `enc:` dla haseł FTP/SSH
- `CORS_ALLOWED_ORIGINS` - lista dozwolonych originów dla API, rozdzielona przecinkami
- `LOGIN_ATTEMPT_LIMIT` - limit błędnych prób logowania w oknie czasowym (domyślnie 5)
- `LOGIN_ATTEMPT_WINDOW_SECONDS` - okno czasowe dla limitu logowania (domyślnie 300)
- `LOGIN_LOCKOUT_SECONDS` - czas blokady po przekroczeniu limitu (domyślnie 300)
- `FLASK_DEBUG` - uruchomienie Flask w trybie debug (domyślnie wyłączone)
- `PORT` - port backendu (domyślnie 5000)
- `DJANGO_SETTINGS_MODULE`, `DJANGO_SECRET_KEY`, `DJANGO_DEBUG` - dla warstwy Django

## 9. Uruchomienie lokalne (zalecane)

### 9.1 Backend (Flask)

```powershell
cd backend
pip install -r requirements.txt
python app.py
```

Domyślny adres: `http://127.0.0.1:5000`

### 9.2 Frontend (React)

```powershell
cd my-app
npm install
npm run dev
```

Domyślny adres: `http://localhost:5173`

Jeśli port jest zajęty, Vite uruchomi kolejny wolny port.

## 10. Uruchomienie przez Docker

```powershell
docker compose up --build
```

Po starcie:

- frontend: `http://localhost:5173`
- backend: `http://localhost:5000`

Zatrzymanie:

```powershell
docker compose down
```

## 11. Build, testy i jakość

### 11.1 Frontend

```powershell
cd my-app
npm run build
npm run test:run
npm run lint
```

### 11.2 Backend

W repo nie ma obecnie jednolitego zestawu testów automatycznych uruchamianych jednym poleceniem dla całego backendu.
Zalecane jest dodanie standardowego pipeline testowego (np. pytest + smoke tests endpointów).

## 12. Operacyjne endpointy API (skrót)

- `/api/auth/login`
- `/api/settings`
- `/api/kiosks`
- `/api/device/<serial>/ip`
- `/api/ftp/connect`
- `/api/ftp/files`
- `/api/ftp/upload`
- `/api/ftp/delete`
- `/api/ftp/delete-multiple`
- `/api/ftp/mkdir`
- `/api/ftp/download`
- `/api/ftp/get-file-content`
- `/api/ftp/put-file-content`
- `/api/reservations/check`
- `/api/reservations/create`
- `/api/reservations`
- `/api/users`
- `/api/account/change-password`

Pełna lista endpointów znajduje się w `backend/app.py`.

## 13. Struktura katalogów

```text
Strona Kiosku - Framework Project/
├── backend/
│   ├── app.py
│   ├── db_config.py
│   ├── sftp_handler.py
│   ├── requirements.txt
│   ├── kiosk_platform/
│   └── apps/
├── database/
│   ├── kiosks.db
│   ├── schema.sql
│   └── migration_*.sql
├── my-app/
│   ├── src/
│   ├── package.json
│   └── vite.config.js
└── docker-compose.yml
```

## 14. Bezpieczeństwo i dobre praktyki

- Przenieś sekrety (`JWT_SECRET_KEY`, klucze) do zmiennych środowiskowych.
- Włącz HTTPS i reverse proxy na środowisku produkcyjnym.
- Dodaj rotację i audyt tokenów.
- Ogranicz CORS do zaufanych hostów.
- Rozważ migrację z SQLite do silnika serwerowego (PostgreSQL) przy większym obciążeniu.

## 15. Plan dalszego rozwoju

1. Ujednolicić docelowy runtime backendu (Flask-only lub Django-native API).
2. Dodać pełny pipeline CI/CD z testami backend + frontend.
3. Dodać observability: structured logging, metrics i health checks.
4. Wydzielić konfigurację środowisk (`dev`, `staging`, `prod`) i sekrety.

---

Dokument opisuje aktualny stan całego projektu i jest przygotowany pod standard pracy zespołowej w środowisku profesjonalnym.