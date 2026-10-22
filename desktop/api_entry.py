"""Frozen local API entry point. Build this executable on its target OS."""
import os
import sys
import threading


def stop_when_parent_exits():
    # A pipe inherited from Electron closes even after an abnormal parent exit.
    sys.stdin.buffer.read()
    os._exit(0)


def main():
    if os.getenv('STUDIO_PARENT_PIPE') == '1':
        threading.Thread(target=stop_when_parent_exits, daemon=True).start()
    import uvicorn
    from backend.main import app
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['STUDIO_API_PORT']),
                loop='asyncio', http='h11', ws='none', lifespan='on', access_log=False)


if __name__ == '__main__':
    main()
