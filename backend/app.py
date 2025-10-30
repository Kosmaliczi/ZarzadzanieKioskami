import os
import sqlite3
import datetime
from flask import Flask, request, jsonify, send_file, after_this_request
from flask_cors import CORS
import ftplib
from dotenv import load_dotenv
import tempfile
import base64
import jwt
import bcrypt
from functools import wraps
from sftp_handler import SFTPHandler, sftp_connect

# Ładowanie zmiennych środowiskowych
load_dotenv()

app = Flask(__name__)
CORS(app)

# Klucz do szyfrowania/deszyfrowania (powinien być taki sam jak w pliku config.js)
ENCRYPTION_KEY = 'kiosk-manager-secure-key-2025'

# Klucz do podpisywania tokenów JWT (powinien być przechowywany w zmiennych środowiskowych)
JWT_SECRET_KEY = 'twoj-tajny-klucz-jwt-2025'  # W produkcji powinien być bardziej bezpieczny i przechowywany w zmiennych środowiskowych

# Funkcja do deszyfrowania danych
def decrypt_data(encrypted_text):
    # Jeśli nie ma tekstu do odszyfrowania, zwróć pusty ciąg
    if not encrypted_text:
        return ''
    
    try:
        # Dekodowanie Base64
        encrypted_string = base64.b64decode(encrypted_text).decode('utf-8')
        
        # Deszyfrowanie XOR z kluczem
        result = []
        for i in range(len(encrypted_string)):
            char_code = ord(encrypted_string[i]) ^ ord(ENCRYPTION_KEY[i % len(ENCRYPTION_KEY)])
            result.append(chr(char_code))
        
        return ''.join(result)
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

