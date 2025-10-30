# Instrukcja szybkiego startu - LibreELEC 12.0.2 (Raspberry Pi 5)

## 🎯 Przegląd

Ten system zarządzania kioskami został zaktualizowany o pełne wsparcie dla **LibreELEC 12.0.2** na **Raspberry Pi 5** (RPi5.aarch64).

### Kluczowe różnice LibreELEC vs Debian

| Cecha | Debian/Raspbian | LibreELEC |
|-------|-----------------|-----------|
| Protokół | FTP (vsftpd) | **SFTP (SSH)** |
| Port | 21 | **22** |
| Użytkownik | kiosk | **root** |
| Katalog | /home/kiosk/MediaPionowe | **/storage/MediaPionowe** |

## 🚀 Szybki start dla LibreELEC

### 1. Przygotowanie Raspberry Pi 5 z LibreELEC

```bash
# 1. Włącz SSH w Kodi
# Kodi > Settings > LibreELEC > Services > SSH
# - Enable SSH: ON
# - Set password: <twoje_haslo>

# 2. Połącz się przez SSH
ssh root@<IP_RASPBERRY_PI>

# 3. Pobierz instalator
# (Skopiuj pliki z katalogu "Do Kiosku/" na RPi)
scp Do\ Kiosku/instalator_libreelec.sh root@<IP_RASPBERRY_PI>:/storage/
scp Do\ Kiosku/ipdoapi.py root@<IP_RASPBERRY_PI>:/storage/

# 4. Uruchom instalator
ssh root@<IP_RASPBERRY_PI>
cd /storage
chmod +x instalator_libreelec.sh
./instalator_libreelec.sh
```

### 2. Konfiguracja backendu (serwer zarządzania)

```powershell
# W katalogu projektu na Windows
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt

# WAŻNE: Zainstaluj dodatkową zależność dla SFTP
pip install paramiko

# Uruchom backend
python backend/app.py
```

### 3. Konfiguracja kiosku w panelu WWW

1. Otwórz `frontend/index.html` w przeglądarce
2. Zaloguj się (admin/admin)
3. Dodaj nowy kiosk:
   - **Nazwa**: np. "Kiosk RPi5 LibreELEC"
   - **MAC Address**: (pobierany automatycznie)
   - **Serial Number**: (pobierany automatycznie przez ipdoapi.py)
   - **FTP Username**: `root`
   - **FTP Password**: (hasło SSH z Kodi)
   - **FTP Port**: `22` ← **WAŻNE!**

4. Kliknij "Zapisz" i "Test połączenia"

## 📁 Struktura projektu

```
.
├── backend/
│   ├── app.py                          # Główny backend (wspiera FTP i SFTP)
│   ├── sftp_handler.py                 # NOWY: Obsługa SFTP dla LibreELEC
│   ├── requirements.txt                # Zależności (+ paramiko)
│   └── ssh_keys/
│       └── kiosk_id_rsa               # Klucz SSH (opcjonalnie)
├── Do Kiosku/
│   ├── instalator.sh                   # Dla Debian/Raspbian (vsftpd)
│   ├── instalator_libreelec.sh         # NOWY: Dla LibreELEC (SFTP)
│   └── ipdoapi.py                      # Skrypt raportowania IP
├── docs/
│   ├── Dokumentacja Kiosk.md           # Dokumentacja główna
│   └── LibreELEC_Konfiguracja.md       # NOWY: Szczegóły LibreELEC
└── database/
    ├── schema.sql
    └── migration_libreelec.sql         # NOWY: Migracja ustawień
```

## 🔧 Automatyczne wykrywanie protokołu

Backend **automatycznie** wybiera odpowiedni protokół:

- **Port 21** → FTP (dla Debian z vsftpd)
- **Port 22** → SFTP (dla LibreELEC przez SSH)

Nie musisz nic zmieniać w interfejsie - wszystko działa transparentnie!

## ✅ Wspierane operacje (FTP i SFTP)

Wszystkie operacje działają identycznie niezależnie od protokołu:

