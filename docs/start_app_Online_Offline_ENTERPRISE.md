# Dokumentacja Enterprise
## start_app Online_Offline.sh

Wersja dokumentu: 1.0  
Data: 2026-03-13  
Zakres: Kompletny opis operacyjny, techniczny i utrzymaniowy skryptu start_app Online_Offline.sh.

---

## 1. Cel i zakres

Skrypt realizuje pracę kiosku prezentacyjnego w dwóch trybach sterowanych jednym parametrem:

- ONLINE_MODE=1: pełna funkcjonalność (pobieranie PDF z sieci, konwersja PDF do obrazów, filtrowanie wg reguł daty, wyświetlanie mediów)
- ONLINE_MODE=0: wyłącznie lokalny pokaz obrazów z katalogu IMG_DIR, bez operacji sieciowych i bez obsługi PDF

Dokument obejmuje:

- architekturę logiczną i przepływy wykonania
- parametry i punkty konfiguracji
- zależności systemowe
- model logowania i diagnostyki
- bezpieczeństwo operacyjne
- runbook administracyjny
- checklisty wdrożeniowe i utrzymaniowe

---

## 2. Lokalizacja i artefakty

Plik wykonywalny:

- start_app Online_Offline.sh

Katalogi robocze:

- PDF_DIR=/home/kiosk/MediaPionowe
- IMG_DIR=/home/kiosk/MediaPionowe/converted

Pliki logów i diagnostyki:

- LOG_FILE=$PDF_DIR/download.log
- $PDF_DIR/rotate.err
- $PDF_DIR/rotate.out

Lock pojedynczej instancji:

- /tmp/start_app_online_offline.lock
- /tmp/start_app_online_offline.lock/pid

Cache fullscreen:

- /tmp/kiosk_fullscreen

---

## 3. Słownik pojęć

- Viewer: aplikacja wyświetlająca media (feh, imv, eog, display)
- Tryb pełny: ONLINE_MODE=1
- Tryb lokalny: ONLINE_MODE=0
- Media signature: skrót listy plików używany do restartu persistenta feh po zmianie zawartości katalogu
- Aktywne klucze daty: zestaw nazw mediów dopuszczonych do wyświetlania wg reguł miesiąc/dzień

---

## 4. Architektura funkcjonalna

### 4.1 Bloki odpowiedzialności

1. Inicjalizacja środowiska
- ustawienie DISPLAY
- wyłączenie wygaszacza i DPMS
- walidacja parametrów

2. Kontrola współbieżności
- lock pojedynczej instancji przez lock directory + PID

3. Rotacja ekranu
- dedykowana ścieżka poleceń rotate-display/rotate

4. Warstwa mediów
- detekcja viewera
- otwieranie obrazów i PDF
- ubijanie poprzednich procesów viewerów

5. Warstwa konwersji
- konwersja PDF do obrazów przez pdftoppm / convert / gs

6. Warstwa sieci
- pobranie listy PDF
- wybór najnowszego po Last-Modified
- pobieranie i aktualizacja lokalnej kopii

7. Warstwa playlisty
- zbieranie mediów
- filtr datowy i fallback
- pętla odtwarzania z kontrolą czasu ekspozycji

### 4.2 Główna zasada sterowania

ONLINE_MODE decyduje o wykonaniu gałęzi logiki:

- ONLINE_MODE=1: uruchamiane są wszystkie bloki
- ONLINE_MODE=0: uruchamiana wyłącznie logika lokalnego pokazu obrazów z IMG_DIR

---

## 5. Parametry i konfiguracja

### 5.1 Parametry środowiskowe i stałe

- ONLINE_MODE
  - wartości: 0 albo 1
  - domyślnie: 1
  - znaczenie: wybór pełnej funkcjonalności lub trybu lokalnego

- TIME_PER_ITEM
  - domyślnie: 30 sekund
  - walidacja: dodatnia liczba całkowita

- PDF_CONVERT_TIMEOUT
  - domyślnie: 25 sekund
  - dotyczy pojedynczej operacji konwersji PDF

- PDF_CONVERT_DPI
  - domyślnie: 150
  - wpływa na jakość i rozmiar obrazów po konwersji

### 5.2 Parametry wejściowe CLI

- offline: wymusza ONLINE_MODE=0
- online: wymusza ONLINE_MODE=1
- rotate-display <right|0|normal|left|inverted>
- rotate <right|0|normal|left|inverted>

Uwagi:

- polecenie rotate-display/rotate kończy proces po wykonaniu obrotu
- przy braku orientacji skrypt zwraca kod wyjścia 2

---

## 6. Przepływy wykonania

### 6.1 Start procesu

1. Tworzenie katalogów roboczych
2. Próba pozyskania locka pojedynczej instancji
3. Konfiguracja DISPLAY i xset
4. Walidacja ONLINE_MODE i TIME_PER_ITEM
5. Weryfikacja dostępności viewera obrazów
6. Rozgałęzienie logiki wg ONLINE_MODE

### 6.2 Przepływ ONLINE_MODE=1