# Dekorator do weryfikacji tokenu JWT
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Token jest nieprawidłowy'}), 401

        if not token:
            return jsonify({'message': 'Token jest wymagany'}), 401

        try:
            data = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            conn = get_db_connection()
            user = conn.execute('SELECT * FROM users WHERE username = ?', (data['username'],)).fetchone()
            conn.close()
            if not user:
                return jsonify({'message': 'Użytkownik nie istnieje'}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token wygasł'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token jest nieprawidłowy'}), 401

        return f(*args, **kwargs)
    return decorated

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
    if user and bcrypt.checkpw(password.encode('utf-8'), user['password'].encode('utf-8')):
        # Generowanie tokenu JWT
        token = jwt.encode({
            'username': username,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        }, JWT_SECRET_KEY, algorithm="HS256")
        return jsonify({
            "success": True,
            "username": username,
            "token": token,
            "message": "Logowanie pomyślne"
        })
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
            ('admin', bcrypt.hashpw('admin'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8'))  # W produkcji powinno być używane hashowanie haseł
        )
        conn.commit()
    
    conn.close()

# Inicjalizacja domyślnego użytkownika przy starcie
init_default_user()

# Ścieżka do klucza SSH dla SFTP (LibreELEC)
SSH_KEY_PATH = os.path.join(os.path.dirname(__file__), 'ssh_keys', 'kiosk_id_rsa')

# Funkcja określająca protokół na podstawie portu
def get_protocol(port):
    """
    Określa protokół na podstawie numeru portu
    Args:
        port: Numer portu (21 dla FTP, 22 dla SFTP)
    Returns:
        'ftp' lub 'sftp'
    """
    return 'sftp' if port == 22 else 'ftp'

# Obsługa FTP (tradycyjny vsftpd)
def ftp_connect(hostname, username, password, port=21):
    try:
        ftp = ftplib.FTP()
        ftp.connect(hostname, port)
        ftp.login(username, password)
        return ftp
    except Exception as e:
        print(f"FTP connection error: {e}")
        return None

# Uniwersalna funkcja do łączenia (FTP lub SFTP)
def connect_file_transfer(hostname, username, password, port=21):
    """
    Uniwersalna funkcja łącząca z serwerem plików
    Automatycznie wybiera FTP (port 21) lub SFTP (port 22)
    
    Args:
        hostname: Adres IP kiosku
        username: Nazwa użytkownika (LibreELEC: root)
        password: Hasło
        port: Port (21=FTP, 22=SFTP)
    
    Returns:
        Obiekt FTP/SFTP lub None w przypadku błędu
    """
    protocol = get_protocol(port)
    
    if protocol == 'sftp':
        # LibreELEC - używamy SFTP z hasłem (nie kluczem SSH)
        # Klucze SSH są używane tylko do komend SSH, nie do SFTP
        return sftp_connect(hostname, username, password, port)
    else:
        # Tradycyjny FTP (vsftpd)
        return ftp_connect(hostname, username, password, port)

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
def ftp_get_file_content(ftp, path, encoding: str = 'utf-8'):
    """Pobiera zawartość pliku jako tekst w UTF-8.

    Zwraca tekst jeśli plik jest poprawnym UTF-8. Rzuca UnicodeDecodeError
    gdy zawartość nie jest poprawnym UTF-8. Inne wyjątki są logowane i
    funkcja zwraca None.
    """
    temp_file_path = None
    try:
        # Utwórz tymczasowy plik do pobrania zawartości
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            # Pobierz plik z FTP
            ftp.retrbinary(f'RETR {path}', temp_file.write)
            temp_file_path = temp_file.name

        # Odczytaj zawartość pobranego pliku w UTF-8
        with open(temp_file_path, 'r', encoding=encoding, errors='strict') as file:
            content = file.read()

        return content
    except UnicodeDecodeError as e:
        # Plik nie jest w UTF-8 – propaguj błąd, aby API mogło zwrócić czytelny komunikat
        print(f"FTP get file content error (not UTF-8): {e}")
        raise
    except Exception as e:
        print(f"FTP get file content error: {e}")
        return None
    finally:
        # Usuń tymczasowy plik
        try:
            if temp_file_path and os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
        except Exception:
            pass

# Nowa funkcja do zapisu zawartości pliku
def ftp_put_file_content(ftp, path, content, encoding: str = 'utf-8'):
    """Zapisuje zawartość tekstową jako plik w kodowaniu UTF-8 na serwerze FTP."""
    temp_file_path = None
    try:
        # Utwórz tymczasowy plik z zawartością w UTF-8
        with tempfile.NamedTemporaryFile(delete=False, mode='w', encoding=encoding, newline='') as temp_file:
            temp_file.write(content)
            temp_file_path = temp_file.name

        # Wyślij plik do FTP
        with open(temp_file_path, 'rb') as file:
            ftp.storbinary(f'STOR {path}', file)

        return True
    except Exception as e:
        print(f"FTP put file content error: {e}")
        return False
    finally:
        # Usuń tymczasowy plik
        try:
            if temp_file_path and os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
        except Exception:
            pass

# Endpointy API

@app.route('/api/ticker-text')
def ticker_text():
    """
    UWAGA: Ten endpoint nie jest używany w obecnej implementacji.
    Addon Kodi pobiera plik /storage/napis.txt bezpośrednio z lokalnego systemu plików,
    nie przez HTTP API.
    
    Jeśli chcesz używać tego endpointu, musisz skonfigurować połączenie FTP
    do konkretnego kiosku i pobrać zawartość pliku przez FTP.
    """
    return "Addon Kodi pobiera plik lokalnie z /storage/napis.txt", 200, {'Content-Type': 'text/plain'}

@app.route('/api/settings', methods=['GET'])
@token_required
def get_settings():
    conn = get_db_connection()
    settings = conn.execute('SELECT * FROM settings').fetchall()
    conn.close()
    
    # Zwróć wszystkie ustawienia jako słownik
    settings_dict = {setting['key']: setting['value'] for setting in settings}
    
    return jsonify(settings_dict)

@app.route('/api/settings', methods=['POST'])
@token_required
def update_settings():
    data = request.json
    
    if not data:
        return jsonify({"error": "Brak danych do aktualizacji"}), 400
    
    conn = get_db_connection()
    
    for key, value in data.items():
        conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, value))
    
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Ustawienia zaktualizowane pomyślnie"})

@app.route('/api/kiosks', methods=['GET'])
@token_required
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
@token_required
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
@token_required
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
@token_required
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
    
    return '', 204

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
@token_required
def test_ftp_connection():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Brakujące dane połączenia"}), 400
    
    # Konwersja portu na int
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    protocol = get_protocol(port)
    conn = connect_file_transfer(data['hostname'], data['username'], data['password'], port)
    
    if conn:
        if isinstance(conn, SFTPHandler):
            conn.close()
        else:
            conn.quit()
        return jsonify({"message": f"Połączenie {protocol.upper()} udane"})
    else:
        return jsonify({"error": f"Nie można połączyć się z serwerem {protocol.upper()}"}), 500

