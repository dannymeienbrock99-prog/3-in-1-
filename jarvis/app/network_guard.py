"""Only loopback TCP is allowed inside the running desktop application.

Downloads are a separate setup step, never a runtime fallback.
"""
import ipaddress
import socket

def allowed(host):
    if isinstance(host, bytes):
        host = host.decode('ascii', errors='ignore')
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False

def install():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_getaddrinfo = socket.getaddrinfo
    def check(address):
        if isinstance(address, tuple) and not allowed(address[0]):
            raise PermissionError('Offline-Modus: Externe Verbindung blockiert.')
    def connect(sock, address):
        check(address)
        return original_connect(sock, address)
    def connect_ex(sock, address):
        check(address)
        return original_connect_ex(sock, address)
    def getaddrinfo(host, *args, **kwargs):
        if host is not None and not allowed(host):
            raise PermissionError('Offline-Modus: Externe Namensauflösung blockiert.')
        return original_getaddrinfo(host, *args, **kwargs)
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo
