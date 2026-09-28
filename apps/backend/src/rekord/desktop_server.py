from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Rekord-Fox desktop API server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--web-dist", type=Path, required=True)
    args = parser.parse_args()

    data_dir = args.data_dir.expanduser().resolve()
    web_dist = args.web_dist.expanduser().resolve()

    os.environ.setdefault("REKORD_DATA_DIR", str(data_dir))
    os.environ.setdefault("REKORD_UPLOAD_DIR", str(data_dir / "uploads"))
    os.environ.setdefault("REKORD_WAVEFORM_CACHE_DIR", str(data_dir / "waveforms"))
    os.environ.setdefault("REKORD_DB_PATH", str(data_dir / "rekord.db"))
    os.environ.setdefault("REKORD_WEB_DIST_DIR", str(web_dist))

    from rekord.api.main import app

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=os.environ.get("REKORD_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
