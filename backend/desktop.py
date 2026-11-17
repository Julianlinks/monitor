"""Windows desktop launcher for the bundled local dashboard."""
import argparse
import asyncio
import os
from pathlib import Path
import webbrowser
import multiprocessing

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="电气设备诊断监视")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-dir", type=Path,
                        default=Path(os.getenv("LOCALAPPDATA", Path.home())) / "JulianMonitor")
    args = parser.parse_args()
    data = args.data_dir.resolve()
    data.mkdir(parents=True, exist_ok=True)
    os.chdir(data)
    from main import app
    from config import VERSION

    url = f"http://127.0.0.1:{args.port}/"
    class DesktopServer(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets)
            if self.started:
                print(f"电气设备诊断监视 {VERSION}\n本地地址 {url}\n数据目录 {data}\n按 Ctrl+C 或关闭此窗口退出。", flush=True)
                if not args.no_browser:
                    await asyncio.to_thread(webbrowser.open, url + "#/diagnostics")

    # Reserve the port before the simulator initializes its scratch database.
    cfg = uvicorn.Config(app, host="127.0.0.1", port=args.port, loop="asyncio",
                         http="h11", ws="websockets", access_log=False)
    with cfg.bind_socket() as sock:
        DesktopServer(cfg).run(sockets=[sock])


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
