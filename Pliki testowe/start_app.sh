#!/bin/bash
set +e
# start_app.sh - KIOSK PREZENTACYJNY Z OBSŁUGĄ OFFLINE/ONLINE
# 
# TRYBY PRACY:
#   OFFLINE  - wyświetla TYLKO pliki w katalogu lokalnym, NO network operations
#   ONLINE   - pobiera nowe pliki z sieci, przechowuje lokalnie, wyświetla
#
# URUCHOMIENIE:
#   ./start_app.sh                   # Uruchom w trybie OFFLINE (domyślnie)
#   ./start_app.sh offline           # Uruchom w trybie OFFLINE
#   ./start_app.sh online            # Uruchom w trybie ONLINE (jawnie)
#   OFFLINE_MODE=1 ./start_app.sh    # Zmienna środowiskowa: tryb OFFLINE
#   ./start_app.sh rotate-display right  # Obrót ekranu (bez start pętli)
#
# W TRYBIE OFFLINE:
#   - Wyświetla TYLKO pliki w: $PDF_DIR i $IMG_DIR
#   - Brak połączeń sieciowych, brak timeout'ów
#   - Idealne dla systemu bez internetu
#
# W TRYBIE ONLINE:
#   - Pobiera nowe pliki z $TARGET_PAGE
#   - Przechowuje w $PDF_DIR dla offline dostapu
#   - Wyświetla z priorytetu: converted PDF -> native images -> raw PDFs

# Katalog tymczasowy na pobrane PDF-y i przekonwertowane obrazy
PDF_DIR="/home/kiosk/MediaPionowe"
IMG_DIR="/home/kiosk/MediaPionowe/converted"
mkdir -p "$PDF_DIR"
mkdir -p "$IMG_DIR"

# Blokada pojedynczej instancji (chroni przed zbyt szybkim przełączaniem)
LOCK_DIR="/tmp/start_app.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"

acquire_single_instance_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$LOCK_PID_FILE"
        trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
        return 0
    fi

    if [ -f "$LOCK_PID_FILE" ]; then
        local existing_pid
        existing_pid="$(cat "$LOCK_PID_FILE" 2>/dev/null)"
        if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') start_app.sh już działa (PID=$existing_pid). Ta instancja kończy pracę." >> "$PDF_DIR/download.log"
            return 1
        fi
    fi

    rm -rf "$LOCK_DIR" 2>/dev/null || true
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$LOCK_PID_FILE"
        trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
        return 0
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') Błąd: nie udało się założyć locka pojedynczej instancji." >> "$PDF_DIR/download.log"
    return 1
}

if ! acquire_single_instance_lock; then
    exit 0
fi

# Zapewnij DISPLAY dla viewerow
if [ -z "$DISPLAY" ]; then
    export DISPLAY=:0
fi

# ========== KONFIGURACJA SIECI I OFFLINE/ONLINE ==========
# Adres bazowy katalogu z załącznikami (lista PDF-ów będzie z tego parsowana)
BASE_URL="https://arm.siedlce.pl/storage/attachments/"

# Strona z przyciskiem "siłownia" oraz origin do budowy pełnego URL
BASE_ORIGIN="https://arm.siedlce.pl"
TARGET_PAGE="https://arm.siedlce.pl/pl/silownia-stadion"

# TRYB PRACY: 
#   OFFLINE_MODE=0 (lub zmienną $OFFLINE_MODE) -> pobiera nowe pliki z sieci
#   OFFLINE_MODE=1                             -> wyświetla tylko lokalne pliki
#   STRICT_OFFLINE=1                           -> wymusza wyłącznie tryb offline
# Można ustawić poprzez:
#   - zmienną: OFFLINE_MODE=1 ./start_app.sh
#   - parametr: ./start_app.sh offline
#   - parametr: ./start_app.sh online
# WYMUSZENIE STABILNOŚCI OFFLINE: tutaj ustawiamy twardy offline.
# Uwaga: przy STRICT_OFFLINE=1 parametr "online" jest ignorowany.
STRICT_OFFLINE=0

if [ "$1" = "offline" ]; then
    OFFLINE_MODE=1
elif [ "$1" = "online" ]; then
    OFFLINE_MODE=0
fi
# Domyślnie: tryb OFFLINE (jeśli nie ustawiono zmienną OFFLINE_MODE)
OFFLINE_MODE="${OFFLINE_MODE:-0}"

