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

output_ext="${OUTPUT##*.}"
output_ext="$(printf '%s' "$output_ext" | tr '[:upper:]' '[:lower:]')"

is_image=0
case "$input_ext" in
    jpg|jpeg|png|bmp|gif|webp)
        is_image=1
        ;;
esac

mkdir -p "$(dirname "$OUTPUT")"

VIDEO_ENCODER="$(pick_video_encoder)"
if [ -z "$VIDEO_ENCODER" ]; then
    echo "Error: no usable video encoder available in ffmpeg (checked: H.264/HEVC/MPEG-4)"
    exit 1
fi

if [ "$is_image" -eq 1 ]; then
    # If destination is video, create a short clip from the image.
    # Otherwise, export a full-frame image that fills the target area.
    if [ "$output_ext" = "mp4" ] || [ "$output_ext" = "mkv" ] || [ "$output_ext" = "mov" ]; then
        IMAGE_DURATION_SECONDS="${IMAGE_DURATION_SECONDS:-10}"
        if [ "$VIDEO_ENCODER" = "libx264" ]; then
            ffmpeg -loop 1 -framerate 25 -i "$INPUT" \
                -t "$IMAGE_DURATION_SECONDS" \
                -c:v "$VIDEO_ENCODER" \
                -profile:v high \
                -level 4.0 \
                -preset veryfast \
                -crf 23 \
                -tune stillimage \
                -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
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
                -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
                -pix_fmt yuv420p \
                -g 25 \
                -an \
                -movflags +faststart \
                -y \
                "$OUTPUT"
        fi
    else
        ffmpeg -i "$INPUT" \
            -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
            -frames:v 1 \
            -q:v 2 \
            -y \
            "$OUTPUT"
    fi
    exit 0
fi

if [ "$VIDEO_ENCODER" = "libx264" ]; then
    ffmpeg -i "$INPUT" \
        -map 0:v:0 -map 0:a? \
        -c:v "$VIDEO_ENCODER" \
        -profile:v high \
        -level 4.0 \
        -preset veryfast \
        -crf 23 \
        -tune fastdecode \
        -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
        -pix_fmt yuv420p \
        -g 25 \
        -bf 0 \
        -threads 4 \
        -c:a aac -b:a 128k \
        -movflags +faststart \
        -y \
        "$OUTPUT"
else
    ffmpeg -i "$INPUT" \
        -map 0:v:0 -map 0:a? \
        -c:v "$VIDEO_ENCODER" \
        -b:v 5M \
        -maxrate 5M \
        -bufsize 10M \
        -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
        -pix_fmt yuv420p \
        -g 25 \
        -c:a aac -b:a 128k \
        -movflags +faststart \
        -y \
        "$OUTPUT"
fi