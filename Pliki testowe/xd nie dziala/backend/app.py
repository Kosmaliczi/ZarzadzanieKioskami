import os
import sqlite3
import datetime
from flask import Flask, request, jsonify, send_file, after_this_request
from flask_cors import CORS
import ftplib
from dotenv import load_dotenv
import tempfile
import base64

# Ładowanie zmiennych środowiskowych
load_dotenv()

app = Flask(__name__)
CORS(app)

# Klucz do szyfrowania/deszyfrowania (powinien być taki sam jak w pliku config.js)
ENCRYPTION_KEY = 'kiosk-manager-secure-key-2025'

# Funkcja do deszyfrowania danych
def decrypt_data(encrypted_text):
    # Jeśli nie ma tekstu do odszyfrowania, zwróć pusty ciąg
    if not encrypted_text:
        return ''
    
    try:
        # Dodaj logi dla debugowania
        print(f"Próba deszyfrowania tekstu o długości: {len(encrypted_text)}")
        
        # Dekodowanie Base64
        encrypted_string = base64.b64decode(encrypted_text).decode('utf-8')
        
        # Deszyfrowanie XOR z kluczem
        result = []
        for i in range(len(encrypted_string)):
            char_code = ord(encrypted_string[i]) ^ ord(ENCRYPTION_KEY[i % len(ENCRYPTION_KEY)])
            result.append(chr(char_code))
        
        decrypted = ''.join(result)
        print(f"Deszyfrowanie zakończone pomyślnie. Długość odszyfrowanego tekstu: {len(decrypted)}")
        return decrypted
    except Exception as e:
        print(f'Błąd podczas deszyfrowania: {e}')
        return ''

# Konfiguracja bazy danych
DATABASE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'database', 'kiosks.db')

def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if not os.path.exists(os.path.dirname(DATABASE_PATH)):
        os.makedirs(os.path.dirname(DATABASE_PATH))
    
    conn = get_db_connection()
    with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'database', 'schema.sql'), 'r') as f:
        conn.executescript(f.read())
    conn.commit()
    conn.close()

# Inicjalizacja bazy danych przy starcie
init_db()

