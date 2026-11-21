"""One account-scoped business configuration for the editor and the assistant."""
import hashlib
import json
import unicodedata
from typing import Annotated, Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, field_validator, model_validator
from sqlalchemy import JSON, String, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import Base, get_db
from .workspace import account, router

REGIONS = ["Amazonas", "Áncash", "Apurímac", "Arequipa", "Ayacucho", "Cajamarca", "Callao", "Cusco", "Huancavelica", "Huánuco", "Ica", "Junín", "La Libertad", "Lambayeque", "Lima", "Loreto", "Madre de Dios", "Moquegua", "Pasco", "Piura", "Puno", "San Martín", "Tacna", "Tumbes", "Ucayali"]
Topic = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
Amount = Annotated[FiniteFloat, Field(ge=0)]


class WebBusiness(Base):
    __tablename__ = "radar_web_business"
    account: Mapped[str] = mapped_column(String(100), primary_key=True)
    memory: Mapped[dict] = mapped_column(JSON, default=dict)


class SearchPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    regions: list[str] = Field(default_factory=list, max_length=25)
    entity: str = Field(default="", max_length=200)
    minAmount: Amount | None = None
    maxAmount: Amount | None = None
    currency: Literal["PEN", "USD", "EUR"] = "PEN"

    @field_validator("regions")
    @classmethod
    def regions_are_known(cls, value):
        if any(region not in REGIONS for region in value):
            raise ValueError("Selecciona regiones de la lista.")
        return list(dict.fromkeys(value))

    @field_validator("minAmount", "maxAmount", mode="before")
    @classmethod
    def reject_bool(cls, value):
        if isinstance(value, bool):
            raise ValueError("Introduce un importe válido.")
        return value

    @model_validator(mode="after")
    def valid_range(self):
        if self.minAmount is not None and self.maxAmount is not None and self.minAmount > self.maxAmount:
            raise ValueError("El monto mínimo no puede superar al máximo.")
        self.entity = self.entity.strip()
        return self


def topic_key(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c)).strip()


class BusinessSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = Field(default="", max_length=6000)
    coverage: str = Field(default="", max_length=1000)
    topics: list[Topic] = Field(default_factory=list, max_length=100)
    excludedTopics: list[Topic] = Field(default_factory=list, max_length=100)
    searchPreferences: SearchPreferences = Field(default_factory=SearchPreferences)

    @field_validator("topics", "excludedTopics")
    @classmethod
    def unique_topics(cls, values):
        seen, result = set(), []
        for value in values:
            key = topic_key(value)
            if key not in seen:
                seen.add(key)
                result.append(value)
        return result

    @model_validator(mode="after")
    def coherent_topics(self):
        if {topic_key(v) for v in self.topics} & {topic_key(v) for v in self.excludedTopics}:
            raise ValueError("Un producto no puede estar incluido y excluido a la vez.")
        return self


class BusinessUpdate(BusinessSettings):
    version: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="before")
    @classmethod
    def require_complete_snapshot(cls, values):
        if isinstance(values, dict) and not (set(BusinessSettings.model_fields) | {"version"}).issubset(values):
            raise ValueError("Lee los ajustes actuales y conserva todos los campos antes de guardar.")
        return values


def revision(memory):
    return hashlib.sha256(json.dumps(memory, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def view(memory):
    # A whitelist prevents the historical desktop snapshot/provenance becoming
    # editable tenant, credentials or an alternate authority from the browser.
    settings = {name: memory[name] for name in BusinessSettings.model_fields if name in memory}
    if settings.get("searchPreferences") is None:
        settings.pop("searchPreferences", None)
    parsed = BusinessSettings.model_validate(settings)
    return {"settings": parsed.model_dump(), "version": revision(memory), "regions": REGIONS}


def read_business(db, owner):
    row = db.scalar(select(WebBusiness).where(WebBusiness.account == owner).execution_options(populate_existing=True))
    return view(row.memory if row else {})


def save_business(db: Session, owner, payload: BusinessUpdate):
    row = db.scalar(select(WebBusiness).where(WebBusiness.account == owner).with_for_update().execution_options(populate_existing=True))
    previous = row.memory if row else {}
    if revision(previous) != payload.version:
        raise HTTPException(409, "Tu negocio cambió en otra ventana o en la conversación. Revisa la versión guardada antes de volver a guardar.")
    settings = payload.model_dump(exclude={"version"})
    if view(previous)["settings"] == settings:
        db.commit()
        return view(previous)
    # Preserve the authorized import/provenance; replace only actual settings.
    memory = {**previous, **settings}
    if row:
        row.memory = memory
    else:
        db.add(WebBusiness(account=owner, memory=memory))
    try:
        db.flush()
        from .preparation import enqueue_selected
        enqueue_selected(db, owner)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "El negocio se actualizó mientras guardabas. Revisa la versión guardada.") from None
    return view(memory)


@router.get("/business")
def get_business(owner: str = Depends(account), db: Session = Depends(get_db)):
    return read_business(db, owner)


@router.put("/business")
def put_business(payload: BusinessUpdate, owner: str = Depends(account), db: Session = Depends(get_db)):
    return save_business(db, owner, payload)
