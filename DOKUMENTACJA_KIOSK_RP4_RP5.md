# Dokumentacja pracy z kiosk rp4 i kiosk rp5

## 1. Cel dokumentu
Ten dokument opisuje praktyczne uruchamianie i utrzymanie odtwarzacza kioskowego w dwóch wariantach sprzętowych:
- Raspberry Pi 4: folder kiosk rp4
- Raspberry Pi 5: folder kiosk rp5

Zakres obejmuje:
- strukture katalogow,
- instalacje zaleznosci,
- build,
- uruchomienie,
- integracje z backendem,
- najczestsze problemy i diagnostyke.

## 2. Struktura katalogow
Kazdy folder (kiosk rp4 i kiosk rp5) zawiera podobny zestaw elementow:
- src: kod C++ odtwarzacza,
- scripts: skrypty instalacyjne i narzedziowe,
- CMakeLists.txt: konfiguracja budowania,
- playlist.m3u: lokalna playlista testowa.

W praktyce oba warianty sa bardzo zblizone funkcjonalnie. Najwazniejsze roznice dotyczace eksploatacji wynikaja z:
- platformy sprzetowej,
- flag kompilacji w CMake,
- doboru skryptow instalacyjnych.

## 3. Najwazniejsze roznice rp4 vs rp5

### 3.1 CMake
- kiosk rp4:
  - definiuje RASPBERRY_PI dla architektur arm i aarch64.
- kiosk rp5:
  - ma dodatkowe flagi optymalizacyjne dla arm (mcpu i mtune na cortex-a76),
  - definiuje RASPBERRY_PI dla arm.

### 3.2 Skrypty instalacyjne
- kiosk rp4:
  - glowny skrypt instalacyjny: scripts/install_all.sh,
  - skupia sie na ffmpeg i gotowosci skryptow konwersji.
- kiosk rp5:
  - glowny skrypt instalacyjny zaleznosci: scripts/install_deps_raspberry.sh,
  - instaluje pelny zestaw bibliotek developerskich i modyfikuje profil wydajnosci.

### 3.3 Uruchamianie kiosku
- oba warianty maja scripts/run_video_player.sh,
- rp4 dodatkowo preferuje natywny tryb SDL przez kmsdrm i potrafi odcinac sesje desktopowa (display/wayland),
- oba warianty potrafia bootstrapowac orientacje i playlisty z backendu.

## 4. Wymagania systemowe
Minimalnie:
- system Linux na Raspberry Pi,
- dostep do apt,
- CMake,
- kompilator C++,
- biblioteki FFmpeg,
- SDL2,
- Boost,
- OpenSSL,
- CURL,
- jsoncpp,
- websocketpp.

Uwaga operacyjna:
- dla dlugotrwalej pracy kiosku zalecane jest uruchamianie przez SFTP (port 22) i playlisty na storage.

## 5. Instalacja zaleznosci

### 5.1 Raspberry Pi 4
Wykonaj:
1. przejdz do folderu kiosk rp4/scripts,
2. uruchom install_all.sh,
3. potwierdz brak bledow w logu.

Skrypt:
- instaluje ffmpeg,
- sprawdza dostepnosc enkoderow,
- nadaje prawa wykonywania skryptom konwersji i uruchamiania.

### 5.2 Raspberry Pi 5
Wykonaj:
1. przejdz do folderu kiosk rp5/scripts,
2. uruchom install_deps_raspberry.sh,
3. potwierdz instalacje bibliotek build/runtime.

Skrypt:
- instaluje narzedzia kompilacji,
- instaluje FFmpeg, SDL2 i biblioteki sieciowe,
- ustawia dodatkowe wpisy wydajnosciowe w konfiguracji systemu.

## 6. Build odtwarzacza
Workflow dla obu folderow:
1. utworz katalog build,
2. uruchom cmake,
3. uruchom make.

Przyklad:
- w katalogu kiosk rp4 lub kiosk rp5:
  - mkdir -p build
  - cd build
  - cmake ..
  - make -j4

Artefakt:
- binarka video_player w katalogu build.

## 7. Uruchamianie odtwarzacza
Glowny punkt startowy:
- scripts/run_video_player.sh

Logika uruchomienia:
1. sprawdzenie binarki video_player,
2. bootstrap orientacji ekranu,
3. wyszukanie playlisty lokalnie,
4. fallback do trybu backend-bootstrap, jezeli podano URL backendu.

Wspierane lokalizacje playlist obejmuja miedzy innymi:
- playlisty w katalogu projektu,
- storage/videos,
- home/kiosk/MediaPionowe.

## 8. Integracja z backendem
Odtwarzacz wspiera:
- raportowanie IP kiosku,
- raportowanie bledow runtime,
- pobieranie orientacji,
- pobieranie playlist.

Przydatne zmienne srodowiskowe:
- KIOSK_BACKEND_URL lub BACKEND_BASE_URL,
- KIOSK_SERIAL_NUMBER,
- KIOSK_PLAYBACK_SOURCE,
- KIOSK_ORIENTATION_FILE,
- KIOSK_RUNTIME_PLAYLIST_FILE,
- KIOSK_WS_PORT,
- KIOSK_WS_TOKEN.

Wskazowka:
- jezeli backend nie jest dostepny, zadbaj o lokalna playliste m3u/m3u8.

## 9. Konwersja mediow
W folderach scripts dostepne sa narzedzia:
- convert_picture.sh,
- convert_video.sh,
- convert_for_rpi.sh.

Zalecenia:
- testuj pliki wyjsciowe na docelowym urzadzeniu,
- przy problemach z kodowaniem sprawdz wyniki ffmpeg i dostepne enkodery.

## 10. Diagnostyka i najczestsze problemy

### 10.1 Brak obrazu na pelnym ekranie
- sprawdz uruchomienie przez run_video_player.sh,
- sprawdz ustawienia SDL i sterownika kmsdrm,
- zweryfikuj czy inna warstwa desktopowa nie przykrywa odtwarzacza.

### 10.2 Brak playlisty
- zweryfikuj sciezki playlist lokalnych,
- ustaw KIOSK_PLAYBACK_SOURCE,
- sprawdz, czy backend zwraca playlisty dla danego numeru seryjnego.

### 10.3 Problemy FTP/SFTP przy synchronizacji plikow
- preferuj SFTP (port 22),
- zweryfikuj dane dostepowe kiosku,
- sprawdz uprawnienia katalogow docelowych na urzadzeniu.

### 10.4 Problemy z orientacja
- sprawdz plik orientacji i jego uprawnienia,
- sprawdz endpoint orientacji w backendzie,
- zweryfikuj wartosci: normal, right, left, inverted.

## 11. Rekomendowany workflow wdrozenia
1. Wybierz wariant sprzetowy i folder (rp4 albo rp5).
2. Zainstaluj zaleznosci skryptem dedykowanym dla platformy.
3. Zbuduj video_player przez CMake.
4. Przygotuj playliste i media.
5. Skonfiguruj zmienne backendowe.
6. Uruchom run_video_player.sh.
7. Zweryfikuj logi odtwarzacza i endpointy backendu.

## 12. Powiazane pliki
- kiosk rp4/README.md
- kiosk rp4/CMakeLists.txt
- kiosk rp4/scripts/install_all.sh
- kiosk rp4/scripts/run_video_player.sh
- kiosk rp5/README.md
- kiosk rp5/CMakeLists.txt
- kiosk rp5/scripts/install_deps_raspberry.sh
- kiosk rp5/scripts/run_video_player.sh
- README.md
