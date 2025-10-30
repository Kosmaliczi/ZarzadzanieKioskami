# Konfiguracja LibreELEC 12.0.2 dla Raspberry Pi 5

## Przegląd

LibreELEC 12.0.2 to minimalistyczny system Linux przeznaczony dla Kodi. W przeciwieństwie do pełnego systemu Debian/Raspbian:
- **System główny jest tylko do odczytu** (read-only)
- **Brak menedżera pakietów apt-get** - nie można zainstalować vsftpd
- **Partycja /storage jest do zapisu** - wszystkie dane użytkownika
- **SSH jest wbudowany** - domyślnie dostępny w ustawieniach
- **SFTP działa automatycznie** z SSH - nie potrzeba dodatkowej konfiguracji

## Wymagania systemowe

- **System**: LibreELEC 12.0.2
- **Platforma**: Raspberry Pi 5 (RPi5.aarch64)
- **Kodi**: Wersja zainstalowana z LibreELEC
- **Sieć**: Połączenie Ethernet lub WiFi z dostępem do serwera zarządzania

## Kluczowe różnice: Debian vs LibreELEC

| Cecha | Debian/Raspbian | LibreELEC |
|-------|-----------------|-----------|
| **Katalog mediów** | `/home/kiosk/MediaPionowe` | `/storage/MediaPionowe` |
| **Protokół plików** | FTP (vsftpd) | SFTP (wbudowany) |
| **Port** | 21 | 22 |
| **Użytkownik** | kiosk | root |
| **Hasło** | Konfigurowane przez użytkownika | Ustawiane w Kodi |
| **Instalacja usług** | apt-get, systemd | Skrypty w /storage/.config |

## Instalacja krok po kroku

### 1. Włączenie SSH w LibreELEC

1. Uruchom Kodi
2. Przejdź do **Settings** (Ustawienia)
3. Wybierz **LibreELEC**
4. Przejdź do **Services** (Usługi)
5. Wybierz **SSH**
6. **Włącz SSH** (Enable SSH)
7. **Ustaw hasło** dla użytkownika root
8. Zapisz ustawienia

**Domyślne dane dostępowe SSH:**
- Użytkownik: `root`
- Hasło: (ustawione przez Ciebie w Kodi)
- Port: `22`

### 2. Przygotowanie struktury katalogów

Połącz się z LibreELEC przez SSH i wykonaj:

```bash
# Połączenie SSH (z Twojego komputera)
ssh root@<IP_RASPBERRY_PI>

# Utworzenie katalogu dla mediów
mkdir -p /storage/MediaPionowe
mkdir -p /storage/MediaPionowe/videos
mkdir -p /storage/MediaPionowe/images
mkdir -p /storage/MediaPionowe/config

# Ustawienie uprawnień
chmod 755 /storage/MediaPionowe
```

### 3. Instalacja skryptu raportowania IP

1. Skopiuj pliki z katalogu `Do Kiosku/` na swój komputer
2. Użyj `instalator_libreelec.sh` do automatycznej konfiguracji:

```bash
# Skopiuj skrypt instalacyjny na RPi
scp instalator_libreelec.sh root@<IP_RASPBERRY_PI>:/storage/

# Połącz się przez SSH
ssh root@<IP_RASPBERRY_PI>

# Uruchom instalator
cd /storage
chmod +x instalator_libreelec.sh
./instalator_libreelec.sh
```

3. Postępuj zgodnie z instrukcjami na ekranie
4. Podaj adres IP serwera API gdy zostaniesz poproszony

### 4. Manualna instalacja skryptu (alternatywa)

Jeśli wolisz ręczną konfigurację:

```bash
# Skopiuj plik ipdoapi.py
scp ipdoapi.py root@<IP_RASPBERRY_PI>:/storage/.config/

# Edytuj plik i ustaw adres API
ssh root@<IP_RASPBERRY_PI>
vi /storage/.config/ipdoapi.py
# Zmień linię: API_BASE_URL = "http://192.168.0.107:5000/api/"
# na Twój adres serwera

# Utwórz usługę systemd
mkdir -p /storage/.config/system.d
cat > /storage/.config/system.d/ipdoapi.service << EOF
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

# Włącz i uruchom usługę
systemctl enable /storage/.config/system.d/ipdoapi.service
systemctl start ipdoapi.service

# Sprawdź status
systemctl status ipdoapi.service
```