if [ "$STRICT_OFFLINE" -eq 1 ]; then
    if [ "$OFFLINE_MODE" -eq 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') STRICT_OFFLINE=1: ignoruję żądanie trybu online i wymuszam offline" >> "$PDF_DIR/download.log"
    fi
    OFFLINE_MODE=1
fi

# Czas wyświetlania pojedynczego pliku (w sekundach)
TIME_PER_ITEM=30
# Limit czasu pojedynczej konwersji PDF (sekundy)
PDF_CONVERT_TIMEOUT=25

validate_time_per_item() {
    # Dozwolone tylko dodatnie liczby całkowite
    if ! [[ "$TIME_PER_ITEM" =~ ^[1-9][0-9]*$ ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Nieprawidłowe TIME_PER_ITEM='$TIME_PER_ITEM'. Ustawiam wartość domyślną: 30" >> "$PDF_DIR/download.log"
        TIME_PER_ITEM=30
    fi
}

sleep_for_duration() {
    local duration="$1"
    local end_ts now remaining

    end_ts=$(( $(date +%s) + duration ))
    while true; do
        now=$(date +%s)
        remaining=$(( end_ts - now ))
        [ "$remaining" -le 0 ] && break
        # Powtórz sleep, jeśli został przerwany sygnałem
        sleep "$remaining" || true
    done
}

run_with_timeout() {
    local timeout_seconds="$1"
    shift

    if command -v timeout >/dev/null 2>&1; then
        timeout "$timeout_seconds" "$@"
    else
        "$@"
    fi
}


validate_time_per_item
echo "$(date '+%Y-%m-%d %H:%M:%S') Start skryptu PID=$$ TIME_PER_ITEM=${TIME_PER_ITEM}s" >> "$PDF_DIR/download.log"

# Rozdzielczość dla konwersji PDF (wyższa = lepsza jakość, ale większy plik)
PDF_CONVERT_DPI=150

# Funkcja: obróć ekran (kompatybilna z API rotate-display)
# Użycie: ./start_app.sh rotate-display <orientation>
# orientation: 'right' | '0' | 'normal' (opcjonalnie: 'left' | 'inverted')
rotate_display() {
    local raw="$normal"
    local o
    # Normalizuj wejście
    o="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
    case "$o" in
        0|normal|n|norm) o="normal" ;;
        right|r) o="right" ;;
        left|l) o="left" ;;
        inverted|i|180) o="inverted" ;;
        *) echo "Nieprawidłowa orientacja: '$raw'. Dozwolone: right | 0 | normal | left | inverted" >&2
           return 2 ;;
    esac

    # Zapewnij dostęp do Xorg na :0
    if [ -z "$DISPLAY" ]; then
        export DISPLAY=:0
    fi

    if ! command -v xrandr >/dev/null 2>&1; then
        echo "Brak polecenia xrandr w PATH" >&2
        return 3
    fi

    # Wykonaj obrót
    if ! xrandr -o "$o" 2>"$PDF_DIR/rotate.err" 1>"$PDF_DIR/rotate.out"; then
        echo "Błąd wykonywania xrandr -o $o" >&2
        return 4
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') Ekran obrócony na: $o" >> "$PDF_DIR/download.log"
}

# Tryb tylko-obrót: umożliwia wywołanie z backendu/SSH bez startu pętli
if [ "$1" = "rotate-display" ] || [ "$1" = "rotate" ]; then
    if [ -z "$2" ]; then
        echo "Użycie: $0 rotate-display <right|0|normal|left|inverted>" >&2
        exit 2
    fi
    rotate_display "$2"
    exit $?
fi

