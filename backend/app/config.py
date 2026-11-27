from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./dev.db"
    cors_origins: str = ""  # comma-separated; empty means same-origin only (see nginx proxy design)
    # Settings > Developer tools and every /api/admin route. Off by default: the app has no sign-in,
    # and these tools edit the database directly. Compose and the devcontainer switch it on.
    dev_tools_enabled: bool = False

    # Multi-LIMS Warehouse (MySQL), read-only. All optional: an empty URL means MLWH is off and
    # the rest of the app is unaffected (services/mlwh.py). The URL is like DATABASE_URL, e.g.
    # mysql+pymysql://user@host:3306/database. The password is better kept out of the URL in
    # MLWH_PASSWORD (no URL encoding, never part of a printed URL); if set, it wins.
    mlwh_database_url: str = ""
    mlwh_password: SecretStr = SecretStr("")
    # TLS is always on. MLWH_SSL_CA: CA bundle path for a server certificate from an internal
    # CA (empty: the system trust store). MLWH_SSL_VERIFY=false still encrypts but skips the
    # certificate and host-name check - only for a server whose CA isn't available.
    mlwh_ssl_ca: str = ""
    mlwh_ssl_verify: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
