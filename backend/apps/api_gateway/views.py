from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt

from app import app as legacy_flask_app


HOP_BY_HOP_HEADERS = {
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'content-length',
}


def _collect_headers(django_request):
    headers = {}
    for key, value in django_request.META.items():
        if key.startswith('HTTP_'):
            header_name = key[5:].replace('_', '-').title()
            headers[header_name] = value

    content_type = django_request.META.get('CONTENT_TYPE')
    if content_type:
        headers['Content-Type'] = content_type

    return headers


@csrf_exempt
def legacy_proxy(request, path=''):
    target_path = request.get_full_path()
    if not target_path:
        target_path = '/'

    body = request.body if request.body else None
    headers = _collect_headers(request)

    with legacy_flask_app.test_client() as client:
        legacy_response = client.open(
            path=target_path,
            method=request.method,
            headers=headers,
            data=body,
            content_type=request.META.get('CONTENT_TYPE'),
            follow_redirects=False,
        )

    response = HttpResponse(
        content=legacy_response.get_data(),
        status=legacy_response.status_code,
        content_type=legacy_response.headers.get('Content-Type'),
    )

    for header_name, header_value in legacy_response.headers.items():
        if header_name.lower() not in HOP_BY_HOP_HEADERS:
            response[header_name] = header_value

    return response
