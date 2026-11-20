"""Research published prices after a preparation completes, even with no portal session."""
import logging
import threading
import time
from uuid import uuid4

from sqlalchemy import func, or_, select

from . import tender_market
from .preparation import PreparationJob, job_id, memory_for
from .tender_work import current_workspace
from .workspace import WebOpportunity

log = logging.getLogger(__name__)
BATCH_SIZE = 8
LEASE_SECONDS = 300
MAX_ATTEMPTS = 3


def mark(job, status, **values):
    job.sections = {**job.sections, "marketResearch": {"status": status, **values}}


def existing_ids(db, owner, key):
    refs = tender_market.MarketReferences
    return set(db.scalars(select(refs.requirement).where(refs.account == owner, refs.opportunity == key)))


def same_generation(db, item, job):
    return bool(item and item.account == job.account and job.id == job_id(item, memory_for(db, job.account))[0])


def active(db, item, job):
    return bool(same_generation(db, item, job) and item.selection == "interesting" and not item.hidden)


def research_one(factory, owner, search=None, clock=time.time):
    now = int(clock())
    state = PreparationJob.sections["marketResearch"]
    status = state["status"].as_string()
    with factory.begin() as db:
        job = db.scalar(select(PreparationJob).join(WebOpportunity, WebOpportunity.key == PreparationJob.opportunity)
            .where(PreparationJob.account == owner, WebOpportunity.account == owner, WebOpportunity.hidden.is_(False),
                   WebOpportunity.selection == "interesting", PreparationJob.status.in_(("ready", "partial")),
                   or_(status.is_(None), status.in_(("queued", "running", "retry"))),
                   func.coalesce(state["after"].as_integer(), 0) <= now)
            .order_by(PreparationJob.updated_at, PreparationJob.id).limit(1)
            .with_for_update(of=PreparationJob, skip_locked=True))
        if not job:
            return False
        key = job.opportunity
        item = db.get(WebOpportunity, key)
        if not active(db, item, job):
            mark(job, "superseded")
            return True
        _, view = current_workspace(db, owner, key)
        known = existing_ids(db, owner, key)
        pending = [r for r in view["requirements"] if r["id"] not in known]
        if not pending:
            mark(job, "complete")
            return True
        attempts = job.sections.get("marketResearch", {}).get("attempts", 0)
        if attempts >= MAX_ATTEMPTS:
            mark(job, "failed")
            return True
        generation, token = job.id, uuid4().hex
        mark(job, "running", token=token, after=now + LEASE_SECONDS, attempts=attempts + 1)

    batch = pending[:BATCH_SIZE]
    try:
        results = (search or tender_market.search_prices)(batch)
    except Exception as error:
        log.warning("automatic_market_research_failed kind=%s", type(error).__name__)
        results = None

    with factory.begin() as db:
        # Same lock order as a change of bases or selection.
        item = db.get(WebOpportunity, key, with_for_update=True)
        job = db.get(PreparationJob, generation, with_for_update=True)
        if not job or job.sections.get("marketResearch", {}).get("token") != token:
            return True
        if not same_generation(db, item, job) or job.status not in ("ready", "partial"):
            mark(job, "superseded")
        elif not active(db, item, job):
            prior_attempts = max(0, job.sections.get("marketResearch", {}).get("attempts", 1) - 1)
            mark(job, "queued", **({"attempts": prior_attempts} if prior_attempts else {}))
        elif results is None:
            mark(job, "retry" if attempts + 1 < MAX_ATTEMPTS else "failed",
                 attempts=attempts + 1, after=int(clock()) + 60 * 2**attempts)
        else:
            # A user may have refreshed a price while the provider was working.
            known = existing_ids(db, owner, key)
            tender_market.save_references(db, owner, key, {i: v for i, v in results.items() if i not in known})
            mark(job, "queued" if len(pending) > BATCH_SIZE else "complete")
    return True


class MarketWorker(threading.Thread):
    def __init__(self, factory, owner):
        super().__init__(name="tender-market", daemon=True)
        self.factory = factory
        self.owner = owner
        self.shutdown = threading.Event()

    def run(self):
        while not self.shutdown.is_set():
            try:
                worked = research_one(self.factory, self.owner)
            except Exception as error:
                log.warning("automatic_market_cycle_failed kind=%s", type(error).__name__)
                worked = False
            self.shutdown.wait(1 if worked else 15)

    def stop(self):
        self.shutdown.set()
        self.join(timeout=2)
