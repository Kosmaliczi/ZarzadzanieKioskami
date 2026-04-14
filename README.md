# Strona Kiosku - Framework Project

Ten projekt składa się z:
- backendu Flask (API + SQLite)
- nowego frontendu React/Vite (`my-app`)
- starszego frontendu statycznego (`frontend`)
- bazy danych SQLite (`database/kiosks.db`)

## 1. Wymagania

- Python 3.11+ (u Ciebie działa 3.14)
- Node.js 18+
- npm

## 2. Struktura projektu

- `backend/` - serwer API Flask
- `database/` - plik bazy i SQL migracji
- `my-app/` - aktualny frontend React/Vite
- `frontend/` - starsza wersja statyczna (legacy)

## 3. Uruchomienie backendu

Przejdź do backendu:

```powershell
cd backend
```

Zainstaluj zależności (pierwszy raz):

```powershell
pip install -r requirements.txt
```

Uruchom serwer:

```powershell
python app.py
```

Backend domyślnie działa pod adresem:
- `http://127.0.0.1:5000`

### Backend Django (nowa struktura enterprise)

Backend został przebudowany do architektury Django z podziałem na moduły:
- `backend/kiosk_platform/` - konfiguracja projektu Django
- `backend/apps/health/` - endpointy zdrowia usługi
- `backend/apps/api_gateway/` - brama API i routing legacy

Uruchomienie Django backend:

```powershell
cd backend
python manage.py runserver 0.0.0.0:5000
```

Uwaga: aktualna funkcjonalność endpointów jest zachowana przez warstwę gateway, która deleguje żądania do istniejącej logiki Flask. Dzięki temu zachowujesz kompatybilność i jednocześnie masz strukturę zgodną ze standardami enterprise Django.

## 4. Uruchomienie frontendu (my-app)

W nowym terminalu:

```powershell
cd my-app
npm install
npm run dev
```

Vite zwykle startuje na:
- `http://localhost:5173`

Jeśli port 5173 jest zajęty, uruchomi się np. na 5174. Użyj adresu, który pokaże terminal.

## 5. Build produkcyjny frontendu

```powershell
cd my-app
npm run build
```

Pliki produkcyjne trafią do:
- `my-app/dist/`

## 6. Testy

```powershell
cd my-app
npm run test:run
```

Tryb watch:

```powershell
npm run test
```

## 7. Jak działa połączenie z bazą

- Backend łączy się z SQLite przez `backend/db_config.py`.
- Domyślna baza to `database/kiosks.db`.
- Frontend (`my-app`) pobiera dane przez endpointy `/api/*`.

## 8. Najczęstsze problemy

### Frontend nie widzi API

Upewnij się, że backend działa na porcie 5000.

### Port 5173 zajęty

To normalne. Otwórz port podany przez Vite (np. 5174).

### Ostrzeżenia Paramiko TripleDES

To ostrzeżenia deprecacji biblioteki kryptograficznej. Nie blokują działania API.

### `database is locked`

Projekt ma obsługę locków SQLite, więc API powinno dalej zwracać odpowiedzi. Jeśli problem trwa długo, zamknij zbędne procesy trzymające bazę.

## 9. Szybki start (skrót)

Terminal 1:

```powershell
cd backend
python app.py
```

Terminal 2:

```powershell
cd my-app
npm run dev
```

Potem wejdź na adres Vite z terminala (`http://localhost:5173` albo `http://localhost:5174`).

## 10. Uruchomienie przez Docker

W repo zostały dodane pliki:
- `docker-compose.yml`
- `backend/Dockerfile`
- `my-app/Dockerfile`

### Start całego projektu

Z katalogu głównego projektu:

```powershell
docker compose up --build
```

Po uruchomieniu:
- frontend: `http://localhost:5173`
- backend API: `http://localhost:5000`

### Zatrzymanie kontenerów

```powershell
docker compose down
```

### Ważne informacje

- Baza SQLite jest mapowana jako wolumen `./database:/database`.
- Backend używa zmiennej środowiskowej:
	- `KIOSK_DATABASE_PATH=/database/kiosks.db`
- Frontend używa proxy do backendu ustawionego przez:
	- `VITE_BACKEND_URL=http://backend:5000`
