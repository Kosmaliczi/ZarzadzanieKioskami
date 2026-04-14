import datetime
import sqlite3
import threading
import time

from db_config import get_database_path

DATABASE_PATH = get_database_path()

STATUS_UPDATE_MIN_INTERVAL_SECONDS = 30
LOCK_WARNING_MIN_INTERVAL_SECONDS = 60
_last_status_update_ts = 0.0
_last_lock_warning_ts = 0.0
_status_update_lock = threading.Lock()


def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout = 30000')
    return conn


def update_kiosk_statuses(logger):
    global _last_status_update_ts, _last_lock_warning_ts

    now_ts = time.time()
    if now_ts - _last_status_update_ts < STATUS_UPDATE_MIN_INTERVAL_SECONDS:
        return

    if not _status_update_lock.acquire(blocking=False):
        return

    conn = None
    try:
        conn = get_db_connection()
        two_minutes_ago = (datetime.datetime.now() - datetime.timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S')
        conn.execute(
            'UPDATE kiosks SET status = "offline" WHERE last_connection < ? AND status != "offline"',
            (two_minutes_ago,),
        )
        conn.commit()
        _last_status_update_ts = now_ts
    except sqlite3.OperationalError as error:
        if 'database is locked' in str(error).lower():
            if now_ts - _last_lock_warning_ts >= LOCK_WARNING_MIN_INTERVAL_SECONDS:
                logger.warning('Pominięto update statusów kiosków: database is locked')
                _last_lock_warning_ts = now_ts
        else:
            raise
    finally:
        if conn:
            conn.close()
        _status_update_lock.release()