# Funkcja aktualizująca statusy kiosków na podstawie czasu ostatniego połączenia
def update_kiosk_statuses():
    conn = get_db_connection()
    # Pobierz czas 1 minuty temu
    two_minutes_ago = (datetime.datetime.now() - datetime.timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S')
    
    # Zaktualizuj statusy kiosków, które nie połączyły się w ciągu ostatnich 1 minut
    conn.execute(
        'UPDATE kiosks SET status = "offline" WHERE last_connection < ? AND status != "offline"',
        (two_minutes_ago,)
    )
    conn.commit()
    conn.close()

# Endpoint do weryfikacji danych logowania
@app.route('/api/auth/login', methods=['POST'])
def verify_login():
    data = request.json
    
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Brakujące dane logowania"}), 400
    
    username = data['username']
    password = data['password']
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()
    
    if user and user['password'] == password:  # W produkcji powinno być używane hashowanie haseł
        return jsonify({
            "success": True,
            "username": username,
            "message": "Logowanie pomyślne"
        })
    else:
        return jsonify({
            "success": False,
            "message": "Nieprawidłowa nazwa użytkownika lub hasło"
        }), 401

# Dodanie domyślnego użytkownika, jeśli tabela jest pusta
def init_default_user():
    conn = get_db_connection()
    user_count = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
    
    if user_count == 0:
        conn.execute(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            ('admin', 'admin')  # W produkcji powinno być używane hashowanie haseł
        )
        conn.commit()
    
    conn.close()

# Inicjalizacja domyślnego użytkownika przy starcie
init_default_user()

# Obsługa FTP
def ftp_connect(hostname, username, password, port=21):
    try:
        ftp = ftplib.FTP()
        ftp.connect(hostname, port)
        ftp.login(username, password)
        return ftp
    except Exception as e:
        print(f"FTP connection error: {e}")
        return None

# Nowa funkcja do tworzenia katalogów FTP
def ftp_create_directory(ftp, path):
    try:
        ftp.mkd(path)
        return True
    except Exception as e:
        print(f"FTP mkdir error: {e}")
        return False

# Nowa funkcja do usuwania plików/katalogów FTP
def ftp_delete_file(ftp, path, is_directory=False):
    try:
        if is_directory:
            # Rekurencyjne usuwanie katalogów nie jest zaimplementowane w podstawowej bibliotece
            # Dla prostych przypadków można użyć:
            ftp.rmd(path)
        else:
            ftp.delete(path)
        return True
    except Exception as e:
        print(f"FTP delete error: {e}")
        return False

# Nowa funkcja do pobierania zawartości pliku
def ftp_get_file_content(ftp, path):
    try:
        # Utwórz tymczasowy plik do pobrania zawartości
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            # Pobierz plik z FTP
            ftp.retrbinary(f'RETR {path}', temp_file.write)
            temp_file_path = temp_file.name
        
        # Odczytaj zawartość pobranego pliku
        with open(temp_file_path, 'r') as file:
            content = file.read()
        
        # Usuń tymczasowy plik
        os.unlink(temp_file_path)
        
        return content
    except Exception as e:
        print(f"FTP get file content error: {e}")
        return None

# Nowa funkcja do zapisu zawartości pliku
def ftp_put_file_content(ftp, path, content):
    try:
        # Utwórz tymczasowy plik z zawartością
        with tempfile.NamedTemporaryFile(delete=False, mode='w') as temp_file:
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        # Wyślij plik do FTP
        with open(temp_file_path, 'rb') as file:
            ftp.storbinary(f'STOR {path}', file)
        
        # Usuń tymczasowy plik
        os.unlink(temp_file_path)
        
        return True
    except Exception as e:
        print(f"FTP put file content error: {e}")
        return False

# Endpointy API


@app.route('/api/settings', methods=['GET'])
def get_settings():
    conn = get_db_connection()
    settings = conn.execute('SELECT * FROM settings').fetchall()
    conn.close()
    
    # Zwróć wszystkie ustawienia jako słownik
    settings_dict = {setting['key']: setting['value'] for setting in settings}
    
    return jsonify(settings_dict)

@app.route('/api/settings', methods=['POST'])
def update_settings():
    data = request.json
    
    if not data:
        return jsonify({"error": "Brak danych do aktualizacji"}), 400
    
    # Wymuszenie nazwy użytkownika SSH jako "kiosk"
    if 'defaultSshUsername' in data:
        data['defaultSshUsername'] = 'kiosk'
    
    # Debugowanie - wypisanie danych z żądania
    print(f"Otrzymano dane do aktualizacji ustawień: {data.keys()}")
    if 'defaultSshPassword' in data:
        print(f"Otrzymano hasło SSH o długości: {len(data['defaultSshPassword'])}")
    
    conn = get_db_connection()
    
    for key, value in data.items():
        conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, value))
    
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Ustawienia zaktualizowane pomyślnie"})

@app.route('/api/kiosks', methods=['GET'])
def get_kiosks():
    # Aktualizuj statusy kiosków przed zwróceniem wyników
    update_kiosk_statuses()
    
    # Sprawdź, czy zapytanie pochodzi bezpośrednio po aktualizacji IP
    # Możemy to sprawdzić na podstawie nagłówka referer
    referer = request.headers.get('Referer', '')
    user_agent = request.headers.get('User-Agent', '')
    
    # Jeśli żądanie pochodzi od kiosku (prawdopodobnie po aktualizacji IP)
    # możemy to wykryć na podstawie nagłówków lub źródła żądania
    if 'Kiosk-Device' in user_agent or '/api/device/' in referer:
        # Zwróć minimalną odpowiedź (tylko podstawowe dane)
        conn = get_db_connection()
        kiosks = conn.execute('SELECT id, name, serial_number, ip_address, status FROM kiosks').fetchall()
        conn.close()
        
        # Dodaj specjalny flag do odpowiedzi - frontend będzie wiedział, żeby nie odświeżać UI
        response = jsonify({
            "kiosks": [dict(kiosk) for kiosk in kiosks],
            "no_refresh": True
        })
        response.headers['X-No-Refresh'] = 'true'
        return response
    
    # Standardowa odpowiedź dla normalnych zapytań z frontendu
    conn = get_db_connection()
    kiosks = conn.execute('SELECT * FROM kiosks').fetchall()
    conn.close()
    
    return jsonify([dict(kiosk) for kiosk in kiosks])