## Konfiguracja serwera zarządzania (Backend)

### 1. Aktualizacja wymagań

Backend wymaga dodatkowych zależności dla SFTP:

```bash
# W katalogu projektu
pip install paramiko
```

### 2. Struktura plików

Dodane pliki:
- `backend/sftp_handler.py` - Obsługa połączeń SFTP
- `Do Kiosku/instalator_libreelec.sh` - Instalator dla LibreELEC

### 3. Konfiguracja kiosku w panelu WWW

Podczas dodawania kiosku LibreELEC:

**Dane FTP (faktycznie SFTP):**
- **Nazwa użytkownika**: `root`
- **Hasło**: (hasło SSH ustawione w Kodi)
- **Port**: `22` (nie 21!)
- **Katalog domyślny**: `/storage/MediaPionowe`

**Uwaga**: Pomimo nazwy "FTP" w interfejsie, przy porcie 22 backend automatycznie używa SFTP.

### 4. Automatyczne wykrywanie protokołu

Backend automatycznie wykrywa protokół na podstawie portu:
- **Port 21** → FTP (vsftpd dla Debian)
- **Port 22** → SFTP (SSH dla LibreELEC)

## Testowanie połączenia

### Test SFTP z linii poleceń

```bash
# Test połączenia SFTP
sftp root@<IP_RASPBERRY_PI>

# Po zalogowaniu:
sftp> cd /storage/MediaPionowe
sftp> ls
sftp> quit
```

### Test przez panel WWW

1. Zaloguj się do panelu zarządzania
2. Dodaj nowy kiosk lub edytuj istniejący
3. Ustaw dane:
   - IP: (adres LibreELEC)
   - Port: `22`
   - Użytkownik: `root`
   - Hasło: (hasło SSH)
4. Kliknij "Test połączenia"
5. Jeśli sukces, przejdź do zakładki plików
6. Powinieneś zobaczyć zawartość `/storage/MediaPionowe`

## Zarządzanie plikami przez SFTP

Backend automatycznie obsługuje:
- ✅ **Listowanie plików i katalogów**
- ✅ **Upload plików** (obrazy, wideo, konfiguracja)
- ✅ **Download plików**
- ✅ **Usuwanie plików i katalogów**
- ✅ **Tworzenie katalogów**
- ✅ **Edycja plików tekstowych** (np. schedule.json)

Wszystko działa transparentnie - interfejs nie wymaga zmian.

## Struktura katalogów LibreELEC

```
/storage/                          # Główny katalog użytkownika (do zapisu)
├── .config/                       # Konfiguracje
│   ├── ipdoapi.py                # Skrypt raportowania IP
│   └── system.d/                 # Usługi systemd użytkownika
│       └── ipdoapi.service       # Usługa raportowania IP
├── .kodi/                         # Dane Kodi
├── .ssh/                          # Klucze SSH
│   └── authorized_keys           # Autoryzowane klucze publiczne
├── MediaPionowe/                  # Katalog mediów (utworzony przez nas)
│   ├── videos/                   # Filmy
│   ├── images/                   # Obrazy
│   └── config/                   # Konfiguracje (np. playlista)
└── ... (inne dane użytkownika)
```

## Rozwiązywanie problemów

### Problem: Nie można połączyć się przez SSH

**Rozwiązanie:**
1. Sprawdź czy SSH jest włączony w Kodi (Settings > LibreELEC > Services > SSH)
2. Upewnij się, że ustawiłeś hasło dla użytkownika root
3. Sprawdź połączenie sieciowe: `ping <IP_RASPBERRY_PI>`
4. Sprawdź firewall na routerze

### Problem: "Permission denied" podczas zapisu plików

**Rozwiązanie:**
```bash
# Połącz się przez SSH
ssh root@<IP_RASPBERRY_PI>

# Sprawdź uprawnienia
ls -la /storage/MediaPionowe

# Napraw uprawnienia
chmod 755 /storage/MediaPionowe
chmod -R 644 /storage/MediaPionowe/*
```

### Problem: Usługa ipdoapi nie działa