@app.route('/api/ftp/files', methods=['POST'])
@token_required
def list_ftp_files():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Brakujące dane połączenia"}), 400
    
    # Domyślna ścieżka dla LibreELEC SFTP to /storage/videos
    # Dla Debian/vsftpd FTP to /home/kiosk/MediaPionowe
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    # Automatyczne określanie domyślnej ścieżki w zależności od protokołu
    default_path = '/home/kiosk/MediaPionowe' if port == 22 else '/home/kiosk/MediaPionowe'
    remote_path = data.get('path', default_path)
    
    protocol = get_protocol(port)
    conn = connect_file_transfer(data['hostname'], data['username'], data['password'], port)
    
    if not conn:
        return jsonify({"error": f"Nie można połączyć się z serwerem {protocol.upper()}"}), 500
    
    try:
        file_info = []
        
        if isinstance(conn, SFTPHandler):
            # SFTP - LibreELEC
            files = conn.list_directory(remote_path)
            for file_data in files:
                full_path = os.path.join(remote_path, file_data['name']).replace('\\', '/')
                file_info.append({
                    "name": file_data['name'],
                    "size": file_data['size'],
                    "path": full_path,
                    "isDirectory": file_data['is_directory'],
                    "modified": datetime.datetime.fromtimestamp(file_data['modified']).strftime('%Y-%m-%d %H:%M:%S'),
                    "permissions": file_data['permissions']
                })
        else:
            # FTP tradycyjny
            # Zmieniamy katalog na podany
            conn.cwd(remote_path)
            
            # Pobieramy listę plików i katalogów
            files = []
            conn.dir(lambda line: files.append(line))
            
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
        
        # Zamykanie połączenia
        if isinstance(conn, SFTPHandler):
            conn.close()
        else:
            conn.quit()
        
        return jsonify(file_info)
    except Exception as e:
        try:
            if isinstance(conn, SFTPHandler):
                conn.close()
            else:
                conn.quit()
        except:
            pass
        return jsonify({"error": f"Błąd podczas listowania plików: {str(e)}"}), 500

