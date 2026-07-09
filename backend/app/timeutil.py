from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware(dt: datetime) -> datetime:
    """SQLite doesn't round-trip tzinfo, so a DateTime(timezone=True) column can come
    back naive even though every value we write is UTC. Normalize before any datetime
    arithmetic to avoid 'can't subtract naive and aware' errors."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
