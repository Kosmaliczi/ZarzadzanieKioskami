#!/bin/bash
set +e

# Offline-only kiosk display script.
# No internet access, no PDF handling, only images from IMG_DIR.

IMG_DIR="/home/kiosk/MediaPionowe/converted"
TIME_PER_ITEM=45
LOG_FILE="/home/kiosk/MediaPionowe/offline_display.log"

mkdir -p "$IMG_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

# Single instance lock
LOCK_DIR="/tmp/start_app_offline.lock"
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
            echo "$(date '+%Y-%m-%d %H:%M:%S') Script already running (PID=$existing_pid)." >> "$LOG_FILE"
            return 1
        fi
    fi

    rm -rf "$LOCK_DIR" 2>/dev/null || true
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$LOCK_PID_FILE"
        trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
        return 0
    fi

    echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: failed to create lock." >> "$LOG_FILE"
    return 1
}

if ! acquire_single_instance_lock; then
    exit 0
fi

if [ -z "$DISPLAY" ]; then
    export DISPLAY=:0
fi

# Prevent X11 screensaver/DPMS blackouts
if command -v xset >/dev/null 2>&1; then
    xset -display "$DISPLAY" s off >/dev/null 2>&1 || true
    xset -display "$DISPLAY" -dpms >/dev/null 2>&1 || true
    xset -display "$DISPLAY" s noblank >/dev/null 2>&1 || true
fi

validate_time_per_item() {
    if ! [[ "$TIME_PER_ITEM" =~ ^[1-9][0-9]*$ ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Invalid TIME_PER_ITEM='$TIME_PER_ITEM', using 45." >> "$LOG_FILE"
        TIME_PER_ITEM=45
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
        sleep "$remaining" || true
    done
}

rotate_display() {
    local raw="$1"
    local o

    o="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
    case "$o" in
        0|normal|n|norm) o="normal" ;;
        right|r) o="right" ;;
        left|l) o="left" ;;
        inverted|i|180) o="inverted" ;;
        *) echo "Invalid orientation: '$raw'" >&2; return 2 ;;
    esac

    if ! command -v xrandr >/dev/null 2>&1; then
        echo "xrandr not found" >&2
        return 3
    fi

    xrandr -o "$o" >/dev/null 2>&1 || return 4
    echo "$(date '+%Y-%m-%d %H:%M:%S') Screen rotated to: $o" >> "$LOG_FILE"
}

if [ "$1" = "rotate-display" ] || [ "$1" = "rotate" ]; then
    if [ -z "$2" ]; then
        echo "Usage: $0 rotate-display <right|0|normal|left|inverted>" >&2
        exit 2
    fi
    rotate_display "$2"
    exit $?
fi

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

