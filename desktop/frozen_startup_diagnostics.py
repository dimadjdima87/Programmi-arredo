"""Opt-in CI startup traces, before third-party frozen runtime hooks execute."""
import os
import sys

if os.getenv("STUDIO_DIAG_STARTUP") == "1":
    import faulthandler
    print("Native API bootstrap started", file=sys.stderr, flush=True)
    faulthandler.enable(file=sys.stderr, all_threads=True)
    faulthandler.dump_traceback_later(15, repeat=True, file=sys.stderr)
