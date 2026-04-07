# Kiosk-reklamowy-Raspi5

System do zdalnego zarządzania kioskami (np. Raspberry Pi) z panelem WWW, backendem API (Flask), bazą SQLite i skryptami wdrożeniowymi na urządzeniach.

## Co zawiera repozytorium

- Frontend: statyczne HTML/CSS/JS w `frontend/`
- Backend API: Flask + SQLite w `backend/`
- Baza danych: `database/` (`schema.sql` i pliki migracji)
- Skrypty na kiosk: `Do Kiosku/` (systemd, vsftpd, noVNC)
- Uruchomienie w kontenerach: `Dockerfile`, `docker-compose.yml`
- Pliki testowe i robocze: `Pliki testowe/` (wykluczone z Dockera przez `.dockerignore`)

## Szybki start w Dockerze

1) Zbuduj i uruchom środowisko:

```powershell
docker compose up --build
```

2) Backend API będzie dostępny na porcie `5000`.

3) Panel WWW jest serwowany przez backend z katalogu `frontend/`.

4) Domyślne konto do logowania to `admin` / `admin`.

## Uruchomienie lokalne (Windows, PowerShell)

1) Zainstaluj Python 3.10+ i pip, a następnie zależności backendu:

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r backend/requirements.txt
```

2) Uruchom backend API:

```powershell
python backend/app.py
```

3) Wejdź na panel WWW przez backend: `http://127.0.0.1:5000/` albo `http://127.0.0.1:5000/login`.

## Konfiguracja i działanie

- Backend używa SQLite w `database/kiosks.db` i inicjalizuje schemat przy starcie.
- API obsługuje logowanie JWT, zarządzanie kioskami, FTP/SFTP, pliki, rezerwacje i użytkowników.
- Katalog `backend/ssh_keys/` zawiera klucze SSH używane przez operacje administracyjne.

## Struktura repozytorium

- `backend/` — Flask API, inicjalizacja bazy, operacje FTP/SFTP, SSH, JWT
- `frontend/` — panel WWW, logowanie JWT, zarządzanie kioskami, FTP, edytor plików, playlista
- `database/` — SQLite DB (`kiosks.db`) i schema (`schema.sql`)
- `Do Kiosku/` — skrypty i jednostki systemd dla urządzenia (raport IP, vsftpd, noVNC)
- `kodi_ticker_addon/` — dodatek Kodi dla paska tekstowego
- `Dockerfile` i `docker-compose.yml` — uruchomienie backendu w kontenerze

## Wymagania

- Python 3.10+
- System Windows/Linux dla serwera API lub Docker Engine/Compose
- Sieć lokalna łącząca serwer i kioski

## Dokumentacja

- `docs/Dokumentacja Kiosk.md`
- `docs/LibreELEC_Konfiguracja.md`
- `docs/LIBREELEC_QUICKSTART.md`

## Licencja

Brak pliku licencji w repozytorium. Dodaj własną licencję, jeśli publikujesz projekt.
