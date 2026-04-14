-- Migracja: Dodanie kolumny role do tabeli users
-- Data: 2025-03-06
-- Powód: Wprowadzenie systemu ról dla użytkowników (administrator, użytkownik)

-- Dodaj kolumnę role do tabeli users jeśli jeszcze nie istnieje
ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';

-- Informacja:
-- Dostępne role: 'user' (domyślna), 'admin' (administrator)
-- Istniejący użytkownicy automatycznie otrzymają rolę 'user'
