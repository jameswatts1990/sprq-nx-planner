from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AppSetting(Base):
    """A simple key/value store for app-wide settings the user can change at runtime.

    Backs the admin "Sample defaults" panel (the default loading options applied to newly
    created/imported samples) and the "Email template" panel (the editable PacBio credit
    email). Namespaced keys (e.g. "sample_default.priority", "credit_email.body") keep
    unrelated settings from colliding. Values are stored as free text; the reading service
    is responsible for interpreting/validating them (see services/settings_service).

    value is Text (not a length-capped String): the credit-email body runs to several
    hundred characters, which Postgres would reject under a varchar(255) cap."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
