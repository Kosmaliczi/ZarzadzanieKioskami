import os
import sqlite3
import bcrypt
from db_config import get_database_path

# Ścieżka do bazy danych
DATABASE_PATH = get_database_path()

def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def migrate_passwords():
    conn = get_db_connection()
    users = conn.execute('SELECT id, password FROM users').fetchall()
    updated = 0
    for user in users:
        pwd = user['password']
        # Jeśli hasło wygląda na hash bcrypt, pomiń
        if pwd.startswith('$2b$') or pwd.startswith('$2a$'):
            continue
        hashed = bcrypt.hashpw(pwd.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        conn.execute('UPDATE users SET password = ? WHERE id = ?', (hashed, user['id']))
        updated += 1
    conn.commit()
    conn.close()
    print(f'Zaktualizowano {updated} haseł użytkowników do formatu bcrypt.')

if __name__ == '__main__':
    migrate_passwords()
