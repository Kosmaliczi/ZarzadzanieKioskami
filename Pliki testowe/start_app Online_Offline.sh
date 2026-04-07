#!/bin/bash
set +e

# ============================================================
# KIOSK SCRIPT: ONLINE / OFFLINE
# - ONLINE_MODE=1: pelna funkcjonalnosc
# - ONLINE_MODE=0: tylko lokalny pokaz obrazow z IMG_DIR
# ============================================================

# start_app Online_Offline.sh
# ONLINE_MODE=1 -> pelna funkcjonalnosc (jak start_app.sh)
# ONLINE_MODE=0 -> tylko wyswietlanie obrazow z IMG_DIR

# [SEKCJA] Podstawowe sciezki i logi
PDF_DIR="/home/kiosk/MediaPionowe"
IMG_DIR="/home/kiosk/MediaPionowe/converted"
LOG_FILE="$PDF_DIR/download.log"

mkdir -p "$PDF_DIR"
mkdir -p "$IMG_DIR"

# Blokada pojedynczej instancji
LOCK_DIR="/tmp/start_app_online_offline.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"

# [SEKCJA] Kontrola pojedynczej instancji
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
            echo "$(date '+%Y-%m-%d %H:%M:%S') start_app Online_Offline.sh juz dziala (PID=$existing_pid)." >> "$LOG_FILE"
            return 1
        fi
    fi

    rm -rf "$LOCK_DIR" 2>/dev/null || true
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$LOCK_PID_FILE"
        trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
        return 0
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') Blad: nie udalo sie zalozyc locka pojedynczej instancji." >> "$LOG_FILE"
    return 1
}

if ! acquire_single_instance_lock; then
    exit 0
fi

if [ -z "$DISPLAY" ]; then
    export DISPLAY=:0
fi

# [SEKCJA] Ustawienia ekranu (X11)
# Zapobiega wygaszaniu ekranu/DPMS
if command -v xset >/dev/null 2>&1; then
    xset -display "$DISPLAY" s off >/dev/null 2>&1 || true
    xset -display "$DISPLAY" -dpms >/dev/null 2>&1 || true
    xset -display "$DISPLAY" s noblank >/dev/null 2>&1 || true
fi

# Konfiguracja sieci dla trybu ONLINE_MODE=1
BASE_URL="https://arm.siedlce.pl/storage/attachments/"
BASE_ORIGIN="https://arm.siedlce.pl"
TARGET_PAGE="https://arm.siedlce.pl/pl/silownia-stadion"

# [SEKCJA] Tryby pracy i argumenty uruchomienia
# Sterowanie jednym parametrem:
# ONLINE_MODE=1 -> pelna funkcjonalnosc
# ONLINE_MODE=0 -> tylko obrazy z IMG_DIR
ONLINE_MODE="${ONLINE_MODE:-1}"

if [ "$1" = "offline" ]; then
    ONLINE_MODE=0
elif [ "$1" = "online" ]; then
    ONLINE_MODE=1
fi

# Obsluga polecenia obrotu niezaleznie od trybu
if [ "$1" = "rotate-display" ] || [ "$1" = "rotate" ]; then
    ROTATE_REQUEST=1
else
    ROTATE_REQUEST=0
fi

