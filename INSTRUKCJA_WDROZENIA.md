# 🎯 Instrukcja wdrożenia - Wsparcie LibreELEC

## Podsumowanie

System zarządzania kioskami został zaktualizowany o pełne wsparcie dla **LibreELEC 12.0.2** na **Raspberry Pi 5** (RPi5.aarch64).

Główne zmiany:
- ✅ **SFTP zamiast FTP** dla LibreELEC (port 22)
- ✅ **Automatyczne wykrywanie protokołu** na podstawie portu
- ✅ **Pełna kompatybilność wsteczna** z Debian/FTP
- ✅ **Dedykowany instalator** dla LibreELEC
- ✅ **Szczegółowa dokumentacja**

---

## 📦 1. Aktualizacja zależności backendu

### Krok 1: Zainstaluj paramiko

```powershell
# W katalogu projektu (Windows PowerShell)
.\.venv\Scripts\Activate.ps1
pip install paramiko
```

### Krok 2: Zweryfikuj instalację

```powershell
pip list | Select-String paramiko
# Powinno wyświetlić: paramiko  x.x.x
```

---

## 🔧 2. Weryfikacja zmian w backendzie

### Sprawdź czy nowe pliki zostały utworzone:

```powershell
# Sprawdź czy istnieje sftp_handler.py
Test-Path backend\sftp_handler.py
# Powinno zwrócić: True

# Sprawdź czy app.py zawiera import
Select-String -Path backend\app.py -Pattern "from sftp_handler"
# Powinno znaleźć linię z importem
```

### Test uruchomienia backendu:

```powershell
python backend\app.py
```

Sprawdź w konsoli czy nie ma błędów związanych z:
- `from sftp_handler import SFTPHandler, sftp_connect`
- `ImportError: No module named 'paramiko'`

Jeśli backend się uruchamia bez błędów - sukces! ✅

---

## 📱 3. Przygotowanie Raspberry Pi 5 z LibreELEC

### Krok 1: Włącz SSH w Kodi

1. Na Raspberry Pi uruchom Kodi
2. Przejdź do: **Settings** (ikona koła zębatego)
3. Wybierz: **LibreELEC**
4. Przejdź do: **Services**
5. Wybierz: **SSH**
6. **Enable SSH**: Przełącz na **ON**
7. **Set SSH Password**: Ustaw silne hasło
8. Zapisz i wyjdź

### Krok 2: Sprawdź adres IP

W Kodi:
1. Settings > System Information > Network
2. Zapisz **IP address**

Lub przez SSH (jeśli już masz połączenie):
```bash
hostname -I
```

### Krok 3: Test połączenia SSH

Z komputera Windows:
```powershell
ssh root@<IP_RASPBERRY_PI>
# Wpisz hasło ustawione w kroku 1
```

Jeśli połączenie działa - kontynuuj! ✅

---

## 🚀 4. Instalacja na LibreELEC

### Metoda A: Automatyczna instalacja (ZALECANA)

```powershell
# 1. Skopiuj pliki na RPi
scp "Do Kiosku\instalator_libreelec.sh" root@<IP_RASPBERRY_PI>:/storage/
scp "Do Kiosku\ipdoapi.py" root@<IP_RASPBERRY_PI>:/storage/

# 2. Połącz się przez SSH
ssh root@<IP_RASPBERRY_PI>

# 3. Uruchom instalator (na RPi)
cd /storage
chmod +x instalator_libreelec.sh
./instalator_libreelec.sh
```

### W instalatorze:

1. Wybierz opcję **1** (Pełna instalacja)
2. Potwierdź wykryte środowisko LibreELEC
3. Podaj adres IP serwera API (np. `192.168.0.107`)
4. Poczekaj na zakończenie instalacji
5. Sprawdź podsumowanie

### Weryfikacja:

```bash
# Sprawdź status usługi raportowania IP
systemctl status ipdoapi.service

# Powinno wyświetlić: Active: active (running)

# Sprawdź czy katalog mediów istnieje
ls -la /storage/MediaPionowe

# Sprawdź logi
journalctl -u ipdoapi.service -n 20
```

---

### Metoda B: Manualna instalacja