**Diagnostyka:**
```bash
# Sprawdź status usługi
systemctl status ipdoapi.service

# Zobacz logi
journalctl -u ipdoapi.service -f

# Restart usługi
systemctl restart ipdoapi.service

# Sprawdź czy skrypt się uruchamia ręcznie
python3 /storage/.config/ipdoapi.py
```

### Problem: Backend zwraca błąd połączenia SFTP

**Rozwiązanie:**
1. Sprawdź czy `paramiko` jest zainstalowany: `pip list | grep paramiko`
2. Jeśli nie, zainstaluj: `pip install paramiko`
3. Sprawdź logi backendu pod kątem szczegółów błędu
4. Upewnij się, że port jest ustawiony na 22, nie 21

### Problem: System tylko do odczytu

LibreELEC ma system główny tylko do odczytu. **To normalne zachowanie.**

**Co możesz modyfikować:**
- ✅ Wszystko w `/storage/`
- ✅ Konfiguracje Kodi
- ✅ Usługi w `/storage/.config/system.d/`

**Czego NIE możesz modyfikować:**
- ❌ System w `/usr/`, `/bin/`, `/etc/` (tylko do odczytu)
- ❌ Instalacja pakietów przez apt-get (brak menedżera)

## Bezpieczeństwo

### Rekomendacje

1. **Zmień hasło SSH** na silne i unikalne
2. **Używaj kluczy SSH** zamiast haseł (opcjonalnie):
   ```bash
   # Na swoim komputerze
   ssh-keygen -t rsa -b 4096
   ssh-copy-id root@<IP_RASPBERRY_PI>
   ```
3. **Ogranicz dostęp SSH** do sieci lokalnej (firewall)
4. **Regularnie aktualizuj** LibreELEC
5. **Monitoruj logi** połączeń SSH

### Użycie kluczy SSH w backendzie

Backend wspiera autoryzację kluczem SSH. Klucz znajduje się w:
```
backend/ssh_keys/kiosk_id_rsa
```

Aby użyć tego klucza z LibreELEC:
```bash
# Skopiuj klucz publiczny na RPi
ssh-copy-id -i backend/ssh_keys/kiosk_id_rsa.pub root@<IP_RASPBERRY_PI>
```

## Funkcje dodatkowe

### Automatyczny start przy uruchomieniu systemu

Usługa `ipdoapi.service` jest automatycznie uruchamiana przy starcie systemu.

### Restart Kodi zdalnie przez SSH

```bash
# Przez backend (endpoint SSH)
POST /api/kiosks/{id}/restart-service

# Ręcznie przez SSH
ssh root@<IP_RASPBERRY_PI> "systemctl restart kodi"
```

### Zmiana orientacji ekranu (jeśli dostępne)

W LibreELEC rotacja ekranu może wymagać modyfikacji konfiguracji Kodi lub edycji plików konfiguracyjnych systemu.

## Porównanie wydajności

| Aspekt | FTP (Debian) | SFTP (LibreELEC) |
|--------|--------------|------------------|
| **Bezpieczeństwo** | Nieszyfrowane | Szyfrowane (SSH) |
| **Szybkość** | Szybsze | Nieco wolniejsze (szyfrowanie) |
| **Łatwość instalacji** | Wymaga vsftpd | Wbudowane |
| **Zgodność** | Standardowe | Wymaga paramiko |

## Podsumowanie

LibreELEC 12.0.2 na Raspberry Pi 5 **nie obsługuje tradycyjnego FTP**, ale oferuje lepszą alternatywę:

✅ **SFTP przez SSH** - bezpieczniejsze, wbudowane, bez dodatkowej instalacji
✅ **Automatyczna obsługa** w backendzie - wykrywanie po porcie
✅ **Identyczna funkcjonalność** - wszystkie operacje na plikach działają tak samo
✅ **Lepsza integracja** - jeden port (22) dla SSH i transferu plików

**Następne kroki:**
1. Włącz SSH w Kodi i ustaw hasło
2. Uruchom `instalator_libreelec.sh` na RPi
3. Dodaj kiosk w panelu WWW z portem 22
4. Testuj połączenie i zarządzanie plikami

## Wsparcie

W przypadku problemów:
1. Sprawdź logi systemd: `journalctl -u ipdoapi.service`
2. Sprawdź logi SSH: `journalctl -u sshd`
3. Sprawdź logi backendu
4. Zobacz sekcję "Rozwiązywanie problemów" powyżej
