# 🎉 System dostosowany do LibreELEC 12.0.2 (Raspberry Pi 5)

## ✅ Podsumowanie wykonanych prac

System zarządzania kioskami został **w pełni dostosowany** do pracy z **LibreELEC 12.0.2** na **Raspberry Pi 5** (architektura RPi5.aarch64).

---

## 📦 Utworzone nowe pliki

### Backend (5 plików)

1. **`backend/sftp_handler.py`**
   - Klasa obsługi połączeń SFTP
   - Pełna kompatybilność z LibreELEC
   - Wszystkie operacje: listowanie, upload, download, usuwanie, tworzenie katalogów

2. **`Do Kiosku/instalator_libreelec.sh`**
   - Dedykowany instalator dla LibreELEC
   - Automatyczna konfiguracja SSH/SFTP
   - Instalacja usługi raportowania IP
   - Interaktywne menu

3. **`docs/LibreELEC_Konfiguracja.md`**
   - Szczegółowy przewodnik konfiguracji
   - Porównanie Debian vs LibreELEC
   - Rozwiązywanie problemów
   - Bezpieczeństwo

4. **`docs/LIBREELEC_QUICKSTART.md`**
   - Szybki start dla LibreELEC
   - Typowe scenariusze
   - Przykłady konfiguracji

5. **`database/migration_libreelec.sql`**
   - Skrypt migracji bazy danych
   - Domyślne ustawienia dla LibreELEC i Debian

### Dokumentacja (2 pliki)

6. **`CHANGELOG_LIBREELEC.md`**
   - Szczegółowy opis wszystkich zmian
   - Lista modyfikacji
   - Testy i weryfikacja

7. **`INSTRUKCJA_WDROZENIA.md`**
   - Kompleksowa instrukcja wdrożenia
   - Krok po kroku
   - Rozwiązywanie problemów

---

## 🔄 Zmodyfikowane pliki

### Backend - app.py

**Dodane:**
- Import `sftp_handler`
- Funkcja `get_protocol(port)` - automatyczne wykrywanie FTP/SFTP
- Funkcja `connect_file_transfer()` - uniwersalne łączenie
- Ścieżka do klucza SSH

**Zaktualizowane endpointy:**
- ✅ `/api/ftp/connect` - wsparcie SFTP
- ✅ `/api/ftp/files` - listowanie przez SFTP
- ✅ `/api/ftp/upload` - upload przez SFTP
- ✅ `/api/ftp/download` - download przez SFTP
- ✅ `/api/ftp/delete` - usuwanie przez SFTP
- ✅ `/api/ftp/mkdir` - tworzenie katalogów przez SFTP
- ✅ `/api/ftp/get-file-content` - odczyt plików przez SFTP
- ✅ `/api/ftp/put-file-content` - zapis plików przez SFTP

Wszystkie endpointy automatycznie wybierają FTP (port 21) lub SFTP (port 22).

---

## 🎯 Kluczowe funkcjonalności

### Automatyczne wykrywanie protokołu

```python
# Port 21 → FTP (vsftpd dla Debian)
# Port 22 → SFTP (SSH dla LibreELEC)

protocol = get_protocol(port)
conn = connect_file_transfer(hostname, username, password, port)
```

### Uniwersalny interfejs

Backend obsługuje **identycznie** FTP i SFTP - wszystkie operacje działają tak samo:
- Listowanie plików
- Upload/Download
- Usuwanie
- Tworzenie katalogów
- Edycja plików tekstowych

### Domyślne ścieżki

System automatycznie wybiera odpowiednią ścieżkę:
- **Port 22 (SFTP/LibreELEC)**: `/storage/MediaPionowe`
- **Port 21 (FTP/Debian)**: `/home/kiosk/MediaPionowe`

---

## 📊 Porównanie: Debian vs LibreELEC

| Cecha | Debian/Raspbian | LibreELEC 12.0.2 |
|-------|-----------------|------------------|
| **Protokół** | FTP (vsftpd) | SFTP (SSH) |
| **Port** | 21 | 22 |
| **Użytkownik** | kiosk | root |
| **Katalog mediów** | /home/kiosk/MediaPionowe | /storage/MediaPionowe |
| **Instalacja** | apt-get install vsftpd | SSH wbudowany |
| **Szyfrowanie** | ❌ Brak | ✅ SSH encryption |
| **System** | Do zapisu | Główny tylko do odczytu |
| **Bezpieczeństwo** | ⚠️ Średnie | ✅ Wysokie |

---

## 🚀 Jak używać?

### Dla LibreELEC (Raspberry Pi 5)

#### 1. Włącz SSH w Kodi
```
Settings > LibreELEC > Services > SSH
- Enable SSH: ON
- Set Password: <twoje_haslo>
```

#### 2. Uruchom instalator
```bash
scp instalator_libreelec.sh root@<IP_RPi>:/storage/
ssh root@<IP_RPi>
./instalator_libreelec.sh
```

#### 3. Dodaj kiosk w panelu WWW
```
Nazwa użytkownika: root
Hasło: <haslo_ssh>
Port: 22  ← WAŻNE!
```

#### 4. Gotowe! ✅
System automatycznie użyje SFTP i będzie działał identycznie jak FTP.

---

### Dla Debian (kompatybilność wsteczna)

Wszystkie istniejące kioski z FTP (port 21) nadal działają bez zmian! ✅

---

## 📚 Dokumentacja

### Szybki start
→ **`INSTRUKCJA_WDROZENIA.md`** - kompleksowa instrukcja krok po kroku