```bash
# Połącz się przez SSH
ssh root@<IP_RASPBERRY_PI>

# 1. Utwórz strukturę katalogów
mkdir -p /storage/MediaPionowe/{videos,images,config}
chmod 755 /storage/MediaPionowe

# 2. Skopiuj skrypt raportowania IP
# (z komputera Windows)
scp "Do Kiosku\ipdoapi.py" root@<IP_RASPBERRY_PI>:/storage/.config/

# 3. Edytuj adres IP serwera API
ssh root@<IP_RASPBERRY_PI>
vi /storage/.config/ipdoapi.py
# Zmień: API_BASE_URL = "http://192.168.0.107:5000/api/"
# Zapisz: ESC :wq

# 4. Utwórz usługę systemd
mkdir -p /storage/.config/system.d
cat > /storage/.config/system.d/ipdoapi.service << 'EOF'
[Unit]
Description=IP Reporting Service for Kiosk Management
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /storage/.config/ipdoapi.py
Restart=always
RestartSec=30
User=root

[Install]
WantedBy=multi-user.target
EOF

# 5. Włącz i uruchom usługę
systemctl enable /storage/.config/system.d/ipdoapi.service
systemctl start ipdoapi.service

# 6. Sprawdź status
systemctl status ipdoapi.service
```

---

## 🌐 5. Konfiguracja w panelu WWW

### Krok 1: Uruchom backend

```powershell
# W katalogu projektu
python backend\app.py
```

### Krok 2: Otwórz panel w przeglądarce

```
http://localhost:5000
# Lub otwórz plik: frontend/index.html
```

### Krok 3: Zaloguj się

- **Username**: `admin`
- **Password**: `admin`

### Krok 4: Dodaj nowy kiosk LibreELEC

1. Kliknij **"Dodaj Kiosk"**
2. Wypełnij dane:
   - **Nazwa**: `Kiosk RPi5 LibreELEC` (lub dowolna)
   - **MAC Address**: (zostanie pobrany automatycznie przez ipdoapi.py)
   - **Serial Number**: (zostanie pobrany automatycznie)
   - **FTP Username**: `root`
   - **FTP Password**: (hasło SSH ustawione w Kodi)
   - **FTP Port**: `22` ⚠️ **BARDZO WAŻNE! Nie 21!**
3. Kliknij **"Zapisz"**

### Krok 5: Test połączenia

1. W liście kiosków znajdź dodany kiosk
2. Kliknij przycisk **"Test połączenia"** lub **"Połącz FTP"**
3. Powinno wyświetlić: **"Połączenie SFTP udane"** ✅

### Krok 6: Test zarządzania plikami

1. Kliknij **"Pliki"** przy kiosku
2. Powinieneś zobaczyć strukturę katalogów `/storage/MediaPionowe`
3. Spróbuj:
   - Utworzyć folder
   - Przesłać plik (obraz lub wideo)
   - Pobrać plik
   - Usunąć plik

---

## ✅ 6. Weryfikacja działania

### Test 1: Raportowanie IP

```bash
# Na RPi przez SSH
journalctl -u ipdoapi.service -f

# Powinno pokazywać cykliczne raportowanie IP co 30 sekund
```

### Test 2: Status kiosku w panelu

1. W panelu WWW odśwież listę kiosków
2. Kiosk powinien mieć status **"online"** (zielony)
3. IP powinno być aktualne
4. Last Connection powinno być < 1 minuta

### Test 3: Upload pliku przez SFTP

1. W panelu przejdź do plików kiosku
2. Kliknij **"Upload"**
3. Wybierz plik testowy (np. obraz JPG)
4. Upload powinien się powieść
5. Zweryfikuj przez SSH:
   ```bash
   ssh root@<IP_RASPBERRY_PI>
   ls -lh /storage/MediaPionowe/
   # Powinien być widoczny przesłany plik
   ```

### Test 4: Edycja pliku tekstowego

1. Utwórz plik `test.txt` w katalogu mediów
2. W panelu kliknij "Edytuj"
3. Zmień zawartość
4. Zapisz
5. Zweryfikuj przez SSH czy zmiany zostały zapisane

---

## 📊 7. Mieszane środowisko (Debian + LibreELEC)

System wspiera **jednocześnie** różne typy kiosków!

### Przykładowa konfiguracja:

| Kiosk | System | Protokół | Port | Użytkownik | Katalog |
|-------|--------|----------|------|------------|---------|
| Kiosk #1 | Debian | FTP | 21 | kiosk | /home/kiosk/MediaPionowe |
| Kiosk #2 | LibreELEC | SFTP | 22 | root | /storage/MediaPionowe |
| Kiosk #3 | Debian | FTP | 21 | kiosk | /home/kiosk/MediaPionowe |
| Kiosk #4 | LibreELEC | SFTP | 22 | root | /storage/MediaPionowe |

Wszystkie działają równolegle bez problemów! ✅

---

## 🐛 8. Rozwiązywanie problemów

### Problem 1: Backend nie uruchamia się - błąd importu

```
ImportError: No module named 'paramiko'
```

**Rozwiązanie:**
```powershell
.\.venv\Scripts\Activate.ps1
pip install paramiko
```