@app.route('/api/ftp/upload', methods=['POST'])
@token_required
def upload_ftp_file():
    # Sprawdź, czy to FormData czy JSON
    if request.content_type and 'multipart/form-data' in request.content_type:
        # FormData - dla dużych plików
        data = request.form
        file = request.files.get('file')
        
        if not file:
            return jsonify({"error": "Brak pliku do przesłania"}), 400
        
        hostname = data.get('hostname')
        username = data.get('username')
        password = data.get('password')
        port = int(data.get('port', 21))
        remote_path = data.get('path', '/home/kiosk/MediaPionowe' if port == 22 else '/home/kiosk/MediaPionowe')
        file_name = data.get('file_name') or file.filename
        
        print(f"Upload (FormData) - file: {file_name}, size: {file.content_length}, path: {remote_path}, port: {port}")
        
        # Połączenie z serwerem (FTP lub SFTP)
        protocol = get_protocol(port)
        conn = connect_file_transfer(hostname, username, password, port)
        
        if not conn:
            return jsonify({"error": f"Nie można połączyć się z serwerem {protocol.upper()}"}), 500
        
        try:
            # Zapisz plik tymczasowo
            with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                file.save(temp_file.name)
                temp_file_path = temp_file.name
            
            if isinstance(conn, SFTPHandler):
                # SFTP - LibreELEC
                full_path = os.path.join(remote_path, file_name).replace('\\', '/')
                conn.upload_file(temp_file_path, full_path)
                conn.close()
            else:
                # FTP tradycyjny
                conn.cwd(remote_path)
                with open(temp_file_path, 'rb') as f:
                    conn.storbinary(f'STOR {file_name}', f)
                conn.quit()
            
            # Usuń plik tymczasowy
            os.remove(temp_file_path)
            
            return jsonify({"message": f"Plik {file_name} został pomyślnie przesłany"})
        except Exception as e:
            try:
                if isinstance(conn, SFTPHandler):
                    conn.close()
                else:
                    conn.quit()
            except:
                pass
            
            try:
                if 'temp_file_path' in locals():
                    os.remove(temp_file_path)
            except:
                pass
            
            return jsonify({"error": f"Błąd podczas przesyłania pliku: {str(e)}"}), 500
    else:
        # JSON - dla małych plików (backward compatibility)
        data = request.json
        
        # Debug - wypisz otrzymane klucze
        print(f"Upload request received with keys: {data.keys() if data else 'None'}")
        
        if not data or 'hostname' not in data or 'username' not in data or 'password' not in data or 'file_data' not in data:
            print(f"Missing data - hostname: {'hostname' in data if data else False}, username: {'username' in data if data else False}, password: {'password' in data if data else False}, file_data: {'file_data' in data if data else False}")
            return jsonify({"error": "Brakujące dane do przesłania pliku"}), 400
        
        # Domyślna ścieżka w zależności od portu
        port = 21
        if 'port' in data:
            try:
                port = int(data['port'])
            except (ValueError, TypeError):
                return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
        
        default_path = '/home/kiosk/MediaPionowe' if port == 22 else '/home/kiosk/MediaPionowe'
        remote_path = data.get('path', default_path)
        file_name = data.get('file_name')
        file_data = data.get('file_data')
        
        print(f"Upload details - file_name: {file_name}, path: {remote_path}, port: {port}")
        
        if not file_name or not file_data:
            print(f"Missing file details - file_name: {bool(file_name)}, file_data length: {len(file_data) if file_data else 0}")
            return jsonify({"error": "Brak nazwy pliku lub danych pliku"}), 400
        
        # Dekodowanie danych pliku z base64
        try:
            # Usunięcie nagłówka 'data:...' jeśli istnieje
            if ';base64,' in file_data:
                file_data = file_data.split(';base64,')[1]
            
            file_bytes = base64.b64decode(file_data)
        except Exception as e:
            return jsonify({"error": f"Błąd dekodowania danych pliku: {str(e)}"}), 400
        
        # Połączenie z serwerem (FTP lub SFTP)
        protocol = get_protocol(port)
        conn = connect_file_transfer(data['hostname'], data['username'], data['password'], port)
        
        if not conn:
            return jsonify({"error": f"Nie można połączyć się z serwerem {protocol.upper()}"}), 500
        
        try:
            # Tworzenie tymczasowego pliku lokalnego
            with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                temp_file.write(file_bytes)
                temp_file_path = temp_file.name
            
            if isinstance(conn, SFTPHandler):
                # SFTP - LibreELEC
                full_path = os.path.join(remote_path, file_name).replace('\\', '/')
                conn.upload_file(temp_file_path, full_path)
                conn.close()
            else:
                # FTP tradycyjny
                conn.cwd(remote_path)
                with open(temp_file_path, 'rb') as file:
                    conn.storbinary(f'STOR {file_name}', file)
                conn.quit()
            
            # Usunięcie tymczasowego pliku
            os.remove(temp_file_path)
            
            return jsonify({"message": f"Plik {file_name} został pomyślnie przesłany"})
        except Exception as e:
            try:
                if isinstance(conn, SFTPHandler):
                    conn.close()
                else:
                    conn.quit()
            except:
                pass
            
            # Próba usunięcia tymczasowego pliku
            try:
                if 'temp_file_path' in locals():
                    os.remove(temp_file_path)
            except:
                pass
                
            return jsonify({"error": f"Błąd podczas przesyłania pliku: {str(e)}"}), 500

@app.route('/api/ftp/delete', methods=['POST'])
@token_required
def delete_ftp_file():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data or 'path' not in data:
        return jsonify({"error": "Brakujące dane do usunięcia pliku"}), 400
    
    file_path = data['path']
    is_directory = data.get('is_directory', False) or data.get('isDirectory', False)
    
    # Konwersja portu na int
    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    # Połączenie z serwerem (FTP lub SFTP)
    protocol = get_protocol(port)
    conn = connect_file_transfer(data['hostname'], data['username'], data['password'], port)
    
    if not conn:
        return jsonify({"error": f"Nie można połączyć się z serwerem {protocol.upper()}"}), 500
    
    try:
        if isinstance(conn, SFTPHandler):
            # SFTP - LibreELEC
            result = conn.delete_file(file_path, is_directory)
            conn.close()
        else:
            # FTP tradycyjny
            result = ftp_delete_file(conn, file_path, is_directory)
            conn.quit()
        
        if result:
            return jsonify({"message": f"{'Katalog' if is_directory else 'Plik'} został pomyślnie usunięty"})
        else:
            return jsonify({"error": f"Nie można usunąć {'katalogu' if is_directory else 'pliku'}"}), 500
    except Exception as e:
        try:
            if isinstance(conn, SFTPHandler):
                conn.close()
            else:
                conn.quit()
        except:
            pass
        return jsonify({"error": f"Błąd podczas usuwania: {str(e)}"}), 500