1. Logowanie startu trybu pełnego
2. Pobranie URL najnowszego PDF ze strony docelowej
3. Pobranie/aktualizacja lokalnego PDF
4. Ustawienie orientacji ekranu na normal
5. Pętla główna:
- konwersja wszystkich PDF do obrazów
- zbudowanie listy mediów z priorytetami
- zastosowanie filtra datowego
- odtwarzanie pozycji przez TIME_PER_ITEM

### 6.3 Przepływ ONLINE_MODE=0

1. Logowanie startu trybu lokalnego
2. Brak wywołań sieci
3. Brak obsługi PDF
4. Ustawienie orientacji ekranu na normal
5. Pętla główna:
- pobranie wyłącznie obrazów z IMG_DIR
- jeśli viewer=feh: praca w trybie persistent slideshow
- pozostałe viewery: sekwencyjne wyświetlanie obrazów

---

## 7. Reguły selekcji mediów

### 7.1 Budowa listy mediów w ONLINE_MODE=1

Źródła i priorytet:

1. Obrazy w IMG_DIR (w tym skonwertowane strony PDF)
2. Obrazy bezpośrednio w PDF_DIR
3. PDF z PDF_DIR tylko wtedy, gdy brak skonwertowanej wersji

Mechanizm deduplikacji:

- seen_files: unika duplikatów po nazwie bazowej
- has_converted: blokuje fallback PDF, jeśli istnieje skonwertowany odpowiednik

### 7.2 Filtr datowy

Reguła biznesowa:

- dzień <= 15: aktywne klucze miesiąc1 i miesiąc2
- dzień > 15: aktywne klucze miesiąc2 i następny_miesiąc1

Obsługiwane warianty nazw:

- polskie pełne
- polskie skrócone
- angielskie skrócone
- angielskie pełne

Normalizacja:

- zamiana na małe litery
- usuwanie polskich znaków diakrytycznych

Fallback:

- gdy po filtrze lista jest pusta, odtwarzane są wszystkie media z listy pierwotnej

---

## 8. Konwersja PDF

### 8.1 Kolejność narzędzi

1. pdftoppm
2. ImageMagick convert
3. Ghostscript gs

### 8.2 Strategia wyników

- format stron wynikowych: PNG
- nazwa docelowa: nazwa miesiąca + numer strony
- czyszczenie poprzednich artefaktów przed nową konwersją

### 8.3 Caching

- jeśli pierwszy obraz miesiąca jest nowszy od PDF, konwersja jest pomijana

---

## 9. Integracja sieciowa

### 9.1 Endpointy

- BASE_URL: listing załączników
- TARGET_PAGE: strona źródłowa linków PDF
- BASE_ORIGIN: baza do budowy URL absolutnych

### 9.2 Wybór najnowszego PDF

- parser wyciąga href do PDF
- dla każdego URL pobierany jest nagłówek Last-Modified
- data konwertowana do Unix timestamp
- wybór pliku o największym timestamp

### 9.3 Aktualizacja lokalna

- curl z warunkiem -z dla istniejącego pliku
- przy zmianie PDF czyszczony jest cache obrazów i fullscreen

---

## 10. Obsługa viewerów i ekranu

### 10.1 Wspierane viewery obrazów

- feh
- imv
- eog
- display

### 10.2 Zachowanie per viewer

- feh: fullscreen + zoom fill; dodatkowo obsługa persistenta w ONLINE_MODE=0
- imv: fullscreen + scale full
- eog/display: przygotowanie obrazu pod rozdzielczość ekranu przez convert

### 10.3 Obsługa PDF (tylko ONLINE_MODE=1)

- preferencja: konwersja PDF do obrazu
- fallback: xpdf lub evince przy błędzie konwersji

### 10.4 Rotacja ekranu

- komenda xrandr -o
- obsługiwane orientacje: normal/right/left/inverted

---

## 11. Model logowania i diagnostyki

### 11.1 Miejsce logów

- główny log: $PDF_DIR/download.log
- diagnostyka rotacji: rotate.err i rotate.out

### 11.2 Kluczowe zdarzenia logowane

- start procesu z parametrami
- wejście w tryb ONLINE_MODE=1 lub ONLINE_MODE=0
- wyniki pobrań i aktualizacji PDF
- wybór i konwersja mediów
- błędy otwierania plików i brak zależności
- czasy ekspozycji mediów

### 11.3 Zalecenie operacyjne

- uruchomić rotację logów systemowych (np. logrotate), aby ograniczyć wzrost pliku download.log

---

## 12. Kody zakończenia i błędy

Kody zwracane jawnie:

- 0: poprawne zakończenie lub wyjście po wykryciu aktywnej instancji
- 2: błędne użycie rotate-display/rotate lub błędna orientacja
- 3: brak xrandr
- 4: błąd wykonania xrandr
- 1: brak wspieranego viewera obrazów

Typowe błędy runtime:

- brak połączenia sieciowego lub timeouty curl (ONLINE_MODE=1)
- brak narzędzi konwersji PDF
- brak viewerów PDF do fallback

