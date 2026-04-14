from django.urls import path

from .views import kiosk_detail, kiosk_ftp_credentials, kiosks_collection, login_view

urlpatterns = [
    path('api/auth/login', login_view),
    path('api/kiosks', kiosks_collection),
    path('api/kiosks/<int:kiosk_id>', kiosk_detail),
    path('api/kiosks/<int:kiosk_id>/ftp-credentials', kiosk_ftp_credentials),
]
