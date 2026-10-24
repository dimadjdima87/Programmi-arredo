"""Compile a portable API directory using the current operating system."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
subprocess.run([
    sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
    '--name', 'studio-api', '--paths', str(root),
    '--distpath', str(root/'desktop'/'build-api'),
    '--workpath', str(root/'desktop'/'build-pyinstaller'),
    '--specpath', str(root/'desktop'/'build-pyinstaller'),
    '--hidden-import', 'sqlalchemy.dialects.sqlite.pysqlite',
    '--hidden-import', 'uvicorn.protocols.http.h11_impl',
    '--hidden-import', 'uvicorn.lifespan.on',
    '--hidden-import', 'uvicorn.loops.asyncio',
    '--collect-all', 'PIL',
    '--collect-all', 'shapely',
    str(root/'desktop'/'api_entry.py')
], cwd=root, check=True)
