"""Frozen local API entry point. Build this executable on its target OS."""
import os
import sys
import threading


def stop_when_parent_exits():
    # A pipe inherited from Electron closes even after an abnormal parent exit.
    sys.stdin.buffer.read()
    os._exit(0)


def main():
    import uvicorn
    from backend.main import app
    if os.getenv('STUDIO_DIAG_STARTUP') == '1':
        import faulthandler
        faulthandler.cancel_dump_traceback_later()
        print('Native API imports completed', file=sys.stderr, flush=True)
    # Initialize native libraries before a blocking read holds the inherited stdin.
    if os.getenv('STUDIO_PARENT_PIPE') == '1':
        threading.Thread(target=stop_when_parent_exits, daemon=True).start()
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['STUDIO_API_PORT']),
                loop='asyncio', http='h11', ws='none', lifespan='on', access_log=False)


if __name__ == '__main__':
    main()