@app.route('/api/kiosks', methods=['POST'])
def add_kiosk():
    data = request.json
    
    if not data or 'mac_address' not in data or 'serial_number' not in data:
        return jsonify({"error": "Brakujące dane: wymagane mac_address i serial_number"}), 400
    
    conn = get_db_connection()
    try:
        conn.execute(
            'INSERT INTO kiosks (mac_address, serial_number, name, ftp_username, ftp_password) VALUES (?, ?, ?, ?, ?)',
            (data['mac_address'], data['serial_number'], data.get('name', ''),
             data.get('ftp_username', ''), data.get('ftp_password', ''))
        )
        conn.commit()
        kiosk_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.close()
        
        return jsonify({"id": kiosk_id, "message": "Kiosk dodany pomyślnie"}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Kiosk o podanym MAC lub S/N już istnieje"}), 409
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500

@app.route('/api/kiosks/<int:kiosk_id>', methods=['PUT'])
def update_kiosk(kiosk_id):
    data = request.json
    
    if not data:
        return jsonify({"error": "Brak danych do aktualizacji"}), 400
    
    conn = get_db_connection()
    
    # Sprawdzenie, czy kiosk istnieje
    kiosk = conn.execute('SELECT * FROM kiosks WHERE id = ?', (kiosk_id,)).fetchone()
    if not kiosk:
        conn.close()
        return jsonify({"error": "Kiosk nie znaleziony"}), 404
    
    # Pola, które można aktualizować
    update_fields = {
        'name': data.get('name'),
        'mac_address': data.get('mac_address'),
        'serial_number': data.get('serial_number'),
        'ftp_username': data.get('ftp_username'),
        'ftp_password': data.get('ftp_password'),
        'updated_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }
    
    # Usuń None z dict
    update_fields = {k: v for k, v in update_fields.items() if v is not None}
    
    if not update_fields:
        conn.close()
        return jsonify({"error": "Brak ważnych pól do aktualizacji"}), 400
    
    try:
        query = 'UPDATE kiosks SET ' + ', '.join([f"{k} = ?" for k in update_fields.keys()]) + ' WHERE id = ?'
        conn.execute(query, list(update_fields.values()) + [kiosk_id])
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Kiosk zaktualizowany pomyślnie"})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Konflikt danych - MAC lub S/N już istnieje"}), 409
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500

@app.route('/api/kiosks/<int:kiosk_id>', methods=['DELETE'])
def delete_kiosk(kiosk_id):
    conn = get_db_connection()
    
    # Sprawdzenie, czy kiosk istnieje
    kiosk = conn.execute('SELECT * FROM kiosks WHERE id = ?', (kiosk_id,)).fetchone()
    if not kiosk:
        conn.close()
        return jsonify({"error": "Kiosk nie znaleziony"}), 404
    
    conn.execute('DELETE FROM kiosks WHERE id = ?', (kiosk_id,))
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Kiosk usunięty pomyślnie"})

