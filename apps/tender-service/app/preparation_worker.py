"""Headless RADAR preparation worker. No browser and no WhatsApp sends."""
import argparse
import logging
import os
import signal

from .database import Base, engine, SessionLocal
from . import bases_rag  # noqa: F401 - register RAG chunks table before create_all
from . import whatsapp_bases  # noqa: F401 - register notice table before create_all
from .preparation import PreparationWorker, poll_selections
from .security import read_secret


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="One poll and one durable job, then exit")
    parser.add_argument("--poll-only", action="store_true", help="Import selections and enqueue only; no downloads or AI calls")
    args = parser.parse_args()
    owner = os.getenv("RADAR_WEB_ACCOUNT", "").strip()
    if not owner or len(owner) > 100 or not read_secret("RADAR_MEOWLAB_TOKEN"):
        parser.error("Configure the pilot account and its server-only MeowLab bearer")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    Base.metadata.create_all(engine)
    worker = PreparationWorker(SessionLocal, owner)
    for name in ("SIGTERM", "SIGINT"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), lambda *_: worker.stop_event.set())
    if args.poll_only:
        count = poll_selections(SessionLocal, owner)
        logging.info("Selections imported: %d. No messages or AI requests were sent.", count)
    elif args.once:
        count, processed = worker.cycle()
        logging.info("Preparation cycle finished; selections=%d job_processed=%s", count, processed)
    else:
        worker.run()


if __name__ == "__main__":
    main()
