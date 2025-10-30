#!/bin/bash
#
# Skrypt instalacyjny dla LibreELEC 12.0.2 (Raspberry Pi 5)
# Data: 17.10.2025
# 
# LibreELEC jest systemem tylko do odczytu z ograniczonym pakietem narzędzi.
# Wykorzystuje wbudowany SSH dla SFTP zamiast vsftpd.

# Definicja kolorów do komunikatów
txtrst=$(tput sgr0) # Reset tekstu
txtred=$(tput setaf 1) # Czerwony
txtgreen=$(tput setaf 2) # Zielony
txtyellow=$(tput setaf 3) # Żółty

echo -e "${txtgreen}=========================================${txtrst}"
echo -e "${txtgreen}Instalator dla LibreELEC 12.0.2 (RPi5)${txtrst}"
echo -e "${txtgreen}=========================================${txtrst}"

# Funkcja sprawdzająca środowisko LibreELEC
sprawdz_srodowisko() {
    echo -e "${txtyellow}Sprawdzanie środowiska LibreELEC...${txtrst}"
    
    # Sprawdzanie czy to LibreELEC
    if [ ! -f /etc/libreelec_version ]; then
        echo -e "${txtred}Ten skrypt jest przeznaczony dla LibreELEC!${txtrst}"
        echo -e "${txtyellow}Wykryto inny system. Czy chcesz kontynuować? (t/n)${txtrst}"
        read -p "Wybór: " kontynuuj
        if [ "$kontynuuj" != "t" ] && [ "$kontynuuj" != "T" ]; then
            echo -e "${txtred}Instalacja przerwana!${txtrst}"
            exit 1
        fi
    else
        LIBREELEC_VERSION=$(cat /etc/libreelec_version)
        echo -e "${txtgreen}Wykryto LibreELEC: ${LIBREELEC_VERSION}${txtrst}"
    fi
    
    # Sprawdzanie architektury
    ARCH=$(uname -m)
    echo -e "${txtgreen}Architektura: ${ARCH}${txtrst}"
    
    # Sprawdzanie czy SSH jest włączony
    if ! systemctl is-active --quiet sshd; then
        echo -e "${txtred}Usługa SSH nie jest uruchomiona!${txtrst}"
        echo -e "${txtyellow}Włącz SSH w ustawieniach Kodi: Settings > LibreELEC > Services > SSH${txtrst}"
        exit 1
    else
        echo -e "${txtgreen}SSH jest aktywny${txtrst}"
    fi
    
    echo -e "${txtgreen}Środowisko LibreELEC OK. Kontynuowanie...${txtrst}"
}

# Konfiguracja katalogów dla mediów
konfiguruj_katalogi() {
    echo -e "${txtyellow}Konfiguracja katalogów dla mediów...${txtrst}"
    
    # W LibreELEC używamy /storage - jest to partycja do zapisu
    # System główny jest tylko do odczytu
    MEDIA_DIR="/storage/MediaPionowe"
    
    if [ ! -d "$MEDIA_DIR" ]; then
        echo -e "${txtyellow}Tworzenie katalogu $MEDIA_DIR...${txtrst}"
        mkdir -p "$MEDIA_DIR" || { echo -e "${txtred}Nie można utworzyć katalogu!${txtrst}"; return 1; }
        chmod 755 "$MEDIA_DIR"
        echo -e "${txtgreen}Katalog utworzony: $MEDIA_DIR${txtrst}"
    else
        echo -e "${txtgreen}Katalog już istnieje: $MEDIA_DIR${txtrst}"
    fi
    
    # Tworzenie struktury podkatalogów
    mkdir -p "$MEDIA_DIR/videos" "$MEDIA_DIR/images" "$MEDIA_DIR/config"
    
    echo -e "${txtgreen}Struktura katalogów gotowa${txtrst}"
}

