# Ticker Overlay Addon dla Kodi

Ten addon wyświetla przewijający się napis (ticker) od prawej do lewej na dole ekranu Kodi, wykorzystując wbudowany RSS ticker. Treść jest pobierana z pliku tekstowego `/storage/napis.txt` edytowalnego przez stronę WWW.

## Instalacja
1. Skopiuj cały katalog `service.ticker` do `/storage/.kodi/addons/` na urządzeniu z Kodi/LibreELEC.
   Możesz użyć FTP/SFTP lub sekcji "FTP" w panelu WWW.
   
2. Upewnij się, że struktura katalogów wygląda tak:
   ```
   /storage/.kodi/addons/service.ticker/
   ├── addon.xml
   ├── service.py
   └── README.txt
   ```

3. Zrestartuj Kodi lub uruchom ponownie urządzenie.

4. Sprawdź czy addon działa w: Ustawienia → Dodatki → Moje dodatki → Usługi → Ticker Overlay

## Edycja napisu
- Edytuj plik `/storage/napis.txt` przez panel WWW w sekcji "Edytor".
- Ustaw ścieżkę pliku na `/storage/napis.txt` lub `/napis.txt`.
- Addon automatycznie pobierze nową treść co 10 sekund i zaktualizuje ticker.

## Jak to działa
1. Addon czyta tekst z pliku `/storage/napis.txt`
2. Tworzy lokalny plik RSS z tym tekstem
3. Włącza wbudowany RSS ticker w Kodi
4. Ticker automatycznie przewija tekst od prawej do lewej na dole ekranu

## Dostosowanie
W pliku `service.py` możesz zmienić:
- `TICKER_FILE` - ścieżka do pliku tekstowego
- `REFRESH_INTERVAL` - częstotliwość sprawdzania pliku (domyślnie 10 sekund)

Prędkość przewijania i wygląd tickera można dostosować w ustawieniach Kodi:
- Ustawienia → Wygląd interfejsu → Skórka → Konfiguruj skórkę → RSS

## Troubleshooting
- Jeśli addon nie uruchamia się, sprawdź logi Kodi w `/storage/.kodi/temp/kodi.log`
- Upewnij się, że plik `/storage/napis.txt` istnieje i jest czytelny
- Możesz utworzyć testowy plik przez SSH: `echo "Test napisu" > /storage/napis.txt`
- Jeśli ticker nie pojawia się, sprawdź czy RSS ticker jest włączony w ustawieniach skórki Kodi
- Niektóre skórki mogą wymagać ręcznego włączenia RSS w ustawieniach wyglądu

## Wymagania
- Kodi 19+ (Matrix) lub LibreELEC 10+
- Python 3.x w Kodi (standardowo dostępny)
- Skórka Kodi musi wspierać RSS ticker (większość domyślnych skórek wspiera)

## Autor
Kiosk System - GitHub Copilot
