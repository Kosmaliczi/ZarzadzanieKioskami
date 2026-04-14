from django.urls import re_path
from .views import legacy_proxy

urlpatterns = [
    re_path(r'^(?P<path>.*)$', legacy_proxy),
]