@app.route('/api/ftp/delete-multiple', methods=['POST'])
@token_required
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
@token_required
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
@token_required
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
    
    # Tworzenie pełnej ścieżki do nowego katalogu
    new_dir_path = os.path.join(parent_path, folder_name).replace('\\', '/')
    
    # Połączenie z serwerem (FTP lub SFTP)
    protocol = get_protocol(port)
    conn = connect_file_transfer(data['hostname'], data['username'], data['password'], port)
    
    if not conn:
        return jsonify({"error": f"Nie można połączyć się z serwerem {protocol.upper()}"}), 500
    
    try:
        if isinstance(conn, SFTPHandler):
            # SFTP - LibreELEC
            result = conn.create_directory(new_dir_path)
            conn.close()
        else:
            # FTP tradycyjny
            conn.cwd(parent_path)
            result = ftp_create_directory(conn, folder_name)
            conn.quit()
        
        
        if result:
            return jsonify({"message": f"Katalog {folder_name} został pomyślnie utworzony", "path": new_dir_path})
        else:
            return jsonify({"error": f"Nie można utworzyć katalogu {folder_name}"}), 500
    except Exception as e:
        try:
            if isinstance(conn, SFTPHandler):
                conn.close()
            else:
                conn.quit()
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
    
    # Sprawdzenie, czy kiosk istnieje (pobierz także ftp_username do użycia jako domyślna nazwa użytkownika SSH)
    kiosk = conn.execute('SELECT id, name, ip_address, ftp_username FROM kiosks WHERE id = ?', (kiosk_id,)).fetchone()
    if not kiosk:
        conn.close()
        return jsonify({"error": "Kiosk nie znaleziony"}), 404
    
    if not kiosk['ip_address']:
        conn.close()
        return jsonify({"error": "Kiosk nie ma przypisanego adresu IP"}), 400
    
    conn.close()
    
    # Pobierz ustawienia SSH z bazy danych (użyjemy ich, jeśli nie podano w żądaniu)
    conn = get_db_connection()
    settings = conn.execute('SELECT key, value FROM settings WHERE key IN ("defaultSshUsername", "defaultSshPort", "defaultSshService")').fetchall()
    conn.close()
    
    # Zamień ustawienia na słownik
    settings_dict = {setting['key']: setting['value'] for setting in settings}
    
    # Preferuj kolejno: nazwę użytkownika z żądania -> ftp_username kiosku -> domyślne ustawienie -> 'root'
    ssh_username = request_data.get('username')
    if not ssh_username:
        kiosk_ftp_user = kiosk['ftp_username'] if 'ftp_username' in kiosk.keys() else None
        ssh_username = kiosk_ftp_user or settings_dict.get('defaultSshUsername', 'root')
    
    # Określamy ścieżkę do klucza SSH - zawsze używamy stałej nazwy pliku
    ssh_key_path = os.path.join(os.path.dirname(__file__), 'ssh_keys', 'kiosk_id_rsa_openssh')
    
    # Sprawdzenie czy klucz SSH istnieje
    if not os.path.exists(ssh_key_path):
        print(f"Nie znaleziono klucza SSH ({ssh_key_path})")
        return jsonify({"error": f"Nie znaleziono klucza SSH. Upewnij się, że klucz istnieje w folderze backend/ssh_keys/kiosk_id_rsa"}), 500
    
    ssh_port = int(request_data.get('port') or settings_dict.get('defaultSshPort', 22))
    
    # Wypisz informacje diagnostyczne dla celów debugowania
    print(f"Restarting service kiosk on kiosk {kiosk['name'] or kiosk['id']} ({kiosk['ip_address']})")
    print(f"SSH connection details: {ssh_username}@{kiosk['ip_address']}:{ssh_port} using key authentication from {ssh_key_path}")
    
    try:
        import paramiko
        
        # Utwórz klienta SSH
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        try:
            # Załaduj klucz SSH
            try:
                private_key = paramiko.RSAKey.from_private_key_file(ssh_key_path)
                print(f"Klucz SSH załadowany pomyślnie: {ssh_key_path}")
            except Exception as key_error:
                print(f"Błąd podczas ładowania klucza SSH: {key_error}")
                return jsonify({"error": f"Błąd podczas ładowania klucza SSH: {str(key_error)}"}), 500

            # Połącz z kioskiem przez SSH używając klucza
            try:
                ssh.connect(
                    hostname=kiosk['ip_address'],
                    port=ssh_port,
                    username=ssh_username,
                    pkey=private_key,
                    timeout=10,
                    look_for_keys=False,
                    allow_agent=False
                )
                print(f"Połączono przez SSH używając klucza")
            except paramiko.AuthenticationException:
                # Jeśli autentykacja kluczem nie zadziałała, spróbuj z hasłem (jeśli podane)
                ssh_password = request_data.get('password')
                if ssh_password:
                    print(f"Autentykacja kluczem nieudana, próba z hasłem...")
                    ssh.connect(
                        hostname=kiosk['ip_address'],
                        port=ssh_port,
                        username=ssh_username,
                        password=ssh_password,
                        timeout=10,
                        look_for_keys=False,
                        allow_agent=False
                    )
                    print(f"Połączono przez SSH używając hasła")
                else:
                    raise
        except Exception as e:
            print(f"Błąd połączenia SSH: {str(e)}")
            return jsonify({
                "error": f"Nie można połączyć się z kioskiem przez SSH: {str(e)}. Sprawdź czy klucz publiczny jest zainstalowany na kiosku w ~/.ssh/authorized_keys lub podaj hasło SSH."
            }), 500
        
        # Wykonaj komendę restartu usługi
        try:
            # Zawsze restartuj kiosk.service niezależnie od systemu
            service_name = 'kiosk.service'
            print(f"Restarting service: {service_name}")
            restart_cmd = f"sudo systemctl restart {service_name}"
            print(f"Executing command: {restart_cmd}")
            stdin, stdout, stderr = ssh.exec_command(restart_cmd, timeout=10)
            exit_code = stdout.channel.recv_exit_status()
            
            if exit_code != 0:
                # Jeśli sudo nie zadziałało, spróbuj użyć systemctl bez sudo
                restart_cmd = f"systemctl restart {service_name}"
                print(f"First command failed, trying: {restart_cmd}")
                stdin, stdout, stderr = ssh.exec_command(restart_cmd, timeout=10)
                exit_code = stdout.channel.recv_exit_status()
                
                if exit_code != 0:
                    # Logowanie błędów
                    err_output = stderr.read().decode('utf-8').strip()
                    return jsonify({
                        "error": f"Błąd podczas restartu usługi {service_name}: {err_output}",
                        "command": restart_cmd,
                        "exit_code": exit_code
                    }), 500
            
            success_message = f"Usługa {service_name} została pomyślnie zrestartowana na kiosku {kiosk['name'] or kiosk['id']}"
            print(success_message)
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
            "message": success_message
        })
    except ImportError:
        return jsonify({
            "error": "Nie można zrestartować usługi: brak biblioteki paramiko. Zainstaluj ją używając 'pip install paramiko'"
        }), 500
    except Exception as e:
        return jsonify({"error": f"Nieoczekiwany błąd: {str(e)}"}), 500

