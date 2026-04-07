#!/bin/bash
#
# Skrypt instalacyjny dla vsftpd i noVNC z x11vnc
# Data: 19.05.2025

# Definicja kolorów do komunikatów
txtrst=$(tput sgr0) # Reset tekstu
txtred=$(tput setaf 1) # Czerwony
txtgreen=$(tput setaf 2) # Zielony
txtyellow=$(tput setaf 3) # Żółty

# Funkcja sprawdzająca środowisko
sprawdz_srodowisko() {
    echo -e "${txtyellow}Sprawdzanie środowiska...${txtrst}"
    
    # Sprawdzanie czy użytkownik jest root-em
    if [ "$(id -u)" -ne 0 ]; then
        echo -e "${txtred}Ten skrypt musi być uruchomiony jako root!${txtrst}"
        echo -e "Uruchom ponownie z poleceniem: sudo $0"
        exit 1
    fi
    
    # Sprawdzanie czy to system Debian/Ubuntu
    if [ ! -f /etc/debian_version ]; then
        echo -e "${txtred}Ten skrypt jest przeznaczony dla systemów Debian/Ubuntu!${txtrst}"
        echo -e "Zmień system na Debian/Ubuntu i uruchom skrypt ponownie."
        exit 1
    fi
    
    XDG_TYPE=$(echo $XDG_SESSION_TYPE)
    if [ "$XDG_TYPE" != "x11" ] && [ "$XDG_TYPE" != "" ]; then
        echo -e "${txtred}Uwaga: Wykryto sesję typu $XDG_TYPE zamiast wymaganej x11!${txtrst}"
        echo -e "${txtred}Jeżeli skrypt jest uruchamiany w sesji SSH, zakończ skrypt i uruchom przez terminal z Pulpitu.${txtrst}"
        echo -e "${txtyellow}Dla Raspberry Pi wykonaj następujące kroki, aby zmienić na x11:${txtrst}"
        echo -e "1. Uruchom polecenie: sudo raspi-config"
        echo -e "2. Wybierz opcję: 6 Advanced Options"
        echo -e "3. Wybierz opcję: A6 Wayland"
        echo -e "4. Wybierz opcję: W1 X11"
        echo -e "5. Potwierdź wybór i zamknij raspi-config"
        echo -e "6. Uruchom ponownie system: sudo reboot"
        echo -e "7. Po ponownym uruchomieniu uruchom skrypt instalacyjny jeszcze raz."
        
        # Opcjonalna automatyczna konfiguracja
        echo -e "${txtyellow}Czy chcesz teraz automatycznie uruchomić raspi-config? (t/n)${txtrst}"
        read -p "Wybór: " auto_config
        if [ "$auto_config" = "t" ] || [ "$auto_config" = "T" ]; then
            echo -e "${txtyellow}Uruchamiam raspi-config...${txtrst}"
            echo -e "${txtyellow}Po zakończeniu konfiguracji i ponownym uruchomieniu, uruchom ten skrypt ponownie.${txtrst}"
            # Sprawdzenie czy raspi-config jest dostępny
            if command -v raspi-config &> /dev/null; then
                sleep 2
                raspi-config
                exit 0
            else
                echo -e "${txtred}Narzędzie raspi-config nie jest dostępne na tym systemie.${txtrst}"
            fi
        fi
        
        echo -e "${txtred}Czy chcesz kontynuować mimo niewłaściwego typu sesji? (t/n)${txtrst}"
        read -p "Wybór: " kontynuuj
        if [ "$kontynuuj" != "t" ] && [ "$kontynuuj" != "T" ]; then
            echo -e "${txtred}Instalacja przerwana!${txtrst}"
            exit 1
        fi
    fi
    
    echo -e "${txtgreen}Środowisko OK. Kontynuowanie...${txtrst}"
}