# Funkcja: znajdź wszystkie PDF-y pod BASE_URL (parsowanie listingu HTML)
# W OFFLINE_MODE=1: natychmiast zwraca (żaden network call)
fetch_pdf_urls() {
    if [ "$OFFLINE_MODE" -eq 1 ]; then
        return 0  # Offline mode: brak pobierania z sieci
    fi
    curl -sS "$BASE_URL" \
    | grep -Eoi 'href="[^"]+\.pdf"' \
    | sed -E 's/.*href="([^"]+)".*/\1/' \
    | while read -r href; do
        if [[ "$href" =~ ^https?:// ]]; then
            echo "$href"
        else
            href="${href#/}"
            echo "${BASE_URL%/}/$href"
        fi
      done \
    | sort -u
}

# Prosta detekcja przeglądarki obrazów
detect_image_viewer() {
    if command -v feh >/dev/null 2>&1; then
        echo "feh"
    elif command -v imv >/dev/null 2>&1; then
        echo "imv"
    elif command -v eog >/dev/null 2>&1; then
        echo "eog"
    elif command -v display >/dev/null 2>&1; then
        echo "display"
    else
        echo ""
    fi
}

IMG_VIEWER="$(detect_image_viewer)"

# Pobierz rozdzielczosc ekranu (fallback: 1920x1080)
get_screen_resolution() {
    if command -v xrandr >/dev/null 2>&1; then
        local res
        res=$(xrandr | grep '\*' | awk '{print $1}' | head -n1)
        if [ -n "$res" ]; then
            echo "$res"
            return 0
        fi
    fi
    echo "1920x1080"
}

# Przygotuj obraz do pelnego wypelnienia ekranu (cover)
prepare_fullscreen_image() {
    local src="$1"
    local res
    local tmp_dir
    local base
    local out

    res="$(get_screen_resolution)"
    tmp_dir="/tmp/kiosk_fullscreen"
    base="$(basename "$src")"
    out="$tmp_dir/${base%.*}_$res.png"

    mkdir -p "$tmp_dir"

    # Sprawdź czy już mamy przygotowany obraz (cache)
    if [ -f "$out" ] && [ "$out" -nt "$src" ]; then
        echo "$out"
        return 0
    fi

    if command -v convert >/dev/null 2>&1; then
        # Skaluje z przycieciem, aby w 100% wypelnic ekran
        convert "$src" \
            -resize "${res}^" \
            -gravity center -extent "$res" \
            "$out" 2>>"$PDF_DIR/download.log"
        if [ -f "$out" ]; then
            echo "$out"
            return 0
        fi
    fi

    # Fallback - zwroc oryginalny obraz
    echo "$src"
}

# Czysc stary cache obrazow przygotowanych do fullscreen
cleanup_fullscreen_cache() {
    if [ -d "/tmp/kiosk_fullscreen" ]; then
        find "/tmp/kiosk_fullscreen" -type f -mmin +60 -delete 2>/dev/null || true
    fi
}

# Uśmiercenie potencjalnych procesów podglądu
kill_viewers() {
    pkill -f xpdf 2>/dev/null || true
    pkill -f mupdf 2>/dev/null || true
    pkill -f evince 2>/dev/null || true
    pkill -f feh 2>/dev/null || true
    pkill -f imv 2>/dev/null || true
    pkill -f eog 2>/dev/null || true
    pkill -f display 2>/dev/null || true
    pkill -f sxiv 2>/dev/null || true
}

open_image() {
    local img="$1"
    local prepared
    case "$IMG_VIEWER" in
        feh)
            # feh skaluje natywnie przez --zoom fill – nie trzeba pre-skalować (ważne na 4K)
            feh -F --zoom fill "$img" &
            ;;
        imv)
            # imv skaluje natywnie przez -s full – nie trzeba pre-skalować
            imv -f -s full "$img" &
            ;;
        eog)
            # eog nie skaluje sam – pre-skaluj przez convert
            prepared="$(prepare_fullscreen_image "$img")"
            eog --fullscreen "$prepared" &
            ;;
        display)
            # ImageMagick display – pre-skaluj, żeby wypełnić ekran
            prepared="$(prepare_fullscreen_image "$img")"
            display -window root "$prepared" &
            ;;
        *)
            echo "$(date '+%Y-%m-%d %H:%M:%S') Brak przeglądarki obrazów (feh/imv/eog/display)" >> "$PDF_DIR/download.log"
            return 1
            ;;
    esac
}

# Funkcja: konwertuj PDF na obrazek wysokiej jakości
convert_pdf_to_image() {
    local pdf_path="$1"
    local pdf_name="$(basename "$pdf_path" .pdf)"
    local output_prefix="$IMG_DIR/tmp_${pdf_name}_page"
    local month_num month_name
    local first_image=""
    local page_index page_file target_file

    month_num=$((10#$(date +%m)))
    case "$month_num" in
        1) month_name="styczen" ;;
        2) month_name="luty" ;;
        3) month_name="marzec" ;;
        4) month_name="kwiecien" ;;
        5) month_name="maj" ;;
        6) month_name="czerwiec" ;;
        7) month_name="lipiec" ;;
        8) month_name="sierpien" ;;
        9) month_name="wrzesien" ;;
        10) month_name="pazdziernik" ;;
        11) month_name="listopad" ;;
        12) month_name="grudzien" ;;
        *) month_name="plik" ;;
    esac

    first_image="$IMG_DIR/${month_name}1.png"

    # Jeśli obrazki już istnieją i są nowsze niż PDF, nie konwertuj ponownie
    if [ -n "$first_image" ] && [ "$first_image" -nt "$pdf_path" ]; then
        echo "$first_image"
        return 0
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') Konwertuję PDF na obrazy: $pdf_name" >> "$PDF_DIR/download.log"

    # Wyczyść stare strony z poprzedniej konwersji
    rm -f "${output_prefix}-"*.png 2>/dev/null || true
    rm -f "$IMG_DIR/${month_name}"*.png 2>/dev/null || true

    # Metoda 1: pdftoppm (szybsza, preferowana)
    if command -v pdftoppm >/dev/null 2>&1; then
        # -png = format PNG
        # -r = rozdzielczość DPI
        run_with_timeout "$PDF_CONVERT_TIMEOUT" \
            pdftoppm -png -r "$PDF_CONVERT_DPI" "$pdf_path" "$output_prefix" 2>>"$PDF_DIR/download.log"

        shopt -s nullglob
        page_index=1
        for page_file in "${output_prefix}-"*.png; do
            target_file="$IMG_DIR/${month_name}${page_index}.png"
            mv -f "$page_file" "$target_file"
            page_index=$((page_index + 1))
        done
        shopt -u nullglob

        first_image="$IMG_DIR/${month_name}1.png"
        if [ -f "$first_image" ]; then
            echo "$first_image"
            return 0
        fi
    fi

    # Metoda 2: ImageMagick convert (fallback)
    if command -v convert >/dev/null 2>&1; then
        # -density = rozdzielczość DPI
        # -quality = jakość kompresji
        # -background white -alpha remove = białe tło zamiast przezroczystego
        run_with_timeout "$PDF_CONVERT_TIMEOUT" \
            convert -density "$PDF_CONVERT_DPI" "$pdf_path" \
                -quality 90 \
                -background white -alpha remove \
                -alpha off \
                "${output_prefix}-%03d.png" 2>>"$PDF_DIR/download.log"

        shopt -s nullglob
        page_index=1
        for page_file in "${output_prefix}-"*.png; do
            target_file="$IMG_DIR/${month_name}${page_index}.png"
            mv -f "$page_file" "$target_file"
            page_index=$((page_index + 1))
        done
        shopt -u nullglob

        first_image="$IMG_DIR/${month_name}1.png"
        if [ -f "$first_image" ]; then
            echo "$first_image"
            return 0
        fi
    fi

    # Metoda 3: gs (Ghostscript - fallback)
    if command -v gs >/dev/null 2>&1; then
          run_with_timeout "$PDF_CONVERT_TIMEOUT" \
                gs -dSAFER -dBATCH -dNOPAUSE \
                    -sDEVICE=png16m -r"$PDF_CONVERT_DPI" \
                    -sOutputFile="${output_prefix}-%03d.png" \
                    "$pdf_path" 2>>"$PDF_DIR/download.log"

        shopt -s nullglob
        page_index=1
        for page_file in "${output_prefix}-"*.png; do
            target_file="$IMG_DIR/${month_name}${page_index}.png"
            mv -f "$page_file" "$target_file"
            page_index=$((page_index + 1))
        done
        shopt -u nullglob

        first_image="$IMG_DIR/${month_name}1.png"
        if [ -f "$first_image" ]; then
            echo "$first_image"
            return 0
        fi
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') BŁĄD: Nie można skonwertować PDF. Zainstaluj pdftoppm, ImageMagick lub Ghostscript." >> "$PDF_DIR/download.log"
    return 1
}

