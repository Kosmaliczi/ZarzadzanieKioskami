# Instrukcja instalacji Ticker Addon

## O Addonie
Ten addon wykorzystuje wbudowany RSS ticker w Kodi do wyświetlania przewijanego tekstu od prawej do lewej na dole ekranu. Tekst jest edytowalny przez panel WWW i automatycznie odświeżany.

## Krok 1: Przygotowanie plików
Addon znajduje się w katalogu `kodi_ticker_addon/` w repozytorium.

## Krok 2: Skopiowanie addonu na urządzenie Kodi/LibreELEC

### Opcja A: Przez panel WWW (FTP/SFTP)
1. Otwórz panel WWW w przeglądarce.
2. Przejdź do sekcji "FTP".
3. Połącz się z kioskiem (wybierz kiosk z listy).
4. Przejdź do katalogu `/storage/.kodi/addons/`.
5. Utwórz nowy katalog `service.ticker`.
6. Prześlij pliki:
   - `addon.xml`
   - `service.py`
   - `README.txt`

### Opcja B: Przez SSH/SFTP (ręcznie)
```bash
# Z poziomu komputera (Windows PowerShell lub Linux/Mac terminal)
scp -r kodi_ticker_addon root@IP_KIOSKU:/storage/.kodi/addons/service.ticker
```

Lub użyj programu WinSCP/FileZilla:
- Host: IP kiosku
- Port: 22 (SFTP)
- Użytkownik: root
- Hasło: (hasło SSH)

## Krok 3: Utworzenie pliku tekstowego z napisem
Przez panel WWW w sekcji "Edytor":
1. Wybierz kiosk.
2. Połącz się z FTP.
3. Ustaw ścieżkę pliku: `/storage/napis.txt`
4. Wpisz treść napisu (np. "Witamy w naszym sklepie!").
5. Kliknij "Zapisz".

Lub przez SSH:
```bash
ssh root@IP_KIOSKU
echo "Witamy w naszym sklepie!" > /storage/napis.txt
```

## Krok 4: Restart Kodi
```bash
systemctl restart kodi
```

Lub przez panel WWW:
- Sekcja "Kioski" → znajdź kiosk → przycisk "Restart"

## Krok 5: Weryfikacja
1. Połącz się przez VNC lub webowy interfejs Kodi (przycisk "Połącz przez VNC" w panelu).
2. Sprawdź czy RSS ticker pojawia się na dole ekranu i przewija się z prawej do lewej.
3. Sprawdź logi: `/storage/.kodi/temp/kodi.log` (szukaj "Ticker:").

### Jeśli ticker nie jest widoczny
1. Otwórz Ustawienia Kodi
2. Przejdź do: **Ustawienia → Wygląd interfejsu → Skórka → Konfiguruj skórkę**
3. Znajdź opcję **RSS** i upewnij się, że jest włączona
4. Możesz dostosować:
   - Prędkość przewijania tickera
   - Położenie na ekranie
   - Czcionkę i kolory

## Troubleshooting

### Addon się nie uruchamia
```bash
cat /storage/.kodi/temp/kodi.log | grep -i ticker
```
Sprawdź błędy w logach.

### Brak napisu na ekranie
1. Sprawdź czy plik `/storage/napis.txt` istnieje:
   ```bash
   cat /storage/napis.txt
   ```
2. Sprawdź uprawnienia:
   ```bash
   chmod 644 /storage/napis.txt
   ```
3. **Sprawdź czy RSS ticker jest włączony w skórce Kodi** (patrz wyżej - "Jeśli ticker nie jest widoczny")
4. Sprawdź czy utworzył się plik `/storage/ticker_feed.xml`:
   ```bash
   ls -la /storage/ticker_feed.xml
   cat /storage/ticker_feed.xml
   ```

### Napis nie aktualizuje się
- Addon sprawdza plik co **10 sekund** (REFRESH_INTERVAL).
- Upewnij się, że plik został zapisany poprawnie.
- Sprawdź logi: `grep "Ticker:" /storage/.kodi/temp/kodi.log`
- Sprawdź czy RSS feed został zaktualizowany: `cat /storage/ticker_feed.xml`

### Ticker przewija się zbyt szybko/wolno
W ustawieniach Kodi:
- **Ustawienia → Wygląd interfejsu → Skórka → Konfiguruj skórkę → RSS**
- Dostosuj prędkość przewijania

## Edycja napisu w czasie rzeczywistym
Po zapisaniu zmian w pliku przez panel WWW, napis zostanie automatycznie zaktualizowany w ciągu około **10 sekund** bez konieczności restartu Kodi. Ticker automatycznie odświeży się i wyświetli nową treść przewijaną od prawej do lewej.

## Jak to działa technicznie
1. Addon czyta plik `/storage/napis.txt` co 10 sekund
2. Tworzy lokalny plik RSS (`/storage/ticker_feed.xml`) z tym tekstem
3. Włącza wbudowany RSS ticker w Kodi przez JSON-RPC API
4. RSS ticker Kodi automatycznie przewija tekst od prawej do lewej
5. Przy każdej zmianie tekstu, RSS feed jest aktualizowany i skin odświeżany
