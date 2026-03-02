#!/bin/bash
# start_app.sh

# Katalog tymczasowy na pobrane PDF-y
PDF_DIR="/home/kiosk/MediaPionowe"
mkdir -p "$PDF_DIR"

# Adres bazowy katalogu z załącznikami (lista PDF-ów będzie z tego parsowana)
BASE_URL="https://arm.siedlce.pl/storage/attachments/"

# [NOWE] Strona z przyciskiem "siłownia" oraz origin do budowy pełnego URL
BASE_ORIGIN="https://arm.siedlce.pl"
TARGET_PAGE="https://arm.siedlce.pl/pl/silownia-stadion"

# Funkcja: znajdź wszystkie PDF-y pod BASE_URL (parsowanie listingu HTML)
fetch_pdf_urls() {
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

# [ZMIANA] Zastąp funkcję 'fetch_silownia_pdf_url' funkcją wyszukującą pierwszy PDF na stronie
fetch_first_pdf_url() {
    local page href url

    # Spróbuj pobrać źródło przez view-source:, a jeśli brak treści – zwykły URL
    page="$(curl -sS "view-source:$TARGET_PAGE")"
    if [ -z "$page" ]; then
        page="$(curl -sS "$TARGET_PAGE")"
    fi

    # Weź pierwszy href do .pdf w kolejności wystąpienia
    href="$(
        printf '%s' "$page" \
        | tr '\n' ' ' \
        | grep -Eoi 'href="[^"]+\.pdf"' \
        | sed -E 's/href="([^"]+\.pdf)"/\1/' \
        | head -n1
    )"

    # Zbuduj pełny URL
    if [[ -z "$href" ]]; then
        echo ""
        return
    fi
    if [[ "$href" =~ ^https?:// ]]; then
        url="$href"
    elif [[ "$href" =~ ^/ ]]; then
        url="${BASE_ORIGIN%/}$href"
    else
        url="${BASE_ORIGIN%/}/$href"
    fi
    echo "$url"
}

# Funkcja do pobrania PDF (obsługuje pełny URL lub samą nazwę pliku)
pobierz_pdf() {
    local input="$1"
    local url name sciezka

    if [[ "$input" =~ ^https?:// ]]; then
        url="$input"
        name="$(basename "$input")"
    else
        # Jeśli podano nazwę, dobuduj URL.
        name="${input%.pdf}.pdf"
        url="${BASE_URL%/}/$name"
    fi
    sciezka="$PDF_DIR/$name"

    # Pobierz plik jeśli nie istnieje
    if [ ! -f "$sciezka" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Pobieram $url" >> "$PDF_DIR/download.log"
        tmp="$sciezka.tmp"
        http_code=$(curl -L -sS -w "%{http_code}" -o "$tmp" "$url" || echo "000")
        if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ] && [ -s "$tmp" ]; then
            mv "$tmp" "$sciezka"
        else
            rm -f "$tmp"
            echo "$(date '+%Y-%m-%d %H:%M:%S') Błąd pobierania $url (HTTP $http_code)" >> "$PDF_DIR/download.log"
        fi
    fi
}

# [ZMIANA] Użyj nowej funkcji i zrezygnuj z wyszukiwania po "siłownia"
FIRST_PDF_URL="$(fetch_first_pdf_url)"
if [ -z "$FIRST_PDF_URL" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Nie znaleziono żadnego PDF na $TARGET_PAGE - przerywam" >> "$PDF_DIR/download.log"
    exit 1
fi

# Pobierz wyłącznie ten jeden plik
pobierz_pdf "$FIRST_PDF_URL"

# Przygotuj listę wyłącznie z tym jednym PDF-em
NAME="$(basename "$FIRST_PDF_URL")"
PDF_LIST=("$PDF_DIR/$NAME")
if [ ! -f "${PDF_LIST[0]}" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Brak pobranego pliku: ${PDF_LIST[0]}" >> "$PDF_DIR/download.log"
    exit 1
fi

# Indeks aktualnie wyświetlanego PDF
INDEX=0
NUM_FILES=${#PDF_LIST[@]}

# Pętla główna wyświetlania PDF-ów
while true; do
    PDF="${PDF_LIST[$INDEX]}"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Otwieram plik: $PDF" >> "$PDF_DIR/download.log"

    # Zabij poprzedni proces xpdf
    pkill -f xpdf

    # Uruchom xpdf w pełnym ekranie
    xpdf -fullscreen "$PDF" &

    # Przejdź do następnego pliku
    INDEX=$(( (INDEX + 1) % NUM_FILES ))

    # Czas wyświetlania PDF (w sekundach)
    sleep 15
done