@app.route('/api/ftp/get-file-content', methods=['POST'])
@token_required
def api_get_file_content():
    data = request.json
    required_fields = ['hostname', 'username', 'path']
    
    if not data or not all(field in data for field in required_fields):
        missing = [f for f in required_fields if f not in data] if data else required_fields
        return jsonify({"error": f"Brakujące dane: {', '.join(missing)}"}), 400
    
    hostname = data['hostname']
    port = int(data.get('port', 21))
    username = data['username']
    password = data.get('password', '')
    file_path = data['path']
    
    print(f"GET file content: {file_path} from {hostname}:{port} (user: {username})")
    
    # Jeśli hasło jest zaszyfrowane, odszyfruj je
    if password and isinstance(password, str) and password.startswith('ENC:'):
        password = decrypt_data(password[4:])
    
    # Połącz z FTP lub SFTP (w zależności od portu)
    protocol = get_protocol(port)
    conn = connect_file_transfer(hostname, username, password, port)
    if not conn:
        return jsonify({"error": f"Nie można połączyć się z serwerem {protocol.upper()}"}), 500
    
    try:
        # Pobierz zawartość pliku (wymagane UTF-8)
        if isinstance(conn, SFTPHandler):
            # SFTP - LibreELEC
            content = conn.get_file_content(file_path)
            conn.close()
        else:
            # FTP tradycyjny
            content = ftp_get_file_content(conn, file_path)
            conn.quit()
            
        if content is None:
            return jsonify({"error": f"Nie można pobrać zawartości pliku {file_path}"}), 500

        return jsonify({
            "content": content,
            "path": file_path,
            "message": "Zawartość pliku pobrana pomyślnie"
        })
    except UnicodeDecodeError:
        return jsonify({
            "error": "Plik nie jest w kodowaniu UTF-8. Proszę zapisać plik w UTF-8 i spróbować ponownie.",
            "path": file_path
        }), 415  # Unsupported Media Type
    except Exception as e:
        print(f"Error getting file content: {str(e)}")
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            if isinstance(conn, SFTPHandler):
                conn.close()
            else:
                conn.quit()
        except:
            pass

