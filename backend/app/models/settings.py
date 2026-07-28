from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AppSetting(Base):
    """A simple key/value store for app-wide settings the user can change at runtime.

    Currently backs the admin "Sample defaults" panel (the default loading options applied
    to newly created/imported samples). Namespaced keys (e.g. "sample_default.priority")
    keep unrelated settings from colliding. Values are stored as strings; the reading
    service is responsible for interpreting/validating them (see services/settings_service)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str | None] = mapped_column(String(255), nullable=True)