@app.route('/api/device/<string:serial_number>/ip', methods=['POST', 'PUT'])
def update_device_ip(serial_number):
    # Obsługa zarówno metody POST jak i PUT
    if request.method == 'PUT':
        try:
            data = request.get_json(silent=True) or {}
        except:
            try:
                raw_data = request.get_data(as_text=True)
                data = {"mac_address": raw_data.strip()} if raw_data else {}
            except:
                data = {}
    else:
        data = request.json or {}

    ip_address = data.get('ip_address') or request.remote_addr
    mac_address = data.get('mac_address', '')

    conn = get_db_connection()

    kiosk = conn.execute(
        'SELECT * FROM kiosks WHERE serial_number = ?', 
        (serial_number,)
    ).fetchone()

    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if not kiosk:
        # Zamykamy połączenie z bazą danych
        conn.close()
        # Odrzucamy aktualizację IP dla niezarejestrowanych urządzeń
        return jsonify({
            "status": "error", 
            "message": "Kiosk o podanym numerze seryjnym nie jest zarejestrowany w systemie"
        }), 404

    update_query = 'UPDATE kiosks SET ip_address = ?, last_connection = ?, status = ?, updated_at = ?'
    update_params = [ip_address, now, 'online', now]

    if mac_address:
        update_query += ', mac_address = ?'
        update_params.append(mac_address)

    update_query += ' WHERE serial_number = ?'
    update_params.append(serial_number)

    conn.execute(update_query, update_params)
    conn.commit()
    conn.close()

    # Zwróć prostą odpowiedź JSON bez żadnych nagłówków sterujących
    return jsonify({"status": "ok", "action": "updated"})

@app.route('/api/ftp/connect', methods=['POST'])
def test_ftp_connection():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Brakujące dane połączenia FTP"}), 400
    
    # Konwersja portu na int
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    ftp = ftp_connect(data['hostname'], data['username'], data['password'], port)
    
    if ftp:
        ftp.quit()
        return jsonify({"message": "Połączenie FTP udane"})
    else:
        return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500

@app.route('/api/ftp/files', methods=['POST'])
def list_ftp_files():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Brakujące dane połączenia FTP"}), 400
    
    remote_path = data.get('path', '/home/kiosk/MediaPionowe')
    
    # Konwersja portu na int
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    ftp = ftp_connect(data['hostname'], data['username'], data['password'], port)
    
    if not ftp:
        return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500
    
    try:
        # Zmieniamy katalog na podany
        ftp.cwd(remote_path)
        
        # Pobieramy listę plików i katalogów
        files = []
        ftp.dir(lambda line: files.append(line))
        
        file_info = []
        for line in files:
            # Parsujemy dane z formatu DIR - typowy format Unix
            parts = line.split(None, 8)
            if len(parts) < 9:
                continue
                
            permissions = parts[0]
            size = parts[4]
            date_str = f"{parts[5]} {parts[6]} {parts[7]}"
            name = parts[8]
            
            # Sprawdzanie, czy to katalog (pierwszy znak permissions to 'd')
            is_dir = permissions.startswith('d')
            
            try:
                # Próba przekształcenia rozmiaru na liczbę
                size_num = int(size)
            except ValueError:
                size_num = 0
                
            # Tworzenie ścieżki
            full_path = os.path.join(remote_path, name)
                
            # Formatowanie daty modyfikacji
            try:
                if ':' in parts[7]:  # Format "Oct 14 13:45" (rok bieżący)
                    current_year = datetime.datetime.now().year
                    mod_date = datetime.datetime.strptime(f"{date_str} {current_year}", "%b %d %H:%M %Y")
                else:  # Format "Oct 14 2022" (rok podany)
                    mod_date = datetime.datetime.strptime(date_str, "%b %d %Y")
                modified = mod_date.strftime('%Y-%m-%d %H:%M:%S')
            except ValueError:
                modified = "Nieznana data"
                
            file_info.append({
                "name": name,
                "path": full_path,
                "is_directory": is_dir,
                "size": size_num,
                "modified": modified
            })
                
        ftp.quit()
        return jsonify(file_info)
    except Exception as e:
        try:
            ftp.quit()
        except:
            pass
        return jsonify({"error": f"Błąd podczas listowania plików: {str(e)}"}), 500