- ✅ Listowanie plików i katalogów
- ✅ Upload plików (obrazy, wideo, konfiguracje)
- ✅ Download plików
- ✅ Usuwanie plików i katalogów
- ✅ Tworzenie katalogów
- ✅ Edycja plików tekstowych (np. schedule.json)
- ✅ Zarządzanie playlistą

## 🔒 Bezpieczeństwo

### LibreELEC (SFTP - Port 22)
- ✅ **Szyfrowane połączenie** (SSH)
- ✅ **Autoryzacja hasłem** lub kluczem SSH
- ✅ **Bezpieczniejsze** niż FTP

### Debian (FTP - Port 21)
- ⚠️ **Nieszyfrowane połączenie**
- ℹ️ Używaj tylko w zaufanej sieci lokalnej

## 📝 Typowe scenariusze

### Scenariusz 1: Nowy kiosk z LibreELEC

```bash
# Na Raspberry Pi:
1. Zainstaluj LibreELEC 12.0.2
2. Włącz SSH w Kodi i ustaw hasło
3. Uruchom instalator_libreelec.sh
4. Sprawdź status: systemctl status ipdoapi.service

# W panelu WWW:
1. Dodaj kiosk z portem 22
2. Użytkownik: root
3. Testuj połączenie
```

### Scenariusz 2: Migracja z Debian na LibreELEC

```bash
# Kopia zapasowa mediów z Debian:
scp -r kiosk@<OLD_IP>:/home/kiosk/MediaPionowe/* ./backup/

# Upload na LibreELEC:
scp -r ./backup/* root@<NEW_IP>:/storage/MediaPionowe/

# W panelu WWW:
1. Edytuj kiosk
2. Zmień port z 21 na 22
3. Zmień użytkownika z kiosk na root
4. Zaktualizuj hasło
5. Test połączenia
```

### Scenariusz 3: Mieszane środowisko (Debian + LibreELEC)

System wspiera **jednocześnie** kioski Debian (FTP) i LibreELEC (SFTP)!

```
Kiosk 1: Debian, Port 21, kiosk, /home/kiosk/MediaPionowe
Kiosk 2: LibreELEC, Port 22, root, /storage/MediaPionowe
Kiosk 3: Debian, Port 21, kiosk, /home/kiosk/MediaPionowe
```

Wszystkie działają równolegle bez problemów.

## 🐛 Rozwiązywanie problemów

### Problem: "Nie można połączyć się" (Port 22)

```bash
# Sprawdź czy SSH działa
ssh root@<IP_RASPBERRY_PI>

# Jeśli działa, sprawdź backend:
pip list | grep paramiko
# Jeśli brak: pip install paramiko
```

### Problem: "Permission denied" (SFTP)

```bash
# Sprawdź uprawnienia na RPi
ssh root@<IP_RASPBERRY_PI>
ls -la /storage/MediaPionowe
chmod 755 /storage/MediaPionowe
```

### Problem: Usługa ipdoapi nie raportuje IP

```bash
# Sprawdź logi
ssh root@<IP_RASPBERRY_PI>
journalctl -u ipdoapi.service -f

# Restart usługi
systemctl restart ipdoapi.service
```

## 📚 Dodatkowa dokumentacja

- **[Dokumentacja Kiosk.md](docs/Dokumentacja%20Kiosk.md)** - Pełna dokumentacja systemu
- **[LibreELEC_Konfiguracja.md](docs/LibreELEC_Konfiguracja.md)** - Szczegółowy przewodnik LibreELEC
- **[README.md](README.md)** - Dokumentacja główna projektu

## 🎉 Podsumowanie

System został w pełni dostosowany do **LibreELEC 12.0.2 na Raspberry Pi 5**:

✅ Automatyczna obsługa SFTP (port 22) i FTP (port 21)
✅ Dedykowany instalator dla LibreELEC
✅ Wsparcie dla struktury katalogów /storage/
✅ Kompatybilność wsteczna z Debian/Raspbian
✅ Wszystkie funkcje działają identycznie na obu platformach

**Gotowe do użycia!** 🚀
