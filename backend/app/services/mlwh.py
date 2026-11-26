"""Read-only connection to Sanger's Multi-LIMS Warehouse (MySQL), from configuration only.

Settings: MLWH_DATABASE_URL, MLWH_PASSWORD, MLWH_SSL_CA, MLWH_SSL_VERIFY (app/config.py).
RunNx must keep working when MLWH is unset or unreachable, so nothing here runs at import or
startup: the engine is built on first use, connections time out fast, and `status()` turns
every failure into a result instead of raising. TLS is always on; there is no plain fallback.
Sessions are set READ ONLY as a second guard behind the read-only login.
"""

import ssl
from functools import cache
from time import perf_counter

from sqlalchemy import URL, Engine, create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

from app.config import settings
from app.schemas.mlwh import MlwhStatus, MlwhTable

CONNECT_TIMEOUT_S = 5
READ_TIMEOUT_S = 10


class MlwhConfigError(ValueError):
    """MLWH_DATABASE_URL is set but unusable (not a URL, or not a MySQL one)."""


def is_configured() -> bool:
    return bool(settings.mlwh_database_url.strip())


def _password() -> str:
    return settings.mlwh_password.get_secret_value()


def connection_url() -> URL:
    try:
        url = make_url(settings.mlwh_database_url.strip())
    except Exception as exc:  # noqa: BLE001 - sqlalchemy raises ArgumentError for a bad URL
        raise MlwhConfigError("MLWH_DATABASE_URL is not a valid database URL.") from exc
    if url.get_backend_name() != "mysql":
        raise MlwhConfigError("MLWH_DATABASE_URL must be a MySQL URL (mysql+pymysql://...).")
    if url.drivername == "mysql":
        url = url.set(drivername="mysql+pymysql")
    if _password():
        url = url.set(password=_password())
    return url


def describe_target(url: URL) -> str:
    """user@host:port/database - never the password."""
    return f"{url.username or ''}@{url.host or ''}:{url.port or 3306}/{url.database or ''}"


def ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context(cafile=settings.mlwh_ssl_ca.strip() or None)
    if not settings.mlwh_ssl_verify:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    return context


def connect_args() -> dict:
    # PyMySQL takes an SSLContext for `ssl`; a context always means TLS.
    return {"connect_timeout": CONNECT_TIMEOUT_S, "read_timeout": READ_TIMEOUT_S, "ssl": ssl_context()}


@cache
def get_engine() -> Engine:
    """The shared MLWH engine, built on first use. Raises MlwhConfigError when unset or invalid."""
    if not is_configured():
        raise MlwhConfigError("MLWH is not configured (MLWH_DATABASE_URL is empty).")
    engine = create_engine(connection_url(), pool_pre_ping=True, pool_recycle=3600, connect_args=connect_args())

    @event.listens_for(engine, "connect")
    def _read_only_session(dbapi_connection, _connection_record):
        with dbapi_connection.cursor() as cursor:
            cursor.execute("SET SESSION TRANSACTION READ ONLY")

    return engine


def _scrub(message: str) -> str:
    password = _password()
    if not password and is_configured():
        try:
            password = make_url(settings.mlwh_database_url.strip()).password or ""
        except Exception:  # noqa: BLE001 - nothing to scrub if the URL doesn't parse
            password = ""
    return message.replace(password, "***") if password else message


def status() -> MlwhStatus:
    """Connect with the configured details, read the server version and the tables the login
    can see. Never raises: not configured, a bad URL or an unreachable server are results."""
    if not is_configured():
        return MlwhStatus(configured=False, ok=False)
    try:
        target = describe_target(connection_url())
    except MlwhConfigError as exc:
        return MlwhStatus(configured=True, ok=False, error=str(exc))

    started = perf_counter()
    try:
        with get_engine().connect() as conn:
            server_version = conn.execute(text("SELECT VERSION()")).scalar_one()
            # Positional unpacking: MySQL 8 returns these information_schema columns upper-cased.
            rows = conn.execute(
                text(
                    "SELECT table_name, table_rows FROM information_schema.tables"
                    " WHERE table_schema = DATABASE() ORDER BY table_name"
                )
            ).all()
    except Exception as exc:  # noqa: BLE001 - any failure (DNS, TLS, auth, driver) is a result to show
        # The driver's own message ("Access denied...", "Can't connect...") is already actionable;
        # SQLAlchemy's wrapper only adds noise.
        error = str(exc.orig if isinstance(exc, DBAPIError) else exc)
        return MlwhStatus(configured=True, ok=False, target=target, error=_scrub(error))
    return MlwhStatus(
        configured=True,
        ok=True,
        target=target,
        elapsed_ms=round((perf_counter() - started) * 1000),
        server_version=server_version,
        tables=[MlwhTable(name=name, approx_rows=approx_rows) for name, approx_rows in rows],
    )
