import os
import posixpath
import sqlite3
import datetime
import uuid
import time
import threading
from flask import Flask, request, jsonify, send_file, after_this_request, send_from_directory, g
from flask_cors import CORS
import ftplib
from dotenv import load_dotenv
import tempfile
import base64
import io
import jwt
import bcrypt
from functools import wraps
from sftp_handler import SFTPHandler, sftp_connect
from db_config import get_database_path, get_database_dir

# Ładowanie zmiennych środowiskowych
load_dotenv()

app = Flask(__name__)
CORS(app)

ACTION_PERMISSION_CATALOG = {
    'kiosk.manage': 'Zarządzanie kioskami (dodaj/edytuj/usuń)',
    'kiosk.paths': 'Edycja ścieżek kiosku',
    'kiosk.restart': 'Restart usługi kiosku',
    'kiosk.rotate': 'Obrót ekranu / orientacji kiosku',
    'playlist.save': 'Zapis i synchronizacja playlisty',
    'settings.manage': 'Zarządzanie ustawieniami systemu',
    'users.manage': 'Zarządzanie użytkownikami i rolami',
}

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
DATABASE_PATH = get_database_path()
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))

def get_db_connection():
    # timeout + busy_timeout redukują ryzyko chwilowych locków przy równoległych żądaniach
    conn = sqlite3.connect(DATABASE_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout = 30000')
    return conn

def init_db():
    if not os.path.exists(get_database_dir()):
        os.makedirs(get_database_dir())

    db_exists = os.path.exists(DATABASE_PATH)
    conn = get_db_connection()

    # Inicjalizuj schemat tylko dla nowej bazy.
    if not db_exists:
        schema_candidates = [
            os.path.join(PROJECT_ROOT, 'database', 'schema.sql'),
            os.path.join(os.path.dirname(__file__), 'schema.sql'),
        ]
        schema_path = next((path for path in schema_candidates if os.path.exists(path)), None)

        if not schema_path:
            conn.close()
            raise RuntimeError(
                "Brak pliku schema.sql. Przywróć folder 'database/schema.sql' "
                "lub ustaw KIOSK_DATABASE_PATH na istniejącą bazę SQLite."
            )

        with open(schema_path, 'r', encoding='utf-8') as f:
            conn.executescript(f.read())
        conn.commit()
    
    # Ustawienia SQLite poprawiające współbieżność odczyt/zapis.
    try:
        conn.execute('PRAGMA journal_mode = WAL')
        conn.execute('PRAGMA synchronous = NORMAL')
    except sqlite3.OperationalError as e:
        # W trybie debug Flask reloader uruchamia proces 2x i chwilowy lock jest normalny.
        if 'database is locked' in str(e).lower():
            app.logger.info("Pominięto ustawienie WAL przy starcie: database is locked")
        else:
            app.logger.warning(f"Nie udało się ustawić trybu WAL: {str(e)}")
    except Exception as e:
        app.logger.warning(f"Nie udało się ustawić trybu WAL: {str(e)}")

    # Migracja: Dodaj kolumnę role do tabeli users jeśli nie istnieje
    try:
        cursor = conn.execute("PRAGMA table_info(users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'role' not in columns:
            app.logger.info("Dodawanie kolumny 'role' do tabeli users...")
            conn.execute("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user'")
            conn.commit()
            app.logger.info("Kolumna 'role' dodana pomyślnie")

        if 'must_change_password' not in columns:
            app.logger.info("Dodawanie kolumny 'must_change_password' do tabeli users...")
            conn.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")
            conn.commit()
            app.logger.info("Kolumna 'must_change_password' dodana pomyślnie")
    except Exception as e:
        app.logger.error(f"Błąd podczas migracji bazy danych: {str(e)}")

    # Migracja: tabele playlist
    try:
        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kiosk_id INTEGER NOT NULL,
                name VARCHAR(120) NOT NULL DEFAULT 'Default',
                order_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(kiosk_id, name),
                FOREIGN KEY(kiosk_id) REFERENCES kiosks(id) ON DELETE CASCADE
            )
            '''
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_playlists_kiosk ON playlists(kiosk_id)')

        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS playlist_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_type VARCHAR(20) DEFAULT 'file',
                file_size INTEGER DEFAULT 0,
                display_frequency INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            )
            '''
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, position)')

        playlist_columns = [column[1] for column in conn.execute('PRAGMA table_info(playlists)').fetchall()]
        if 'order_mode' not in playlist_columns:
            conn.execute("ALTER TABLE playlists ADD COLUMN order_mode VARCHAR(20) NOT NULL DEFAULT 'manual'")

        playlist_item_columns = [column[1] for column in conn.execute('PRAGMA table_info(playlist_items)').fetchall()]
        if 'display_frequency' not in playlist_item_columns:
            conn.execute('ALTER TABLE playlist_items ADD COLUMN display_frequency INTEGER NOT NULL DEFAULT 1')

        conn.commit()
    except Exception as e:
        app.logger.error(f"Błąd podczas migracji tabel playlist: {str(e)}")

    # Migracja: konfigurowalne ścieżki per kiosk.
    try:
        kiosk_columns = [column[1] for column in conn.execute('PRAGMA table_info(kiosks)').fetchall()]
        if 'media_path' not in kiosk_columns:
            conn.execute("ALTER TABLE kiosks ADD COLUMN media_path TEXT")
        if 'text_file_path' not in kiosk_columns:
            conn.execute("ALTER TABLE kiosks ADD COLUMN text_file_path TEXT")
        if 'playlist_target_file' not in kiosk_columns:
            conn.execute("ALTER TABLE kiosks ADD COLUMN playlist_target_file TEXT")
        conn.commit()
    except Exception as e:
        app.logger.error(f"Błąd podczas migracji ścieżek kiosku: {str(e)}")

    # Migracja: uprawnienia akcji per użytkownik.
    try:
        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS user_action_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                allowed INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, action),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            '''
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_user_action_permissions_user ON user_action_permissions(user_id, action)')
        conn.commit()
    except Exception as e:
        app.logger.error(f"Błąd podczas migracji uprawnień akcji użytkowników: {str(e)}")
    finally:
        conn.close()

# Inicjalizacja bazy danych przy starcie
init_db()

# Ograniczenie częstotliwości zapisu statusów i spamu logów przy lockach SQLite.
STATUS_UPDATE_MIN_INTERVAL_SECONDS = 30
LOCK_WARNING_MIN_INTERVAL_SECONDS = 60
_last_status_update_ts = 0.0
_last_lock_warning_ts = 0.0
_status_update_lock = threading.Lock()

# Funkcja aktualizująca statusy kiosków na podstawie czasu ostatniego połączenia
def update_kiosk_statuses():
    global _last_status_update_ts, _last_lock_warning_ts

    now_ts = time.time()

    # Nie wykonuj zapisu częściej niż co 30 sekund (frontend zwykle odświeża częściej).
    if now_ts - _last_status_update_ts < STATUS_UPDATE_MIN_INTERVAL_SECONDS:
        return

    # Jeśli inny request już aktualizuje statusy, pomiń ten przebieg.
    if not _status_update_lock.acquire(blocking=False):
        return

    conn = None
    try:
        conn = get_db_connection()
        # Pobierz czas 1 minuty temu
        two_minutes_ago = (datetime.datetime.now() - datetime.timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S')

        # Zaktualizuj statusy kiosków, które nie połączyły się w ciągu ostatnich 1 minut
        conn.execute(
            'UPDATE kiosks SET status = "offline" WHERE last_connection < ? AND status != "offline"',
            (two_minutes_ago,)
        )
        conn.commit()
        _last_status_update_ts = now_ts
    except sqlite3.OperationalError as e:
        # Nie przerywaj żądania /api/kiosks przez chwilowy lock bazy.
        if 'database is locked' in str(e).lower():
            if now_ts - _last_lock_warning_ts >= LOCK_WARNING_MIN_INTERVAL_SECONDS:
                app.logger.warning('Pominięto update statusów kiosków: database is locked')
                _last_lock_warning_ts = now_ts
        else:
            raise
    finally:
        if conn:
            conn.close()
        _status_update_lock.release()

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
            # Zapisz username i rolę w Flask g dla dostępu w endpointach
            g.current_user = user['username']
            g.current_user_role = user['role'] or 'user'
            g.current_user_must_change_password = bool(user['must_change_password']) if 'must_change_password' in user.keys() else False

            # Wymuś zmianę hasła po pierwszym logowaniu.
            if g.current_user_must_change_password and request.path != '/api/account/change-password':
                return jsonify({
                    'message': 'Wymagana zmiana hasła przed dalszym korzystaniem z systemu',
                    'must_change_password': True,
                }), 403
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token wygasł'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token jest nieprawidłowy'}), 401

        return f(*args, **kwargs)
    return decorated

# Dekorator do weryfikacji uprawnień administratora
def admin_required(f):
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
            
            # Sprawdzenie roli
            role = data.get('role', 'user')
            if role != 'admin':
                return jsonify({'message': 'Brak uprawnień. Ta operacja wymaga roli administratora.'}), 403
            
            conn = get_db_connection()
            user = conn.execute('SELECT * FROM users WHERE username = ?', (data['username'],)).fetchone()
            conn.close()
            if not user:
                return jsonify({'message': 'Użytkownik nie istnieje'}), 401
            # Zapisz username i rolę w Flask g dla dostępu w endpointach
            g.current_user = user['username']
            g.current_user_role = user['role'] or 'user'
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token wygasł'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token jest nieprawidłowy'}), 401

        return f(*args, **kwargs)
    return decorated


def has_user_action_permission(username, action):
    if not username or not action:
        return False

    conn = get_db_connection()
    try:
        user = conn.execute('SELECT id, role FROM users WHERE username = ?', (username,)).fetchone()
        if not user:
            return False

        if (user['role'] or 'user') == 'admin':
            return True

        permission = conn.execute(
            'SELECT allowed FROM user_action_permissions WHERE user_id = ? AND action = ?',
            (user['id'], action)
        ).fetchone()
        return bool(permission and int(permission['allowed']) == 1)
    finally:
        conn.close()


def action_permission_required(action):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if action not in ACTION_PERMISSION_CATALOG:
                return jsonify({'message': f'Nieznana akcja uprawnień: {action}'}), 500

            current_username = getattr(g, 'current_user', None)
            if not current_username:
                return jsonify({'message': 'Brak kontekstu użytkownika'}), 401

            if not has_user_action_permission(current_username, action):
                return jsonify({'message': f'Brak uprawnień do akcji: {action}'}), 403

            return f(*args, **kwargs)
        return decorated
    return decorator

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
        must_change_password = bool(user['must_change_password']) if 'must_change_password' in user.keys() else False
        # Generowanie tokenu JWT zawierającego rolę
        token = jwt.encode({
            'username': username,
            'role': user['role'] or 'user',
            'must_change_password': must_change_password,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        }, JWT_SECRET_KEY, algorithm="HS256")
        return jsonify({
            "success": True,
            "username": username,
            "role": user['role'] or 'user',
            "must_change_password": must_change_password,
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
            'INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, ?, ?)',
            (
                'admin',
                bcrypt.hashpw('admin'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8'),
                'admin',
                0,
            )  # W produkcji powinno być używane hashowanie haseł
        )
        conn.commit()

    # Kompatybilność wsteczna: jeśli konto admin istnieje, wymuś rolę admin.
    conn.execute(
        "UPDATE users SET role = 'admin' WHERE username = 'admin' AND (role IS NULL OR role != 'admin')"
    )
    conn.execute(
        "UPDATE users SET must_change_password = 0 WHERE username = 'admin' AND (must_change_password IS NULL OR must_change_password != 0)"
    )
    conn.commit()
    
    conn.close()

# Inicjalizacja domyślnego użytkownika przy starcie
init_default_user()

# Ścieżka do klucza SSH dla SFTP (LibreELEC)
SSH_KEY_PATH = os.path.join(os.path.dirname(__file__), 'ssh_keys', 'kiosk_id_rsa')


def build_ssh_username_candidates(kiosk, settings_dict, request_data=None):
    candidates = []

    if request_data:
        requested_username = (request_data.get('username') or '').strip()
        if requested_username:
            candidates.append(requested_username)

    kiosk_username = (kiosk['ftp_username'] or '').strip() if 'ftp_username' in kiosk.keys() else ''
    if kiosk_username:
        candidates.append(kiosk_username)

    default_username = (settings_dict.get('defaultSshUsername') or '').strip()
    if default_username:
        candidates.append(default_username)

    candidates.extend(['kiosk', 'root'])

    unique_candidates = []
    seen = set()
    for username in candidates:
        if username and username not in seen:
            unique_candidates.append(username)
            seen.add(username)

    return unique_candidates


def connect_ssh_with_username_fallback(hostname, port, username_candidates, key_path, password=None):
    import paramiko

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        private_key = paramiko.RSAKey.from_private_key_file(key_path)
    except Exception as key_error:
        raise Exception(f"Błąd podczas ładowania klucza SSH: {str(key_error)}") from key_error

    last_error = None

    for username in username_candidates:
        try:
            ssh.connect(
                hostname=hostname,
                port=port,
                username=username,
                pkey=private_key,
                timeout=10,
                look_for_keys=False,
                allow_agent=False,
            )
            return ssh, username
        except Exception as auth_error:
            last_error = auth_error

    if password:
        for username in username_candidates:
            try:
                ssh.connect(
                    hostname=hostname,
                    port=port,
                    username=username,
                    password=password,
                    timeout=10,
                    look_for_keys=False,
                    allow_agent=False,
                )
                return ssh, username
            except Exception as auth_error:
                last_error = auth_error

    ssh.close()
    raise last_error or Exception('Nie udało się uwierzytelnić przez SSH')

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


def get_default_media_path(port):
    # LibreELEC / Kodi: media domyślnie w /storage/videos (SFTP, port 22)
    return '/storage/videos' if port == 22 else '/home/kiosk/MediaPionowe'


def get_default_text_file_path(port):
    # LibreELEC / Kodi lokalnie używa /storage/napis.txt
    return '/storage/napis.txt' if port == 22 else 'napis.txt'


def normalize_optional_path(value):
    text = str(value or '').strip()
    return text if text else None


def get_kiosk_path_setting(kiosk_row, key):
    if not kiosk_row:
        return None
    try:
        return normalize_optional_path(kiosk_row[key])
    except Exception:
        return None


def build_playlist_target_from_media_path(media_path):
    base_path = str(media_path or '').strip() or '/storage/videos'
    if not base_path.startswith('/'):
        base_path = '/' + base_path.lstrip('/')
    base_path = base_path.rstrip('/') or '/'
    if base_path == '/':
        return '/kiosk_playlist.m3u'
    return f"{base_path}/kiosk_playlist.m3u"


def get_kiosk_media_path(kiosk_row, port):
    configured = get_kiosk_path_setting(kiosk_row, 'media_path')
    return configured or get_default_media_path(port)


def get_kiosk_text_file_path(kiosk_row, port):
    configured = get_kiosk_path_setting(kiosk_row, 'text_file_path')
    if configured:
        if configured.startswith('/'):
            return configured
        if port == 22:
            return f"/storage/{configured.lstrip('/')}"
        return configured
    return get_default_text_file_path(port)


def get_kiosk_playlist_target_file(kiosk_row, port):
    configured = get_kiosk_path_setting(kiosk_row, 'playlist_target_file')
    if configured:
        if configured.startswith('/'):
            return configured
        media_path = get_kiosk_media_path(kiosk_row, port)
        media_dir = (media_path or '/').rstrip('/') or '/'
        if media_dir == '/':
            return '/' + configured.lstrip('/')
        return f"{media_dir}/{configured.lstrip('/')}"

    media_path = get_kiosk_media_path(kiosk_row, port)
    return build_playlist_target_from_media_path(media_path)


def resolve_playlist_target_file(port, target_file, kiosk_row):
    path = normalize_optional_path(target_file)
    if not path:
        return get_kiosk_playlist_target_file(kiosk_row, port)
    if path.startswith('/'):
        return path

    media_path = get_kiosk_media_path(kiosk_row, port)
    media_dir = (media_path or '/').rstrip('/') or '/'
    if media_dir == '/':
        return '/' + path.lstrip('/')
    return f"{media_dir}/{path.lstrip('/')}"


def resolve_text_file_path(port, file_path, default_file_path=None):
    path = str(file_path or '').strip()
    fallback_path = str(default_file_path or '').strip()

    if not path:
        return fallback_path or get_default_text_file_path(port)

    # Jeśli ścieżka jest względna, użyj katalogu z configured default, jeśli jest absolutny.
    if not path.startswith('/'):
        if fallback_path.startswith('/'):
            base_dir = posixpath.dirname(fallback_path.rstrip('/')) or '/'
            return posixpath.join(base_dir, path).replace('\\', '/')
        if port == 22:
            return f"/storage/{path.lstrip('/')}"
        return path

    return path

# Obsługa FTP (tradycyjny vsftpd)
def ftp_connect(hostname, username, password, port=21):
    try:
        ftp = ftplib.FTP(timeout=10)
        ftp.connect(hostname, port, timeout=10)
        ftp.login(username, password)
        return ftp
    except ftplib.all_errors as e:
        print(f"FTP connection error: {e}")
        return None
    except OSError as e:
        print(f"FTP connection error: {e}")
        return None
    except Exception as e:
        print(f"FTP connection error: {e}")
        return None

# Uniwersalna funkcja do łączenia (FTP lub SFTP)
def connect_file_transfer(hostname, username, password, port=21):
    """
    Uniwersalna funkcja łącząca z serwerem plików
    Automatycznie wybiera FTP (port 21) lub SFTP (port 22)
    Obsługuje retry z exponential backoff dla przejściowych błędów
    
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
        # Tradycyjny FTP (vsftpd) - spróbuj z retry
        retry_count = 3
        retry_delay = 1  # sekund
        
        for attempt in range(retry_count):
            conn = ftp_connect(hostname, username, password, port)
            if conn:
                return conn
            
            if attempt < retry_count - 1:
                print(f"FTP connection retry {attempt + 1}/{retry_count - 1}, waiting {retry_delay}s...")
                time.sleep(retry_delay)
                retry_delay *= 2  # exponential backoff
        
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
@action_permission_required('settings.manage')
def get_settings():
    conn = get_db_connection()
    settings = conn.execute('SELECT * FROM settings').fetchall()
    conn.close()
    
    # Zwróć wszystkie ustawienia jako słownik
    settings_dict = {setting['key']: setting['value'] for setting in settings}
    
    return jsonify(settings_dict)

@app.route('/api/settings', methods=['POST'])
@token_required
@action_permission_required('settings.manage')
def update_settings():
    data = request.json
    
    if not data:
        return jsonify({"error": "Brak danych do aktualizacji"}), 400
    
    conn = get_db_connection()
    
    for key, value in data.items():
        conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, value))

    if 'tickerOrientation' not in data and 'orientation' in data:
        conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('tickerOrientation', str(data.get('orientation') or '').strip().lower()))
    
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Ustawienia zaktualizowane pomyślnie"})


@app.route('/api/ticker-orientation', methods=['GET'])
def get_ticker_orientation():
    conn = get_db_connection()
    setting = conn.execute('SELECT value FROM settings WHERE key = ?', ('tickerOrientation',)).fetchone()
    conn.close()
    orientation = (setting['value'] if setting else 'normal') or 'normal'
    return jsonify({
        'orientation': normalize_orientation_value(orientation),
    })

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


def get_or_create_playlist(conn, kiosk_id, playlist_name='Default'):
    playlist = conn.execute(
        'SELECT id, kiosk_id, name, order_mode, created_at, updated_at FROM playlists WHERE kiosk_id = ? AND name = ?',
        (kiosk_id, playlist_name)
    ).fetchone()

    if playlist:
        return playlist

    conn.execute(
        'INSERT INTO playlists (kiosk_id, name, order_mode, updated_at) VALUES (?, ?, ?, ?)',
        (kiosk_id, playlist_name, 'manual', datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    )
    conn.commit()
    return conn.execute(
        'SELECT id, kiosk_id, name, order_mode, created_at, updated_at FROM playlists WHERE kiosk_id = ? AND name = ?',
        (kiosk_id, playlist_name)
    ).fetchone()


def apply_playlist_order(items, order_mode):
    if order_mode == 'name_asc':
        return sorted(items, key=lambda x: str(x['file_name']).lower())
    if order_mode == 'name_desc':
        return sorted(items, key=lambda x: str(x['file_name']).lower(), reverse=True)
    if order_mode == 'random':
        shuffled = list(items)
        import random
        random.shuffle(shuffled)
        return shuffled
    return sorted(items, key=lambda x: (x['position'], x['id']))


def build_playlist_m3u(items, order_mode):
    ordered = apply_playlist_order(items, order_mode)
    lines = ['#EXTM3U']
    for item in ordered:
        freq = item['display_frequency'] if item['display_frequency'] and item['display_frequency'] > 0 else 1
        for _ in range(freq):
            lines.append(str(item['file_path']))
    return '\n'.join(lines) + '\n'


def sync_orientation_hint_to_kiosk(kiosk_row, orientation_value, target_file='/storage/kiosk_orientation.txt'):
    hostname = kiosk_row['ip_address']
    username = kiosk_row['ftp_username'] or 'root'
    password = kiosk_row['ftp_password'] or ''

    if not hostname or not password:
        raise Exception('Brak IP lub hasła FTP/SFTP kiosku do synchronizacji orientacji')

    conn = connect_file_transfer(hostname, username, password, 22)
    used_port = 22
    if not conn:
        conn = connect_file_transfer(hostname, username, password, 21)
        used_port = 21
    if not conn:
        raise Exception('Nie można połączyć się z kioskiem przez SFTP ani FTP')

    try:
        content = normalize_orientation_value(orientation_value)
        if isinstance(conn, SFTPHandler):
            conn.put_file_content(target_file, content)
            conn.close()
        else:
            remote_dir = os.path.dirname(target_file) or '/'
            remote_name = os.path.basename(target_file)
            conn.cwd(remote_dir)
            with io.BytesIO((content + '\n').encode('utf-8')) as stream:
                conn.storbinary(f'STOR {remote_name}', stream)
            conn.quit()
        return used_port
    except Exception:
        try:
            if isinstance(conn, SFTPHandler):
                conn.close()
            else:
                conn.quit()
        except Exception:
            pass
        raise


def sync_orientation_hint_via_ssh(kiosk_row, orientation_value, target_file='/storage/kiosk_orientation.txt'):
    hostname = kiosk_row['ip_address']
    if not hostname:
        raise Exception('Brak IP kiosku do synchronizacji orientacji przez SSH')

    conn = get_db_connection()
    settings = conn.execute('SELECT key, value FROM settings WHERE key IN ("defaultSshUsername", "defaultSshPort")').fetchall()
    conn.close()
    settings_dict = {setting['key']: setting['value'] for setting in settings}

    username_candidates = build_ssh_username_candidates(kiosk_row, settings_dict)
    ssh_port = int(settings_dict.get('defaultSshPort', 22))
    ssh_key_path = os.path.join(os.path.dirname(__file__), 'ssh_keys', 'kiosk_id_rsa_openssh')
    ssh_password = kiosk_row['ftp_password'] if 'ftp_password' in kiosk_row.keys() else None

    content = normalize_orientation_value(orientation_value)

    ssh, _ = connect_ssh_with_username_fallback(
        hostname=hostname,
        port=ssh_port,
        username_candidates=username_candidates,
        key_path=ssh_key_path,
        password=ssh_password,
    )

    try:
        # value and target_file are controlled in backend, so simple quoting is sufficient here.
        cmd = f"bash -lc 'printf \"%s\\n\" \"{content}\" > \"{target_file}\"'"
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=10)
        _ = stdin
        err = stderr.read().decode('utf-8', errors='ignore').strip()
        code = stdout.channel.recv_exit_status()
        if code != 0:
            raise Exception(err or f'Nie udało się zapisać pliku orientacji przez SSH (exit code {code})')
        return ssh_port
    finally:
        try:
            ssh.close()
        except Exception:
            pass


def normalize_orientation_value(value):
    orientation = (value or '').strip().lower()
    if orientation in ('0', 'normal'):
        return 'normal'
    if orientation in ('90', 'right'):
        return 'right'
    if orientation in ('270', 'left'):
        return 'left'
    if orientation in ('180', 'inverted'):
        return 'inverted'
    return 'normal'


def sync_playlist_to_kiosk(kiosk_row, playlist_content, target_file=None):
    hostname = kiosk_row['ip_address']
    username = kiosk_row['ftp_username'] or 'root'
    password = kiosk_row['ftp_password'] or ''
    target_path = target_file or get_kiosk_playlist_target_file(kiosk_row, 22)

    if not hostname or not password:
        raise Exception('Brak IP lub hasła FTP/SFTP kiosku do synchronizacji playlisty')

    # Preferuj SFTP dla LibreELEC/Kodi.
    conn = connect_file_transfer(hostname, username, password, 22)
    used_port = 22
    if not conn:
        conn = connect_file_transfer(hostname, username, password, 21)
        used_port = 21
    if not conn:
        raise Exception('Nie można połączyć się z kioskiem przez SFTP ani FTP')

    try:
        if isinstance(conn, SFTPHandler):
            conn.put_file_content(target_path, playlist_content)
            conn.close()
        else:
            remote_dir = os.path.dirname(target_path) or '/'
            remote_name = os.path.basename(target_path)
            conn.cwd(remote_dir)
            with io.BytesIO(playlist_content.encode('utf-8')) as stream:
                conn.storbinary(f'STOR {remote_name}', stream)
            conn.quit()
        return used_port
    except Exception:
        try:
            if isinstance(conn, SFTPHandler):
                conn.close()
            else:
                conn.quit()
        except Exception:
            pass
        raise


@app.route('/api/kiosks/<int:kiosk_id>/playlist', methods=['GET'])
@token_required
def get_kiosk_playlist(kiosk_id):
    playlist_name = (request.args.get('name') or 'Default').strip() or 'Default'

    conn = get_db_connection()
    kiosk = conn.execute(
        'SELECT id, media_path, text_file_path, playlist_target_file FROM kiosks WHERE id = ?',
        (kiosk_id,)
    ).fetchone()
    if not kiosk:
        conn.close()
        return jsonify({'error': 'Kiosk nie znaleziony'}), 404

    playlist = get_or_create_playlist(conn, kiosk_id, playlist_name)
    items = conn.execute(
        '''
        SELECT id, position, file_path, file_name, file_type, file_size, display_frequency
        FROM playlist_items
        WHERE playlist_id = ?
        ORDER BY position ASC, id ASC
        ''',
        (playlist['id'],)
    ).fetchall()
    conn.close()

    return jsonify({
        'playlist': {
            'id': playlist['id'],
            'kiosk_id': playlist['kiosk_id'],
            'name': playlist['name'],
            'order_mode': playlist['order_mode'] or 'manual',
            'targetFile': get_kiosk_playlist_target_file(kiosk, 22),
            'created_at': playlist['created_at'],
            'updated_at': playlist['updated_at'],
        },
        'items': [
            {
                'id': item['id'],
                'position': item['position'],
                'path': item['file_path'],
                'name': item['file_name'],
                'type': item['file_type'] or 'file',
                'size': item['file_size'] or 0,
                'displayFrequency': item['display_frequency'] or 1,
            }
            for item in items
        ],
    })


@app.route('/api/kiosks/<int:kiosk_id>/playlist', methods=['PUT'])
@token_required
@action_permission_required('playlist.save')
def save_kiosk_playlist(kiosk_id):
    data = request.json or {}
    items = data.get('items', [])
    playlist_name = (data.get('name') or 'Default').strip() or 'Default'
    order_mode = str(data.get('orderMode') or 'manual').strip() or 'manual'

    allowed_order_modes = {'manual', 'name_asc', 'name_desc', 'random'}
    if order_mode not in allowed_order_modes:
        return jsonify({'error': 'Nieprawidłowy orderMode. Dozwolone: manual, name_asc, name_desc, random'}), 400

    if not isinstance(items, list):
        return jsonify({'error': 'Pole items musi być listą'}), 400

    conn = get_db_connection()
    kiosk = conn.execute(
        'SELECT id, ip_address, ftp_username, ftp_password, media_path, text_file_path, playlist_target_file FROM kiosks WHERE id = ?',
        (kiosk_id,)
    ).fetchone()
    if not kiosk:
        conn.close()
        return jsonify({'error': 'Kiosk nie znaleziony'}), 404

    target_file = resolve_playlist_target_file(22, data.get('targetFile'), kiosk)

    playlist = get_or_create_playlist(conn, kiosk_id, playlist_name)

    try:
        conn.execute('DELETE FROM playlist_items WHERE playlist_id = ?', (playlist['id'],))

        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            file_path = str(item.get('path') or '').strip()
            file_name = str(item.get('name') or '').strip()
            if not file_path or not file_name:
                continue
            file_type = str(item.get('type') or 'file').strip() or 'file'
            file_size = item.get('size')
            display_frequency = item.get('displayFrequency', 1)
            try:
                file_size = int(file_size) if file_size is not None else 0
            except (TypeError, ValueError):
                file_size = 0
            try:
                display_frequency = int(display_frequency)
                if display_frequency < 1:
                    display_frequency = 1
            except (TypeError, ValueError):
                display_frequency = 1

            conn.execute(
                '''
                INSERT INTO playlist_items (playlist_id, position, file_path, file_name, file_type, file_size, display_frequency)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ''',
                (playlist['id'], index + 1, file_path, file_name, file_type, file_size, display_frequency)
            )

        conn.execute(
            'UPDATE playlists SET order_mode = ?, updated_at = ? WHERE id = ?',
            (order_mode, datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), playlist['id'])
        )
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({'error': f'Błąd zapisu playlisty: {str(e)}'}), 500

    saved_items = conn.execute(
        '''
        SELECT id, position, file_path, file_name, file_type, file_size, display_frequency
        FROM playlist_items
        WHERE playlist_id = ?
        ORDER BY position ASC, id ASC
        ''',
        (playlist['id'],)
    ).fetchall()
    saved_count = len(saved_items)
    conn.close()

    sync_error = None
    sync_port = None
    try:
        playlist_content = build_playlist_m3u(saved_items, order_mode)
        sync_port = sync_playlist_to_kiosk(kiosk, playlist_content, target_file)
    except Exception as e:
        sync_error = str(e)

    response = {
        'message': 'Playlista zapisana pomyślnie',
        'playlistId': playlist['id'],
        'itemsCount': saved_count,
        'orderMode': order_mode,
        'targetFile': target_file,
    }
    if sync_port:
        response['synced'] = True
        response['syncPort'] = sync_port
    if sync_error:
        response['synced'] = False
        response['syncError'] = sync_error

    return jsonify(response)

@app.route('/api/kiosks', methods=['POST'])
@token_required
@action_permission_required('kiosk.manage')
def add_kiosk():
    data = request.json
    
    if not data or 'mac_address' not in data or 'serial_number' not in data:
        return jsonify({"error": "Brakujące dane: wymagane mac_address i serial_number"}), 400
    
    conn = get_db_connection()
    try:
        conn.execute(
              'INSERT INTO kiosks (mac_address, serial_number, name, ftp_username, ftp_password, media_path, text_file_path, playlist_target_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (data['mac_address'], data['serial_number'], data.get('name', ''),
               data.get('ftp_username', ''), data.get('ftp_password', ''),
               normalize_optional_path(data.get('media_path')),
               normalize_optional_path(data.get('text_file_path')),
               normalize_optional_path(data.get('playlist_target_file')))
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

    current_username = getattr(g, 'current_user', None)
    requested_fields = set(data.keys())
    path_fields = {'media_path', 'text_file_path', 'playlist_target_file'}

    if requested_fields and requested_fields.issubset(path_fields):
        if not has_user_action_permission(current_username, 'kiosk.paths'):
            return jsonify({"error": "Brak uprawnień do edycji ścieżek kiosku"}), 403
    else:
        if not has_user_action_permission(current_username, 'kiosk.manage'):
            return jsonify({"error": "Brak uprawnień do edycji kiosku"}), 403
    
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
        'media_path': normalize_optional_path(data.get('media_path')) if 'media_path' in data else None,
        'text_file_path': normalize_optional_path(data.get('text_file_path')) if 'text_file_path' in data else None,
        'playlist_target_file': normalize_optional_path(data.get('playlist_target_file')) if 'playlist_target_file' in data else None,
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
@action_permission_required('kiosk.manage')
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

    # Fallback: jeśli FTP na 21 jest niedostępny, spróbuj SFTP na 22.
    if not conn and port == 21:
        fallback_port = 22
        fallback_protocol = get_protocol(fallback_port)
        print(f"FTP connect failed on {data['hostname']}:{port}, trying fallback {fallback_protocol.upper()}:{fallback_port}")
        fallback_conn = connect_file_transfer(data['hostname'], data['username'], data['password'], fallback_port)
        if fallback_conn:
            if isinstance(fallback_conn, SFTPHandler):
                fallback_conn.close()
            else:
                fallback_conn.quit()
            return jsonify({
                "message": f"Połączenie {fallback_protocol.upper()} udane (automatyczny fallback z FTP:21)",
                "protocol": fallback_protocol,
                "port": fallback_port,
                "fallback": True,
            })

    if conn:
        if isinstance(conn, SFTPHandler):
            conn.close()
        else:
            conn.quit()
        return jsonify({"message": f"Połączenie {protocol.upper()} udane", "protocol": protocol, "port": port})

    error_msg = f"Nie można połączyć się z serwerem {protocol.upper()} na {data['hostname']}:{port}. Sprawdź czy serwer słucha na podanym porcie i podane dane logowania są poprawne."
    return jsonify({"error": error_msg}), 500

@app.route('/api/ftp/files', methods=['POST'])
@token_required
def list_ftp_files():
    data = request.json
    
    if not data or 'hostname' not in data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Brakujące dane połączenia"}), 400
    
    kiosk = None
    kiosk_id = data.get('kioskId')
    if kiosk_id is not None and str(kiosk_id).strip():
        try:
            parsed_kiosk_id = int(kiosk_id)
        except (ValueError, TypeError):
            return jsonify({"error": "kioskId musi być liczbą całkowitą"}), 400

        db_conn = get_db_connection()
        kiosk = db_conn.execute(
            'SELECT id, media_path, text_file_path, playlist_target_file FROM kiosks WHERE id = ?',
            (parsed_kiosk_id,)
        ).fetchone()
        db_conn.close()

        if not kiosk:
            return jsonify({"error": "Kiosk nie znaleziony"}), 404

    port = 21
    if 'port' in data:
        try:
            port = int(data['port'])
        except (ValueError, TypeError):
            return jsonify({"error": "Port musi być liczbą całkowitą"}), 400
    
    # Automatyczne określanie domyślnej ścieżki na podstawie protokołu i ustawień kiosku.
    requested_path = str(data.get('path', '')).strip()
    path_provided = bool(requested_path)
    default_path = get_kiosk_media_path(kiosk, port)
    remote_path = requested_path if path_provided else default_path
    
    protocol = get_protocol(port)
    conn = connect_file_transfer(data['hostname'], data['username'], data['password'], port)

    # Fallback: jeśli FTP na 21 nie działa, spróbuj SFTP 22.
    if not conn and port == 21:
        fallback_port = 22
        fallback_protocol = get_protocol(fallback_port)
        fallback_conn = connect_file_transfer(data['hostname'], data['username'], data['password'], fallback_port)
        if fallback_conn:
            conn = fallback_conn
            port = fallback_port
            protocol = fallback_protocol
            if not path_provided:
                remote_path = get_kiosk_media_path(kiosk, fallback_port)

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
        remote_path = data.get('path', get_default_media_path(port))
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
        
        default_path = get_default_media_path(port)
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
    kiosk = conn.execute(
        'SELECT id, name, ip_address, ftp_username, ftp_password, media_path, text_file_path, playlist_target_file FROM kiosks WHERE id = ?',
        (kiosk_id,)
    ).fetchone()
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
        "ftp_password": kiosk['ftp_password'],
        "media_path": kiosk['media_path'],
        "text_file_path": kiosk['text_file_path'],
        "playlist_target_file": kiosk['playlist_target_file'],
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
@token_required
@action_permission_required('kiosk.restart')
def restart_kiosk_service(kiosk_id):
    # Pobierz dane z żądania (jeśli istnieją)
    request_data = request.json or {}
    
    # Wymagaj hasła SSH przy restarcie
    ssh_password = (request_data.get('password') or '').strip()
    if not ssh_password:
        return jsonify({"error": "Hasło SSH jest wymagane do restartu usługi"}), 400
    
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
    username_candidates = build_ssh_username_candidates(kiosk, settings_dict, request_data)
    
    # Określamy ścieżkę do klucza SSH - zawsze używamy stałej nazwy pliku
    ssh_key_path = os.path.join(os.path.dirname(__file__), 'ssh_keys', 'kiosk_id_rsa_openssh')
    
    # Sprawdzenie czy klucz SSH istnieje
    if not os.path.exists(ssh_key_path):
        print(f"Nie znaleziono klucza SSH ({ssh_key_path})")
        return jsonify({"error": f"Nie znaleziono klucza SSH. Upewnij się, że klucz istnieje w folderze backend/ssh_keys/kiosk_id_rsa"}), 500
    
    ssh_port = int(request_data.get('port') or settings_dict.get('defaultSshPort', 22))
    
    # Wypisz informacje diagnostyczne dla celów debugowania
    print(f"Restarting service kiosk on kiosk {kiosk['name'] or kiosk['id']} ({kiosk['ip_address']})")
    print(f"SSH connection candidates: {', '.join(username_candidates)}@{kiosk['ip_address']}:{ssh_port} using key authentication from {ssh_key_path}")
    
    try:
        try:
            ssh, used_username = connect_ssh_with_username_fallback(
                hostname=kiosk['ip_address'],
                port=ssh_port,
                username_candidates=username_candidates,
                key_path=ssh_key_path,
                password=ssh_password
            )
            print(f"Połączono przez SSH używając konta {used_username}")
        except Exception as e:
            print(f"Błąd połączenia SSH: {str(e)}")
            return jsonify({
                "error": f"Nie można połączyć się z kioskiem przez SSH: {str(e)}. Sprawdź czy klucz publiczny jest zainstalowany na kiosku w ~/.ssh/authorized_keys lub ustaw właściwy login SSH."
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
    kiosk = None
    kiosk_id = data.get('kioskId')
    if kiosk_id is not None and str(kiosk_id).strip():
        try:
            parsed_kiosk_id = int(kiosk_id)
        except (ValueError, TypeError):
            return jsonify({"error": "kioskId musi być liczbą całkowitą"}), 400

        db_conn = get_db_connection()
        kiosk = db_conn.execute(
            'SELECT id, media_path, text_file_path, playlist_target_file FROM kiosks WHERE id = ?',
            (parsed_kiosk_id,)
        ).fetchone()
        db_conn.close()

        if not kiosk:
            return jsonify({"error": "Kiosk nie znaleziony"}), 404

    default_text_path = get_kiosk_text_file_path(kiosk, port)
    file_path = resolve_text_file_path(port, data.get('path'), default_text_path)
    
    print(f"GET file content: {file_path} from {hostname}:{port} (user: {username})")
    
    # Jeśli hasło jest zaszyfrowane, odszyfruj je
    if password and isinstance(password, str) and password.startswith('ENC:'):
        password = decrypt_data(password[4:])
    
    # Połącz z FTP lub SFTP (w zależności od portu)
    protocol = get_protocol(port)
    conn = connect_file_transfer(hostname, username, password, port)

    # Fallback: jeśli FTP na 21 nie działa, spróbuj SFTP na 22 i dostosuj domyślną ścieżkę.
    if not conn and port == 21:
        fallback_port = 22
        fallback_protocol = get_protocol(fallback_port)
        fallback_default_text_path = get_kiosk_text_file_path(kiosk, fallback_port)
        fallback_path = resolve_text_file_path(fallback_port, data.get('path'), fallback_default_text_path)
        fallback_conn = connect_file_transfer(hostname, username, password, fallback_port)
        if fallback_conn:
            conn = fallback_conn
            port = fallback_port
            protocol = fallback_protocol
            file_path = fallback_path

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
    kiosk = None
    kiosk_id = data.get('kioskId')
    if kiosk_id is not None and str(kiosk_id).strip():
        try:
            parsed_kiosk_id = int(kiosk_id)
        except (ValueError, TypeError):
            return jsonify({"error": "kioskId musi być liczbą całkowitą"}), 400

        db_conn = get_db_connection()
        kiosk = db_conn.execute(
            'SELECT id, media_path, text_file_path, playlist_target_file FROM kiosks WHERE id = ?',
            (parsed_kiosk_id,)
        ).fetchone()
        db_conn.close()

        if not kiosk:
            return jsonify({"error": "Kiosk nie znaleziony"}), 404

    default_text_path = get_kiosk_text_file_path(kiosk, port)
    file_path = resolve_text_file_path(port, data.get('path'), default_text_path)
    content = data['content']
    
    print(f"PUT file content: {file_path} to {hostname}:{port} (user: {username}), content length: {len(content)}")
    
    # Jeśli hasło jest zaszyfrowane, odszyfruj je
    if password and isinstance(password, str) and password.startswith('ENC:'):
        password = decrypt_data(password[4:])
    
    # Połącz z FTP lub SFTP (w zależności od portu)
    protocol = get_protocol(port)
    conn = connect_file_transfer(hostname, username, password, port)

    # Fallback: jeśli FTP na 21 nie działa, spróbuj SFTP na 22 i dostosuj domyślną ścieżkę.
    if not conn and port == 21:
        fallback_port = 22
        fallback_protocol = get_protocol(fallback_port)
        fallback_default_text_path = get_kiosk_text_file_path(kiosk, fallback_port)
        fallback_path = resolve_text_file_path(fallback_port, data.get('path'), fallback_default_text_path)
        fallback_conn = connect_file_transfer(hostname, username, password, fallback_port)
        if fallback_conn:
            conn = fallback_conn
            port = fallback_port
            protocol = fallback_protocol
            file_path = fallback_path

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
@action_permission_required('kiosk.rotate')
def rotate_kiosk_display(kiosk_id):
    data = request.json or {}
    orientation = (data.get('orientation') or '').strip().lower()
    allowed = ['right', '0', 'normal', 'left', 'inverted', '90', '270', '180']
    if orientation not in allowed:
        return jsonify({"error": "Nieprawidłowa orientacja. Dozwolone: right | 0 (normal) | left | inverted | 90 | 180 | 270"}), 400
    # Znormalizuj do wartości wspieranych przez xrandr ('normal','right','left','inverted')
    normalized = normalize_orientation_value(orientation)

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
    username_candidates = build_ssh_username_candidates(kiosk, settings_dict)
    ssh_port = int(settings_dict.get('defaultSshPort', 22))

    ssh_key_path = os.path.join(os.path.dirname(__file__), 'ssh_keys', 'kiosk_id_rsa_openssh')
    has_key = os.path.exists(ssh_key_path)
    ssh_password = kiosk['ftp_password'] if 'ftp_password' in kiosk.keys() else None
    if not has_key and not ssh_password:
        return jsonify({"error": "Brak klucza SSH i hasła. Skonfiguruj backend/ssh_keys/kiosk_id_rsa_openssh lub ustaw ftp_password dla kiosku."}), 500

    orientation_file_error = None
    orientation_file_port = None
    try:
        orientation_file_port = sync_orientation_hint_to_kiosk(kiosk, normalized)
    except Exception as hint_error:
        orientation_file_error = str(hint_error)

    try:
        ssh, used_username = connect_ssh_with_username_fallback(
            hostname=kiosk['ip_address'],
            port=ssh_port,
            username_candidates=username_candidates,
            key_path=ssh_key_path,
            password=ssh_password,
        )
        print(f"Połączono przez SSH używając konta {used_username}")

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
            if orientation_file_port:
                return jsonify({
                    "success": True,
                    "message": "Orientacja zapisana w pliku orientacji kiosku, xrandr nie powiódł się",
                    "orientation": normalized,
                    "fallbackApplied": True,
                    "orientationFile": "/storage/kiosk_orientation.txt",
                    "orientationFilePort": orientation_file_port,
                    "orientationFileError": orientation_file_error,
                    "stdout": out,
                    "stderr": err,
                    "exitCode": code,
                })
            return jsonify({"error": f"Błąd xrandr: {err or 'nieznany błąd'}", "stdout": out, "stderr": err, "exitCode": code}), 500

        return jsonify({
            "success": True,
            "message": "Ekran obrócony",
            "orientation": normalized,
            "orientationFile": "/storage/kiosk_orientation.txt",
            "orientationFilePort": orientation_file_port,
            "orientationFileError": orientation_file_error,
            "stdout": out,
        })
    except ImportError:
        if orientation_file_port:
            return jsonify({
                "success": True,
                "message": "Orientacja zapisana w pliku orientacji kiosku, ale brak biblioteki paramiko do xrandr",
                "orientation": normalized,
                "fallbackApplied": True,
                "orientationFile": "/storage/kiosk_orientation.txt",
                "orientationFilePort": orientation_file_port,
                "orientationFileError": orientation_file_error,
            })
        return jsonify({"error": "Brak biblioteki paramiko. Zainstaluj: pip install paramiko"}), 500
    except Exception as e:
        if orientation_file_port:
            return jsonify({
                "success": True,
                "message": "Orientacja zapisana w pliku orientacji kiosku, wystąpił błąd przy xrandr",
                "orientation": normalized,
                "fallbackApplied": True,
                "orientationFile": "/storage/kiosk_orientation.txt",
                "orientationFilePort": orientation_file_port,
                "orientationFileError": orientation_file_error,
                "error": str(e),
            })
        return jsonify({"error": f"Nieoczekiwany błąd: {str(e)}"}), 500


@app.route('/api/kiosks/<int:kiosk_id>/orientation-file', methods=['POST'])
@token_required
@action_permission_required('kiosk.rotate')
def write_kiosk_orientation_file(kiosk_id):
    data = request.json or {}
    orientation = (data.get('orientation') or '').strip().lower()
    allowed = ['right', '0', 'normal', 'left', 'inverted', '90', '270', '180']
    if orientation not in allowed:
        return jsonify({"error": "Nieprawidłowa orientacja. Dozwolone: right | 0 (normal) | left | inverted | 90 | 180 | 270"}), 400

    normalized = normalize_orientation_value(orientation)

    conn = get_db_connection()
    kiosk = conn.execute(
        'SELECT id, name, ip_address, ftp_username, ftp_password FROM kiosks WHERE id = ?',
        (kiosk_id,)
    ).fetchone()
    conn.close()
    if not kiosk:
        return jsonify({"error": "Kiosk nie znaleziony"}), 404

    transfer_errors = []
    used_port = None
    used_method = None

    if kiosk['ip_address']:
        try:
            used_port = sync_orientation_hint_to_kiosk(kiosk, normalized)
            used_method = 'sftp' if used_port == 22 else 'ftp'
        except Exception as transfer_error:
            transfer_errors.append(str(transfer_error))

        if not used_port:
            try:
                used_port = sync_orientation_hint_via_ssh(kiosk, normalized)
                used_method = 'ssh'
            except Exception as ssh_error:
                transfer_errors.append(str(ssh_error))
    else:
        transfer_errors.append('Kiosk nie ma przypisanego adresu IP')

    db_conn = get_db_connection()
    db_conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('tickerOrientation', normalized))
    db_conn.commit()
    db_conn.close()

    if used_port:
        return jsonify({
            "success": True,
            "message": f"Orientacja zapisana ({used_method})",
            "orientation": normalized,
            "orientationFile": "/storage/kiosk_orientation.txt",
            "orientationFilePort": used_port,
            "warning": '; '.join(transfer_errors) if transfer_errors else None,
        })

    return jsonify({
        "success": True,
        "message": "Orientacja zapisana w ustawieniach backendu, ale nie udało się zapisać pliku na kiosk",
        "orientation": normalized,
        "orientationFile": "/storage/kiosk_orientation.txt",
        "orientationFilePort": None,
        "warning": '; '.join(transfer_errors) if transfer_errors else 'Nieznany błąd transferu',
    })

# =============================================================================
# TRASY DO SERWOWANIA FRONTENDU
# =============================================================================

# Ścieżka do folderu frontend
FRONTEND_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend')
FRONTEND_LOGIN_FILE = 'loginKiosk.html'
FRONTEND_DASHBOARD_FILE = 'indexKiosk.html'
MY_APP_DIST_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'my-app', 'dist')

@app.route('/')
def index():
    """Strona główna - przekierowanie do logowania"""
    return send_from_directory(FRONTEND_PATH, FRONTEND_LOGIN_FILE)

@app.route('/login')
def login_page():
    """Strona logowania"""
    return send_from_directory(FRONTEND_PATH, FRONTEND_LOGIN_FILE)

@app.route('/dashboard')
def dashboard():
    """Panel główny (po zalogowaniu)"""
    return send_from_directory(FRONTEND_PATH, FRONTEND_DASHBOARD_FILE)

@app.route('/<path:filename>')
def serve_frontend(filename):
    """Serwowanie plików statycznych frontendu (CSS, JS, obrazy)"""
    try:
        # Kompatybilność ze starymi odwołaniami do nazw plików HTML.
        if filename == 'index.html':
            filename = FRONTEND_DASHBOARD_FILE
        elif filename == 'login.html':
            filename = FRONTEND_LOGIN_FILE
        return send_from_directory(FRONTEND_PATH, filename)
    except:
        # Jeśli plik nie istnieje, zwróć 404
        return jsonify({"error": "File not found"}), 404


@app.route('/app')
@app.route('/app/<path:filename>')
def serve_react_app(filename='index.html'):
    """Serwowanie aplikacji React (my-app/dist) pod prefiksem /app."""
    if not os.path.isdir(MY_APP_DIST_PATH):
        return jsonify({
            "error": "React app build not found",
            "message": "Uruchom 'npm run build' w katalogu my-app"
        }), 404

    requested_path = os.path.join(MY_APP_DIST_PATH, filename)

    # Jeśli żądany plik istnieje, zwróć go bezpośrednio (np. assets/*).
    if filename != 'index.html' and os.path.exists(requested_path):
        return send_from_directory(MY_APP_DIST_PATH, filename)

    # Fallback SPA: dla tras React Router zwróć index.html.
    return send_from_directory(MY_APP_DIST_PATH, 'index.html')

# ===== REZERWACJE =====

@app.route('/api/reservations/check', methods=['POST'])
@token_required
def check_reservation():
    """Sprawdzenie dostępności terminu rezerwacji"""
    try:
        data = request.get_json()
        
        # Walidacja danych
        if not data or not all(k in data for k in ['date', 'start_time', 'end_time', 'name']):
            return jsonify({"error": "Brakujące wymagane pola: date, start_time, end_time, name"}), 400
        
        date = data.get('date')
        start_time = data.get('start_time')
        end_time = data.get('end_time')
        name = data.get('name')
        
        # Walidacja logiczna - czy czas zakończenia jest po czasie rozpoczęcia
        if start_time >= end_time:
            return jsonify({
                "error": "Godzina zakończenia musi być późniejsza niż godzina rozpoczęcia",
                "available": False
            }), 400
        
        app.logger.info(f"Sprawdzanie rezerwacji: {date} {start_time}-{end_time} dla {name}")
        
        # Sprawdź kolizje w bazie danych
        conn = get_db_connection()
        
        # Znajdź wszystkie aktywne rezerwacje tego samego dnia, które kolidują czasowo
        conflicting_reservations = conn.execute('''
            SELECT id, name, start_time, end_time 
            FROM reservations 
            WHERE date = ? 
            AND status = 'active'
            AND (
                (start_time < ? AND end_time > ?) OR
                (start_time < ? AND end_time > ?) OR
                (start_time >= ? AND end_time <= ?)
            )
        ''', (date, end_time, start_time, end_time, start_time, start_time, end_time)).fetchall()
        
        conn.close()
        
        if conflicting_reservations:
            # Termin zajęty - zwróć informacje o kolizjach
            conflicts = []
            for reservation in conflicting_reservations:
                conflicts.append({
                    'name': reservation['name'],
                    'start_time': reservation['start_time'],
                    'end_time': reservation['end_time']
                })
            
            return jsonify({
                "available": False,
                "error": "Wybierz inny termin",
                "conflicts": conflicts,
                "message": f"Znaleziono {len(conflicts)} kolizję(i) w wybranym terminie"
            }), 409  # 409 Conflict
        
        # Termin dostępny
        return jsonify({
            "available": True,
            "message": f"Termin dostępny - {date} od {start_time} do {end_time}"
        }), 200
        
    except Exception as e:
        app.logger.error(f"Błąd podczas sprawdzania rezerwacji: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

@app.route('/api/reservations/create', methods=['POST'])
@token_required
def create_reservation():
    """Utworzenie nowej rezerwacji"""
    try:
        data = request.get_json()
        current_user = g.current_user  # Z dekoratora @token_required
        
        # Walidacja danych
        if not data or not all(k in data for k in ['date', 'start_time', 'end_time', 'name']):
            return jsonify({"error": "Brakujące wymagane pola: date, start_time, end_time, name"}), 400
        
        date = data.get('date')
        start_time = data.get('start_time')
        end_time = data.get('end_time')
        name = data.get('name')
        notes = data.get('notes', '')
        
        # Walidacja logiczna
        if start_time >= end_time:
            return jsonify({
                "error": "Godzina zakończenia musi być późniejsza niż godzina rozpoczęcia"
            }), 400
        
        app.logger.info(f"Tworzenie rezerwacji: {date} {start_time}-{end_time} dla {name} przez użytkownika {current_user}")
        
        conn = get_db_connection()
        
        try:
            # Double-check: Ponownie sprawdź kolizje przed zapisem (race condition protection)
            conflicting_reservations = conn.execute('''
                SELECT id, name, start_time, end_time 
                FROM reservations 
                WHERE date = ? 
                AND status = 'active'
                AND (
                    (start_time < ? AND end_time > ?) OR
                    (start_time < ? AND end_time > ?) OR
                    (start_time >= ? AND end_time <= ?)
                )
            ''', (date, end_time, start_time, end_time, start_time, start_time, end_time)).fetchall()
            
            if conflicting_reservations:
                conn.close()
                conflicts = []
                for reservation in conflicting_reservations:
                    conflicts.append({
                        'name': reservation['name'],
                        'start_time': reservation['start_time'],
                        'end_time': reservation['end_time']
                    })
                
                return jsonify({
                    "error": "Termin został już zarezerwowany przez inną osobę",
                    "conflicts": conflicts
                }), 409  # 409 Conflict
            
            # Zapisz rezerwację do bazy danych
            cursor = conn.execute('''
                INSERT INTO reservations (date, start_time, end_time, name, status, created_by, notes)
                VALUES (?, ?, ?, ?, 'active', ?, ?)
            ''', (date, start_time, end_time, name, current_user, notes))
            
            reservation_id = cursor.lastrowid
            conn.commit()
            conn.close()
            
            app.logger.info(f"Rezerwacja utworzona pomyślnie - ID: {reservation_id}")
            
            # Zwróć potwierdzenie
            return jsonify({
                "success": True,
                "reservation_id": reservation_id,
                "message": f"Rezerwacja potwierdzona - ID: {reservation_id}",
                "date": date,
                "start_time": start_time,
                "end_time": end_time,
                "name": name
            }), 201
            
        except sqlite3.IntegrityError as e:
            conn.close()
            app.logger.error(f"Błąd integralności bazy danych: {str(e)}")
            return jsonify({"error": "Błąd zapisu rezerwacji - naruszenie integralności danych"}), 400
        
    except Exception as e:
        app.logger.error(f"Błąd podczas tworzenia rezerwacji: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

@app.route('/api/reservations', methods=['GET'])
@token_required
def get_reservations():
    """Pobierz listę rezerwacji"""
    try:
        # Parametry filtrowania
        date_filter = request.args.get('date')
        status_filter = request.args.get('status', 'active')  # domyślnie tylko aktywne
        
        conn = get_db_connection()
        
        # Buduj zapytanie SQL
        if date_filter:
            # Filtruj po dacie
            reservations = conn.execute('''
                SELECT id, date, start_time, end_time, name, status, created_at, created_by, notes
                FROM reservations
                WHERE date = ? AND status = ?
                ORDER BY date ASC, start_time ASC
            ''', (date_filter, status_filter)).fetchall()
        else:
            # Pobierz wszystkie przyszłe rezerwacje
            reservations = conn.execute('''
                SELECT id, date, start_time, end_time, name, status, created_at, created_by, notes
                FROM reservations
                WHERE date >= date('now') AND status = ?
                ORDER BY date ASC, start_time ASC
            ''', (status_filter,)).fetchall()
        
        conn.close()
        
        # Konwertuj na listę słowników
        reservations_list = []
        for res in reservations:
            reservations_list.append({
                'id': res['id'],
                'date': res['date'],
                'start_time': res['start_time'],
                'end_time': res['end_time'],
                'name': res['name'],
                'status': res['status'],
                'created_at': res['created_at'],
                'created_by': res['created_by'],
                'notes': res['notes']
            })
        
        return jsonify({
            "success": True,
            "reservations": reservations_list,
            "count": len(reservations_list)
        }), 200
        
    except Exception as e:
        app.logger.error(f"Błąd podczas pobierania rezerwacji: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

@app.route('/api/reservations/<int:reservation_id>/cancel', methods=['PATCH'])
@token_required
def cancel_reservation(reservation_id):
    """Anuluj rezerwację (soft delete - zmiana statusu na 'cancelled')"""
    try:
        current_user = g.current_user
        
        conn = get_db_connection()
        
        # Sprawdź czy rezerwacja istnieje
        reservation = conn.execute('''
            SELECT id, name, date, start_time, end_time, status
            FROM reservations
            WHERE id = ?
        ''', (reservation_id,)).fetchone()
        
        if not reservation:
            conn.close()
            return jsonify({"error": "Rezerwacja nie istnieje"}), 404
        
        if reservation['status'] == 'cancelled':
            conn.close()
            return jsonify({"error": "Rezerwacja została już anulowana"}), 400
        
        # Anuluj rezerwację
        conn.execute('''
            UPDATE reservations
            SET status = 'cancelled'
            WHERE id = ?
        ''', (reservation_id,))
        
        conn.commit()
        conn.close()
        
        app.logger.info(f"Rezerwacja #{reservation_id} anulowana przez {current_user}")
        
        return jsonify({
            "success": True,
            "message": f"Rezerwacja #{reservation_id} została anulowana",
            "reservation_id": reservation_id
        }), 200
        
    except Exception as e:
        app.logger.error(f"Błąd podczas anulowania rezerwacji: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

# Zarządzanie użytkownikami

@app.route('/api/permissions/catalog', methods=['GET'])
@token_required
@action_permission_required('users.manage')
def get_permissions_catalog():
    return jsonify({
        "success": True,
        "actions": [
            {"key": key, "label": label}
            for key, label in ACTION_PERMISSION_CATALOG.items()
        ]
    }), 200


@app.route('/api/users/<int:user_id>/permissions', methods=['GET'])
@token_required
@action_permission_required('users.manage')
def get_user_permissions(user_id):
    conn = get_db_connection()
    user = conn.execute('SELECT id, username, role FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "Użytkownik nie istnieje"}), 404

    permissions_rows = conn.execute(
        'SELECT action, allowed FROM user_action_permissions WHERE user_id = ?',
        (user_id,)
    ).fetchall()
    conn.close()

    permissions_map = {row['action']: bool(int(row['allowed'])) for row in permissions_rows}

    # Admin ma pełne uprawnienia niezależnie od mapy.
    if (user['role'] or 'user') == 'admin':
        for action_key in ACTION_PERMISSION_CATALOG.keys():
            permissions_map[action_key] = True

    return jsonify({
        "success": True,
        "user": {
            "id": user['id'],
            "username": user['username'],
            "role": user['role'] or 'user',
        },
        "permissions": permissions_map,
    }), 200


@app.route('/api/users/<int:user_id>/permissions', methods=['PUT'])
@token_required
@action_permission_required('users.manage')
def update_user_permissions(user_id):
    data = request.get_json() or {}
    permissions = data.get('permissions')
    if not isinstance(permissions, dict):
        return jsonify({"error": "Pole permissions musi być obiektem key->bool"}), 400

    conn = get_db_connection()
    user = conn.execute('SELECT id, username, role FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "Użytkownik nie istnieje"}), 404

    if (user['role'] or 'user') == 'admin':
        conn.close()
        return jsonify({"error": "Uprawnienia akcji dla administratora są zawsze pełne"}), 400

    invalid_keys = [key for key in permissions.keys() if key not in ACTION_PERMISSION_CATALOG]
    if invalid_keys:
        conn.close()
        return jsonify({"error": f"Nieznane akcje uprawnień: {', '.join(invalid_keys)}"}), 400

    try:
        conn.execute('DELETE FROM user_action_permissions WHERE user_id = ?', (user_id,))

        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        for action_key, allowed in permissions.items():
            if bool(allowed):
                conn.execute(
                    '''
                    INSERT INTO user_action_permissions (user_id, action, allowed, updated_at)
                    VALUES (?, ?, 1, ?)
                    ''',
                    (user_id, action_key, now)
                )

        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({"error": f"Błąd zapisu uprawnień: {str(e)}"}), 500

    updated_rows = conn.execute(
        'SELECT action, allowed FROM user_action_permissions WHERE user_id = ?',
        (user_id,)
    ).fetchall()
    conn.close()

    updated_permissions = {key: False for key in ACTION_PERMISSION_CATALOG.keys()}
    for row in updated_rows:
        updated_permissions[row['action']] = bool(int(row['allowed']))

    return jsonify({
        "success": True,
        "message": f"Uprawnienia akcji użytkownika '{user['username']}' zostały zaktualizowane",
        "user_id": user_id,
        "permissions": updated_permissions,
    }), 200

@app.route('/api/users', methods=['GET'])
@token_required
@action_permission_required('users.manage')
def get_users():
    """Pobierz listę wszystkich użytkowników"""
    try:
        conn = get_db_connection()
        users = conn.execute('''
            SELECT id, username, role, must_change_password, created_at, updated_at
            FROM users
            ORDER BY created_at DESC
        ''').fetchall()
        conn.close()
        
        users_list = []
        for user in users:
            users_list.append({
                'id': user['id'],
                'username': user['username'],
                'role': user['role'] or 'user',
                'must_change_password': bool(user['must_change_password']) if 'must_change_password' in user.keys() else False,
                'created_at': user['created_at'],
                'updated_at': user['updated_at']
            })
        
        return jsonify({
            "success": True,
            "users": users_list,
            "count": len(users_list)
        }), 200
        
    except Exception as e:
        app.logger.error(f"Błąd podczas pobierania użytkowników: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

@app.route('/api/users', methods=['POST'])
@token_required
@action_permission_required('users.manage')
def create_user():
    """Utwórz nowego użytkownika"""
    try:
        data = request.get_json()
        
        # Walidacja danych
        if not data or not all(k in data for k in ['username', 'password']):
            return jsonify({"error": "Brakujące wymagane pola: username, password"}), 400
        
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        # Walidacja logiczna
        if not username or len(username) < 3:
            return jsonify({"error": "Login musi mieć co najmniej 3 znaki"}), 400
        
        if not password or len(password) < 6:
            return jsonify({"error": "Hasło musi mieć co najmniej 6 znaków"}), 400
        
        # Sprawdzenie czy login zawiera tylko znaki alfanumeryczne i podkreślenia
        import re
        if not re.match(r'^[a-zA-Z0-9_-]+$', username):
            return jsonify({"error": "Login może zawierać tylko litery, cyfry, podkreślenia i myślniki"}), 400
        
        app.logger.info(f"Tworzenie nowego użytkownika: {username}")
        
        conn = get_db_connection()
        
        try:
            # Zahashuj hasło
            hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
            
            # Wstaw nowego użytkownika
            cursor = conn.execute('''
                INSERT INTO users (username, password, must_change_password)
                VALUES (?, ?, 1)
            ''', (username, hashed_password.decode('utf-8')))
            
            user_id = cursor.lastrowid
            conn.commit()
            conn.close()
            
            app.logger.info(f"Użytkownik {username} (ID: {user_id}) utworzony pomyślnie")
            
            return jsonify({
                "success": True,
                "user_id": user_id,
                "username": username,
                "must_change_password": True,
                "message": f"Użytkownik '{username}' został utworzony pomyślnie"
            }), 201
            
        except sqlite3.IntegrityError as e:
            conn.close()
            app.logger.error(f"Błąd - login już istnieje: {str(e)}")
            return jsonify({"error": "Użytkownik z takim loginem już istnieje"}), 400
        
    except Exception as e:
        app.logger.error(f"Błąd podczas tworzenia użytkownika: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@token_required
@action_permission_required('users.manage')
def delete_user(user_id):
    """Usuń użytkownika"""
    try:
        current_user = g.current_user
        
        # Sprawdzenie uprawnień - nie możesz usunąć siebie
        conn = get_db_connection()
        current_user_data = conn.execute('SELECT id FROM users WHERE username = ?', (current_user,)).fetchone()
        
        if current_user_data and current_user_data['id'] == user_id:
            conn.close()
            return jsonify({"error": "Nie możesz usunąć swojego konta"}), 400
        
        # Usuń użytkownika
        user = conn.execute('SELECT username FROM users WHERE id = ?', (user_id,)).fetchone()
        
        if not user:
            conn.close()
            return jsonify({"error": "Użytkownik nie istnieje"}), 404
        
        conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
        conn.commit()
        conn.close()
        
        app.logger.info(f"Użytkownik {user['username']} usunięty przez {current_user}")
        
        return jsonify({
            "success": True,
            "message": f"Użytkownik '{user['username']}' został usunięty"
        }), 200
        
    except Exception as e:
        app.logger.error(f"Błąd podczas usuwania użytkownika: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

@app.route('/api/users/<int:user_id>/role', methods=['PUT'])
@token_required
@action_permission_required('users.manage')
def update_user_role(user_id):
    """Aktualizuj rolę użytkownika"""
    try:
        current_user = g.current_user
        data = request.get_json()
        
        # Walidacja danych
        if not data or 'role' not in data:
            return jsonify({"error": "Wymagane pole: role"}), 400
        
        role = data.get('role', '').strip().lower()
        
        # Weryfikacja prawidłowej roli
        if role not in ['user', 'admin']:
            return jsonify({"error": "Nieprawidłowa rola. Dozwolone: 'user', 'admin'"}), 400
        
        conn = get_db_connection()
        
        # Sprawdzenie czy użytkownik istnieje
        user = conn.execute('SELECT username, id FROM users WHERE id = ?', (user_id,)).fetchone()
        
        if not user:
            conn.close()
            return jsonify({"error": "Użytkownik nie istnieje"}), 404
        
        # Aktualizuj rolę
        conn.execute('''
            UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (role, user_id))
        
        conn.commit()
        conn.close()
        
        app.logger.info(f"Zmieniono rolę użytkownika {user['username']} na {role} przez {current_user}")
        
        return jsonify({
            "success": True,
            "message": f"Rola użytkownika '{user['username']}' zmieniona na '{role}'",
            "user_id": user_id,
            "new_role": role
        }), 200
        
    except Exception as e:
        app.logger.error(f"Błąd podczas aktualizacji roli użytkownika: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

@app.route('/api/account/change-password', methods=['POST'])
@token_required
def change_password():
    """Zmień hasło zalogowanego użytkownika"""
    try:
        current_user = g.current_user
        data = request.get_json()
        
        # Walidacja danych
        if not data or not all(k in data for k in ['current_password', 'new_password', 'confirm_password']):
            return jsonify({"error": "Brakujące wymagane pola: current_password, new_password, confirm_password"}), 400
        
        current_password = data.get('current_password', '')
        new_password = data.get('new_password', '')
        confirm_password = data.get('confirm_password', '')
        
        # Walidacja nowego hasła
        if not new_password or len(new_password) < 6:
            return jsonify({"error": "Nowe hasło musi mieć co najmniej 6 znaków"}), 400
        
        if new_password != confirm_password:
            return jsonify({"error": "Nowe hasła do siebie nie pasują"}), 400
        
        if current_password == new_password:
            return jsonify({"error": "Nowe hasło musi być inne od bieżącego"}), 400
        
        # Pobierz dane użytkownika
        conn = get_db_connection()
        user = conn.execute('SELECT id, password FROM users WHERE username = ?', (current_user,)).fetchone()
        conn.close()
        
        if not user:
            return jsonify({"error": "Użytkownik nie istnieje"}), 404
        
        # Sprawdź czy bieżące hasło jest poprawne
        if not bcrypt.checkpw(current_password.encode('utf-8'), user['password'].encode('utf-8')):
            app.logger.warning(f"Falses attempt to change password for user {current_user}")
            return jsonify({"error": "Bieżące hasło jest nieprawidłowe"}), 401
        
        # Zahashuj nowe hasło
        hashed_password = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt())
        
        # Aktualizuj hasło w bazie
        conn = get_db_connection()
        conn.execute('''
            UPDATE users SET password = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (hashed_password.decode('utf-8'), user['id']))
        conn.commit()
        conn.close()
        
        app.logger.info(f"Użytkownik {current_user} zmienił swoje hasło")
        
        return jsonify({
            "success": True,
            "message": "Hasło zostało zmienione pomyślnie"
        }), 200
        
    except Exception as e:
        app.logger.error(f"Błąd podczas zmiany hasła: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

@app.route('/api/users/<int:user_id>/change-password', methods=['POST'])
@token_required
@action_permission_required('users.manage')
def admin_change_user_password(user_id):
    """Zmień hasło użytkownika jako administrator (bez wymagania starego hasła)"""
    try:
        current_user = g.current_user
        data = request.get_json()
        
        # Walidacja danych
        if not data or not all(k in data for k in ['new_password', 'confirm_password']):
            return jsonify({"error": "Brakujące wymagane pola: new_password, confirm_password"}), 400
        
        new_password = data.get('new_password', '')
        confirm_password = data.get('confirm_password', '')
        
        # Walidacja nowego hasła
        if not new_password or len(new_password) < 6:
            return jsonify({"error": "Nowe hasło musi mieć co najmniej 6 znaków"}), 400
        
        if new_password != confirm_password:
            return jsonify({"error": "Nowe hasła do siebie nie pasują"}), 400
        
        # Pobierz dane użytkownika
        conn = get_db_connection()
        user = conn.execute('SELECT username FROM users WHERE id = ?', (user_id,)).fetchone()
        
        if not user:
            conn.close()
            return jsonify({"error": "Użytkownik nie istnieje"}), 404
        
        # Zahashuj nowe hasło
        hashed_password = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt())
        
        # Aktualizuj hasło w bazie
        conn.execute('''
            UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (hashed_password.decode('utf-8'), user_id))
        conn.commit()
        conn.close()
        
        app.logger.info(f"Administrator {current_user} zmienił hasło użytkownika {user['username']}")
        
        return jsonify({
            "success": True,
            "message": f"Hasło użytkownika '{user['username']}' zostało zmienione pomyślnie"
        }), 200
        
    except Exception as e:
        app.logger.error(f"Błąd podczas zmiany hasła użytkownika przez administratora: {str(e)}")
        return jsonify({"error": f"Błąd serwera: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)