@app.route('/api/ftp/upload', methods=['POST'])
def upload_ftp_file():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data or 'file_data' not in data:
        return jsonify({"error": "Brakujące dane do przesłania pliku"}), 400
    
    remote_path = data.get('path', '/home/kiosk/MediaPionowe')
    file_name = data.get('file_name')
    file_data = data.get('file_data')
    
    if not file_name or not file_data:
        return jsonify({"error": "Brak nazwy pliku lub danych pliku"}), 400
    
    # Konwersja portu na int
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    # Dekodowanie danych pliku z base64
    try:
        # Usunięcie nagłówka 'data:...' jeśli istnieje
        if ';base64,' in file_data:
            file_data = file_data.split(';base64,')[1]
        
        file_bytes = base64.b64decode(file_data)
    except Exception as e:
        return jsonify({"error": f"Błąd dekodowania danych pliku: {str(e)}"}), 400
    
    # Połączenie z serwerem FTP
    ftp = ftp_connect(data['hostname'], data['username'], data['password'], port)
    
    if not ftp:
        return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500
    
    try:
        # Zmieniamy katalog na podany
        ftp.cwd(remote_path)
        
        # Tworzenie tymczasowego pliku lokalnego
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(file_bytes)
            temp_file_path = temp_file.name
        
        # Przesyłanie pliku
        with open(temp_file_path, 'rb') as file:
            ftp.storbinary(f'STOR {file_name}', file)
        
        # Usunięcie tymczasowego pliku
        os.remove(temp_file_path)
        
        ftp.quit()
        return jsonify({"message": f"Plik {file_name} został pomyślnie przesłany"})
    except Exception as e:
        try:
            ftp.quit()
        except:
            pass
        
        # Próba usunięcia tymczasowego pliku
        try:
            os.remove(temp_file_path)
        except:
            pass
            
        return jsonify({"error": f"Błąd podczas przesyłania pliku: {str(e)}"}), 500

@app.route('/api/ftp/delete', methods=['POST'])
def delete_ftp_file():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data or 'path' not in data:
        return jsonify({"error": "Brakujące dane do usunięcia pliku"}), 400
    
    file_path = data['path']
    is_directory = data.get('is_directory', False)
    
    # Konwersja portu na int
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    # Połączenie z serwerem FTP
    ftp = ftp_connect(data['hostname'], data['username'], data['password'], port)
    
    if not ftp:
        return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500
    
    try:
        # Usunięcie pliku lub katalogu
        result = ftp_delete_file(ftp, file_path, is_directory)
        
        ftp.quit()
        
        if result:
            return jsonify({"message": f"{'Katalog' if is_directory else 'Plik'} został pomyślnie usunięty"})
        else:
            return jsonify({"error": f"Nie można usunąć {'katalogu' if is_directory else 'pliku'}"}), 500
    except Exception as e:
        try:
            ftp.quit()
        except:
            pass
        return jsonify({"error": f"Błąd podczas usuwania: {str(e)}"}), 500

@app.route('/api/ftp/delete-multiple', methods=['POST'])
def delete_multiple_ftp_files():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data or 'files' not in data:
        return jsonify({"error": "Brakujące dane do usunięcia plików"}), 400
    
    files = data['files']
    
    if not isinstance(files, list) or len(files) == 0:
        return jsonify({"error": "Lista plików do usunięcia jest pusta lub nieprawidłowa"}), 400
    
    # Konwersja portu na int
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    # Połączenie z serwerem FTP
    ftp = ftp_connect(data['hostname'], data['username'], data['password'], port)
    
    if not ftp:
        return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500
    
    try:
        results = []
        for file_info in files:
            path = file_info.get('path')
            is_directory = file_info.get('isDirectory', False)
            
            if not path:
                results.append({"path": "Nieznana ścieżka", "success": False, "error": "Brak ścieżki"})
                continue
                
            try:
                result = ftp_delete_file(ftp, path, is_directory)
                results.append({"path": path, "success": result, "is_directory": is_directory})
            except Exception as e:
                results.append({"path": path, "success": False, "error": str(e), "is_directory": is_directory})
        
        ftp.quit()
        
        # Sprawdź, czy były jakieś błędy
        had_errors = any(not r['success'] for r in results)
        
        if had_errors:
            return jsonify({
                "message": "Niektóre pliki nie zostały usunięte",
                "results": results
            }), 207  # 207 Multi-Status
        else:
            return jsonify({
                "message": "Wszystkie pliki zostały pomyślnie usunięte",
                "results": results
            })
    except Exception as e:
        try:
            ftp.quit()
        except:
            pass
        return jsonify({"error": f"Błąd podczas usuwania plików: {str(e)}"}), 500

