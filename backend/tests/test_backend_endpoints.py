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

    @patch("app.sync_orientation_hint_to_kiosk")
    def test_orientation_file_endpoint_falls_back_to_backend_setting(self, mock_sync_orientation):
        kiosk_id = self._create_kiosk()
        mock_sync_orientation.side_effect = Exception("connection failed")

        response = self.client.post(
            f"/api/kiosks/{kiosk_id}/orientation-file",
            json={"orientation": "right"},
            headers=self._admin_headers(),
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload.get("success"))
        self.assertEqual(payload.get("orientation"), "right")
        self.assertEqual(payload.get("orientationFile"), "/storage/kiosk_orientation.txt")

        settings_response = self.client.get(
            "/api/ticker-orientation",
        )
        self.assertEqual(settings_response.status_code, 200)
        settings_payload = settings_response.get_json()
        self.assertEqual(settings_payload.get("orientation"), "right")

    def test_admin_can_assign_action_permissions_to_user(self):
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

        forbidden_response = self.client.post(
            f"/api/kiosks/{kiosk_id}/orientation-file",
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
            f"/api/kiosks/{kiosk_id}/orientation-file",
            json={"orientation": "right"},
            headers={"Authorization": f"Bearer {second_login_token}"},
        )
        self.assertEqual(allowed_response.status_code, 200)
        self.assertTrue(allowed_response.get_json().get("success"))

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

    @patch("app.sync_orientation_hint_to_kiosk")
    @patch("app.connect_ssh_with_username_fallback")
    def test_rotate_display_falls_back_to_orientation_file(self, mock_connect_ssh, mock_sync_orientation):
        kiosk_id = self._create_kiosk()

        conn = backend_app.get_db_connection()
        serial_number = conn.execute("SELECT serial_number FROM kiosks WHERE id = ?", (kiosk_id,)).fetchone()[0]
        conn.close()

        update_ip_response = self.client.post(
            f"/api/device/{serial_number}/ip",
            json={"ip_address": "10.0.0.188"},
        )
        self.assertEqual(update_ip_response.status_code, 200)

        mock_sync_orientation.return_value = 22
        mock_connect_ssh.side_effect = Exception("SSH unavailable")

        response = self.client.post(
            f"/api/kiosks/{kiosk_id}/rotate-display",
            json={"orientation": "right"},
            headers=self._admin_headers(),
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload.get("success"))
        self.assertTrue(payload.get("fallbackApplied"))
        self.assertEqual(payload.get("orientation"), "right")
        self.assertEqual(payload.get("orientationFile"), "/storage/kiosk_orientation.txt")
        mock_sync_orientation.assert_called_once()
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


if __name__ == "__main__":
    unittest.main()