open_media() {
    local path="$1"
    local ext
    ext="$(printf '%s' "${path##*.}" | tr '[:upper:]' '[:lower:]')"

    # W trybie OFFLINE tylko wyświetlamy istniejące pliki bez konwersji.
    if [ "$OFFLINE_MODE" -eq 1 ]; then
        if [ "$ext" = "pdf" ]; then
            if command -v xpdf >/dev/null 2>&1; then
                xpdf -fullscreen -z page "$path" &
            elif command -v evince >/dev/null 2>&1; then
                evince --fullscreen "$path" &
            else
                echo "$(date '+%Y-%m-%d %H:%M:%S') OFFLINE: Brak przeglądarki PDF (xpdf/evince)" >> "$PDF_DIR/download.log"
                return 1
            fi
        else
            open_image "$path"
        fi
        return 0
    fi

    if [ "$ext" = "pdf" ]; then
        # Konwertuj PDF na obrazek
        local converted_image
        converted_image="$(convert_pdf_to_image "$path")"
        
        if [ -n "$converted_image" ] && [ -f "$converted_image" ]; then
            # Wyświetl przekonwertowany obrazek w pełnym ekranie
            echo "$(date '+%Y-%m-%d %H:%M:%S') Wyświetlam PDF jako obraz: $converted_image" >> "$PDF_DIR/download.log"
            kill_viewers
            open_image "$converted_image"
        else
            # Fallback - spróbuj wyświetlić PDF bezpośrednio (jeśli konwersja się nie powiodła)
            echo "$(date '+%Y-%m-%d %H:%M:%S') UWAGA: Konwersja PDF nie powiodła się, próbuję wyświetlić bezpośrednio" >> "$PDF_DIR/download.log"
            kill_viewers
            if command -v xpdf >/dev/null 2>&1; then
                xpdf -fullscreen -z page "$path" &
            elif command -v evince >/dev/null 2>&1; then
                evince --fullscreen "$path" &
            else
                echo "$(date '+%Y-%m-%d %H:%M:%S') Brak przeglądarki PDF" >> "$PDF_DIR/download.log"
            fi
        fi
    else
        kill_viewers
        open_image "$path"
    fi
}

# [ZMIANA] Funkcja pobierająca NAJNOWSZY PDF ze strony (po dacie modyfikacji)
# W OFFLINE_MODE=1: natychmiast zwraca puste (żaden network call)
# W ONLINE_MODE: pobiera listę PDFs, sprawdza Last-Modified, zwraca URL najnowszego
fetch_newest_pdf_url() {
    if [ "$OFFLINE_MODE" -eq 1 ]; then
        return 0  # Offline mode: brak pobierania z sieci
    fi

    local page all_pdfs href url newest_url newest_timestamp current_timestamp temp_headers
    
    # Pobierz zwykly HTML strony
    page="$(curl -sS --connect-timeout 5 --max-time 15 "$TARGET_PAGE")"

    # Pobierz WSZYSTKIE href-y do PDF-ów
    all_pdfs="$(
        printf '%s' "$page" \
        | tr '\n' ' ' \
        | grep -Eoi 'href="[^"]+\.pdf"' \
        | sed -E 's/href="([^"]+\.pdf)"/\1/'
    )"

    newest_url=""
    newest_timestamp=0

    echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Szukam najnowszego PDF ze znalezionych plików..." >> "$PDF_DIR/download.log"

    # Dla każdego PDF-a, sprawdzaj datę Last-Modified
    while IFS= read -r href; do
        [ -z "$href" ] && continue
        
        # Zbuduj pełny URL
        if [[ "$href" =~ ^https?:// ]]; then
            url="$href"
        elif [[ "$href" =~ ^/ ]]; then
            url="${BASE_ORIGIN%/}$href"
        else
            url="${BASE_ORIGIN%/}/$href"
        fi
        
        echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Sprawdzam PDF: $url" >> "$PDF_DIR/download.log"
        
        # Pobierz TYLKO header Last-Modified (szybciej niż pełny -I)
        local last_modified
        last_modified="$(curl -sS --connect-timeout 5 --max-time 10 -I "$url" 2>/dev/null | grep -i "^last-modified:" | cut -d' ' -f2- | tr -d '\r')"
        
        if [ -n "$last_modified" ]; then
            # Konwertuj datę HTTP na timestamp Unix (obsługuje zarówno GNU date jak i BSD date)
            if date -d "$last_modified" +%s >/dev/null 2>&1; then
                # GNU date
                current_timestamp=$(date -d "$last_modified" +%s 2>/dev/null)
            elif date -j -f "%a, %d %b %Y %H:%M:%S %Z" "$last_modified" +%s >/dev/null 2>&1; then
                # BSD date (macOS)
                current_timestamp=$(date -j -f "%a, %d %b %Y %H:%M:%S %Z" "$last_modified" +%s 2>/dev/null)
            else
                echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Nie mogę sparsować daty: $last_modified" >> "$PDF_DIR/download.log"
                current_timestamp=0
            fi
            
            echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Last-Modified: $last_modified -> timestamp: $current_timestamp (aktualnie najnowszy: $newest_timestamp)" >> "$PDF_DIR/download.log"
            
            if [ "$current_timestamp" -gt "$newest_timestamp" ]; then
                newest_timestamp=$current_timestamp
                newest_url="$url"
                echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Nowy najnowszy PDF: $newest_url" >> "$PDF_DIR/download.log"
            fi
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Brak Last-Modified dla: $url" >> "$PDF_DIR/download.log"
        fi
    done <<< "$all_pdfs"

    echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Wybrany najnowszy PDF: $newest_url" >> "$PDF_DIR/download.log"
    echo "$newest_url"
}

# Buduje nazwę PDF w formacie: <miesiac><numer_strony>.pdf, np. marzec1.pdf
build_month_page_filename() {
    local source_name="$1"
    local month_num month_name page_num

    month_num=$((10#$(date +%m)))
    case "$month_num" in
        1) month_name="styczen" ;;
        2) month_name="luty" ;;
        3) month_name="marzec" ;;
        4) month_name="kwiecien" ;;
        5) month_name="maj" ;;
        6) month_name="czerwiec" ;;
        7) month_name="lipiec" ;;
        8) month_name="sierpien" ;;
        9) month_name="wrzesien" ;;
        10) month_name="pazdziernik" ;;
        11) month_name="listopad" ;;
        12) month_name="grudzien" ;;
        *) month_name="plik" ;;
    esac

    page_num=""
    if [[ "$source_name" =~ [Pp][Aa][Gg][Ee][-_]?([0-9]+) ]]; then
        page_num="${BASH_REMATCH[1]}"
    fi

    if [ -z "$page_num" ]; then
        page_num="1"
    fi

    echo "${month_name}${page_num}.pdf"
}

