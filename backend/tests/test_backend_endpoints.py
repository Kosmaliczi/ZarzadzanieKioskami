import os
import shutil
import sys
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import jwt


TEST_DIR = tempfile.mkdtemp(prefix="kiosk_backend_tests_")
TEST_DB_PATH = os.path.join(TEST_DIR, "kiosks_test.db")
os.environ["KIOSK_DATABASE_PATH"] = TEST_DB_PATH

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import app as backend_app  # noqa: E402


class DummyFtpConnection:
    def quit(self):
        return None


class BackendEndpointsTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TEST_DIR, ignore_errors=True)

    def setUp(self):
        self.client = backend_app.app.test_client()
        backend_app.reset_login_rate_limit_state()

    def _admin_headers(self):
        token = jwt.encode(
            {
                "username": "admin",
                "role": "admin",
                "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            },
            backend_app.JWT_SECRET_KEY,
            algorithm="HS256",
        )
        return {"Authorization": f"Bearer {token}"}

    def _user_headers(self):
        token = jwt.encode(
            {
                "username": "admin",
                "role": "user",
                "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            },
            backend_app.JWT_SECRET_KEY,
            algorithm="HS256",
        )
        return {"Authorization": f"Bearer {token}"}

    def _headers_for_user(self, username, role='user'):
        token = jwt.encode(
            {
                "username": username,
                "role": role,
                "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            },
            backend_app.JWT_SECRET_KEY,
            algorithm="HS256",
        )
        return {"Authorization": f"Bearer {token}"}

    def _create_kiosk(self):
        suffix = uuid.uuid4().hex[:8].upper()
        response = self.client.post(
            "/api/kiosks",
            json={
                "name": f"Test kiosk {suffix}",
                "mac_address": f"AA:BB:CC:DD:{suffix[:2]}:{suffix[2:4]}",
                "serial_number": f"SERIAL-{suffix}",
                "ftp_username": "kiosk",
                "ftp_password": "secret",
            },
            headers=self._admin_headers(),
        )
        self.assertEqual(response.status_code, 201)
        return response.get_json()["id"]

    def test_restart_service_requires_ssh_password(self):
        response = self.client.post(
            "/api/kiosks/123/restart-service",
            json={},
            headers=self._admin_headers(),
        )

        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertIn("Hasło SSH jest wymagane", payload.get("error", ""))

    def test_api_security_headers_are_set(self):
        response = self.client.post(
            "/api/auth/login",
            json={},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(response.headers.get("X-Frame-Options"), "DENY")
        self.assertEqual(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin")
        self.assertIn("camera=()", response.headers.get("Permissions-Policy", ""))
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")

    def test_login_rate_limit_blocks_repeated_failed_attempts(self):
        last_response = None
        for _ in range(backend_app.LOGIN_ATTEMPT_LIMIT):
            last_response = self.client.post(
                "/api/auth/login",
                json={
                    "username": "admin",
                    "password": "definitely_wrong_password",
                },
            )

        self.assertIsNotNone(last_response)
        self.assertEqual(last_response.status_code, 429)
        self.assertIsNotNone(last_response.headers.get("Retry-After"))

        blocked_valid_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin",
            },
        )
        self.assertEqual(blocked_valid_response.status_code, 429)

        backend_app.reset_login_rate_limit_state()

        success_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "admin",
            },
        )
        self.assertEqual(success_response.status_code, 200)
        self.assertTrue(success_response.get_json().get("success"))

    @patch("app.connect_file_transfer")
    def test_ftp_connect_returns_success_for_valid_connection(self, mock_connect):
        mock_connect.return_value = DummyFtpConnection()

        response = self.client.post(
            "/api/ftp/connect",
            json={
                "hostname": "10.0.0.188",
                "username": "kiosk",
                "password": "secret",
                "port": 21,
            },
            headers=self._user_headers(),
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIn("Połączenie FTP udane", payload.get("message", ""))
        self.assertEqual(payload.get("protocol"), "ftp")
        self.assertEqual(payload.get("port"), 21)

    @patch("app.connect_file_transfer")
    def test_ftp_connect_returns_error_for_refused_connection(self, mock_connect):
        mock_connect.return_value = None

        response = self.client.post(
            "/api/ftp/connect",
            json={
                "hostname": "10.0.0.188",
                "username": "kiosk",
                "password": "secret",
                "port": 21,
            },
            headers=self._user_headers(),
        )

        self.assertEqual(response.status_code, 500)
        payload = response.get_json()
        self.assertIn("10.0.0.188:21", payload.get("error", ""))
        self.assertIn("FTP", payload.get("error", ""))

    def test_get_playlist_returns_default_playlist_with_items_array(self):
        kiosk_id = self._create_kiosk()

        response = self.client.get(
            f"/api/kiosks/{kiosk_id}/playlist",
            headers=self._user_headers(),
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIn("playlist", payload)
        self.assertIn("items", payload)
        self.assertEqual(payload["playlist"]["kiosk_id"], kiosk_id)
        self.assertIsInstance(payload["items"], list)

    def test_save_playlist_persists_item_order(self):
        kiosk_id = self._create_kiosk()

        save_response = self.client.put(
            f"/api/kiosks/{kiosk_id}/playlist",
            json={
                "name": "Default",
                "orderMode": "name_desc",
                "items": [
                    {
                        "path": "/home/kiosk/MediaPionowe/b.mp4",
                        "name": "b.mp4",
                        "type": "file",
                        "size": 22,
                        "displayFrequency": 2,
                    },
                    {
                        "path": "/home/kiosk/MediaPionowe/a.mp4",
                        "name": "a.mp4",
                        "type": "file",
                        "size": 11,
                        "displayFrequency": 1,
                    },
                ],
            },
            headers=self._admin_headers(),
        )

        self.assertEqual(save_response.status_code, 200)
        saved_payload = save_response.get_json()
        self.assertEqual(saved_payload.get("itemsCount"), 2)
        self.assertEqual(saved_payload.get("orderMode"), "name_desc")
        self.assertEqual(saved_payload.get("targetFile"), "/storage/videos/kiosk_playlist.m3u")

        get_response = self.client.get(
            f"/api/kiosks/{kiosk_id}/playlist",
            headers=self._user_headers(),
        )
        self.assertEqual(get_response.status_code, 200)
        loaded = get_response.get_json()
        self.assertEqual(loaded["playlist"].get("order_mode"), "name_desc")
        self.assertEqual([item["name"] for item in loaded["items"]], ["b.mp4", "a.mp4"])
        self.assertEqual([item["position"] for item in loaded["items"]], [1, 2])
        self.assertEqual([item.get("displayFrequency") for item in loaded["items"]], [2, 1])

    def test_kiosk_path_settings_are_exposed_and_used_by_playlist(self):
        kiosk_id = self._create_kiosk()

        update_response = self.client.put(
            f"/api/kiosks/{kiosk_id}",
            json={
                "media_path": "/custom/media",
                "text_file_path": "/custom/napis.txt",
                "playlist_target_file": "/custom/media/custom_playlist.m3u",
            },
            headers=self._admin_headers(),
        )
        self.assertEqual(update_response.status_code, 200)

        creds_response = self.client.get(
            f"/api/kiosks/{kiosk_id}/ftp-credentials",
            headers=self._user_headers(),
        )
        self.assertEqual(creds_response.status_code, 200)
        creds_payload = creds_response.get_json()
        self.assertEqual(creds_payload.get("media_path"), "/custom/media")
        self.assertEqual(creds_payload.get("text_file_path"), "/custom/napis.txt")
        self.assertEqual(creds_payload.get("playlist_target_file"), "/custom/media/custom_playlist.m3u")

        playlist_response = self.client.get(
            f"/api/kiosks/{kiosk_id}/playlist",
            headers=self._user_headers(),
        )
        self.assertEqual(playlist_response.status_code, 200)
        playlist_payload = playlist_response.get_json()
        self.assertEqual(playlist_payload["playlist"].get("targetFile"), "/custom/media/custom_playlist.m3u")

    @patch("app.connect_ssh_with_username_fallback")
    def test_rotate_display_updates_ticker_orientation_setting(self, mock_connect_ssh):
        kiosk_id = self._create_kiosk()

        conn = backend_app.get_db_connection()
        serial_number = conn.execute("SELECT serial_number FROM kiosks WHERE id = ?", (kiosk_id,)).fetchone()[0]
        conn.close()

        update_ip_response = self.client.post(
            f"/api/device/{serial_number}/ip",
            json={"ip_address": "10.0.0.188"},
        )
        self.assertEqual(update_ip_response.status_code, 200)

        class _DummyChannel:
            def recv_exit_status(self):
                return 0

        class _DummyStream:
            def __init__(self, data):
                self._data = data
                self.channel = _DummyChannel()

            def read(self):
                return self._data

        class _DummySsh:
            def exec_command(self, cmd, timeout=10):
                _ = cmd
                _ = timeout
                return None, _DummyStream(b""), _DummyStream(b"")

            def close(self):
                return None

        mock_connect_ssh.return_value = (_DummySsh(), "kiosk")

        response = self.client.post(
            f"/api/kiosks/{kiosk_id}/rotate-display",
            json={"orientation": "right"},
            headers=self._admin_headers(),
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload.get("success"))
        self.assertEqual(payload.get("orientation"), "right")

        settings_response = self.client.get(
            "/api/ticker-orientation",
        )
        self.assertEqual(settings_response.status_code, 200)
        settings_payload = settings_response.get_json()
        self.assertEqual(settings_payload.get("orientation"), "right")

        conn = backend_app.get_db_connection()
        try:
            kiosk_orientation = conn.execute(
                "SELECT orientation FROM kiosks WHERE id = ?",
                (kiosk_id,),
            ).fetchone()[0]
        finally:
            conn.close()

        self.assertEqual(kiosk_orientation, "right")

    @patch("app.connect_ssh_with_username_fallback")
    def test_admin_can_assign_action_permissions_to_user(self, mock_connect_ssh):
        create_user_response = self.client.post(
            "/api/users",
            json={
                "username": "perm_user",
                "password": "perm_user_password",
            },
            headers=self._admin_headers(),
        )
        self.assertEqual(create_user_response.status_code, 201)
        user_id = create_user_response.get_json().get("user_id")

        kiosk_id = self._create_kiosk()

        conn = backend_app.get_db_connection()
        serial_number = conn.execute("SELECT serial_number FROM kiosks WHERE id = ?", (kiosk_id,)).fetchone()[0]
        conn.close()

        update_ip_response = self.client.post(
            f"/api/device/{serial_number}/ip",
            json={"ip_address": "10.0.0.188"},
        )
        self.assertEqual(update_ip_response.status_code, 200)

        class _DummyChannel:
            def recv_exit_status(self):
                return 0

        class _DummyStream:
            def __init__(self, data):
                self._data = data
                self.channel = _DummyChannel()

            def read(self):
                return self._data

        class _DummySsh:
            def exec_command(self, cmd, timeout=10):
                _ = cmd
                _ = timeout
                return None, _DummyStream(b""), _DummyStream(b"")

            def close(self):
                return None

        mock_connect_ssh.return_value = (_DummySsh(), "kiosk")

        forbidden_response = self.client.post(
            f"/api/kiosks/{kiosk_id}/rotate-display",
            json={"orientation": "right"},
            headers=self._headers_for_user("perm_user", "user"),
        )
        self.assertEqual(forbidden_response.status_code, 403)

        permissions_response = self.client.put(
            f"/api/users/{user_id}/permissions",
            json={
                "permissions": {
                    "kiosk.rotate": True,
                }
            },
            headers=self._admin_headers(),
        )
        self.assertEqual(permissions_response.status_code, 200)

        # Pierwsze logowanie nowego użytkownika wymaga zmiany hasła przed dostępem do akcji.
        first_login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "perm_user",
                "password": "perm_user_password",
            },
        )
        self.assertEqual(first_login_response.status_code, 200)
        first_login_token = first_login_response.get_json().get("token")

        change_password_response = self.client.post(
            "/api/account/change-password",
            json={
                "current_password": "perm_user_password",
                "new_password": "perm_user_password_2",
                "confirm_password": "perm_user_password_2",
            },
            headers={"Authorization": f"Bearer {first_login_token}"},
        )
        self.assertEqual(change_password_response.status_code, 200)

        second_login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "perm_user",
                "password": "perm_user_password_2",
            },
        )
        self.assertEqual(second_login_response.status_code, 200)
        second_login_token = second_login_response.get_json().get("token")

        allowed_response = self.client.post(
            f"/api/kiosks/{kiosk_id}/rotate-display",
            json={"orientation": "right"},
            headers={"Authorization": f"Bearer {second_login_token}"},
        )
        self.assertEqual(allowed_response.status_code, 200)
        self.assertTrue(allowed_response.get_json().get("success"))

    def test_kiosk_error_logs_require_explicit_action_permission(self):
        kiosk_id = self._create_kiosk()

        conn = backend_app.get_db_connection()
        serial_number = conn.execute(
            "SELECT serial_number FROM kiosks WHERE id = ?",
            (kiosk_id,),
        ).fetchone()[0]
        conn.close()

        create_log_response = self.client.post(
            f"/api/device/{serial_number}/error-log",
            json={
                "message": "Device runtime exception",
                "level": "error",
                "source": "player",
                "details": {"code": "E_PLAYER"},
            },
        )
        self.assertEqual(create_log_response.status_code, 201)

        create_user_response = self.client.post(
            "/api/users",
            json={
                "username": "logs_user",
                "password": "logs_user_password",
            },
            headers=self._admin_headers(),
        )
        self.assertEqual(create_user_response.status_code, 201)
        user_id = create_user_response.get_json().get("user_id")

        first_login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "logs_user",
                "password": "logs_user_password",
            },
        )
        self.assertEqual(first_login_response.status_code, 200)
        first_login_token = first_login_response.get_json().get("token")

        change_password_response = self.client.post(
            "/api/account/change-password",
            json={
                "current_password": "logs_user_password",
                "new_password": "logs_user_password_2",
                "confirm_password": "logs_user_password_2",
            },
            headers={"Authorization": f"Bearer {first_login_token}"},
        )
        self.assertEqual(change_password_response.status_code, 200)

        second_login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "logs_user",
                "password": "logs_user_password_2",
            },
        )
        self.assertEqual(second_login_response.status_code, 200)
        second_login_token = second_login_response.get_json().get("token")
        user_headers = {"Authorization": f"Bearer {second_login_token}"}

        forbidden_response = self.client.get(
            "/api/kiosks/error-logs",
            headers=user_headers,
        )
        self.assertEqual(forbidden_response.status_code, 403)

        grant_permission_response = self.client.put(
            f"/api/users/{user_id}/permissions",
            json={
                "permissions": {
                    "kiosk.error_logs.view": True,
                }
            },
            headers=self._admin_headers(),
        )
        self.assertEqual(grant_permission_response.status_code, 200)

        allowed_response = self.client.get(
            f"/api/kiosks/error-logs?kiosk_id={kiosk_id}&limit=20",
            headers=user_headers,
        )
        self.assertEqual(allowed_response.status_code, 200)

        payload = allowed_response.get_json()
        self.assertTrue(payload.get("success"))
        self.assertGreaterEqual(payload.get("count", 0), 1)
        self.assertTrue(
            any(
                log.get("kiosk_id") == kiosk_id and log.get("message") == "Device runtime exception"
                for log in payload.get("logs", [])
            )
        )

    def test_new_user_must_change_password_on_first_login(self):
        create_user_response = self.client.post(
            "/api/users",
            json={
                "username": "first_login_user",
                "password": "start123",
            },
            headers=self._admin_headers(),
        )
        self.assertEqual(create_user_response.status_code, 201)
        self.assertTrue(create_user_response.get_json().get("must_change_password"))

        first_login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "first_login_user",
                "password": "start123",
            },
        )
        self.assertEqual(first_login_response.status_code, 200)
        first_login_payload = first_login_response.get_json()
        self.assertTrue(first_login_payload.get("must_change_password"))
        first_login_token = first_login_payload.get("token")

        blocked_response = self.client.get(
            "/api/kiosks",
            headers={"Authorization": f"Bearer {first_login_token}"},
        )
        self.assertEqual(blocked_response.status_code, 403)
        self.assertTrue(blocked_response.get_json().get("must_change_password"))

        change_password_response = self.client.post(
            "/api/account/change-password",
            json={
                "current_password": "start123",
                "new_password": "newpass123",
                "confirm_password": "newpass123",
            },
            headers={"Authorization": f"Bearer {first_login_token}"},
        )
        self.assertEqual(change_password_response.status_code, 200)

        second_login_response = self.client.post(
            "/api/auth/login",
            json={
                "username": "first_login_user",
                "password": "newpass123",
            },
        )
        self.assertEqual(second_login_response.status_code, 200)
        second_login_payload = second_login_response.get_json()
        self.assertFalse(second_login_payload.get("must_change_password"))
        second_login_token = second_login_payload.get("token")

        allowed_response = self.client.get(
            "/api/kiosks",
            headers={"Authorization": f"Bearer {second_login_token}"},
        )
        self.assertEqual(allowed_response.status_code, 200)

    @patch("app.connect_ssh_with_username_fallback")
    def test_rotate_display_returns_error_when_ssh_unavailable(self, mock_connect_ssh):
        kiosk_id = self._create_kiosk()

        conn = backend_app.get_db_connection()
        serial_number = conn.execute("SELECT serial_number FROM kiosks WHERE id = ?", (kiosk_id,)).fetchone()[0]
        conn.close()

        update_ip_response = self.client.post(
            f"/api/device/{serial_number}/ip",
            json={"ip_address": "10.0.0.188"},
        )
        self.assertEqual(update_ip_response.status_code, 200)

        mock_connect_ssh.side_effect = Exception("SSH unavailable")

        response = self.client.post(
            f"/api/kiosks/{kiosk_id}/rotate-display",
            json={"orientation": "right"},
            headers=self._admin_headers(),
        )

        self.assertEqual(response.status_code, 500)
        payload = response.get_json()
        self.assertIn("error", payload)
        mock_connect_ssh.assert_called_once()

    @patch("app.ftp_get_file_content")
    @patch("app.connect_file_transfer")
    def test_get_file_content_uses_storage_path_on_sftp_fallback(self, mock_connect, mock_get_file_content):
        class DummySftp(backend_app.SFTPHandler):
            def __init__(self):
                pass

            def get_file_content(self, path):
                self.path = path
                return "test-content"

            def close(self):
                return None

        sftp_conn = DummySftp()

        def side_effect(hostname, username, password, port):
            if port == 21:
                return None
            if port == 22:
                return sftp_conn
            return None

        mock_connect.side_effect = side_effect
        mock_get_file_content.return_value = "unused"

        response = self.client.post(
            "/api/ftp/get-file-content",
            json={
                "hostname": "10.0.0.188",
                "username": "root",
                "password": "secret",
                "path": "napis.txt",
                "port": 21,
            },
            headers=self._user_headers(),
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload.get("path"), "/storage/napis.txt")

    @patch("app.connect_file_transfer")
    def test_scrolling_text_visibility_handles_sftp_first_path_failure(self, mock_connect):
        kiosk_id = self._create_kiosk()

        conn = backend_app.get_db_connection()
        conn.execute(
            "UPDATE kiosks SET ip_address = ?, ftp_password = ?, text_file_path = ? WHERE id = ?",
            ("10.0.0.188", "secret", "/home/kiosk/napis.txt", kiosk_id),
        )
        conn.commit()
        conn.close()

        class DummySftp(backend_app.SFTPHandler):
            def __init__(self):
                self.paths = []

            def put_file_content(self, path, content):
                _ = content
                self.paths.append(path)
                if path == "/home/kiosk/napis.txt":
                    raise OSError("Failure")
                if path == "/storage/napis.txt":
                    return True
                return False

            def close(self):
                return None

        sftp_conn = DummySftp()

        def side_effect(hostname, username, password, port):
            _ = hostname
            _ = username
            _ = password
            if port == 22:
                return sftp_conn
            return None

        mock_connect.side_effect = side_effect

        response = self.client.post(
            f"/api/kiosks/{kiosk_id}/scrolling-text-visibility",
            json={"hidden": True},
            headers=self._admin_headers(),
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload.get("success"))
        self.assertEqual(payload.get("protocol"), "sftp")
        self.assertEqual(payload.get("path"), "/storage/napis.txt")
        self.assertIn("/home/kiosk/napis.txt", sftp_conn.paths)
        self.assertIn("/storage/napis.txt", sftp_conn.paths)

    @patch("app.connect_file_transfer")
    def test_scrolling_text_visibility_toggle_restores_previous_text(self, mock_connect):
        kiosk_id = self._create_kiosk()

        conn = backend_app.get_db_connection()
        conn.execute(
            "UPDATE kiosks SET ip_address = ?, ftp_password = ?, text_file_path = ? WHERE id = ?",
            ("10.0.0.188", "secret", "/home/kiosk/napis.txt", kiosk_id),
        )
        conn.commit()
        conn.close()

        class DummySftp(backend_app.SFTPHandler):
            def __init__(self):
                self.files = {"/home/kiosk/napis.txt": "To jest tekst z pliku napis.txt\n"}

            def get_file_content(self, path):
                if path in self.files:
                    return self.files[path]
                raise OSError("No such file")

            def put_file_content(self, path, content):
                self.files[path] = content
                return True

            def close(self):
                return None

        sftp_conn = DummySftp()

        def side_effect(hostname, username, password, port):
            _ = hostname
            _ = username
            _ = password
            if port == 22:
                return sftp_conn
            return None

        mock_connect.side_effect = side_effect

        hide_response = self.client.post(
            f"/api/kiosks/{kiosk_id}/scrolling-text-visibility",
            json={"hidden": True},
            headers=self._admin_headers(),
        )
        self.assertEqual(hide_response.status_code, 200)
        self.assertEqual(
            sftp_conn.files.get("/home/kiosk/napis.txt"),
            backend_app.SCROLLING_TEXT_HIDE_DIRECTIVE + "\n",
        )

        show_response = self.client.post(
            f"/api/kiosks/{kiosk_id}/scrolling-text-visibility",
            json={"hidden": False},
            headers=self._admin_headers(),
        )
        self.assertEqual(show_response.status_code, 200)
        self.assertEqual(
            sftp_conn.files.get("/home/kiosk/napis.txt"),
            "To jest tekst z pliku napis.txt\n",
        )


if __name__ == "__main__":
    unittest.main()