---

### Problem 2: "Nie można połączyć się z serwerem SFTP"

**Możliwe przyczyny:**

A) SSH nie jest włączony na LibreELEC
```bash
# Sprawdź SSH
ssh root@<IP_RASPBERRY_PI>
# Jeśli nie działa, włącz SSH w Kodi
```

B) Nieprawidłowe hasło
```bash
# Zresetuj hasło w Kodi:
# Settings > LibreELEC > Services > SSH > Set SSH Password
```

C) Nieprawidłowy port w panelu
```
# Sprawdź czy port to 22, nie 21!
```

D) Firewall blokuje połączenie
```bash
# Na RPi sprawdź czy port 22 jest otwarty
netstat -tuln | grep 22
```

---

### Problem 3: "Permission denied" podczas uploadu

**Rozwiązanie:**
```bash
ssh root@<IP_RASPBERRY_PI>
chmod 755 /storage/MediaPionowe
chmod -R 644 /storage/MediaPionowe/*
```

---

### Problem 4: Usługa ipdoapi nie raportuje IP

**Diagnostyka:**
```bash
# Sprawdź status
systemctl status ipdoapi.service

# Zobacz logi
journalctl -u ipdoapi.service -n 50

# Sprawdź czy skrypt się uruchamia ręcznie
python3 /storage/.config/ipdoapi.py
```

**Możliwe problemy:**

A) Nieprawidłowy adres API w ipdoapi.py
```bash
vi /storage/.config/ipdoapi.py
# Sprawdź linię: API_BASE_URL = "http://..."
```

B) Brak połączenia sieciowego
```bash
ping <IP_SERWERA_API>
```

C) Backend nie działa
```powershell
# Na serwerze sprawdź czy backend działa
python backend\app.py
```

---

### Problem 5: Kiosk pokazuje status "offline"

**Przyczyny:**
- Usługa ipdoapi nie działa (zobacz Problem 4)
- Brak połączenia sieciowego
- Backend nie odświeża statusów

**Rozwiązanie:**
```bash
# Restart usługi na RPi
systemctl restart ipdoapi.service

# Sprawdź logi
journalctl -u ipdoapi.service -f

# W panelu WWW odśwież stronę
```

---

## 📚 9. Dodatkowe zasoby

### Dokumentacja

1. **[CHANGELOG_LIBREELEC.md](CHANGELOG_LIBREELEC.md)**
   - Szczegółowy opis wszystkich zmian
   - Lista nowych plików i modyfikacji

2. **[docs/LibreELEC_Konfiguracja.md](docs/LibreELEC_Konfiguracja.md)**
   - Pełna dokumentacja LibreELEC
   - Porównanie z Debian
   - Rozwiązywanie problemów

3. **[docs/LIBREELEC_QUICKSTART.md](docs/LIBREELEC_QUICKSTART.md)**
   - Szybki start
   - Typowe scenariusze
   - Przykłady konfiguracji

### Pliki konfiguracyjne

- `backend/sftp_handler.py` - Obsługa SFTP
- `Do Kiosku/instalator_libreelec.sh` - Instalator dla LibreELEC
- `database/migration_libreelec.sql` - Migracja bazy danych

---

## ✨ 10. Podsumowanie

### Co zostało dodane:

✅ Pełne wsparcie dla SFTP (LibreELEC)
✅ Automatyczne wykrywanie protokołu (port 21=FTP, 22=SFTP)
✅ Dedykowany instalator dla LibreELEC
✅ Szczegółowa dokumentacja
✅ Kompatybilność wsteczna z Debian/FTP

### Co działa:

✅ Listowanie plików i katalogów
✅ Upload plików
✅ Download plików
✅ Usuwanie plików i katalogów
✅ Tworzenie katalogów
✅ Edycja plików tekstowych
✅ Raportowanie IP
✅ Zarządzanie playlistą
✅ Restart usługi przez SSH
✅ Mieszane środowisko (FTP + SFTP)

### Gotowe do produkcji!

System jest w pełni funkcjonalny i gotowy do wdrożenia na Raspberry Pi 5 z LibreELEC 12.0.2! 🚀

---

## 📞 Wsparcie

W przypadku problemów:

1. Sprawdź sekcję **"Rozwiązywanie problemów"** powyżej
2. Zobacz szczegółową dokumentację w `docs/`
3. Sprawdź logi:
   - Backend: konsola Python
   - LibreELEC: `journalctl -u ipdoapi.service`
   - SSH: `journalctl -u sshd`

---

**Data aktualizacji:** 17 października 2025  
**Wersja:** 2.0 - Wsparcie LibreELEC