# Funkcja do pobrania PDF (obsługuje pełny URL lub samą nazwę pliku)
# W OFFLINE_MODE=1: natychmiast zwraca (żaden network call)
# W ONLINE_MODE: pobiera/aktualizuje PDF z sieci, przechowuje lokalnie
pobierz_pdf() {
    if [ "$OFFLINE_MODE" -eq 1 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Tryb offline - pomijam pobieranie plików z sieci" >> "$PDF_DIR/download.log"
        return 0  # Offline mode: brak pobierania z sieci
    fi

    local input="$1"
    local url name sciezka target_name
    local base_name

    if [[ "$input" =~ ^https?:// ]]; then
        url="$input"
        name="$(basename "$input")"
    else
        # Jeśli podano nazwę, dobuduj URL.
        name="${input%.pdf}.pdf"
        url="${BASE_URL%/}/$name"
    fi
    target_name="$(build_month_page_filename "$name")"
    sciezka="$PDF_DIR/$target_name"
    base_name="${target_name%.pdf}"

    echo "$(date '+%Y-%m-%d %H:%M:%S') Mapowanie nazwy PDF: $name -> $target_name" >> "$PDF_DIR/download.log"

    # Pobierz plik jeśli nie istnieje lub został zaktualizowany na serwerze
    echo "$(date '+%Y-%m-%d %H:%M:%S') Sprawdzam aktualizacje: $url" >> "$PDF_DIR/download.log"
    tmp="$sciezka.tmp"
    if [ -f "$sciezka" ]; then
        # -z pobiera tylko gdy zdalny plik jest nowszy
        http_code=$(curl -L -sS --connect-timeout 3 --max-time 12 -z "$sciezka" -w "%{http_code}" -o "$tmp" "$url" || echo "000")
        if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ] && [ -s "$tmp" ]; then
            mv "$tmp" "$sciezka"
            # Wymus przebudowanie cache obrazkow po aktualizacji PDF
            rm -f "${IMG_DIR}/${base_name}"*.png "$IMG_DIR/${base_name}.png"
            rm -f "/tmp/kiosk_fullscreen/${base_name}"_* 2>/dev/null || true
            echo "$(date '+%Y-%m-%d %H:%M:%S') Zaktualizowano PDF i wyczyszczono cache: $target_name" >> "$PDF_DIR/download.log"
        else
            rm -f "$tmp"
            if [ "$http_code" = "304" ]; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') Brak zmian: $target_name" >> "$PDF_DIR/download.log"
            elif [ "$http_code" != "000" ]; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') Błąd aktualizacji $url (HTTP $http_code)" >> "$PDF_DIR/download.log"
            fi
        fi
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') Pobieram $url" >> "$PDF_DIR/download.log"
        http_code=$(curl -L -sS --connect-timeout 3 --max-time 12 -w "%{http_code}" -o "$tmp" "$url" || echo "000")
        if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ] && [ -s "$tmp" ]; then
            mv "$tmp" "$sciezka"
        else
            rm -f "$tmp"
            echo "$(date '+%Y-%m-%d %H:%M:%S') Błąd pobierania $url (HTTP $http_code)" >> "$PDF_DIR/download.log"
        fi
    fi
}

# ========== INICJALIZACJA - OFFLINE vs ONLINE ==========
if [ "$OFFLINE_MODE" -eq 1 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ========== TRYB OFFLINE ==========" >> "$PDF_DIR/download.log"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Wyświetlam TYLKO pliki lokalne z: $PDF_DIR" >> "$PDF_DIR/download.log"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Brak połączeń sieciowych - skrypt będzie działać szybko bez timeout'ów" >> "$PDF_DIR/download.log"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') ========== TRYB ONLINE ==========" >> "$PDF_DIR/download.log"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Sprawdzam nowe pliki na: $TARGET_PAGE" >> "$PDF_DIR/download.log"
    FIRST_PDF_URL="$(fetch_newest_pdf_url)"
    if [ -n "$FIRST_PDF_URL" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Pobieranie PDF: $FIRST_PDF_URL" >> "$PDF_DIR/download.log"
        pobierz_pdf "$FIRST_PDF_URL"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') Brak nowych plików na serwerze, będę wyświetlać dostępne lokalnie" >> "$PDF_DIR/download.log"
    fi
fi

# Ustaw domyślną orientację ekranu na "right" (pionowo) przy starcie
echo "$(date '+%Y-%m-%d %H:%M:%S') Ustawiam orientację ekranu: normal (poziomo)" >> "$PDF_DIR/download.log"
rotate_display "normal" || echo "$(date '+%Y-%m-%d %H:%M:%S') UWAGA: Nie udało się obrócić ekranu" >> "$PDF_DIR/download.log"

# Przygotowanie pętli prezentacji: PDF + obrazy z katalogu
shopt -s nullglob nocaseglob

# ========== GŁÓWNA PĘTLA WYŚWIETLANIA ==========
# W każdej pętli: przeskanuj pliki, zastosuj filtr daty, wyświetlaj TIME_PER_ITEM sekund każdy
while true; do
    cleanup_fullscreen_cache

    # OFFLINE: ignoruj konwersje, filtry dat i całą logikę sieciową.
    # Wyświetlaj tylko lokalne pliki w prostej pętli.
    if [ "$OFFLINE_MODE" -eq 1 ]; then
        MEDIA_LIST=()

        for media_file in \
            "$IMG_DIR"/*.jpg "$IMG_DIR"/*.jpeg "$IMG_DIR"/*.png "$IMG_DIR"/*.gif "$IMG_DIR"/*.bmp "$IMG_DIR"/*.webp \
            "$PDF_DIR"/*.jpg "$PDF_DIR"/*.jpeg "$PDF_DIR"/*.png "$PDF_DIR"/*.gif "$PDF_DIR"/*.bmp "$PDF_DIR"/*.webp \
            "$PDF_DIR"/*.pdf; do
            [ -f "$media_file" ] || continue
            MEDIA_LIST+=("$media_file")
        done

        echo "$(date '+%Y-%m-%d %H:%M:%S') OFFLINE: znaleziono ${#MEDIA_LIST[@]} plików do wyświetlenia" >> "$PDF_DIR/download.log"

        if [ ${#MEDIA_LIST[@]} -eq 0 ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') OFFLINE: brak plików do wyświetlenia w $PDF_DIR i $IMG_DIR" >> "$PDF_DIR/download.log"
            sleep 5
            continue
        fi

        for MEDIA in "${MEDIA_LIST[@]}"; do
            ITEM_START_TS=$(date +%s)
            echo "$(date '+%Y-%m-%d %H:%M:%S') OFFLINE: wyświetlam plik: $MEDIA" >> "$PDF_DIR/download.log"
            if open_media "$MEDIA"; then
                sleep_for_duration "$TIME_PER_ITEM"
            else
                echo "$(date '+%Y-%m-%d %H:%M:%S') OFFLINE: błąd otwarcia pliku, pomijam długie oczekiwanie: $MEDIA" >> "$PDF_DIR/download.log"
                sleep 1
                continue
            fi
            ITEM_END_TS=$(date +%s)
            ITEM_DURATION=$((ITEM_END_TS - ITEM_START_TS))
            echo "$(date '+%Y-%m-%d %H:%M:%S') OFFLINE: czas ekspozycji: ${ITEM_DURATION}s (TIME_PER_ITEM=${TIME_PER_ITEM}s)" >> "$PDF_DIR/download.log"
        done

        continue
    fi

    # Najpierw przekonwertuj wszystkie PDF-y do obrazów
    for pdf_file in "$PDF_DIR"/*.pdf; do
        [ -f "$pdf_file" ] || continue
        convert_pdf_to_image "$pdf_file" >/dev/null 2>&1 || true
    done

    # Zbieraj dynamicznie listę istniejacych plikow (priorytet: converted -> obrazy -> PDF fallback)
    MEDIA_LIST=()
    declare -A seen_files
    declare -A has_converted

    for img_file in \
        "$IMG_DIR"/*.jpg "$IMG_DIR"/*.jpeg "$IMG_DIR"/*.png "$IMG_DIR"/*.gif "$IMG_DIR"/*.bmp "$IMG_DIR"/*.webp; do
        [ -f "$img_file" ] || continue
        base_name="$(basename "$img_file" | sed -E 's/\.(jpg|jpeg|png|gif|bmp|webp)$//')"
        MEDIA_LIST+=("$img_file")
        seen_files[$base_name]=1
        if [[ "$base_name" =~ ^(.+)_page-[0-9]+$ ]]; then
            has_converted["${BASH_REMATCH[1]}"]=1
        else
            has_converted[$base_name]=1
        fi
    done

    for img_file in \
        "$PDF_DIR"/*.jpg "$PDF_DIR"/*.jpeg "$PDF_DIR"/*.png "$PDF_DIR"/*.gif "$PDF_DIR"/*.bmp "$PDF_DIR"/*.webp; do
        [ -f "$img_file" ] || continue
        base_name="$(basename "$img_file" | sed -E 's/\.(jpg|jpeg|png|gif|bmp|webp)$//')"
        if [ -z "${seen_files[$base_name]}" ]; then
            MEDIA_LIST+=("$img_file")
            seen_files[$base_name]=1
        fi
    done

    for pdf_file in "$PDF_DIR"/*.pdf; do
        [ -f "$pdf_file" ] || continue
        base_name="$(basename "$pdf_file" .pdf)"
        if [ -n "${has_converted[$base_name]}" ]; then
            continue
        fi
        if [ -z "${seen_files[$base_name]}" ]; then
            MEDIA_LIST+=("$pdf_file")
            seen_files[$base_name]=1
        fi
    done

    # Debug: Loguj znalezione pliki
    echo "$(date '+%Y-%m-%d %H:%M:%S') Znaleziono ${#MEDIA_LIST[@]} plików do wyświetlenia" >> "$PDF_DIR/download.log"

    if [ ${#MEDIA_LIST[@]} -eq 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Brak plików do wyświetlenia w $PDF_DIR" >> "$PDF_DIR/download.log"
        sleep 5
        continue
    fi

    # Uniwersalny filtr mediów wg daty i miesiąca:
    # - dzień <= 15: wyświetlaj <miesiąc>1 i <miesiąc>2
    # - dzień > 15:  wyświetlaj <miesiąc>2 i <następny_miesiąc>1
    CURRENT_DAY="$(date +%d)"
    DAY_NUM=$((10#$CURRENT_DAY))
    CURRENT_MONTH_NUM=$((10#$(date +%m)))
    MONTH_INDEX=$((CURRENT_MONTH_NUM - 1))
    NEXT_MONTH_INDEX=$(((MONTH_INDEX + 1) % 12))

    # Warianty nazw miesięcy obsługiwane w nazwach plików:
    # - polskie pełne: luty1, marzec2
    # - polskie skróty:  lut1, mar2
    # - angielskie skróty (jak w `date` na Raspberry): feb1, mar2
    # - angielskie pełne: february1, march2
    MONTH_NAMES_PL=(
        "styczen" "luty" "marzec" "kwiecien" "maj" "czerwiec"
        "lipiec" "sierpien" "wrzesien" "pazdziernik" "listopad" "grudzien"
    )
    MONTH_SHORT_PL=(
        "sty" "lut" "mar" "kwi" "maj" "cze"
        "lip" "sie" "wrz" "paz" "lis" "gru"
    )
    MONTH_SHORT_EN=(
        "jan" "feb" "mar" "apr" "may" "jun"
        "jul" "aug" "sep" "oct" "nov" "dec"
    )
    MONTH_FULL_EN=(
        "january" "february" "march" "april" "may" "june"
        "july" "august" "september" "october" "november" "december"
    )

    CUR_PL="${MONTH_NAMES_PL[$MONTH_INDEX]}"
    CUR_PL_SHORT="${MONTH_SHORT_PL[$MONTH_INDEX]}"
    CUR_EN_SHORT="${MONTH_SHORT_EN[$MONTH_INDEX]}"
    CUR_EN_FULL="${MONTH_FULL_EN[$MONTH_INDEX]}"

    NEXT_PL="${MONTH_NAMES_PL[$NEXT_MONTH_INDEX]}"
    NEXT_PL_SHORT="${MONTH_SHORT_PL[$NEXT_MONTH_INDEX]}"
    NEXT_EN_SHORT="${MONTH_SHORT_EN[$NEXT_MONTH_INDEX]}"
    NEXT_EN_FULL="${MONTH_FULL_EN[$NEXT_MONTH_INDEX]}"

    ACTIVE_KEYS=()
    if [ "$DAY_NUM" -le 15 ]; then
        ACTIVE_KEYS+=("${CUR_PL}1" "${CUR_PL}2")
        ACTIVE_KEYS+=("${CUR_PL_SHORT}1" "${CUR_PL_SHORT}2")
        ACTIVE_KEYS+=("${CUR_EN_SHORT}1" "${CUR_EN_SHORT}2")
        ACTIVE_KEYS+=("${CUR_EN_FULL}1" "${CUR_EN_FULL}2")
    else
        ACTIVE_KEYS+=("${CUR_PL}2" "${NEXT_PL}1")
        ACTIVE_KEYS+=("${CUR_PL_SHORT}2" "${NEXT_PL_SHORT}1")
        ACTIVE_KEYS+=("${CUR_EN_SHORT}2" "${NEXT_EN_SHORT}1")
        ACTIVE_KEYS+=("${CUR_EN_FULL}2" "${NEXT_EN_FULL}1")
    fi

    FILTERED_MEDIA_LIST=()
    for MEDIA in "${MEDIA_LIST[@]}"; do
        file_name="$(basename "$MEDIA")"
        media_base="${file_name%.*}"

        # Dla przekonwertowanych stron PDF: Luty1_page-001 -> Luty1
        if [[ "$media_base" =~ ^(.+)_page-[0-9]+$ ]]; then
            media_base="${BASH_REMATCH[1]}"
        fi

        media_key="$(printf '%s' "$media_base" | tr '[:upper:]' '[:lower:]')"
        media_key="$(printf '%s' "$media_key" | sed -e 's/ą/a/g' -e 's/ć/c/g' -e 's/ę/e/g' -e 's/ł/l/g' -e 's/ń/n/g' -e 's/ó/o/g' -e 's/ś/s/g' -e 's/ź/z/g' -e 's/ż/z/g')"

        for key in "${ACTIVE_KEYS[@]}"; do
            if [ "$media_key" = "$key" ]; then
                FILTERED_MEDIA_LIST+=("$MEDIA")
                break
            fi
        done
    done

    echo "$(date '+%Y-%m-%d %H:%M:%S') Filtr daty: dzień=$DAY_NUM, miesiąc_nr=$CURRENT_MONTH_NUM, aktywne_klucze=${ACTIVE_KEYS[*]}, plików=${#FILTERED_MEDIA_LIST[@]}" >> "$PDF_DIR/download.log"

    if [ ${#FILTERED_MEDIA_LIST[@]} -eq 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Brak pasujących plików dla reguły daty (szukane: ${ACTIVE_KEYS[*]}). Fallback: odtwarzam wszystkie media (${#MEDIA_LIST[@]})." >> "$PDF_DIR/download.log"
        FILTERED_MEDIA_LIST=("${MEDIA_LIST[@]}")
    fi

    for MEDIA in "${FILTERED_MEDIA_LIST[@]}"; do
        ITEM_START_TS=$(date +%s)
        echo "$(date '+%Y-%m-%d %H:%M:%S') Przetwarzam plik: $MEDIA" >> "$PDF_DIR/download.log"
        if open_media "$MEDIA"; then
            sleep_for_duration "$TIME_PER_ITEM"
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') Błąd otwarcia pliku, pomijam długie oczekiwanie: $MEDIA" >> "$PDF_DIR/download.log"
            sleep 1
            continue
        fi
        ITEM_END_TS=$(date +%s)
        ITEM_DURATION=$((ITEM_END_TS - ITEM_START_TS))
        echo "$(date '+%Y-%m-%d %H:%M:%S') Czas ekspozycji: ${ITEM_DURATION}s (TIME_PER_ITEM=${TIME_PER_ITEM}s)" >> "$PDF_DIR/download.log"
    done
done
