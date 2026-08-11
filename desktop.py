"""Moon Courier Simulator — десктоп-версия (pywebview + WebView2).

Запуск:  python desktop.py
Требуется:  pip install pywebview
"""
import socket
import threading

def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main():
    try:
        import webview
    except ImportError:
        print("Нет pywebview. Установи:  python -m pip install pywebview")
        return
    import server

    port = free_port()
    t = threading.Thread(target=server.main, args=(port,), daemon=True)
    t.start()

    url = "http://127.0.0.1:%d/" % port
    print("Moon Courier Simulator (desktop): %s" % url)
    webview.create_window(
        "🌙 Moon Courier Simulator",
        url,
        width=1280,
        height=800,
        min_size=(900, 600),
    )
    webview.start()


if __name__ == "__main__":
    main()
