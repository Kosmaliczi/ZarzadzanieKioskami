"""
SFTP Handler dla LibreELEC
Obsługa połączeń SFTP jako alternatywa dla FTP
Kompatybilne z Raspberry Pi 5 / LibreELEC 12.0.2
"""

import paramiko
import stat
import os
import tempfile
from typing import Optional, List, Dict, Any


class SFTPHandler:
    """Klasa do obsługi połączeń SFTP"""
    
    def __init__(self):
        self.client = None
        self.sftp = None
    
    def connect(self, hostname: str, username: str, password: str = None, 
                port: int = 22, key_filename: str = None) -> bool:
        """
        Nawiązuje połączenie SFTP
        
        Args:
            hostname: Adres IP lub nazwa hosta
            username: Nazwa użytkownika (dla LibreELEC: root)
            password: Hasło (opcjonalne jeśli używamy klucza)
            port: Port SSH (domyślnie 22)
            key_filename: Ścieżka do klucza prywatnego SSH
        
        Returns:
            True jeśli połączenie udane, False w przeciwnym razie
        """
        try:
            self.client = paramiko.SSHClient()
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            # Połączenie z wykorzystaniem hasła lub klucza
            if key_filename and os.path.exists(key_filename):
                self.client.connect(
                    hostname=hostname,
                    port=port,
                    username=username,
                    key_filename=key_filename,
                    timeout=10,
                    allow_agent=False,
                    look_for_keys=False
                )
            elif password:
                self.client.connect(
                    hostname=hostname,
                    port=port,
                    username=username,
                    password=password,
                    timeout=10,
                    allow_agent=False,
                    look_for_keys=False
                )
            else:
                print("SFTP: Brak hasła lub klucza SSH")
                return False
            
            # Otwarcie sesji SFTP
            self.sftp = self.client.open_sftp()
            return True
            
        except Exception as e:
            print(f"SFTP connection error: {e}")
            self.close()
            return False
    
    def close(self):
        """Zamyka połączenie SFTP"""
        try:
            if self.sftp:
                self.sftp.close()
            if self.client:
                self.client.close()
        except Exception as e:
            print(f"SFTP close error: {e}")
        finally:
            self.sftp = None
            self.client = None
    
    def list_directory(self, path: str = '.') -> List[Dict[str, Any]]:
        """
        Listuje zawartość katalogu
        
        Args:
            path: Ścieżka do katalogu
        
        Returns:
            Lista słowników z informacjami o plikach
        """
        if not self.sftp:
            raise Exception("Brak połączenia SFTP")
        
        try:
            files = []
            for item in self.sftp.listdir_attr(path):
                file_info = {
                    'name': item.filename,
                    'size': item.st_size,
                    'is_directory': stat.S_ISDIR(item.st_mode),
                    'permissions': oct(item.st_mode)[-3:],
                    'modified': item.st_mtime
                }
                files.append(file_info)
            
            # Sortowanie: najpierw katalogi, potem pliki
            files.sort(key=lambda x: (not x['is_directory'], x['name'].lower()))
            return files
            
        except Exception as e:
            print(f"SFTP list directory error: {e}")
            raise
    
    def upload_file(self, local_path: str, remote_path: str) -> bool:
        """
        Wysyła plik na serwer
        
        Args:
            local_path: Ścieżka do pliku lokalnego
            remote_path: Ścieżka docelowa na serwerze
        
        Returns:
            True jeśli upload udany
        """
        if not self.sftp:
            raise Exception("Brak połączenia SFTP")
        
        try:
            self.sftp.put(local_path, remote_path)
            return True
        except Exception as e:
            print(f"SFTP upload error: {e}")
            raise
    
    def download_file(self, remote_path: str, local_path: str) -> bool:
        """
        Pobiera plik z serwera
        
        Args:
            remote_path: Ścieżka do pliku na serwerze
            local_path: Ścieżka docelowa lokalnie
        
        Returns:
            True jeśli download udany
        """
        if not self.sftp:
            raise Exception("Brak połączenia SFTP")
        
        try:
            self.sftp.get(remote_path, local_path)
            return True
        except Exception as e:
            print(f"SFTP download error: {e}")
            raise
    
    def delete_file(self, path: str, is_directory: bool = False) -> bool:
        """
        Usuwa plik lub katalog
        
        Args:
            path: Ścieżka do pliku/katalogu
            is_directory: True jeśli to katalog
        
        Returns:
            True jeśli usunięcie udane
        """
        if not self.sftp:
            raise Exception("Brak połączenia SFTP")
        
        try:
            if is_directory:
                # Rekurencyjne usuwanie katalogu
                self._remove_directory_recursive(path)
            else:
                self.sftp.remove(path)
            return True
        except Exception as e:
            print(f"SFTP delete error: {e}")
            raise
    
    def _remove_directory_recursive(self, path: str):
        """Rekurencyjnie usuwa katalog i jego zawartość"""
        try:
            for item in self.sftp.listdir_attr(path):
                item_path = os.path.join(path, item.filename).replace('\\', '/')
                if stat.S_ISDIR(item.st_mode):
                    self._remove_directory_recursive(item_path)
                else:
                    self.sftp.remove(item_path)
            self.sftp.rmdir(path)
        except Exception as e:
            print(f"SFTP recursive delete error: {e}")
            raise
    
    def create_directory(self, path: str) -> bool:
        """
        Tworzy katalog
        
        Args:
            path: Ścieżka do nowego katalogu
        
        Returns:
            True jeśli utworzenie udane
        """
        if not self.sftp:
            raise Exception("Brak połączenia SFTP")
        
        try:
            self.sftp.mkdir(path)
            return True
        except Exception as e:
            print(f"SFTP mkdir error: {e}")
            raise
    
    def get_file_content(self, path: str, encoding: str = 'utf-8') -> str:
        """
        Pobiera zawartość pliku jako tekst
        
        Args:
            path: Ścieżka do pliku
            encoding: Kodowanie (domyślnie UTF-8)
        
        Returns:
            Zawartość pliku jako string
        """
        if not self.sftp:
            raise Exception("Brak połączenia SFTP")
        
        temp_file_path = None
        try:
            # Pobierz plik do tymczasowego pliku
            with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                temp_file_path = temp_file.name
            
            self.sftp.get(path, temp_file_path)
            
            # Odczytaj zawartość
            with open(temp_file_path, 'r', encoding=encoding, errors='strict') as file:
                content = file.read()
            
            return content
            
        except UnicodeDecodeError as e:
            print(f"SFTP get file content error (not UTF-8): {e}")
            raise
        except Exception as e:
            print(f"SFTP get file content error: {e}")
            raise
        finally:
            # Usuń tymczasowy plik
            if temp_file_path and os.path.exists(temp_file_path):
                try:
                    os.unlink(temp_file_path)
                except Exception:
                    pass
    
    def put_file_content(self, path: str, content: str, encoding: str = 'utf-8') -> bool:
        """
        Zapisuje zawartość tekstową do pliku
        
        Args:
            path: Ścieżka do pliku docelowego
            content: Zawartość do zapisania
            encoding: Kodowanie (domyślnie UTF-8)
        
        Returns:
            True jeśli zapis udany
        """
        if not self.sftp:
            raise Exception("Brak połączenia SFTP")
        
        temp_file_path = None
        try:
            # Zapisz zawartość do tymczasowego pliku
            with tempfile.NamedTemporaryFile(delete=False, mode='w', encoding=encoding, newline='') as temp_file:
                temp_file.write(content)
                temp_file_path = temp_file.name
            
            # Wyślij plik na serwer
            self.sftp.put(temp_file_path, path)
            return True
            
        except Exception as e:
            print(f"SFTP put file content error: {e}")
            raise
        finally:
            # Usuń tymczasowy plik
            if temp_file_path and os.path.exists(temp_file_path):
                try:
                    os.unlink(temp_file_path)
                except Exception:
                    pass
    
    def file_exists(self, path: str) -> bool:
        """
        Sprawdza czy plik istnieje
        
        Args:
            path: Ścieżka do pliku
        
        Returns:
            True jeśli plik istnieje
        """
        if not self.sftp:
            raise Exception("Brak połączenia SFTP")
        
        try:
            self.sftp.stat(path)
            return True
        except FileNotFoundError:
            return False
        except Exception as e:
            print(f"SFTP file exists check error: {e}")
            return False


def sftp_connect(hostname: str, username: str, password: str = None, 
                 port: int = 22, key_filename: str = None) -> Optional[SFTPHandler]:
    """
    Pomocnicza funkcja do tworzenia połączenia SFTP
    
    Args:
        hostname: Adres IP lub nazwa hosta
        username: Nazwa użytkownika
        password: Hasło (opcjonalne)
        port: Port SSH (domyślnie 22)
        key_filename: Ścieżka do klucza prywatnego SSH
    
    Returns:
        Obiekt SFTPHandler lub None w przypadku błędu
    """
    handler = SFTPHandler()
    if handler.connect(hostname, username, password, port, key_filename):
        return handler
    return None