@app.route('/api/kiosks/<int:kiosk_id>/ftp-credentials', methods=['GET'])
def get_kiosk_ftp_credentials(kiosk_id):
    conn = get_db_connection()
    
    # Sprawdzenie, czy kiosk istnieje
    kiosk = conn.execute('SELECT id, name, ip_address, ftp_username, ftp_password FROM kiosks WHERE id = ?', (kiosk_id,)).fetchone()
    if not kiosk:
        conn.close()
        return jsonify({"error": "Kiosk nie znaleziony"}), 404
    
    conn.close()
    
    # Zwróć dane logowania FTP
    return jsonify({
        "id": kiosk['id'],
        "name": kiosk['name'],
        "ip_address": kiosk['ip_address'],
        "ftp_username": kiosk['ftp_username'],
        "ftp_password": kiosk['ftp_password']
    })

@app.route('/api/ftp/mkdir', methods=['POST'])
def create_ftp_directory():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data or 'path' not in data or 'folder_name' not in data:
        return jsonify({"error": "Brakujące dane do utworzenia katalogu"}), 400
    
    parent_path = data['path']
    folder_name = data['folder_name']
    
    # Walidacja nazwy folderu
    if not folder_name or '/' in folder_name or '\\' in folder_name:
        return jsonify({"error": "Nieprawidłowa nazwa folderu"}), 400
    
    # Konwersja portu na int
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    # Połączenie z serwerem FTP
    ftp = ftp_connect(data['hostname'], data['username'], data['password'], port)
    
    if not ftp:
        return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500
    
    try:
        # Przejdź do katalogu nadrzędnego
        ftp.cwd(parent_path)
        
        # Utwórz nowy katalog
        new_dir_path = os.path.join(parent_path, folder_name).replace('\\', '/')
        result = ftp_create_directory(ftp, folder_name)
        
        ftp.quit()
        
        if result:
            return jsonify({"message": f"Katalog {folder_name} został pomyślnie utworzony", "path": new_dir_path})
        else:
            return jsonify({"error": f"Nie można utworzyć katalogu {folder_name}"}), 500
    except Exception as e:
        try:
            ftp.quit()
        except:
            pass
        return jsonify({"error": f"Błąd podczas tworzenia katalogu: {str(e)}"}), 500

@app.route('/api/ftp/download', methods=['GET'])
def download_ftp_file():
    # Pobierz parametry z zapytania GET
    hostname = request.args.get('hostname')
    port = request.args.get('port', '21')
    username = request.args.get('username')
    password = request.args.get('password')
    path = request.args.get('path')
    
    # Sprawdzenie wymaganych parametrów
    if not hostname or not username or not password or not path:
        return jsonify({"error": "Brakujące dane do pobrania pliku"}), 400
    
    try:
        # Konwersja portu na int
        port = int(port)
    except (ValueError, TypeError):
        return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    try:
        # Połączenie z serwerem FTP
        ftp = ftp_connect(hostname, username, password, port)
        if not ftp:
            return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500
        
        try:
            # Pobierz nazwę pliku z ścieżki
            file_name = os.path.basename(path)
            
            # Przejdź do katalogu zawierającego plik
            directory = os.path.dirname(path)
            if directory:
                ftp.cwd(directory)
            
            # Tworzenie tymczasowego pliku do pobrania zawartości
            with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                temp_file_path = temp_file.name
                
                # Pobierz plik z serwera FTP
                ftp.retrbinary(f'RETR {file_name}', temp_file.write)
            
            # Zamknij połączenie FTP
            ftp.quit()
            
            # Przygotuj odpowiedź z plikiem
            @after_this_request
            def remove_file(response):
                # Usuń plik tymczasowy po wysłaniu odpowiedzi
                try:
                    os.unlink(temp_file_path)
                except Exception as error:
                    app.logger.error(f"Błąd podczas usuwania pliku tymczasowego: {error}")
                return response
                
            # Wyślij plik jako odpowiedź do pobrania
            return send_file(
                temp_file_path,
                as_attachment=True,
                download_name=file_name,
                mimetype='application/octet-stream'
            )
            
        except Exception as e:
            # Zamknij połączenie FTP w przypadku błędu
            try:
                ftp.quit()
            except:
                pass
                
            # Usuń plik tymczasowy w przypadku błędu
            try:
                os.unlink(temp_file_path)
            except:
                pass
                
            return jsonify({"error": f"Błąd podczas pobierania pliku: {str(e)}"}), 500
            
    except Exception as e:
        return jsonify({"error": f"Nieoczekiwany błąd: {str(e)}"}), 500

