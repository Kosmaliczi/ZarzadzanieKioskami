import requests
import json
import subprocess
import platform
import re
import time


# --- Konfiguracja ---
# Ustaw tutaj bazowy URL swojego serwera MediaHub API
API_BASE_URL = "http://192.168.0.107:5000/api/"

# Częstotliwość raportowania adresu IP (w sekundach)
REPORT_INTERVAL = 30  # Raportowanie co 30 sekund dla lepszej aktualizacji statusu

def get_device_serial():
    """
    Pobiera numer seryjny urządzenia.
    Specyficzne dla Raspberry Pi, dla innych systemów może zwrócić None.
    """
    system = platform.system().lower()
    if system == "linux":
        try:
            # Próba odczytania numeru seryjnego z /proc/cpuinfo (typowe dla Raspberry Pi)
            process = subprocess.Popen(
                "cat /proc/cpuinfo | grep Serial | cut -d ' ' -f 2",
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            stdout, stderr = process.communicate(timeout=5)
            if process.returncode == 0 and stdout.strip():
                return stdout.strip()
            else:
                print(f"Nie udało się pobrać numeru seryjnego z /proc/cpuinfo. Błąd: {stderr.strip()}")
        except subprocess.TimeoutExpired:
            print("Timeout podczas próby pobrania numeru seryjnego.")
        except Exception as e:
            print(f"Wystąpił błąd podczas próby pobrania numeru seryjnego: {e}")
    else:
        print(f"Automatyczne pobieranie numeru seryjnego nie jest wspierane dla systemu: {system}")
    return None

def get_ip_address():
    """
    Pobiera główny (pierwszy znaleziony) adres IP urządzenia.
    """
    system = platform.system().lower()
    ip_address = None
    try:
        if system == "linux":
            # Użyj 'hostname -I' aby uzyskać listę adresów IP, weź pierwszy
            process = subprocess.Popen(
                "hostname -I",
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            stdout, stderr = process.communicate(timeout=5)
            if process.returncode == 0 and stdout.strip():
                ip_address = stdout.strip().split(' ')[0]
            else:
                print(f"Nie udało się pobrać adresu IP za pomocą 'hostname -I'. Błąd: {stderr.strip()}")

        elif system == "windows":
            # Użyj 'ipconfig' i sparsuj wynik
            process = subprocess.Popen(
                "ipconfig",
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            stdout, stderr = process.communicate(timeout=10)
            if process.returncode == 0:
                # Szukaj linii z adresem IPv4
                # To wyrażenie regularne może wymagać dostosowania w zależności od języka systemu Windows
                match = re.search(r"IPv4 Address[.\s]*:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", stdout, re.IGNORECASE)
                if not match: # Spróbuj polskiej wersji
                    match = re.search(r"Adres IPv4[.\s]*:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", stdout, re.IGNORECASE)
                
                if match:
                    ip_address = match.group(1)
                else:
                    print("Nie znaleziono adresu IPv4 w wyniku polecenia 'ipconfig'.")
            else:
                print(f"Nie udało się pobrać adresu IP za pomocą 'ipconfig'. Błąd: {stderr.strip()}")
        else:
            print(f"Automatyczne pobieranie adresu IP nie jest wspierane dla systemu: {system}")
        
        return ip_address

    except subprocess.TimeoutExpired:
        print(f"Timeout podczas próby pobrania adresu IP dla systemu {system}.")
    except Exception as e:
        print(f"Wystąpił błąd podczas próby pobrania adresu IP dla systemu {system}: {e}")
    return None


def report_device_ip(api_base_url, device_serial, ip_address):
    """
    Wysyła adres IP urządzenia do serwera MediaHub API.

    :param api_base_url: Bazowy URL serwera API (np. http://localhost:5000/api)
    :param device_serial: Numer seryjny urządzenia.
    :param ip_address: Nowy adres IP urządzenia.
    """
    endpoint_url = f"{api_base_url.rstrip('/')}/device/{device_serial}/ip"
    payload = {"ip_address": ip_address}
    headers = {"Content-Type": "application/json"}

    print(f"Wysyłanie żądania PUT do: {endpoint_url}")
    print(f"Dane: {json.dumps(payload)}")

    try:
        response = requests.put(endpoint_url, json=payload, headers=headers, timeout=10)
        
        print(f"Status odpowiedzi: {response.status_code}")
        try:
            response_data = response.json()
            print("Odpowiedź serwera:")
            print(json.dumps(response_data, indent=2, ensure_ascii=False))
        except json.JSONDecodeError:
            print("Nie udało się zdekodować odpowiedzi JSON. Surowa odpowiedź:")
            print(response.text)

        if response.ok:
            print("Adres IP został pomyślnie zaktualizowany.")
            if response_data.get('status') == 'online':
                print("Status urządzenia: ONLINE")
        else:
            print(f"Błąd podczas aktualizacji adresu IP. Serwer odpowiedział: {response.status_code}")

    except requests.exceptions.ConnectionError as e:
        print(f"Błąd połączenia: Nie można połączyć się z serwerem API pod adresem {api_base_url}.")
        print(f"Szczegóły: {e}")
    except requests.exceptions.Timeout:
        print("Błąd: Żądanie przekroczyło limit czasu.")
    except requests.exceptions.RequestException as e:
        print(f"Wystąpił błąd żądania: {e}")

if __name__ == "__main__":
    print("Automatyczne pobieranie informacji o urządzeniu...")
    
    current_serial = get_device_serial()
    current_ip = get_ip_address()

    if not current_serial:
        print("Nie udało się automatycznie pobrać numeru seryjnego urządzenia. Przerwanie działania.")
        exit(1)
        
    if not current_ip:
        print("Nie udało się automatycznie pobrać adresu IP urządzenia. Przerwanie działania.")
        # Można by tu ewentualnie wysłać "DHCP" jako IP, jeśli to pożądane
        # current_ip = "DHCP" 
        exit(1)

    print(f"Pobrany numer seryjny: {current_serial}")
    print(f"Pobrany adres IP: {current_ip}")
    
    print(f"Rozpoczynam cykliczne raportowanie statusu co {REPORT_INTERVAL} sekund...")
    
    while True:
        # Pobierz aktualny adres IP przed każdym raportem
        updated_ip = get_ip_address() or current_ip
        report_device_ip(API_BASE_URL, current_serial, updated_ip)
        time.sleep(REPORT_INTERVAL)
