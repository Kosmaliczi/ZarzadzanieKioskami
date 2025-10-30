#!/usr/bin/env python3
"""Szybka aktualizacja domyślnego użytkownika SSH na 'root'"""
import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'database', 'kiosks.db')
print(f"Aktualizacja bazy danych: {db_path}")
print("-" * 60)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Sprawdź obecną wartość
    cursor.execute("SELECT value FROM settings WHERE key = 'defaultSshUsername'")
    result = cursor.fetchone()
    print(f"Obecna wartość: {result[0] if result else 'Brak wartości'}")
    
    # Aktualizuj na 'root'
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('defaultSshUsername', 'root')")
    conn.commit()
    
    # Sprawdź nową wartość
    cursor.execute("SELECT value FROM settings WHERE key = 'defaultSshUsername'")
    new_value = cursor.fetchone()
    print(f"Nowa wartość: {new_value[0]}")
    print("-" * 60)
    print("✓ SUKCES! Wartość została zmieniona na 'root'")
    print("\nKOLEJNE KROKI:")
    print("1. Zrestartuj backend Flask (Ctrl+C i uruchom ponownie)")
    print("2. Wyczyść cache przeglądarki (Ctrl+Shift+Delete)")
    print("3. Odśwież stronę (Ctrl+F5)")
    
    conn.close()
except Exception as e:
    print(f"✗ BŁĄD: {e}")
