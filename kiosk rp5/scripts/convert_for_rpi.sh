#!/bin/bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <input_file> <output_file>"
    exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "Error: ffmpeg is required but not installed"
    exit 1
fi

INPUT="$1"
OUTPUT="$2"

if [ ! -f "$INPUT" ]; then
    echo "Error: input file not found: $INPUT"
    exit 1
fi

input_ext="${INPUT##*.}"
input_ext="$(printf '%s' "$input_ext" | tr '[:upper:]' '[:lower:]')"

output_ext="${OUTPUT##*.}"
output_ext="$(printf '%s' "$output_ext" | tr '[:upper:]' '[:lower:]')"

is_image=0
case "$input_ext" in
    jpg|jpeg|png|bmp|gif|webp)
        is_image=1
        ;;
esac

mkdir -p "$(dirname "$OUTPUT")"

if [ "$is_image" -eq 1 ]; then
    # If destination is video, create a short H.264 clip from the image.
    # Otherwise, copy the image as-is.
    if [ "$output_ext" = "mp4" ] || [ "$output_ext" = "mkv" ] || [ "$output_ext" = "mov" ]; then
        IMAGE_DURATION_SECONDS="${IMAGE_DURATION_SECONDS:-10}"
        ffmpeg -loop 1 -framerate 25 -i "$INPUT" \
            -t "$IMAGE_DURATION_SECONDS" \
            -c:v h264 \
            -profile:v baseline \
            -level 3.0 \
            -preset ultrafast \
            -tune stillimage \
            -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
            -pix_fmt yuv420p \
            -g 25 \
            -bf 0 \
            -threads 4 \
            -an \
            -movflags +faststart \
            -y \
            "$OUTPUT"
    else
        cp -f "$INPUT" "$OUTPUT"
    fi
    exit 0
fi

ffmpeg -i "$INPUT" \
    -map 0:v:0 -map 0:a? \
    -c:v h264 \
    -profile:v baseline \
    -level 3.0 \
    -preset ultrafast \
    -tune fastdecode \
    -vf "scale=1920:1080" \
    -pix_fmt yuv420p \
    -g 25 \
    -bf 0 \
    -threads 4 \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    -y \
    "$OUTPUT"