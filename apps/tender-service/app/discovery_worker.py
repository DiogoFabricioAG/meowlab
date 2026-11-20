"""Persistent cloud discovery process; WhatsApp stays behind MeowLab's API."""
import argparse
import json
import logging
import os
import signal
import threading

from .database import Base, engine, SessionLocal
from .opportunity_discovery import DiscoveryWorker
from .security import read_secret


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--collect-only", action="store_true", help="Persist SEACE results, never send WhatsApp")
    parser.add_argument("--force", action="store_true", help="Refresh searches now; preserves notification limits")
    args = parser.parse_args()
    if args.force and not args.once:
        parser.error("--force requires --once; continuous discovery respects its six-hour interval")
    owner = os.getenv("RADAR_WEB_ACCOUNT", "").strip()
    if not owner or len(owner) > 100 or not read_secret("RADAR_MEOWLAB_TOKEN"):
        parser.error("Configure the pilot account and its server-only MeowLab credential")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    Base.metadata.create_all(engine)
    stopped = threading.Event()
    for name in ("SIGTERM", "SIGINT"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), lambda *_: stopped.set())
    worker = DiscoveryWorker(SessionLocal, owner)
    while not stopped.is_set():
        try:
            result = worker.cycle(send=not args.collect_only, force=args.force)
            logging.info("[radar-discovery] cycle %s", json.dumps(result))
        except Exception as error:
            logging.warning("[radar-discovery] cycle_pending kind=%s", type(error).__name__)
            if args.once:
                raise SystemExit(1) from None
        if args.once or stopped.wait(60):
            break


if __name__ == "__main__":
    main()
