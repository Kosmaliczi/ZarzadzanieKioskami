#!/bin/bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <input_image> <output_file>"
    echo "Example (image): $0 photo.jpg out.jpg"
    echo "Example (video): $0 photo.jpg out.mp4"
    exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "Error: ffmpeg is required but not installed"
    exit 1
fi

pick_video_encoder() {
    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libx264'; then
        echo "libx264"
        return
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'h264_v4l2m2m'; then
        echo "h264_v4l2m2m"
        return
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'h264_omx'; then
        echo "h264_omx"
        return
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\<h264\>'; then
        echo "h264"
        return
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libx265'; then
        echo "libx265"
        return
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'hevc_v4l2m2m'; then
        echo "hevc_v4l2m2m"
        return
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\<hevc\>'; then
        echo "hevc"
        return
    fi

    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\<mpeg4\>'; then
        echo "mpeg4"
        return
    fi

    echo ""
}

INPUT="$1"
OUTPUT="$2"

if [ ! -f "$INPUT" ]; then
    echo "Error: input file not found: $INPUT"
    exit 1
fi

input_ext="${INPUT##*.}"
input_ext="$(printf '%s' "$input_ext" | tr '[:upper:]' '[:lower:]')"

case "$input_ext" in
    jpg|jpeg|png|bmp|gif|webp)
        ;;
    *)
        echo "Error: input must be an image (jpg/jpeg/png/bmp/gif/webp)"
        exit 1
        ;;
esac

output_ext="${OUTPUT##*.}"
output_ext="$(printf '%s' "$output_ext" | tr '[:upper:]' '[:lower:]')"

TARGET_WIDTH="${TARGET_WIDTH:-1920}"
TARGET_HEIGHT="${TARGET_HEIGHT:-1080}"
IMAGE_DURATION_SECONDS="${IMAGE_DURATION_SECONDS:-10}"

# "Cover" effect: scale up to fill the entire target area, then crop the excess.
FILL_FILTER="scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,crop=${TARGET_WIDTH}:${TARGET_HEIGHT}"

mkdir -p "$(dirname "$OUTPUT")"

if [ "$output_ext" = "mp4" ] || [ "$output_ext" = "mkv" ] || [ "$output_ext" = "mov" ]; then
    VIDEO_ENCODER="$(pick_video_encoder)"
    if [ -z "$VIDEO_ENCODER" ]; then
        echo "Error: no usable video encoder available in ffmpeg (checked: H.264/HEVC/MPEG-4)"
        exit 1
    fi

    if [ "$VIDEO_ENCODER" = "libx264" ]; then
        ffmpeg -loop 1 -framerate 25 -i "$INPUT" \
            -t "$IMAGE_DURATION_SECONDS" \
            -c:v "$VIDEO_ENCODER" \
            -profile:v high \
            -level 4.0 \
            -preset veryfast \
            -crf 23 \
            -tune stillimage \
            -vf "$FILL_FILTER" \
            -pix_fmt yuv420p \
            -g 25 \
            -bf 0 \
            -threads 4 \
            -an \
            -movflags +faststart \
            -y \
            "$OUTPUT"
    else
        ffmpeg -loop 1 -framerate 25 -i "$INPUT" \
            -t "$IMAGE_DURATION_SECONDS" \
            -c:v "$VIDEO_ENCODER" \
            -b:v 5M \
            -maxrate 5M \
            -bufsize 10M \
            -vf "$FILL_FILTER" \
            -pix_fmt yuv420p \
            -g 25 \
            -an \
            -movflags +faststart \
            -y \
            "$OUTPUT"
    fi
else
    ffmpeg -i "$INPUT" \
        -vf "$FILL_FILTER" \
        -frames:v 1 \
        -q:v 2 \
        -y \
        "$OUTPUT"
fi

echo "Done: $OUTPUT"
