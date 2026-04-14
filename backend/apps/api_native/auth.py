import datetime
import os
from functools import wraps

import jwt
from django.http import JsonResponse

from .db import get_db_connection

JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'twoj-tajny-klucz-jwt-2025')


def _extract_token(request):
    auth_header = request.headers.get('Authorization', '')
    if not auth_header:
        return None

    parts = auth_header.split(' ')
    if len(parts) != 2:
        return None

    return parts[1]


def issue_token(username: str, role: str) -> str:
    payload = {
        'username': username,
        'role': role or 'user',
        'exp': datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=24),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm='HS256')


def token_required(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        token = _extract_token(request)
        if not token:
            return JsonResponse({'message': 'Token jest wymagany'}, status=401)

        try:
            data = jwt.decode(token, JWT_SECRET_KEY, algorithms=['HS256'])
            conn = get_db_connection()
            user = conn.execute('SELECT * FROM users WHERE username = ?', (data['username'],)).fetchone()
            conn.close()

            if not user:
                return JsonResponse({'message': 'Użytkownik nie istnieje'}, status=401)

            request.current_user = user['username']
            request.current_user_role = user['role'] or 'user'
        except jwt.ExpiredSignatureError:
            return JsonResponse({'message': 'Token wygasł'}, status=401)
        except jwt.InvalidTokenError:
            return JsonResponse({'message': 'Token jest nieprawidłowy'}, status=401)

        return view_func(request, *args, **kwargs)

    return wrapped


def admin_required(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        token = _extract_token(request)
        if not token:
            return JsonResponse({'message': 'Token jest wymagany'}, status=401)

        try:
            data = jwt.decode(token, JWT_SECRET_KEY, algorithms=['HS256'])
            role = data.get('role', 'user')
            if role != 'admin':
                return JsonResponse({'message': 'Brak uprawnień. Ta operacja wymaga roli administratora.'}, status=403)

            conn = get_db_connection()
            user = conn.execute('SELECT * FROM users WHERE username = ?', (data['username'],)).fetchone()
            conn.close()

            if not user:
                return JsonResponse({'message': 'Użytkownik nie istnieje'}, status=401)

            request.current_user = user['username']
            request.current_user_role = user['role'] or 'user'
        except jwt.ExpiredSignatureError:
            return JsonResponse({'message': 'Token wygasł'}, status=401)
        except jwt.InvalidTokenError:
            return JsonResponse({'message': 'Token jest nieprawidłowy'}, status=401)

        return view_func(request, *args, **kwargs)

    return wrapped