is_pid_alive() {
    local pid="$1"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

compute_media_signature() {
    printf '%s\n' "$@" | cksum | awk '{print $1":"$2}'
}

collect_media_list() {
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

remove_current_month_first_page_files() {
    local current_day day_num current_month_num month_index
    local month_names_pl month_short_pl month_short_en month_full_en
    local active_keys key removed_any matched_file file_name media_base normalized_base

    current_day="$(date +%d)"
    day_num=$((10#$current_day))

    if [ "$day_num" -le 15 ]; then
        return 0
    fi

    current_month_num=$((10#$(date +%m)))
    month_index=$((current_month_num - 1))

    month_names_pl=(
        "styczen" "luty" "marzec" "kwiecien" "maj" "czerwiec"
        "lipiec" "sierpien" "wrzesien" "pazdziernik" "listopad" "grudzien"
    )
    month_short_pl=(
        "sty" "lut" "mar" "kwi" "maj" "cze"
        "lip" "sie" "wrz" "paz" "lis" "gru"
    )
    month_short_en=(
        "jan" "feb" "mar" "apr" "may" "jun"
        "jul" "aug" "sep" "oct" "nov" "dec"
    )
    month_full_en=(
        "january" "february" "march" "april" "may" "june"
        "july" "august" "september" "october" "november" "december"
    )

    active_keys=(
        "${month_names_pl[$month_index]}1"
        "${month_short_pl[$month_index]}1"
        "${month_short_en[$month_index]}1"
        "${month_full_en[$month_index]}1"
    )

    removed_any=0
    shopt -s nullglob nocaseglob
    for matched_file in \
        "$IMG_DIR"/*.jpg "$IMG_DIR"/*.jpeg "$IMG_DIR"/*.png \
        "$IMG_DIR"/*.gif "$IMG_DIR"/*.bmp "$IMG_DIR"/*.webp; do
        [ -f "$matched_file" ] || continue

        file_name="$(basename "$matched_file")"
        media_base="${file_name%.*}"
        if [[ "$media_base" =~ ^(.+)_page-[0-9]+$ ]]; then
            media_base="${BASH_REMATCH[1]}"
        fi

        normalized_base="$(printf '%s' "$media_base" | tr '[:upper:]' '[:lower:]')"
        normalized_base="$(printf '%s' "$normalized_base" | sed -e 's/ą/a/g' -e 's/ć/c/g' -e 's/ę/e/g' -e 's/ł/l/g' -e 's/ń/n/g' -e 's/ó/o/g' -e 's/ś/s/g' -e 's/ź/z/g' -e 's/ż/z/g')"

        for key in "${active_keys[@]}"; do
            if [ "$normalized_base" = "$key" ]; then
                rm -f "$matched_file"
                echo "$(date '+%Y-%m-%d %H:%M:%S') Removed expired file after day 15: $matched_file" >> "$LOG_FILE"
                removed_any=1
                break
            fi
        done
    done
    shopt -u nullglob nocaseglob

    if [ "$removed_any" -eq 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Day > 15, but no current-month *1 files found to remove in $IMG_DIR" >> "$LOG_FILE"
    fi
}

start_persistent_feh() {
    feh -F --zoom fill -D "$TIME_PER_ITEM" "$@" >/dev/null 2>&1 &
    PERSISTENT_VIEWER_PID="$!"
    echo "$(date '+%Y-%m-%d %H:%M:%S') Started persistent feh PID=$PERSISTENT_VIEWER_PID, files=$#" >> "$LOG_FILE"
}

open_single_image() {
    local img="$1"
    case "$IMG_VIEWER" in
        feh) feh -F --zoom fill "$img" >/dev/null 2>&1 & ;;
        imv) imv -f -s full "$img" >/dev/null 2>&1 & ;;
        eog) eog --fullscreen "$img" >/dev/null 2>&1 & ;;
        display) display -window root "$img" >/dev/null 2>&1 & ;;
        *) return 1 ;;
    esac
    return 0
}

kill_viewers() {
    pkill -f feh 2>/dev/null || true
    pkill -f imv 2>/dev/null || true
    pkill -f eog 2>/dev/null || true
    pkill -f display 2>/dev/null || true
}

validate_time_per_item
echo "$(date '+%Y-%m-%d %H:%M:%S') Start offline display PID=$$ TIME_PER_ITEM=${TIME_PER_ITEM}s IMG_DIR=$IMG_DIR" >> "$LOG_FILE"

if [ "$IMG_VIEWER" = "" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: no supported image viewer (feh/imv/eog/display)." >> "$LOG_FILE"
    exit 1
fi

while true; do
    remove_current_month_first_page_files
    mapfile -t MEDIA_LIST < <(collect_media_list)

    if [ ${#MEDIA_LIST[@]} -eq 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') No image files in IMG_DIR: $IMG_DIR" >> "$LOG_FILE"
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

    # Fallback for non-feh viewers: sequential display
    for media in "${MEDIA_LIST[@]}"; do
        kill_viewers
        if open_single_image "$media"; then
            sleep_for_duration "$TIME_PER_ITEM"
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') Failed to open image: $media" >> "$LOG_FILE"
            sleep 1
        fi
    done
done
