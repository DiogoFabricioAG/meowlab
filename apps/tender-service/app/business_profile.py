"""Account-scoped business profile model compatible with radar_web_business."""
from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class WebBusiness(Base):
    __tablename__ = "radar_web_business"
    account: Mapped[str] = mapped_column(String(100), primary_key=True)
    memory: Mapped[dict] = mapped_column(JSON, default=dict)
