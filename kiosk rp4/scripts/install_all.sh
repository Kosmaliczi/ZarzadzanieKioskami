#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${YELLOW}$1${NC}"
}

log_success() {
    echo -e "${GREEN}$1${NC}"
}

log_error() {
    echo -e "${RED}$1${NC}" >&2
}

require_privileges() {
    if [ "$(id -u)" -eq 0 ]; then
        return 0
    fi

    if ! command -v sudo >/dev/null 2>&1; then
        log_error "Ten skrypt wymaga uprawnień administratora lub dostępnego polecenia sudo."
        exit 1
    fi
}

install_packages() {
    local packages=(
        ffmpeg
    )

    log_info "Aktualizuję listę pakietów..."
    if [ "$(id -u)" -eq 0 ]; then
        apt-get update
    else
        sudo apt-get update
    fi

    log_info "Instaluję wymagane pakiety dla Raspberry Pi 4..."
    if [ "$(id -u)" -eq 0 ]; then
        apt-get install -y "${packages[@]}"
    else
        sudo apt-get install -y "${packages[@]}"
    fi
}

verify_ffmpeg() {
    if ! command -v ffmpeg >/dev/null 2>&1; then
        log_error "ffmpeg nie został zainstalowany poprawnie."
        exit 1
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -Eq 'libx264|h264_v4l2m2m|h264_omx|\<h264\>|libx265|hevc_v4l2m2m|\<hevc\>|\<mpeg4\>'; then
        return 0
    fi

    log_info "Brak dostępnego enkodera wideo (sprawdzano: H.264/HEVC/MPEG-4)."
    log_info "Instalacja będzie kontynuowana, ale eksport do plików wideo może nie działać na tym systemie."
}

pick_video_encoder() {
    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libx264'; then
        echo "libx264"
        return 0
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'h264_v4l2m2m'; then
        echo "h264_v4l2m2m"
        return 0
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'h264_omx'; then
        echo "h264_omx"
        return 0
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\<h264\>'; then
        echo "h264"
        return 0
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libx265'; then
        echo "libx265"
        return 0
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'hevc_v4l2m2m'; then
        echo "hevc_v4l2m2m"
        return 0
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\<hevc\>'; then
        echo "hevc"
        return 0
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\<mpeg4\>'; then
        echo "mpeg4"
        return 0
    fi

    echo ""
}

show_encoder_summary() {
    local encoder
    encoder="$(pick_video_encoder)"
    if [ -n "$encoder" ]; then
        log_success "Wykryty enkoder wideo: $encoder"
        if ! printf '%s' "$encoder" | grep -Eq 'libx264|h264_v4l2m2m|h264_omx|^h264$'; then
            log_info "Uwaga: H.264 niedostępne, będzie użyty fallback ($encoder)."
        fi
    else
        log_info "Nie udało się wykryć enkodera wideo. Konwersja do obrazu nadal będzie działać, do wideo może być niedostępna."
    fi
}

make_scripts_executable() {
    chmod +x \
        "${SCRIPT_DIR}/convert_picture.sh" \
        "${SCRIPT_DIR}/convert_for_rpi.sh" \
        "${SCRIPT_DIR}/convert_video.sh" \
        "${SCRIPT_DIR}/run_video_player.sh" \
        "${SCRIPT_DIR}/install_all.sh" 2>/dev/null || true
}

main() {
    require_privileges
    install_packages
    verify_ffmpeg
    show_encoder_summary
    make_scripts_executable

    log_success "Gotowe. Wymagane zależności zostały zainstalowane."
    echo ""
    echo "Dostępne skrypty:"
    echo "- ${SCRIPT_DIR}/convert_picture.sh"
    echo "- ${SCRIPT_DIR}/convert_for_rpi.sh"
    echo "- ${SCRIPT_DIR}/convert_video.sh"
    echo "- ${SCRIPT_DIR}/run_video_player.sh"
}

main "$@"