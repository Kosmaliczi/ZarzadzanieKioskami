import os
import sqlite3
from db_config import get_database_path

# Ścieżka do bazy danych
DATABASE_PATH = get_database_path()

def run_migration(migration_file):
    if not os.path.exists(DATABASE_PATH):
        print(f"Błąd: Baza danych nie istnieje: {DATABASE_PATH}")
        return False
    
    migration_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'database', migration_file)
    if not os.path.exists(migration_path):
        print(f"Błąd: Plik migracji nie istnieje: {migration_path}")
        return False
    
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        
        with open(migration_path, 'r', encoding='utf-8') as f:
            sql = f.read()
        
        conn.executescript(sql)
        conn.commit()
        conn.close()
        
        print(f"✓ Migracja {migration_file} wykonana pomyślnie")
        return True
    except Exception as e:
        print(f"✗ Błąd podczas wykonywania migracji: {e}")
        return False

if __name__ == '__main__':
    print("Wykonywanie migracji SSH username...")
    run_migration('migration_ssh_username.sql')