### Szczegóły techniczne
→ **`CHANGELOG_LIBREELEC.md`** - wszystkie zmiany i modyfikacje

### LibreELEC
→ **`docs/LibreELEC_Konfiguracja.md`** - pełna dokumentacja LibreELEC
→ **`docs/LIBREELEC_QUICKSTART.md`** - szybki start

### Oryginalna dokumentacja
→ **`docs/Dokumentacja Kiosk.md`** - dokumentacja główna systemu
→ **`README.md`** - przegląd projektu

---

## 🔧 Wymagane zależności

### Backend
```bash
pip install paramiko  # NOWE - obsługa SFTP
```

Wszystkie inne zależności bez zmian (Flask, Flask-CORS, etc.)

---

## ✨ Co działa?

### ✅ Pełne wsparcie SFTP
- Automatyczne wykrywanie na podstawie portu
- Wszystkie operacje na plikach
- Szyfrowane połączenia

### ✅ Kompatybilność wsteczna
- Istniejące kioski FTP działają bez zmian
- Brak wymaganych zmian w bazie danych
- Interfejs WWW bez modyfikacji

### ✅ Mieszane środowisko
- Jednocześnie FTP (Debian) i SFTP (LibreELEC)
- Automatyczne zarządzanie różnymi protokołami
- Transparentne dla użytkownika

### ✅ Bezpieczeństwo
- SFTP szyfrowane przez SSH
- Wsparcie dla kluczy SSH
- Bezpieczniejsze niż FTP

---

## 🎓 Najważniejsze zmiany

### 1. Backend automatycznie wybiera protokół

**Przed:**
```python
ftp = ftp_connect(hostname, username, password, port)  # Tylko FTP
```

**Teraz:**
```python
conn = connect_file_transfer(hostname, username, password, port)
# Automatycznie FTP (port 21) lub SFTP (port 22)
```

### 2. Jedna klasa - dwa protokoły

Klasa `SFTPHandler` implementuje ten sam interfejs co `ftplib.FTP`:
- `list_directory()` ≈ `ftp.dir()`
- `upload_file()` ≈ `ftp.storbinary()`
- `download_file()` ≈ `ftp.retrbinary()`
- `delete_file()` ≈ `ftp.delete()`
- `create_directory()` ≈ `ftp.mkd()`

### 3. Automatyczna ścieżka

```python
# Automatyczne określanie domyślnej ścieżki
default_path = '/storage/MediaPionowe' if port == 22 else '/home/kiosk/MediaPionowe'
```

---

## 🧪 Testowane scenariusze

✅ LibreELEC RPi5 - SFTP port 22
✅ Debian RPi - FTP port 21
✅ Mieszane środowisko (FTP + SFTP jednocześnie)
✅ Upload/Download plików
✅ Edycja plików tekstowych
✅ Raportowanie IP
✅ Zarządzanie playlistą

---

## 🔐 Bezpieczeństwo

### SFTP (LibreELEC) - Zalecane
- ✅ Szyfrowane połączenie SSH
- ✅ Silna autoryzacja
- ✅ Wsparcie kluczy SSH
- ✅ Bezpieczne w sieci publicznej

### FTP (Debian) - Legacy
- ⚠️ Nieszyfrowane połączenie
- ⚠️ Tylko sieć lokalna
- ⚠️ Nie używać w sieci publicznej

---

## 📞 Wsparcie

### W przypadku problemów:

1. **Przeczytaj dokumentację**
   - `INSTRUKCJA_WDROZENIA.md` - sekcja "Rozwiązywanie problemów"
   - `docs/LibreELEC_Konfiguracja.md` - szczegóły LibreELEC

2. **Sprawdź logi**
   - Backend: `python backend/app.py` (konsola)
   - LibreELEC: `journalctl -u ipdoapi.service`
   - SSH: `journalctl -u sshd`

3. **Typowe problemy**
   - Brak modułu paramiko → `pip install paramiko`
   - Nie można połączyć → sprawdź port (22 nie 21!)
   - Permission denied → sprawdź uprawnienia katalogów
   - Usługa nie raportuje IP → sprawdź status systemd

---

## 🎉 Gotowe do wdrożenia!

System jest **w pełni funkcjonalny** i gotowy do użycia z:
- ✅ Raspberry Pi 5 + LibreELEC 12.0.2
- ✅ Raspberry Pi (starsze) + Debian/Raspbian
- ✅ Mieszane środowiska

**Wszystko działa automatycznie, transparentnie i bezpiecznie!** 🚀

---

## 📝 Checklist wdrożenia

### Serwer (Backend)
- [ ] Zainstaluj `paramiko`: `pip install paramiko`
- [ ] Sprawdź czy `sftp_handler.py` istnieje
- [ ] Uruchom backend: `python backend/app.py`
- [ ] Sprawdź brak błędów importu

### Kiosk (LibreELEC)
- [ ] Włącz SSH w Kodi
- [ ] Ustaw hasło SSH
- [ ] Uruchom `instalator_libreelec.sh`
- [ ] Sprawdź status: `systemctl status ipdoapi.service`

### Panel WWW
- [ ] Dodaj kiosk z portem 22
- [ ] Test połączenia → "Połączenie SFTP udane"
- [ ] Test operacji na plikach
- [ ] Sprawdź raportowanie IP (status online)

---

**Data:** 17 października 2025  
**Wersja systemu:** 2.0 - Wsparcie LibreELEC  
**Status:** ✅ Gotowe do produkcji

🎉 **Gratulacje! System jest w pełni dostosowany do Raspberry Pi 5 z LibreELEC 12.0.2!** 🎉
