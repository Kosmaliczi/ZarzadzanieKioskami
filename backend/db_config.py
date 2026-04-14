import os


def get_database_path() -> str:
    """Return absolute path to the SQLite database used by the whole backend."""
    env_path = os.getenv('KIOSK_DATABASE_PATH') or os.getenv('DATABASE_PATH')
    if env_path:
        return env_path

    project_root = os.path.dirname(os.path.dirname(__file__))
    return os.path.join(project_root, 'database', 'kiosks.db')


def get_database_dir() -> str:
    return os.path.dirname(get_database_path())