---

## 13. Bezpieczeństwo i odporność

### 13.1 Mechanizmy odporności

- lock pojedynczej instancji
- powtarzalny sleep odporny na przerwania sygnałem
- fallbacki narzędzi konwersji i viewerów
- bezpieczne ignorowanie błędów niekrytycznych (set +e + lokalne walidacje)

### 13.2 Ryzyka

- parser HTML oparty o grep/sed może wymagać aktualizacji przy zmianie struktury strony
- intensywne użycie pkill -f może wpływać na inne procesy o zbliżonych nazwach
- wysokie DPI zwiększa koszty CPU i I/O

### 13.3 Rekomendacje hardeningu

- uruchamianie pod dedykowanym użytkownikiem bez uprawnień root
- restrykcje uprawnień do katalogów roboczych
- systemd unit z Restart=always i limitami zasobów
- monitoring rozmiaru katalogów i logów

---

## 14. Wymagania systemowe

Minimalne narzędzia:

- bash
- coreutils, sed, awk, grep, find, pkill
- curl
- xrandr, xset
- co najmniej jeden viewer obrazów: feh/imv/eog/display

Opcjonalne, ale rekomendowane:

- pdftoppm (najlepsza ścieżka konwersji)
- ImageMagick convert
- Ghostscript gs
- xpdf lub evince (fallback PDF)

---

## 15. Runbook operacyjny

### 15.1 Start ręczny

```bash
chmod +x "start_app Online_Offline.sh"
ONLINE_MODE=1 ./start_app\ Online_Offline.sh
```

### 15.2 Start w trybie lokalnym

```bash
ONLINE_MODE=0 ./start_app\ Online_Offline.sh
# lub
./start_app\ Online_Offline.sh offline
```

### 15.3 Start pełny

```bash
ONLINE_MODE=1 ./start_app\ Online_Offline.sh
# lub
./start_app\ Online_Offline.sh online
```

### 15.4 Obrót ekranu

```bash
./start_app\ Online_Offline.sh rotate-display right
./start_app\ Online_Offline.sh rotate-display normal
```

### 15.5 Diagnostyka podstawowa

```bash
tail -f /home/kiosk/MediaPionowe/download.log
ls -la /tmp/start_app_online_offline.lock
```

---

## 16. Procedury awaryjne

### 16.1 Brak wyświetlania mediów

1. Sprawdź, czy istnieją obrazy w IMG_DIR
2. Zweryfikuj wykrycie viewera w logu
3. Sprawdź dostępność DISPLAY i działanie xrandr
4. Zweryfikuj brak konkurencyjnej instancji przez lock PID

### 16.2 Problemy z PDF w ONLINE_MODE=1

1. Sprawdź odpowiedzi curl i nagłówki Last-Modified
2. Sprawdź dostępność pdftoppm/convert/gs
3. Zweryfikuj prawa zapisu do PDF_DIR i IMG_DIR
4. Sprawdź rotację cache i wolne miejsce na dysku

---

## 17. Utrzymanie i zmiany

### 17.1 Parametry najczęściej modyfikowane

- ONLINE_MODE
- TIME_PER_ITEM
- PDF_CONVERT_TIMEOUT
- PDF_CONVERT_DPI
- TARGET_PAGE / BASE_URL / BASE_ORIGIN

### 17.2 Zasada zmiany

- zmiany wdrażać etapowo: test lokalny, test na kiosk testowy, dopiero potem produkcja
- po zmianie reguł filtrów datowych wykonywać testy na nazwach plików PL i EN

---

## 18. Testy akceptacyjne

### 18.1 Scenariusze krytyczne

1. ONLINE_MODE=0 i katalog IMG_DIR pusty
2. ONLINE_MODE=0 i katalog IMG_DIR z wieloma obrazami
3. ONLINE_MODE=1 bez sieci
4. ONLINE_MODE=1 z siecią i nowym PDF
5. ONLINE_MODE=1 z błędem konwersji PDF
6. rotate-display z poprawną i błędną orientacją
7. próba uruchomienia drugiej instancji

### 18.2 Kryteria sukcesu

- brak równoległych instancji
- poprawne czasy ekspozycji
- spójność logów i brak krytycznych błędów
- zgodność zachowania z wybranym ONLINE_MODE

---

## 19. Compliance operacyjny

Dla środowisk enterprise zalecane jest:

- centralizacja logów
- alerting na brak nowych mediów i na błędy konwersji
- okresowe przeglądy zależności systemowych
- backup kluczowych katalogów mediów

---

## 20. Podsumowanie

Skrypt start_app Online_Offline.sh zapewnia jednolity i czytelny model sterowania przez ONLINE_MODE, jednocześnie zachowując pełną ścieżkę funkcjonalną w trybie ONLINE_MODE=1 i restrykcyjny, szybki tryb lokalny w ONLINE_MODE=0. Konstrukcja oparta na locku instancji, logowaniu operacyjnym, fallbackach narzędzi i pętli odtwarzania umożliwia stabilną eksploatację kiosku w środowisku produkcyjnym.