# [SEKCJA] Walidacje i konfiguracja czasu
validate_online_mode() {
    if ! [[ "$ONLINE_MODE" =~ ^[01]$ ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Nieprawidlowe ONLINE_MODE='$ONLINE_MODE'. Ustawiam 1." >> "$LOG_FILE"
        ONLINE_MODE=1
    fi
}

TIME_PER_ITEM=30
PDF_CONVERT_TIMEOUT=25
PDF_CONVERT_DPI=150

# TIME_PER_ITEM musi byc dodatnia liczba calkowita.
validate_time_per_item() {
    if ! [[ "$TIME_PER_ITEM" =~ ^[1-9][0-9]*$ ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Nieprawidlowe TIME_PER_ITEM='$TIME_PER_ITEM'. Ustawiam 30." >> "$LOG_FILE"
        TIME_PER_ITEM=30
    fi
}

# Sleep odporny na przerwania sygnalem.
sleep_for_duration() {
    local duration="$1"
    local end_ts now remaining

    end_ts=$(( $(date +%s) + duration ))
    while true; do
        now=$(date +%s)
        remaining=$(( end_ts - now ))
        [ "$remaining" -le 0 ] && break
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

# [SEKCJA] Rotacja ekranu
rotate_display() {
    local raw="$1"
    local o

    o="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
    case "$o" in
        0|normal|n|norm) o="normal" ;;
        right|r) o="right" ;;
        left|l) o="left" ;;
        inverted|i|180) o="inverted" ;;
        *)
            echo "Nieprawidlowa orientacja: '$raw'. Dozwolone: right | 0 | normal | left | inverted" >&2
            return 2
            ;;
    esac

    if [ -z "$DISPLAY" ]; then
        export DISPLAY=:0
    fi

    if ! command -v xrandr >/dev/null 2>&1; then
# Uruchamia polecenie z timeoutem, jesli narzedzie timeout istnieje.
        echo "Brak polecenia xrandr w PATH" >&2
        return 3
    fi

    if ! xrandr -o "$o" 2>"$PDF_DIR/rotate.err" 1>"$PDF_DIR/rotate.out"; then
        echo "Blad wykonywania xrandr -o $o" >&2
        return 4
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') Ekran obrocony na: $o" >> "$LOG_FILE"
    return 0
}

# Tryb serwisowy: sam obrot ekranu i wyjscie.
if [ "$ROTATE_REQUEST" -eq 1 ]; then
    if [ -z "$2" ]; then
        echo "Uzycie: $0 rotate-display <right|0|normal|left|inverted>" >&2
        exit 2
    fi
    rotate_display "$2"
    exit $?
fi

# [SEKCJA] Detekcja i obsluga viewerow
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
PERSISTENT_VIEWER_PID=""
MEDIA_SIGNATURE=""

# Sprawdza, czy proces o danym PID nadal zyje.
is_pid_alive() {
    local pid="$1"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Podpis listy mediow (do wykrycia zmian w katalogu).
compute_media_signature() {
    printf '%s\n' "$@" | cksum | awk '{print $1":"$2}'
}

# Persistent slideshow dla feh - jeden proces odtwarza cala liste.
start_persistent_feh() {
    feh -F --zoom fill -D "$TIME_PER_ITEM" "$@" >/dev/null 2>&1 &
    PERSISTENT_VIEWER_PID="$!"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Started persistent feh PID=$PERSISTENT_VIEWER_PID, files=$#" >> "$LOG_FILE"
}

# Rozdzielczosc ekranu z xrandr, fallback 1920x1080.
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

# Przygotowanie obrazu typu cover pod pelny ekran (z cache).
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

    if [ -f "$out" ] && [ "$out" -nt "$src" ]; then
        echo "$out"
        return 0
    fi

    if command -v convert >/dev/null 2>&1; then
        convert "$src" \
            -resize "${res}^" \
            -gravity center -extent "$res" \
            "$out" 2>>"$LOG_FILE"
        if [ -f "$out" ]; then
            echo "$out"
            return 0
        fi
    fi

    echo "$src"
}

# Czyszczenie przeterminowanego cache obrazow fullscreen.
cleanup_fullscreen_cache() {
    if [ -d "/tmp/kiosk_fullscreen" ]; then
        find "/tmp/kiosk_fullscreen" -type f -mmin +60 -delete 2>/dev/null || true
    fi
}

# Zamknij potencjalnie uruchomione procesy viewerow.
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

