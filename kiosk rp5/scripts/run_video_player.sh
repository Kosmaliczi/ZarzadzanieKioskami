#!/bin/bash

set -euo pipefail
SCRIPT_DIR="/home/kiosk/scripts"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
KIOSK_PLAYBACK_SOURCE="/home/kiosk/MediaPionowe/playlist.m3u"
PLAYER_BIN="/home/kiosk/build/video_player"

resolve_backend_base_url() {
    if [[ -n "${KIOSK_BACKEND_URL:-}" ]]; then
        echo "${KIOSK_BACKEND_URL%/}"
        return 0
    fi
    if [[ -n "${BACKEND_BASE_URL:-}" ]]; then
        echo "${BACKEND_BASE_URL%/}"
        return 0
    fi
    return 1
}

detect_serial_number() {
    if [[ -n "${KIOSK_SERIAL_NUMBER:-}" ]]; then
        echo "${KIOSK_SERIAL_NUMBER}"
        return 0
    fi

    if [[ -r /proc/cpuinfo ]]; then
        local serial
        serial="$(awk -F ':' '/^Serial/{gsub(/^[ \t]+/, "", $2); print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
        if [[ -n "${serial}" ]]; then
            echo "${serial}"
            return 0
        fi
    fi

    return 1
}

normalize_orientation() {
    local raw="${1:-}"
    raw="${raw,,}"
    raw="${raw//[[:space:]]/}"

    case "${raw}" in
        normal|0) echo "normal" ;;
        right|90) echo "right" ;;
        left|270) echo "left" ;;
        inverted|180) echo "inverted" ;;
        *) echo "normal" ;;
    esac
}

extract_json_orientation() {
    sed -n 's/.*"orientation"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

write_local_orientation_hint() {
    local orientation="${1:-normal}"
    local primary_hint_file="${KIOSK_ORIENTATION_FILE:-/home/kiosk/kiosk_orientation.txt}"
    local fallback_hint_file="/tmp/kiosk_orientation.txt"
    local selected_hint_file="${primary_hint_file}"

    if mkdir -p "$(dirname "${primary_hint_file}")" 2>/dev/null &&
       printf '%s\n' "${orientation}" > "${primary_hint_file}" 2>/dev/null; then
        selected_hint_file="${primary_hint_file}"
    else
        mkdir -p "$(dirname "${fallback_hint_file}")"
        printf '%s\n' "${orientation}" > "${fallback_hint_file}"
        selected_hint_file="${fallback_hint_file}"
        echo "Warning: could not write orientation hint to ${primary_hint_file}, using ${fallback_hint_file}" >&2
    fi

    # Keep /tmp copy for easy diagnostics even when /storage is used.
    if [[ "${selected_hint_file}" != "${fallback_hint_file}" ]]; then
        mkdir -p "$(dirname "${fallback_hint_file}")" 2>/dev/null || true
        printf '%s\n' "${orientation}" > "${fallback_hint_file}" 2>/dev/null || true
    fi

    export KIOSK_ORIENTATION_FILE="${selected_hint_file}"
}

bootstrap_display_rotation() {
    local backend_url
    backend_url="$(resolve_backend_base_url || true)"
    if [[ -z "${backend_url}" ]]; then
        write_local_orientation_hint "normal"
        return 0
    fi

    if ! command -v curl >/dev/null 2>&1; then
        write_local_orientation_hint "normal"
        return 0
    fi

    local serial
    serial="$(detect_serial_number || true)"
    if [[ -z "${serial}" ]]; then
        write_local_orientation_hint "normal"
        return 0
    fi

    local orientation="${KIOSK_TARGET_ORIENTATION:-}"
    if [[ -z "${orientation}" ]]; then
        local orientation_response
        orientation_response="$(curl -fsS "${backend_url}/api/device/${serial}/orientation" 2>/dev/null || true)"
        if [[ -n "${orientation_response}" ]]; then
            orientation="$(printf '%s' "${orientation_response}" | extract_json_orientation)"
        fi
    fi

    orientation="$(normalize_orientation "${orientation:-normal}")"
    write_local_orientation_hint "${orientation}"
    echo "Bootstrap orientation: ${orientation}"
}

if [[ ! -x "${PLAYER_BIN}" ]]; then
    echo "Error: video_player binary not found or not executable: ${PLAYER_BIN}" >&2
    echo "Build it first: cd '${PROJECT_ROOT}/build' ; cmake .. ; make -j4" >&2
    exit 1
fi

bootstrap_display_rotation

choose_playlist() {
    local candidates=()

    if [[ -n "${KIOSK_PLAYBACK_SOURCE:-}" ]]; then
        candidates+=("${KIOSK_PLAYBACK_SOURCE}")
    fi

    candidates+=(
        "${PROJECT_ROOT}/playlist.m3u"
        "${PROJECT_ROOT}/playlist.m3u8"
        "${SCRIPT_DIR}/playlist.m3u"
        "${SCRIPT_DIR}/playlist.m3u8"
        "${SCRIPT_DIR}/../playlist.m3u"
        "${SCRIPT_DIR}/../playlist.m3u8"
        "/storage/videos/kiosk_playlist.m3u"
        "/storage/videos/kiosk_playlist.m3u8"
        "/storage/videos/playlist.m3u"
        "/storage/videos/playlist.m3u8"
        "/home/kiosk/MediaPionowe/kiosk_playlist.m3u"
        "/home/kiosk/MediaPionowe/kiosk_playlist.m3u8"
    )

    # Fallback: pick the first playlist file in /storage/videos.
    local auto_playlist
    auto_playlist="$(find /storage/videos -maxdepth 1 -type f \( -iname '*.m3u' -o -iname '*.m3u8' \) 2>/dev/null | head -n 1 || true)"
    if [[ -n "${auto_playlist}" ]]; then
        candidates+=("${auto_playlist}")
    fi

    local path
    for path in "${candidates[@]}"; do
        if [[ -f "${path}" ]]; then
            case "${path,,}" in
                *.m3u|*.m3u8)
                    echo "${path}"
                    return 0
                    ;;
            esac
        fi
    done

    return 1
}

PLAYLIST_PATH=""
if PLAYLIST_PATH="$(choose_playlist)"; then
    echo "Starting player with playlist: ${PLAYLIST_PATH}"
    exec "${PLAYER_BIN}" "${PLAYLIST_PATH}"
fi

if [[ -n "${KIOSK_BACKEND_URL:-}" || -n "${BACKEND_BASE_URL:-}" ]]; then
    echo "No local playlist found. Starting player in backend-bootstrap mode."
    exec "${PLAYER_BIN}"
fi

echo "Error: no playlist file found and backend URL is not configured." >&2
echo "Set one of: KIOSK_PLAYBACK_SOURCE, KIOSK_BACKEND_URL, BACKEND_BASE_URL" >&2
exit 1