# Funkcja instalująca vsftpd
instaluj_vsftpd() {
    echo -e "${txtyellow}Rozpoczynam instalację vsftpd...${txtrst}"
    
    # Instalacja vsftpd i openssl
    apt-get update || { echo -e "${txtred}Błąd podczas aktualizacji pakietów!${txtrst}"; return 1; }
    apt-get install -y vsftpd || { echo -e "${txtred}Błąd podczas instalacji vsftpd!${txtrst}"; return 1; }
    
    # Sprawdzanie i tworzenie katalogu /home/kiosk/MediaPionowe jeśli nie istnieje
    if [ ! -d "/home/kiosk/MediaPionowe" ]; then
        echo -e "Katalog /home/kiosk/MediaPionowe nie istnieje. Tworzę go..."
        mkdir -p /home/kiosk/MediaPionowe || { echo -e "${txtred}Nie można utworzyć katalogu /home/kiosk/MediaPionowe!${txtrst}"; return 1; }
        # Ustawienie odpowiednich uprawnień
        chown -R kiosk:kiosk /home/kiosk/MediaPionowe 2>/dev/null || echo -e "${txtyellow}Uwaga: Użytkownik kiosk może nie istnieć.${txtrst}"
        chmod -R 775 /home/kiosk/MediaPionowe
        echo -e "Utworzono katalog /home/kiosk/MediaPionowe\t${txtgreen}[OK]${txtrst}"
    fi
    
    # Konfiguracja vsftpd
    cp /etc/vsftpd.conf /etc/vsftpd.conf.bak || echo -e "${txtyellow}Uwaga: Nie można utworzyć kopii zapasowej konfiguracji.${txtrst}"
    
    # Stworzenie nowego pliku konfiguracyjnego
    echo "
pasv_min_port=40000
pasv_max_port=50000
local_root=/home/kiosk/MediaPionowe
allow_writeable_chroot=yes
write_enable=YES
chroot_local_user=YES
    " >> /etc/vsftpd.conf
    
    echo -e "Konfiguracja vsftpd\t${txtgreen}[OK]${txtrst}"

    # Restartowanie usługi vsftpd
    systemctl enable vsftpd || echo -e "${txtyellow}Uwaga: Nie można włączyć usługi vsftpd.${txtrst}"
    systemctl restart vsftpd || { echo -e "${txtred}Błąd podczas uruchamiania vsftpd!${txtrst}"; return 1; }
    
    echo -e "${txtgreen}Instalacja vsftpd zakończona pomyślnie!${txtrst}"
}

