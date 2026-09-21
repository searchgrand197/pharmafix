"""ADMS (ZKTeco push protocol) URL patterns."""

from django.urls import re_path

from apps.hr.biometric.views_iclock import CDataView, DeviceCmdView, GetRequestView

urlpatterns = [
    re_path(r'^cdata(?:\.aspx)?/?$', CDataView.as_view(), name='iclock-cdata'),
    re_path(r'^getrequest(?:\.aspx)?/?$', GetRequestView.as_view(), name='iclock-getrequest'),
    re_path(r'^devicecmd(?:\.aspx)?/?$', DeviceCmdView.as_view(), name='iclock-devicecmd'),
]