@app.route('/api/kiosks/<int:kiosk_id>/restart-service', methods=['POST'])
def restart_kiosk_service(kiosk_id):
    # Pobierz dane z żądania (jeśli istnieją)
    request_data = request.json or {}
    
    conn = get_db_connection()
    
    # Sprawdzenie, czy kiosk istnieje
    kiosk = conn.execute('SELECT id, name, ip_address FROM kiosks WHERE id = ?', (kiosk_id,)).fetchone()
    if not kiosk:
        conn.close()
        return jsonify({"error": "Kiosk nie znaleziony"}), 404
    
    if not kiosk['ip_address']:
        conn.close()
        return jsonify({"error": "Kiosk nie ma przypisanego adresu IP"}), 400
    
    conn.close()
    
    # Pobierz ustawienia SSH z bazy danych (użyjemy ich, jeśli nie podano w żądaniu)
    conn = get_db_connection()
    settings = conn.execute('SELECT key, value FROM settings WHERE key IN ("defaultSshUsername", "defaultSshPassword", "defaultSshPort", "defaultSshService")').fetchall()
    conn.close()
      # Zamień ustawienia na słownik
    settings_dict = {setting['key']: setting['value'] for setting in settings}
    
    # Użytkownik SSH jest zawsze ustawiony na "kiosk", niezależnie od danych z żądania
    ssh_username = 'kiosk'
    
    # Pobierz zaszyfrowane hasło i odszyfruj je
    encrypted_password = request_data.get('password') or settings_dict.get('defaultSshPassword', '')
    ssh_password = decrypt_data(encrypted_password)
    
    # Jeśli odszyfrowanie się nie powiodło, wyświetl komunikat diagnostyczny
    if not ssh_password and encrypted_password:
        print(f"Nie można odszyfrować hasła SSH. Zaszyfrowane hasło: {encrypted_password}")
        return jsonify({"error": "Błąd deszyfracji hasła SSH. Sprawdź konfigurację szyfrowania."}), 500
    
    ssh_port = int(request_data.get('port') or settings_dict.get('defaultSshPort', 22))
    
    # Wypisz informacje diagnostyczne dla celów debugowania
    print(f"Restarting service kiosk on kiosk {kiosk['name'] or kiosk['id']} ({kiosk['ip_address']})")
    print(f"SSH connection details: {ssh_username}@{kiosk['ip_address']}:{ssh_port}")
    
    try:
        import paramiko
        
        # Utwórz klienta SSH
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        # Połącz z kioskiem przez SSH
        try:
            ssh.connect(
                kiosk['ip_address'],
                port=ssh_port,
                username=ssh_username,
                password=ssh_password,
                timeout=10
            )
        except Exception as e:
            return jsonify({
                "error": f"Nie można połączyć się z kioskiem przez SSH: {str(e)}"
            }), 500
        
        # Wykonaj komendę restartu usługi
        try:
            # Spróbuj użyć sudo (bez hasła, jeśli kiosk ma skonfigurowany sudo bez hasła)
            restart_cmd = f"sudo systemctl restart kiosk.service"
            print(f"Executing command: {restart_cmd}")
            stdin, stdout, stderr = ssh.exec_command(restart_cmd, timeout=10)
            exit_code = stdout.channel.recv_exit_status()
            
            if exit_code != 0:
                # Jeśli sudo nie zadziałało, spróbuj użyć systemctl bez sudo
                restart_cmd = f"systemctl --user restart kiosk.service"
                print(f"First command failed, trying: {restart_cmd}")
                stdin, stdout, stderr = ssh.exec_command(restart_cmd, timeout=10)
                exit_code = stdout.channel.recv_exit_status()
                
                if exit_code != 0:
                    # Logowanie błędów
                    err_output = stderr.read().decode('utf-8').strip()
                    return jsonify({
                        "error": f"Błąd podczas restartu usługi: {err_output}",
                        "command": restart_cmd,
                        "exit_code": exit_code
                    }), 500
        except Exception as e:
            return jsonify({"error": f"Błąd wykonania komendy: {str(e)}"}), 500
        finally:
            # Zawsze zamknij połączenie SSH
            ssh.close()
        
        # Zaktualizuj czas ostatniego połączenia i status kiosku
        conn = get_db_connection()
        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        conn.execute(
            'UPDATE kiosks SET last_connection = ?, status = ?, updated_at = ? WHERE id = ?',
            (now, 'online', now, kiosk_id)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            "message": f"Usługa kiosk została pomyślnie zrestartowana na kiosku {kiosk['name'] or kiosk['id']}"
        })
    except ImportError:
        return jsonify({
            "error": "Nie można zrestartować usługi: brak biblioteki paramiko. Zainstaluj ją używając 'pip install paramiko'"
        }), 500
    except Exception as e:
        return jsonify({"error": f"Nieoczekiwany błąd: {str(e)}"}), 500

