import datetime
import json
import logging

import bcrypt
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .auth import admin_required, issue_token, token_required
from .db import get_db_connection, update_kiosk_statuses

logger = logging.getLogger(__name__)


def _json_body(request):
    try:
        if not request.body:
            return {}
        return json.loads(request.body.decode('utf-8'))
    except Exception:
        return {}


@csrf_exempt
def login_view(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    data = _json_body(request)
    if not data or 'username' not in data or 'password' not in data:
        return JsonResponse({'error': 'Brakujące dane logowania'}, status=400)

    username = data['username']
    password = data['password']

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()

    if user and bcrypt.checkpw(password.encode('utf-8'), user['password'].encode('utf-8')):
        token = issue_token(username, user['role'] or 'user')
        return JsonResponse(
            {
                'success': True,
                'username': username,
                'role': user['role'] or 'user',
                'token': token,
                'message': 'Logowanie pomyślne',
            }
        )

    return JsonResponse({'success': False, 'message': 'Nieprawidłowa nazwa użytkownika lub hasło'}, status=401)


@csrf_exempt
@token_required
def kiosks_collection(request):
    if request.method == 'GET':
        update_kiosk_statuses(logger=logger)

        referer = request.headers.get('Referer', '')
        user_agent = request.headers.get('User-Agent', '')

        conn = get_db_connection()
        if 'Kiosk-Device' in user_agent or '/api/device/' in referer:
            kiosks = conn.execute('SELECT id, name, serial_number, ip_address, status FROM kiosks').fetchall()
            conn.close()
            response = JsonResponse({'kiosks': [dict(kiosk) for kiosk in kiosks], 'no_refresh': True})
            response['X-No-Refresh'] = 'true'
            return response

        kiosks = conn.execute('SELECT * FROM kiosks').fetchall()
        conn.close()
        return JsonResponse([dict(kiosk) for kiosk in kiosks], safe=False)

    if request.method == 'POST':
        return create_kiosk(request)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@csrf_exempt
@admin_required
def create_kiosk(request):
    data = _json_body(request)
    if not data or 'mac_address' not in data or 'serial_number' not in data:
        return JsonResponse({'error': 'Brakujące dane: wymagane mac_address i serial_number'}, status=400)

    conn = get_db_connection()
    try:
        conn.execute(
            'INSERT INTO kiosks (mac_address, serial_number, name, ftp_username, ftp_password) VALUES (?, ?, ?, ?, ?)',
            (
                data['mac_address'],
                data['serial_number'],
                data.get('name', ''),
                data.get('ftp_username', ''),
                data.get('ftp_password', ''),
            ),
        )
        conn.commit()
        kiosk_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.close()
        return JsonResponse({'id': kiosk_id, 'message': 'Kiosk dodany pomyślnie'}, status=201)
    except Exception as error:
        conn.close()
        if 'UNIQUE constraint failed' in str(error):
            return JsonResponse({'error': 'Kiosk o podanym MAC lub S/N już istnieje'}, status=409)
        return JsonResponse({'error': str(error)}, status=500)


@csrf_exempt
@admin_required
def kiosk_detail(request, kiosk_id):
    if request.method == 'PUT':
        data = _json_body(request)
        if not data:
            return JsonResponse({'error': 'Brak danych do aktualizacji'}, status=400)

        conn = get_db_connection()
        kiosk = conn.execute('SELECT * FROM kiosks WHERE id = ?', (kiosk_id,)).fetchone()
        if not kiosk:
            conn.close()
            return JsonResponse({'error': 'Kiosk nie znaleziony'}, status=404)

        update_fields = {
            'name': data.get('name'),
            'mac_address': data.get('mac_address'),
            'serial_number': data.get('serial_number'),
            'ftp_username': data.get('ftp_username'),
            'ftp_password': data.get('ftp_password'),
            'updated_at': data.get('updated_at') or datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }
        update_fields = {k: v for k, v in update_fields.items() if v is not None}

        if not update_fields:
            conn.close()
            return JsonResponse({'error': 'Brak ważnych pól do aktualizacji'}, status=400)

        try:
            query = 'UPDATE kiosks SET ' + ', '.join([f"{k} = ?" for k in update_fields.keys()]) + ' WHERE id = ?'
            conn.execute(query, list(update_fields.values()) + [kiosk_id])
            conn.commit()
            conn.close()
            return JsonResponse({'message': 'Kiosk zaktualizowany pomyślnie'})
        except Exception as error:
            conn.close()
            if 'UNIQUE constraint failed' in str(error):
                return JsonResponse({'error': 'Konflikt danych - MAC lub S/N już istnieje'}, status=409)
            return JsonResponse({'error': str(error)}, status=500)

    if request.method == 'DELETE':
        conn = get_db_connection()
        kiosk = conn.execute('SELECT * FROM kiosks WHERE id = ?', (kiosk_id,)).fetchone()
        if not kiosk:
            conn.close()
            return JsonResponse({'error': 'Kiosk nie znaleziony'}, status=404)

        conn.execute('DELETE FROM kiosks WHERE id = ?', (kiosk_id,))
        conn.commit()
        conn.close()
        return HttpResponse(status=204)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@csrf_exempt
@token_required
def kiosk_ftp_credentials(request, kiosk_id):
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    conn = get_db_connection()
    kiosk = conn.execute(
        'SELECT id, name, ip_address, ftp_username, ftp_password FROM kiosks WHERE id = ?',
        (kiosk_id,),
    ).fetchone()
    conn.close()

    if not kiosk:
        return JsonResponse({'error': 'Kiosk nie znaleziony'}, status=404)

    return JsonResponse(
        {
            'id': kiosk['id'],
            'name': kiosk['name'],
            'ip_address': kiosk['ip_address'],
            'ftp_username': kiosk['ftp_username'],
            'ftp_password': kiosk['ftp_password'],
        }
    )