# Konfiguracja SSH dla SFTP
konfiguruj_ssh() {
    echo -e "${txtyellow}Konfiguracja SSH dla dostępu SFTP...${txtrst}"
    
    # W LibreELEC SSH jest już skonfigurowany
    # Domyślny użytkownik: root
    # Hasło ustawiane w interfejsie Kodi
    
    echo -e "${txtgreen}SSH w LibreELEC:${txtrst}"
    echo -e "  - Użytkownik: ${txtgreen}root${txtrst}"
    echo -e "  - Port: ${txtgreen}22${txtrst}"
    echo -e "  - Hasło: ${txtyellow}Ustaw w: Kodi > Settings > LibreELEC > Services > SSH${txtrst}"
    echo -e "  - SFTP: ${txtgreen}Włączone automatycznie${txtrst}"
    
    # Sprawdzanie czy plik authorized_keys istnieje
    SSH_DIR="/storage/.ssh"
    if [ ! -d "$SSH_DIR" ]; then
        mkdir -p "$SSH_DIR"
        chmod 700 "$SSH_DIR"
    fi
    
    if [ ! -f "$SSH_DIR/authorized_keys" ]; then
        touch "$SSH_DIR/authorized_keys"
        chmod 600 "$SSH_DIR/authorized_keys"
        echo -e "${txtgreen}Utworzono plik authorized_keys${txtrst}"
    fi
    
    echo -e "${txtyellow}Aby włączyć dostęp przez klucz SSH:${txtrst}"
    echo -e "  1. Skopiuj swój publiczny klucz SSH do: $SSH_DIR/authorized_keys"
    echo -e "  2. Upewnij się, że uprawnienia są poprawne (600)"
}

# Kopiowanie i konfiguracja skryptu raportującego IP
kopiuj_skrypt_ip() {
    echo -e "${txtyellow}Konfiguracja skryptu raportowania IP...${txtrst}"
    
    # Sprawdzenie czy plik ipdoapi.py istnieje
    if [ ! -f "./ipdoapi.py" ]; then
        echo -e "${txtred}Plik ipdoapi.py nie został znaleziony w bieżącym katalogu!${txtrst}"
        echo -e "${txtyellow}Pomiń ten krok? (t/n)${txtrst}"
        read -p "Wybór: " pomin
        if [ "$pomin" != "t" ] && [ "$pomin" != "T" ]; then
            return 1
        fi
        return 0
    fi
    
    # Pytanie o adres IP serwera API
    echo -e "${txtyellow}Podaj adres IP serwera API (np. 192.168.0.107):${txtrst}"
    read -p "Adres IP: " server_ip
    
    if [ -z "$server_ip" ]; then
        echo -e "${txtred}Nie podano adresu IP. Pomijam konfigurację.${txtrst}"
        return 1
    fi
    
    # Kopiowanie i modyfikacja pliku
    SCRIPT_DIR="/storage/.config"
    cp ./ipdoapi.py "$SCRIPT_DIR/ipdoapi.py" || { echo -e "${txtred}Błąd kopiowania!${txtrst}"; return 1; }
    
    # Podmiana adresu IP w pliku
    sed -i "s|API_BASE_URL = \"http://.*:5000/api/\"|API_BASE_URL = \"http://${server_ip}:5000/api/\"|g" "$SCRIPT_DIR/ipdoapi.py"
    
    chmod +x "$SCRIPT_DIR/ipdoapi.py"
    
    echo -e "${txtgreen}Skrypt ipdoapi.py skopiowany i skonfigurowany${txtrst}"
}

