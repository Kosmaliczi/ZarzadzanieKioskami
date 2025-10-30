#!/bin/sh

LOG="/storage/.kodi/temp/autostart-video-loop.log"

(
  echo "$(date) [autostart] Start skryptu." >> "$LOG"

  # Czekaj na proces Kodi
  echo "$(date) [autostart] Czekam na uruchomienie Kodi..." >> "$LOG"
  until pgrep -f kodi.bin >/dev/null; do
    sleep 2
  done

  # Daj Kodi chwilę na pełne załadowanie GUI/usług
  sleep 10

  # Zamiast stałej ścieżki – autodetekcja katalogu z wideo
  VIDEO_DIR=""
  for c in "/storage/video" "/storage/videos"; do
    [ -d "$c" ] && VIDEO_DIR="$c" && break
  done

  # Sprawdź wybrany katalog oraz czy nie jest pusty (rekurencyjnie)
  if [ -z "$VIDEO_DIR" ]; then
    echo "$(date) [autostart] Brak katalogu /storage/video ani /storage/videos - pomijam." >> "$LOG"
    exit 0
  fi

  if ! find "$VIDEO_DIR" -type f \
       \( -iname "*.mp4" -o -iname "*.mkv" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.wmv" -o -iname "*.m4v" -o -iname "*.ts" -o -iname "*.webm" \) \
       -print -quit | grep -q .; then
    echo "$(date) [autostart] Katalog $VIDEO_DIR nie zawiera plików wideo - pomijam." >> "$LOG"
    exit 0
  fi

  echo "$(date) [autostart] Używam katalogu: $VIDEO_DIR" >> "$LOG"

  # Zbuduj playlistę: wyczyść, dodaj pliki pojedynczo (rekurencyjnie), otwórz, ustaw repeat/shuffle
  kodi-send --json='{"jsonrpc":"2.0","id":1,"method":"Playlist.Clear","params":{"playlistid":1}}' >> "$LOG" 2>&1

  count=0
  while IFS= read -r -d '' f; do
    kodi-send --json='{"jsonrpc":"2.0","id":2,"method":"Playlist.Add","params":{"playlistid":1,"item":{"file":"'"$f"'"}}}' >> "$LOG" 2>&1
    count=$((count+1))
  done < <(find "$VIDEO_DIR" -type f \
              \( -iname "*.mp4" -o -iname "*.mkv" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.wmv" -o -iname "*.m4v" -o -iname "*.ts" -o -iname "*.webm" \) \
              -print0 | sort -z)

  if [ "$count" -eq 0 ]; then
    echo "$(date) [autostart] Nie dodano żadnych plików do playlisty - przerywam." >> "$LOG"
    exit 0
  fi

  echo "$(date) [autostart] Dodano $count plików do playlisty." >> "$LOG"

  kodi-send --json='{"jsonrpc":"2.0","id":3,"method":"Player.Open","params":{"item":{"playlistid":1},"options":{"repeat":"all","shuffled":false}}}' >> "$LOG" 2>&1

  # Dla pewności ustaw po otwarciu
  sleep 2
  kodi-send --json='{"jsonrpc":"2.0","id":4,"method":"Player.SetShuffle","params":{"playerid":1,"shuffle":false}}' >> "$LOG" 2>&1
  kodi-send --json='{"jsonrpc":"2.0","id":5,"method":"Player.SetRepeat","params":{"playerid":1,"repeat":"all"}}' >> "$LOG" 2>&1

  echo "$(date) [autostart] Odtwarzanie uruchomione w pętli z ${VIDEO_DIR}." >> "$LOG"
) &

exit 0