# Funkcja kopiująca pliki
kopiuj_pliki() {
    echo -e "${txtyellow}Kopiowanie plików do odpowiednich folderów...${txtrst}"
    
    # Zapytanie do użytkownika o istnienie plików
    echo -e "${txtyellow}Czy posiadasz pliki ipdoapi.py i ipdoapi.service do skopiowania? (t/n)${txtrst}"
    read -p "Odpowiedź: " pliki_istnieja
    if [ "$pliki_istnieja" != "t" ] && [ "$pliki_istnieja" != "T" ]; then
        echo -e "${txtred}Pliki nie istnieją. Proces kopiowania przerwany.${txtrst}"
        return 1
    fi
    
    # Sprawdzenie czy pliki faktycznie istnieją
    plik_py_istnieje=false
    plik_service_istnieje=false
    
    if [ -f "./ipdoapi.py" ]; then
        plik_py_istnieje=true
    else
        echo -e "${txtred}Plik ipdoapi.py nie istnieje w bieżącym katalogu!${txtrst}"
    fi
    
    if [ -f "./ipdoapi.service" ]; then
        plik_service_istnieje=true
    else
        echo -e "${txtred}Plik ipdoapi.service nie istnieje w bieżącym katalogu!${txtrst}"
    fi
    
    # Sprawdzenie czy którykolwiek plik istnieje
    if [ "$plik_py_istnieje" = false ] && [ "$plik_service_istnieje" = false ]; then
        echo -e "${txtred}Żaden z plików nie istnieje. Proces kopiowania przerwany.${txtrst}"
        return 1
    fi
    
    # Kopiowanie pliku ipdoapi.py jeśli istnieje
    if [ "$plik_py_istnieje" = true ]; then
        # Pytanie o adres IP serwera API
        echo -e "${txtyellow}Podaj adres IP serwera, na którym działa strona (np. 192.168.0.100):${txtrst}"
        read -p "Adres IP: " server_ip
        
        if [ -n "$server_ip" ]; then
            # Sprawdzenie poprawności formatu adresu IP
            if ! [[ $server_ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                echo -e "${txtred}Podany adres IP jest nieprawidłowy. Używam oryginalnego adresu.${txtrst}"
                cp -v ./ipdoapi.py /etc/systemd/system/ || { echo -e "${txtred}Błąd podczas kopiowania pliku ipdoapi.py!${txtrst}"; return 1; }
            else
                # Tworzenie tymczasowej kopii pliku ipdoapi.py z zaktualizowanym adresem IP
                echo -e "Aktualizacja adresu IP w pliku ipdoapi.py na $server_ip..."
                # Używa sed do zastąpienia linii z API_BASE_URL
                sed "s|API_BASE_URL = \"http://[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:5000/api/\"|API_BASE_URL = \"http://$server_ip:5000/api/\"|g" ./ipdoapi.py > ./ipdoapi.py.tmp || { echo -e "${txtred}Błąd podczas modyfikacji pliku!${txtrst}"; return 1; }
                
                # Kopiowanie zaktualizowanego pliku do docelowej lokalizacji
                cp -v ./ipdoapi.py.tmp /etc/systemd/system/ipdoapi.py || { echo -e "${txtred}Błąd podczas kopiowania pliku!${txtrst}"; return 1; }
                rm -f ./ipdoapi.py.tmp  # Usuwanie tymczasowego pliku
                
                echo -e "Zaktualizowano i skopiowano ipdoapi.py\t${txtgreen}[OK]${txtrst}"
            fi
        else
            # Jeśli użytkownik nie podał adresu IP, kopiujemy oryginalny plik
            cp -v ./ipdoapi.py /etc/systemd/system/ || { echo -e "${txtred}Błąd podczas kopiowania pliku!${txtrst}"; return 1; }
            echo -e "Skopiowano oryginalny ipdoapi.py bez zmian\t${txtgreen}[OK]${txtrst}"
        fi
    fi
    
    # Kopiowanie pliku ipdoapi.service jeśli istnieje
    if [ "$plik_service_istnieje" = true ]; then
        cp -v ./ipdoapi.service /etc/systemd/system/ || { echo -e "${txtred}Błąd podczas kopiowania pliku ipdoapi.service!${txtrst}"; return 1; }
        echo -e "Skopiowano ipdoapi.service\t${txtgreen}[OK]${txtrst}"
        
        # Jeśli także plik .py został skopiowany, możemy uruchomić usługę
        if [ "$plik_py_istnieje" = true ] && [ -f "/etc/systemd/system/ipdoapi.py" ]; then
            # Opcjonalnie można od razu włączyć usługę
            systemctl daemon-reload || echo -e "${txtyellow}Uwaga: Nie można przeładować usług systemd.${txtrst}"
            chmod +rx /etc/systemd/system/ipdoapi.py || echo -e "${txtyellow}Uwaga: Nie można ustawić uprawnień wykonywania dla pliku.${txtrst}"
            systemctl enable ipdoapi.service || echo -e "${txtyellow}Uwaga: Nie można włączyć usługi ipdoapi.${txtrst}"
            systemctl start ipdoapi.service || echo -e "${txtred}Błąd podczas uruchamiania usługi ipdoapi!${txtrst}"
            echo -e "Włączono usługę ipdoapi\t${txtgreen}[OK]${txtrst}"
        else
            echo -e "${txtyellow}Uwaga: Plik ipdoapi.py nie został skopiowany, usługa nie może zostać uruchomiona.${txtrst}"
        fi
    fi
    
    echo -e "${txtgreen}Kopiowanie plików zakończone!${txtrst}"
}

# Funkcja instalująca noVNC z x11vnc
instaluj_novnc() {
    echo -e "${txtyellow}Rozpoczynam instalację noVNC z x11vnc...${txtrst}"
    
    # Instalacja x11vnc
    apt-get update
    apt-get install -y x11vnc git
    
    git clone https://github.com/novnc/noVNC /home/kiosk/noVNC
    echo -e "Pobrano noVNC\t${txtgreen}[OK]${txtrst}"
    
    # Tworzenie pliku jednostki systemd dla noVNC
    cat > /etc/systemd/system/novnc.service << EOF
[Unit]
Description = start noVNC service
After=syslog.target network.target

[Service]
Type=simple
User=$USER
ExecStart=/home/kiosk/noVNC/utils/novnc_proxy

[Install]
WantedBy=multi-user.target
EOF
    
    # Generowanie hasła dla x11vnc
    read -p "Podaj hasło dla połączeń VNC: " vncpassword
    sudo x11vnc -storepasswd $vncpassword /etc/x11vnc.pass
    
    # Tworzenie pliku jednostki systemd dla x11vnc
    cat > /etc/systemd/system/x11vnc.service << EOF
[Unit]
Description="x11vnc"
Requires=display-manager.service
After=display-manager.service

[Service]
ExecStart=/usr/bin/x11vnc -xkb -noxrecord -noxfixes -noxdamage -display :0 -forever -auth guess -rfbauth /etc/x11vnc.pass
ExecStop=/usr/bin/killall x11vnc
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
    
    # Włączanie i uruchamianie usług
    systemctl daemon-reload
    systemctl enable x11vnc
    systemctl enable novnc
    systemctl start x11vnc
    systemctl start novnc
    
    echo -e "${txtgreen}Instalacja noVNC z x11vnc zakończona pomyślnie!${txtrst}"
}

# Funkcja pokazująca informacje systemowe
pokaz_informacje_systemowe() {
    echo -e "${txtyellow}Pobieram informacje systemowe...${txtrst}"
    
    # Adres MAC głównego interfejsu sieciowego
    echo -e "${txtgreen}--- Informacje o adresie MAC ---${txtrst}"
    if command -v ip &> /dev/null; then
        # Użycie narzędzia IP (nowszy sposób)
        MAIN_INTERFACE=$(ip -o -4 route show to default | awk '{print $5}' | head -n1)
        if [ -n "$MAIN_INTERFACE" ]; then
            MAC_ADDRESS=$(ip link show $MAIN_INTERFACE | awk '/ether/ {print $2}')
            echo -e "Interfejs: $MAIN_INTERFACE"
            echo -e "Adres MAC: ${txtgreen}$MAC_ADDRESS${txtrst}"
        else
            echo -e "${txtred}Nie można znaleźć głównego interfejsu sieciowego.${txtrst}"
        fi
    elif command -v ifconfig &> /dev/null; then
        # Użycie narzędzia ifconfig (starszy sposób)
        MAIN_INTERFACE=$(route -n | grep '^0.0.0.0' | awk '{print $8}' | head -n1)
        if [ -n "$MAIN_INTERFACE" ]; then
            MAC_ADDRESS=$(ifconfig $MAIN_INTERFACE | awk '/ether/ {print $2}')
            echo -e "Interfejs: $MAIN_INTERFACE"
            echo -e "Adres MAC: ${txtgreen}$MAC_ADDRESS${txtrst}"
        else
            echo -e "${txtred}Nie można znaleźć głównego interfejsu sieciowego.${txtrst}"
        fi
    else
        echo -e "${txtred}Brak narzędzi do pobierania adresu MAC (ip lub ifconfig).${txtrst}"
        echo -e "${txtyellow}Instaluję potrzebne narzędzia...${txtrst}"
        apt-get update -qq
        apt-get install -y net-tools
        
        # Ponowna próba pobrania adresu MAC
        MAIN_INTERFACE=$(route -n | grep '^0.0.0.0' | awk '{print $8}' | head -n1)
        if [ -n "$MAIN_INTERFACE" ]; then
            MAC_ADDRESS=$(ifconfig $MAIN_INTERFACE | awk '/ether/ {print $2}')
            echo -e "Interfejs: $MAIN_INTERFACE"
            echo -e "Adres MAC: ${txtgreen}$MAC_ADDRESS${txtrst}"
        else
            echo -e "${txtred}Nie można znaleźć głównego interfejsu sieciowego.${txtrst}"
        fi
    fi
    
    # Numer seryjny (próba kilku metod dla różnych systemów)
    echo -e "\n${txtgreen}--- Informacje o numerze seryjnym ---${txtrst}"
    
    # Metoda 1: Sprawdzenie numeru seryjnego motherboard
    if [ -f /sys/class/dmi/id/product_serial ]; then
        SERIAL=$(cat /sys/class/dmi/id/product_serial)
        echo -e "Numer seryjny płyty głównej: ${txtgreen}$SERIAL${txtrst}"
    fi
    
    # Metoda 2: Sprawdzenie numeru seryjnego dla Raspberry Pi
    if [ -f /proc/cpuinfo ]; then
        RPI_SERIAL=$(grep Serial /proc/cpuinfo | awk '{print $3}')
        if [ -n "$RPI_SERIAL" ]; then
            echo -e "Numer seryjny Raspberry Pi: ${txtgreen}$RPI_SERIAL${txtrst}"
        fi
    fi
    
    # Metoda 3: Użycie narzędzia dmidecode
    if command -v dmidecode &> /dev/null; then
        echo -e "\nSzczegółowe informacje o systemie:"
        # Pobranie informacji o systemie
        dmidecode -t system | grep -E "Manufacturer|Product|Serial"
    else
        echo -e "${txtyellow}Narzędzie dmidecode nie jest zainstalowane. Czy chcesz je zainstalować? (t/n)${txtrst}"
        read -p "Wybór: " install_dmidecode
        if [ "$install_dmidecode" = "t" ] || [ "$install_dmidecode" = "T" ]; then
            apt-get update -qq
            apt-get install -y dmidecode
            echo -e "\nSzczegółowe informacje o systemie:"
            dmidecode -t system | grep -E "Manufacturer|Product|Serial"
        fi
    fi
    
    echo -e "\n${txtgreen}Pobieranie informacji systemowych zakończone!${txtrst}"
}

# Główna część skryptu

echo -e "${txtgreen}=== SKRYPT INSTALACYJNY ====${txtrst}"
echo -e "${txtgreen}=== Data: 19.05.2025 ===${txtrst}\n"

# Sprawdzenie środowiska
sprawdz_srodowisko

# Menu wyboru akcji
while true; do
    echo -e "\n${txtyellow}MENU:${txtrst}"
    echo "1. Instalacja vsftpd"
    echo "2. Kopiowanie plików"
    echo "3. Instalacja noVNC z x11vnc"
    echo "4. Wykonaj wszystko"
    echo "5. Pokaż informacje systemowe"
    echo "0. Wyjście"
    
    read -p "Wybierz opcję (0-5): " opcja
    
    case $opcja in
        1)
            instaluj_vsftpd
            ;;
        2)
            kopiuj_pliki
            ;;
        3)
            instaluj_novnc
            ;;
        4)
            instaluj_vsftpd
            kopiuj_pliki
            instaluj_novnc
            ;;
        5)
            pokaz_informacje_systemowe
            ;;
        0)
            echo -e "${txtgreen}Do widzenia!${txtrst}"
            exit 0
            ;;
        *)
            echo -e "${txtred}Nieprawidłowa opcja!${txtrst}"
            ;;
    esac
done