@app.route('/api/ftp/put-file-content', methods=['POST'])
@token_required
def api_put_file_content():
    data = request.json
    required_fields = ['hostname', 'username', 'path', 'content']
    
    if not data or not all(field in data for field in required_fields):
        missing = [f for f in required_fields if f not in data] if data else required_fields
        return jsonify({"error": f"Brakujące dane: {', '.join(missing)}"}), 400
    
    hostname = data['hostname']
    port = int(data.get('port', 21))
    username = data['username']
    password = data.get('password', '')
    file_path = data['path']
    content = data['content']
    
    print(f"PUT file content: {file_path} to {hostname}:{port} (user: {username}), content length: {len(content)}")
    
    # Jeśli hasło jest zaszyfrowane, odszyfruj je
    if password and isinstance(password, str) and password.startswith('ENC:'):
        password = decrypt_data(password[4:])
    
    # Połącz z FTP lub SFTP (w zależności od portu)
    protocol = get_protocol(port)
    conn = connect_file_transfer(hostname, username, password, port)
    if not conn:
        return jsonify({"error": f"Nie można połączyć się z serwerem {protocol.upper()}"}), 500
    
    try:
        # Zapisz zawartość pliku
        if isinstance(conn, SFTPHandler):
            # SFTP - LibreELEC
            success = conn.put_file_content(file_path, content)
            conn.close()
        else:
            # FTP tradycyjny
            success = ftp_put_file_content(conn, file_path, content)
            conn.quit()
            
        if not success:
            return jsonify({"error": f"Nie można zapisać zawartości pliku {file_path}"}), 500
        
        return jsonify({
            "path": file_path,
            "message": "Zawartość pliku zapisana pomyślnie"
        })
    except Exception as e:
        print(f"Error putting file content: {str(e)}")
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            if isinstance(conn, SFTPHandler):
                conn.close()
            else:
                conn.quit()
        except:
            pass