# Otwiera obraz w zaleznosci od dostepnego viewera.
open_image() {
    local img="$1"
    local prepared
    case "$IMG_VIEWER" in
        feh)
            feh -F --zoom fill "$img" >/dev/null 2>&1 &
            ;;
        imv)
            imv -f -s full "$img" >/dev/null 2>&1 &
            ;;
        eog)
            prepared="$(prepare_fullscreen_image "$img")"
            eog --fullscreen "$prepared" >/dev/null 2>&1 &
            ;;
        display)
            prepared="$(prepare_fullscreen_image "$img")"
            display -window root "$prepared" >/dev/null 2>&1 &
            ;;
        *)
            echo "$(date '+%Y-%m-%d %H:%M:%S') Brak przegladarki obrazow (feh/imv/eog/display)." >> "$LOG_FILE"
            return 1
            ;;
    esac
    return 0
}

# Zbiera tylko obrazy z katalogu IMG_DIR (uzywane glownie w ONLINE_MODE=0).
collect_images_from_img_dir() {
    local files=()
    local media_file

    shopt -s nullglob nocaseglob
    for media_file in \
        "$IMG_DIR"/*.jpg "$IMG_DIR"/*.jpeg "$IMG_DIR"/*.png \
        "$IMG_DIR"/*.gif "$IMG_DIR"/*.bmp "$IMG_DIR"/*.webp; do
        [ -f "$media_file" ] || continue
        files+=("$media_file")
    done
    shopt -u nullglob nocaseglob

    printf '%s\n' "${files[@]}"
}

# [SEKCJA] Konwersja PDF -> obraz (kolejno: pdftoppm, convert, gs)
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

    if [ -n "$first_image" ] && [ "$first_image" -nt "$pdf_path" ]; then
        echo "$first_image"
        return 0
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') Konwertuje PDF na obrazy: $pdf_name" >> "$LOG_FILE"

    rm -f "${output_prefix}-"*.png 2>/dev/null || true
    rm -f "$IMG_DIR/${month_name}"*.png 2>/dev/null || true

    if command -v pdftoppm >/dev/null 2>&1; then
        run_with_timeout "$PDF_CONVERT_TIMEOUT" \
            pdftoppm -png -r "$PDF_CONVERT_DPI" "$pdf_path" "$output_prefix" 2>>"$LOG_FILE"

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

    if command -v convert >/dev/null 2>&1; then
        run_with_timeout "$PDF_CONVERT_TIMEOUT" \
            convert -density "$PDF_CONVERT_DPI" "$pdf_path" \
                -quality 90 \
                -background white -alpha remove \
                -alpha off \
                "${output_prefix}-%03d.png" 2>>"$LOG_FILE"

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

    if command -v gs >/dev/null 2>&1; then
        run_with_timeout "$PDF_CONVERT_TIMEOUT" \
            gs -dSAFER -dBATCH -dNOPAUSE \
                -sDEVICE=png16m -r"$PDF_CONVERT_DPI" \
                -sOutputFile="${output_prefix}-%03d.png" \
                "$pdf_path" 2>>"$LOG_FILE"

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

    echo "$(date '+%Y-%m-%d %H:%M:%S') BLAD: Nie mozna skonwertowac PDF. Zainstaluj pdftoppm, ImageMagick lub Ghostscript." >> "$LOG_FILE"
    return 1
}

# Punkt wejscia wyswietlania pojedynczego medium.
open_media() {
    local path="$1"
    local ext
    ext="$(printf '%s' "${path##*.}" | tr '[:upper:]' '[:lower:]')"

    if [ "$ONLINE_MODE" -eq 0 ]; then
        if [ "$ext" = "pdf" ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') ONLINE_MODE=0: pomijam PDF: $path" >> "$LOG_FILE"
            return 1
        fi
        kill_viewers
        open_image "$path"
        return $?
    fi

    if [ "$ext" = "pdf" ]; then
        local converted_image
        converted_image="$(convert_pdf_to_image "$path")"

        if [ -n "$converted_image" ] && [ -f "$converted_image" ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') Wyswietlam PDF jako obraz: $converted_image" >> "$LOG_FILE"
            kill_viewers
            open_image "$converted_image"
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') UWAGA: Konwersja PDF nie powiodla sie, probuje wyswietlic bezposrednio." >> "$LOG_FILE"
            kill_viewers
            if command -v xpdf >/dev/null 2>&1; then
                xpdf -fullscreen -z page "$path" >/dev/null 2>&1 &
            elif command -v evince >/dev/null 2>&1; then
                evince --fullscreen "$path" >/dev/null 2>&1 &
            else
                echo "$(date '+%Y-%m-%d %H:%M:%S') Brak przegladarki PDF." >> "$LOG_FILE"
            fi
        fi
    else
        kill_viewers
        open_image "$path"
    fi
}

# [SEKCJA] Funkcje sieciowe (aktywne przy ONLINE_MODE=1)
fetch_pdf_urls() {
    if [ "$ONLINE_MODE" -ne 1 ]; then
        return 0
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

# Znajduje najnowszy PDF po naglowku Last-Modified.
fetch_newest_pdf_url() {
    if [ "$ONLINE_MODE" -ne 1 ]; then
        return 0
    fi

    local page all_pdfs href url newest_url newest_timestamp current_timestamp page_size

    echo "$(date '+%Y-%m-%d %H:%M:%S') Pobieranie strony: $TARGET_PAGE" >> "$LOG_FILE"
    
    page="$(curl -sS --connect-timeout 5 --max-time 15 "$TARGET_PAGE" 2>"$PDF_DIR/curl.err")"
    page_size="${#page}"
    
    echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Rozmiar pobranej strony: $page_size bajtow" >> "$LOG_FILE"
    
    if [ "$page_size" -lt 100 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') UWAGA: Strona wydaje sie pusta lub nie pobrana. Curl error:" >> "$LOG_FILE"
        cat "$PDF_DIR/curl.err" >> "$LOG_FILE"
        return 0
    fi

    # Szukaj PDF-ow na stronie - proba roznych wzorców
    all_pdfs="$({
        printf '%s' "$page" \
        | tr '\n' ' ' \
        | grep -Eio 'href="[^"]*\.pdf"' \
        | sed -E 's/href="([^"]+\.pdf)"/\1/'
    })"

    echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Znalezione PDF-y: $(printf '%s' "$all_pdfs" | wc -l) plikow" >> "$LOG_FILE"
    printf '%s\n' "$all_pdfs" | while read -r line; do
        [ -n "$line" ] && echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: PDF link: $line" >> "$LOG_FILE"
    done

    newest_url=""
    newest_timestamp=0

    echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Szukam najnowszego PDF ze znalezionych plikow..." >> "$LOG_FILE"

    while IFS= read -r href; do
        [ -z "$href" ] && continue

        if [[ "$href" =~ ^https?:// ]]; then
            url="$href"
        elif [[ "$href" =~ ^/ ]]; then
            url="${BASE_ORIGIN%/}$href"
        else
            url="${BASE_ORIGIN%/}/$href"
        fi

        echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Sprawdzam PDF: $url" >> "$LOG_FILE"

        local last_modified
        last_modified="$(curl -sS --connect-timeout 5 --max-time 10 -I "$url" 2>/dev/null | grep -i "^last-modified:" | cut -d' ' -f2- | tr -d '\r')"

        if [ -n "$last_modified" ]; then
            if date -d "$last_modified" +%s >/dev/null 2>&1; then
                current_timestamp=$(date -d "$last_modified" +%s 2>/dev/null)
            elif date -j -f "%a, %d %b %Y %H:%M:%S %Z" "$last_modified" +%s >/dev/null 2>&1; then
                current_timestamp=$(date -j -f "%a, %d %b %Y %H:%M:%S %Z" "$last_modified" +%s 2>/dev/null)
            else
                echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Nie moge sparsowac daty: $last_modified" >> "$LOG_FILE"
                current_timestamp=0
            fi

            echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Last-Modified: $last_modified -> timestamp: $current_timestamp (aktualnie najnowszy: $newest_timestamp)" >> "$LOG_FILE"

            if [ "$current_timestamp" -gt "$newest_timestamp" ]; then
                newest_timestamp=$current_timestamp
                newest_url="$url"
                echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Nowy najnowszy PDF: $newest_url" >> "$LOG_FILE"
            fi
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Brak Last-Modified dla: $url" >> "$LOG_FILE"
        fi
    done <<< "$all_pdfs"

    echo "$(date '+%Y-%m-%d %H:%M:%S') DEBUG: Wybrany najnowszy PDF: $newest_url" >> "$LOG_FILE"
    echo "$newest_url"
}

# Buduje lokalna nazwe pliku PDF: <miesiac><numer_strony>.pdf
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

# Pobiera/aktualizuje PDF i odswieza cache po zmianie pliku.
pobierz_pdf() {
    if [ "$ONLINE_MODE" -ne 1 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') ONLINE_MODE=0 - pomijam pobieranie plikow z sieci." >> "$LOG_FILE"
        return 0
    fi

    local input="$1"
    local url name sciezka target_name base_name tmp http_code

    if [[ "$input" =~ ^https?:// ]]; then
        url="$input"
        name="$(basename "$input")"
    else
        name="${input%.pdf}.pdf"
        url="${BASE_URL%/}/$name"
    fi

    target_name="$(build_month_page_filename "$name")"
    sciezka="$PDF_DIR/$target_name"
    base_name="${target_name%.pdf}"

    echo "$(date '+%Y-%m-%d %H:%M:%S') Mapowanie nazwy PDF: $name -> $target_name" >> "$LOG_FILE"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Sprawdzam aktualizacje: $url" >> "$LOG_FILE"

    tmp="$sciezka.tmp"
    if [ -f "$sciezka" ]; then
        http_code=$(curl -L -sS --connect-timeout 3 --max-time 12 -z "$sciezka" -w "%{http_code}" -o "$tmp" "$url" || echo "000")
        if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ] && [ -s "$tmp" ]; then
            mv "$tmp" "$sciezka"
            rm -f "${IMG_DIR}/${base_name}"*.png "$IMG_DIR/${base_name}.png"
            rm -f "/tmp/kiosk_fullscreen/${base_name}"_* 2>/dev/null || true
            echo "$(date '+%Y-%m-%d %H:%M:%S') Zaktualizowano PDF i wyczyszczono cache: $target_name" >> "$LOG_FILE"
        else
            rm -f "$tmp"
            if [ "$http_code" = "304" ]; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') Brak zmian: $target_name" >> "$LOG_FILE"
            elif [ "$http_code" != "000" ]; then
                echo "$(date '+%Y-%m-%d %H:%M:%S') Blad aktualizacji $url (HTTP $http_code)" >> "$LOG_FILE"
            fi
        fi
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') Pobieram $url" >> "$LOG_FILE"
        http_code=$(curl -L -sS --connect-timeout 3 --max-time 12 -w "%{http_code}" -o "$tmp" "$url" || echo "000")
        if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ] && [ -s "$tmp" ]; then
            mv "$tmp" "$sciezka"
        else
            rm -f "$tmp"
            echo "$(date '+%Y-%m-%d %H:%M:%S') Blad pobierania $url (HTTP $http_code)" >> "$LOG_FILE"
        fi
    fi
}

# [SEKCJA] Inicjalizacja wykonania
validate_online_mode
validate_time_per_item

echo "$(date '+%Y-%m-%d %H:%M:%S') Start skryptu PID=$$ ONLINE_MODE=$ONLINE_MODE TIME_PER_ITEM=${TIME_PER_ITEM}s" >> "$LOG_FILE"

if [ -z "$IMG_VIEWER" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') BLAD: brak wspieranej przegladarki obrazow (feh/imv/eog/display)." >> "$LOG_FILE"
    exit 1
fi

# Licznik do regularnego sprawdzania nowych plikow w Mode ONLINE
FETCH_COUNTER=0
FETCH_INTERVAL=3  # Sprawdzaj co 3 iteracje petli

if [ "$ONLINE_MODE" -eq 1 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ========== ONLINE_MODE=1 (PELNA FUNKCJONALNOSC) ==========" >> "$LOG_FILE"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Sprawdzam nowe pliki na: $TARGET_PAGE" >> "$LOG_FILE"
    FIRST_PDF_URL="$(fetch_newest_pdf_url)"
    if [ -n "$FIRST_PDF_URL" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Pobieranie PDF: $FIRST_PDF_URL" >> "$LOG_FILE"
        pobierz_pdf "$FIRST_PDF_URL"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') Brak nowych plikow na serwerze, wyswietlam dostepne lokalnie." >> "$LOG_FILE"
    fi
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') ========== ONLINE_MODE=0 (TYLKO OBRAZY Z IMG_DIR) ==========" >> "$LOG_FILE"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Brak operacji sieciowych i brak obslugi PDF. Katalog obrazow: $IMG_DIR" >> "$LOG_FILE"
fi

# Wspolna akcja startowa: orientacja ekranu.
echo "$(date '+%Y-%m-%d %H:%M:%S') Ustawiam orientacje ekranu: normal" >> "$LOG_FILE"
rotate_display "normal" || echo "$(date '+%Y-%m-%d %H:%M:%S') UWAGA: Nie udalo sie obrocic ekranu." >> "$LOG_FILE"

shopt -s nullglob nocaseglob

# [SEKCJA] Glowna petla odtwarzania
# ONLINE_MODE=0: tylko obrazy z IMG_DIR
# ONLINE_MODE=1: pelna logika mediow + filtr daty
while true; do
    # W trybie ONLINE, regularnie sprawdzaj nowe pliki
    if [ "$ONLINE_MODE" -eq 1 ]; then
        FETCH_COUNTER=$((FETCH_COUNTER + 1))
        if [ "$FETCH_COUNTER" -ge "$FETCH_INTERVAL" ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') Sprawdzenie nowych plikow (iteracja $FETCH_COUNTER)..." >> "$LOG_FILE"
            NEWEST_URL="$(fetch_newest_pdf_url)"
            if [ -n "$NEWEST_URL" ]; then
                pobierz_pdf "$NEWEST_URL"
            fi
            FETCH_COUNTER=0
        fi
    fi
    cleanup_fullscreen_cache

    if [ "$ONLINE_MODE" -eq 0 ]; then
        # Szybka sciezka lokalna bez PDF i bez sieci.
        mapfile -t MEDIA_LIST < <(collect_images_from_img_dir)

        echo "$(date '+%Y-%m-%d %H:%M:%S') ONLINE_MODE=0: znaleziono ${#MEDIA_LIST[@]} obrazow w $IMG_DIR" >> "$LOG_FILE"

        if [ ${#MEDIA_LIST[@]} -eq 0 ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') ONLINE_MODE=0: brak obrazow do wyswietlenia." >> "$LOG_FILE"
            sleep 5
            continue
        fi

        if [ "$IMG_VIEWER" = "feh" ]; then
            CURRENT_SIGNATURE="$(compute_media_signature "${MEDIA_LIST[@]}")"
            if ! is_pid_alive "$PERSISTENT_VIEWER_PID" || [ "$CURRENT_SIGNATURE" != "$MEDIA_SIGNATURE" ]; then
                if is_pid_alive "$PERSISTENT_VIEWER_PID"; then
                    kill "$PERSISTENT_VIEWER_PID" 2>/dev/null || true
                    sleep 1
                fi
                start_persistent_feh "${MEDIA_LIST[@]}"
                MEDIA_SIGNATURE="$CURRENT_SIGNATURE"
            fi
            sleep 5
            continue
        fi

        for MEDIA in "${MEDIA_LIST[@]}"; do
            ITEM_START_TS=$(date +%s)
            kill_viewers
            echo "$(date '+%Y-%m-%d %H:%M:%S') ONLINE_MODE=0: wyswietlam obraz: $MEDIA" >> "$LOG_FILE"
            if open_image "$MEDIA"; then
                sleep_for_duration "$TIME_PER_ITEM"
            else
                echo "$(date '+%Y-%m-%d %H:%M:%S') ONLINE_MODE=0: blad otwarcia obrazu: $MEDIA" >> "$LOG_FILE"
                sleep 1
                continue
            fi
            ITEM_END_TS=$(date +%s)
            ITEM_DURATION=$((ITEM_END_TS - ITEM_START_TS))
            echo "$(date '+%Y-%m-%d %H:%M:%S') ONLINE_MODE=0: czas ekspozycji: ${ITEM_DURATION}s" >> "$LOG_FILE"
        done

        continue
    fi

    # ONLINE_MODE=1: pre-konwersja lokalnych PDF.
    for pdf_file in "$PDF_DIR"/*.pdf; do
        [ -f "$pdf_file" ] || continue
        convert_pdf_to_image "$pdf_file" >/dev/null 2>&1 || true
    done

    # Kolejnosc zrodel: obrazy skonwertowane -> obrazy natywne -> PDF fallback.
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

    echo "$(date '+%Y-%m-%d %H:%M:%S') Znaleziono ${#MEDIA_LIST[@]} plikow do wyswietlenia" >> "$LOG_FILE"

    if [ ${#MEDIA_LIST[@]} -eq 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Brak plikow do wyswietlenia w $PDF_DIR" >> "$LOG_FILE"
        sleep 5
        continue
    fi

    # Regula datowa dla aktywnych nazw mediow.
    CURRENT_DAY="$(date +%d)"
    DAY_NUM=$((10#$CURRENT_DAY))
    CURRENT_MONTH_NUM=$((10#$(date +%m)))
    MONTH_INDEX=$((CURRENT_MONTH_NUM - 1))
    NEXT_MONTH_INDEX=$(((MONTH_INDEX + 1) % 12))

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

    # Filtrowanie mediow po aktywnych kluczach daty.
    FILTERED_MEDIA_LIST=()
    for MEDIA in "${MEDIA_LIST[@]}"; do
        file_name="$(basename "$MEDIA")"
        media_base="${file_name%.*}"

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

    echo "$(date '+%Y-%m-%d %H:%M:%S') Filtr daty: dzien=$DAY_NUM, miesiac_nr=$CURRENT_MONTH_NUM, aktywne_klucze=${ACTIVE_KEYS[*]}, plikow=${#FILTERED_MEDIA_LIST[@]}" >> "$LOG_FILE"

    if [ ${#FILTERED_MEDIA_LIST[@]} -eq 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Brak pasujacych plikow dla reguly daty. Fallback: odtwarzam wszystkie media (${#MEDIA_LIST[@]})." >> "$LOG_FILE"
        FILTERED_MEDIA_LIST=("${MEDIA_LIST[@]}")
    fi

    # Odtwarzanie kazdego medium przez TIME_PER_ITEM.
    for MEDIA in "${FILTERED_MEDIA_LIST[@]}"; do
        ITEM_START_TS=$(date +%s)
        echo "$(date '+%Y-%m-%d %H:%M:%S') Przetwarzam plik: $MEDIA" >> "$LOG_FILE"
        if open_media "$MEDIA"; then
            sleep_for_duration "$TIME_PER_ITEM"
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') Blad otwarcia pliku, pomijam dlugie oczekiwanie: $MEDIA" >> "$LOG_FILE"
            sleep 1
            continue
        fi
        ITEM_END_TS=$(date +%s)
        ITEM_DURATION=$((ITEM_END_TS - ITEM_START_TS))
        echo "$(date '+%Y-%m-%d %H:%M:%S') Czas ekspozycji: ${ITEM_DURATION}s (TIME_PER_ITEM=${TIME_PER_ITEM}s)" >> "$LOG_FILE"
    done
done