# Tworzenie usługi systemd dla raportowania IP
utworz_usluge_systemd() {
    echo -e "${txtyellow}Tworzenie usługi systemd dla raportowania IP...${txtrst}"
    
    # W LibreELEC usługi systemd umieszczamy w /storage/.config/system.d/
    SYSTEMD_DIR="/storage/.config/system.d"
    mkdir -p "$SYSTEMD_DIR"
    
    # Tworzenie pliku usługi
    cat > "$SYSTEMD_DIR/ipdoapi.service" << 'EOF'
[Unit]
Description=IP Reporting Service for Kiosk Management
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /storage/.config/ipdoapi.py
Restart=always
RestartSec=30
User=root

[Install]
WantedBy=multi-user.target
EOF

    chmod 644 "$SYSTEMD_DIR/ipdoapi.service"
    
    # Włączenie usługi
    systemctl enable "$SYSTEMD_DIR/ipdoapi.service"
    systemctl start ipdoapi.service
    
    echo -e "${txtgreen}Usługa ipdoapi.service utworzona i uruchomiona${txtrst}"
}

# Wyświetlanie informacji o konfiguracji
podsumowanie() {
    echo -e ""
    echo -e "${txtgreen}=========================================${txtrst}"
    echo -e "${txtgreen}PODSUMOWANIE INSTALACJI${txtrst}"
    echo -e "${txtgreen}=========================================${txtrst}"
    echo -e ""
    echo -e "${txtgreen}Katalog mediów:${txtrst} /storage/MediaPionowe"
    echo -e "${txtgreen}Skrypt IP:${txtrst} /storage/.config/ipdoapi.py"
    echo -e "${txtgreen}Usługa systemd:${txtrst} /storage/.config/system.d/ipdoapi.service"
    echo -e ""
    echo -e "${txtyellow}DANE DOSTĘPOWE SFTP:${txtrst}"
    echo -e "  Użytkownik: ${txtgreen}root${txtrst}"
    echo -e "  Port: ${txtgreen}22${txtrst}"
    echo -e "  Katalog główny: ${txtgreen}/storage/MediaPionowe${txtrst}"
    echo -e "  Hasło: ${txtyellow}Ustaw w Kodi > Settings > LibreELEC > Services > SSH${txtrst}"
    echo -e ""
    echo -e "${txtyellow}WAŻNE INFORMACJE:${txtrst}"
    echo -e "  - LibreELEC używa SFTP zamiast FTP"
    echo -e "  - System główny jest tylko do odczytu"
    echo -e "  - Wszystkie dane użytkownika w /storage/"
    echo -e "  - Backend musi być skonfigurowany do SFTP (port 22)"
    echo -e ""
    echo -e "${txtgreen}Sprawdź status usługi:${txtrst} systemctl status ipdoapi.service"
    echo -e "${txtgreen}=========================================${txtrst}"
}

# Menu główne
menu_glowne() {
    while true; do
        echo -e ""
        echo -e "${txtgreen}=========================================${txtrst}"
        echo -e "${txtgreen}MENU INSTALACJI${txtrst}"
        echo -e "${txtgreen}=========================================${txtrst}"
        echo -e "1. Pełna instalacja (wszystkie kroki)"
        echo -e "2. Tylko konfiguracja katalogów"
        echo -e "3. Tylko konfiguracja SSH"
        echo -e "4. Tylko skrypt raportowania IP"
        echo -e "5. Tylko usługa systemd"
        echo -e "6. Pokaż podsumowanie"
        echo -e "0. Wyjście"
        echo -e "${txtgreen}=========================================${txtrst}"
        read -p "Wybierz opcję: " wybor
        
        case $wybor in
            1)
                sprawdz_srodowisko
                konfiguruj_katalogi
                konfiguruj_ssh
                kopiuj_skrypt_ip
                utworz_usluge_systemd
                podsumowanie
                ;;
            2)
                konfiguruj_katalogi
                ;;
            3)
                konfiguruj_ssh
                ;;
            4)
                kopiuj_skrypt_ip
                ;;
            5)
                utworz_usluge_systemd
                ;;
            6)
                podsumowanie
                ;;
            0)
                echo -e "${txtgreen}Zakończono${txtrst}"
                exit 0
                ;;
            *)
                echo -e "${txtred}Nieprawidłowy wybór!${txtrst}"
                ;;
        esac
    done
}

# Uruchomienie menu głównego
sprawdz_srodowisko
menu_glowne