""" Obracanie ekranu kiosku przez SSH za pomocą xrandr.

Akceptowane orientacje (kompatybilne z frontendem):
- 'right' | '0' | 'normal'

Obsługiwane dodatkowo (na przyszłość):
- 'left' | 'inverted'

Strategia:
1) Spróbuj legacy: xrandr -o <orientation> (akceptuje '0/right/left/inverted')
2) Fallback: znajdź pierwszy podłączony output i wykonaj: xrandr --output <OUT> --rotate <normal|right|left|inverted>
   (z mapowaniem '0' -> 'normal')
"""
@app.route('/api/kiosks/<int:kiosk_id>/rotate-display', methods=['POST'])
@token_required
def rotate_kiosk_display(kiosk_id):
    data = request.json or {}
    orientation = (data.get('orientation') or '').strip().lower()
    allowed = ['right', '0', 'normal', 'left', 'inverted', '90', '270', '180']
    if orientation not in allowed:
        return jsonify({"error": "Nieprawidłowa orientacja. Dozwolone: right | 0 (normal) | left | inverted | 90 | 180 | 270"}), 400
    # Znormalizuj do wartości wspieranych przez xrandr ('normal','right','left','inverted')
    if orientation == '0' or orientation == 'normal':
        normalized = 'normal'
    elif orientation == '90' or orientation == 'right':
        normalized = 'right'
    elif orientation == '270' or orientation == 'left':
        normalized = 'left'
    elif orientation == '180' or orientation == 'inverted':
        normalized = 'inverted'
    else:
        normalized = orientation

    conn = get_db_connection()
    kiosk = conn.execute('SELECT id, name, ip_address, ftp_username, ftp_password FROM kiosks WHERE id = ?', (kiosk_id,)).fetchone()
    conn.close()
    if not kiosk:
        return jsonify({"error": "Kiosk nie znaleziony"}), 404
    if not kiosk['ip_address']:
        return jsonify({"error": "Kiosk nie ma przypisanego adresu IP"}), 400

    # Pobierz ustawienia SSH
    conn = get_db_connection()
    settings = conn.execute('SELECT key, value FROM settings WHERE key IN ("defaultSshUsername", "defaultSshPort")').fetchall()
    conn.close()
    settings_dict = {s['key']: s['value'] for s in settings}
    # Preferuj ftp_username kiosku jako nazwę użytkownika SSH, w przeciwnym razie użyj ustawień lub 'root'
    ssh_username = kiosk['ftp_username'] if kiosk['ftp_username'] else settings_dict.get('defaultSshUsername', 'root')
    ssh_port = int(settings_dict.get('defaultSshPort', 22))

    ssh_key_path = os.path.join(os.path.dirname(__file__), 'ssh_keys', 'kiosk_id_rsa_openssh')
    has_key = os.path.exists(ssh_key_path)
    ssh_password = kiosk['ftp_password'] if 'ftp_password' in kiosk.keys() else None
    if not has_key and not ssh_password:
        return jsonify({"error": "Brak klucza SSH i hasła. Skonfiguruj backend/ssh_keys/kiosk_id_rsa_openssh lub ustaw ftp_password dla kiosku."}), 500

    try:
        import paramiko
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        # Spróbuj połączyć się kluczem, a w razie niepowodzenia hasłem (jeśli jest dostępne)
        connected = False
        last_err = None
        if has_key:
            try:
                key = paramiko.RSAKey.from_private_key_file(ssh_key_path)
                ssh.connect(kiosk['ip_address'], port=ssh_port, username=ssh_username, pkey=key, timeout=10)
                connected = True
            except Exception as e_auth:
                last_err = e_auth
        if not connected and ssh_password:
            try:
                ssh.connect(kiosk['ip_address'], port=ssh_port, username=ssh_username, password=ssh_password, timeout=10)
                connected = True
            except Exception as e_auth2:
                last_err = e_auth2
        if not connected:
            raise last_err or Exception("Nie udało się uwierzytelnić przez SSH (klucz ani hasło nie zadziałały)")

        # Wykonaj xrandr na ekranie :0, ustawiając zarówno orientację ekranu (-o), jak i per-output (--rotate)
        # To zapewnia poprawny powrót do 'normal', niezależnie od wcześniejszej metody.
        cmd = (
            "bash -lc '"
            "export DISPLAY=:0; "
            f"ORI=\"{normalized}\"; "
            # Najpierw spróbuj ustawić orientację ekranu (może się nie powieść na niektórych konfiguracjach)
            "if ! xrandr -o \"$ORI\" >/dev/null 2>&1; then XO_ERR=1; else XO_ERR=0; fi; "
            # Następnie ustaw orientację na pierwszym podłączonym wyjściu (per-output)
            "OUT=$(xrandr | awk \"/ connected/{print $1; exit}\"); "
            "if [ -n \"$OUT\" ]; then "
            "  if ! xrandr --output \"$OUT\" --rotate \"$ORI\" >/dev/null 2>&1; then PO_ERR=1; else PO_ERR=0; fi; "
            "else PO_ERR=1; fi; "
            # Jeśli obie metody zawiodły, zwróć błąd
            "if [ $XO_ERR -ne 0 ] && [ $PO_ERR -ne 0 ]; then echo \"rotation failed (screen and per-output)\" 1>&2; exit 1; fi'"
        )
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=10)
        out = stdout.read().decode('utf-8', errors='ignore').strip()
        err = stderr.read().decode('utf-8', errors='ignore').strip()
        code = stdout.channel.recv_exit_status()
        ssh.close()

        if code != 0:
            return jsonify({"error": f"Błąd xrandr: {err or 'nieznany błąd'}", "stdout": out, "stderr": err, "exitCode": code}), 500

        return jsonify({"message": "Ekran obrócony", "stdout": out})
    except ImportError:
        return jsonify({"error": "Brak biblioteki paramiko. Zainstaluj: pip install paramiko"}), 500
    except Exception as e:
        return jsonify({"error": f"Nieoczekiwany błąd: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)