@app.route('/api/ftp/get-file-content', methods=['POST'])
def api_get_file_content():
    data = request.json
    required_fields = ['hostname', 'username', 'password', 'path']
    
    if not data or not all(field in data for field in required_fields):
        return jsonify({"error": "Brakujące dane połączenia FTP"}), 400
    
    hostname = data['hostname']
    port = int(data.get('port', 21))
    username = data['username']
    password = data['password']
    file_path = data['path']
    
    # Jeśli hasło jest zaszyfrowane, odszyfruj je
    if password.startswith('ENC:'):
        password = decrypt_data(password[4:])
    
    # Połącz z FTP
    ftp = ftp_connect(hostname, username, password, port)
    if not ftp:
        return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500
    
    try:
        # Pobierz zawartość pliku
        content = ftp_get_file_content(ftp, file_path)
        if content is None:
            return jsonify({"error": f"Nie można pobrać zawartości pliku {file_path}"}), 500
        
        return jsonify({
            "content": content,
            "path": file_path,
            "message": "Zawartość pliku pobrana pomyślnie"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            ftp.quit()
        except:
            pass

@app.route('/api/ftp/put-file-content', methods=['POST'])
def api_put_file_content():
    data = request.json
    required_fields = ['hostname', 'username', 'password', 'path', 'content']
    
    if not data or not all(field in data for field in required_fields):
        return jsonify({"error": "Brakujące dane połączenia FTP lub zawartość pliku"}), 400
    
    hostname = data['hostname']
    port = int(data.get('port', 21))
    username = data['username']
    password = data['password']
    file_path = data['path']
    content = data['content']
    
    # Jeśli hasło jest zaszyfrowane, odszyfruj je
    if password.startswith('ENC:'):
        password = decrypt_data(password[4:])
    
    # Połącz z FTP
    ftp = ftp_connect(hostname, username, password, port)
    if not ftp:
        return jsonify({"error": "Nie można połączyć się z serwerem FTP"}), 500
    
    try:
        # Zapisz zawartość pliku
        success = ftp_put_file_content(ftp, file_path, content)
        if not success:
            return jsonify({"error": f"Nie można zapisać zawartości pliku {file_path}"}), 500
        
        return jsonify({
            "path": file_path,
            "message": "Zawartość pliku zapisana pomyślnie"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            ftp.quit()
        except:
            pass

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)