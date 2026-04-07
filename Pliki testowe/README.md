# Kiosk-reklamowy-Raspi5

System do zdalnego zarządzania kioskami (np. Raspberry Pi) z panelem WWW, backendem API (Flask) i skryptami do wdrożenia na urządzeniach.

- Frontend: statyczne HTML/CSS/JS w `frontend/`
- Backend API: Flask + SQLite w `backend/`
- Baza danych: `database/` (SQLite + `schema.sql`)
- Skrypty na kiosk: `Do Kiosku/` (systemd, vsftpd, noVNC)

## Szybki start (Windows, PowerShell)

1) Zainstaluj Python 3.10+ i pip, a następnie zależności backendu:

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r backend/requirements.txt
```

2) Uruchom backend API (port domyślnie 5000):

```powershell
python backend/app.py
```

3) Otwórz panel WWW: plik `frontend/index.html` (np. przez hosting lokalny) i ustaw adres API w `frontend/js/api.js` oraz `frontend/js/login.js` na IP serwera backendu (domyślnie w kodzie jest wpisany adres sieci lokalnej).

4) Zaloguj się do panelu: domyślny użytkownik to `admin`, hasło `admin` (tworzony automatycznie przy pierwszym uruchomieniu backendu).

Więcej szczegółów, endpoints API, instalacja na Raspberry Pi, FTP/VNC oraz bezpieczeństwo znajdziesz w `docs/Dokumentacja Kiosk.md`.

## Struktura repozytorium

- `backend/` — Flask API, inicjalizacja bazy, operacje FTP, SSH, JWT
- `frontend/` — panel WWW, logowanie JWT, zarządzanie kioskami, FTP, edytor plików, playlista
- `database/` — SQLite DB (`kiosks.db`) i schema (`schema.sql`)
- `Do Kiosku/` — skrypty i jednostki systemd dla urządzenia (raport IP, vsftpd, noVNC)
- `app.py` — prosty serwer do wyświetlania PDF (niezależny od panelu zarządzania)

## Wymagania

- Python 3.10+
- System Windows/Linux dla serwera API
- Sieć lokalna łącząca serwer i kioski

## Licencja

Brak pliku licencji w repozytorium. Dodaj własną licencję, jeśli publikujesz projekt.
