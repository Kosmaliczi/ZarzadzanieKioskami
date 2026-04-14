from django.urls import include, path

urlpatterns = [
    path('health/', include('apps.health.urls')),
    path('', include('apps.api_native.urls')),
    path('', include('apps.api_gateway.urls')),
]
