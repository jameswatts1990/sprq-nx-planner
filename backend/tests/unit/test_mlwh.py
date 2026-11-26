import ssl

import pytest
from pydantic import SecretStr

from app.config import settings
from app.services import mlwh


@pytest.fixture
def configure(monkeypatch):
    def _configure(url="", password="", ssl_ca="", ssl_verify=True):
        monkeypatch.setattr(settings, "mlwh_database_url", url)
        monkeypatch.setattr(settings, "mlwh_password", SecretStr(password))
        monkeypatch.setattr(settings, "mlwh_ssl_ca", ssl_ca)
        monkeypatch.setattr(settings, "mlwh_ssl_verify", ssl_verify)
        mlwh.get_engine.cache_clear()

    yield _configure
    mlwh.get_engine.cache_clear()


def test_unset_url_means_not_configured_and_no_engine(configure):
    configure()
    assert mlwh.is_configured() is False
    with pytest.raises(mlwh.MlwhConfigError):
        mlwh.get_engine()


def test_tls_is_always_on_and_verifies_by_default(configure):
    configure("mysql+pymysql://ro@mlwh.example.org/mlwarehouse")
    context = mlwh.connect_args()["ssl"]
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True


def test_ssl_verify_false_still_encrypts_but_skips_the_check(configure):
    configure("mysql+pymysql://ro@mlwh.example.org/mlwarehouse", ssl_verify=False)
    context = mlwh.connect_args()["ssl"]
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_NONE
    assert context.check_hostname is False


def test_short_timeouts(configure):
    configure("mysql+pymysql://ro@mlwh.example.org/mlwarehouse")
    args = mlwh.connect_args()
    assert args["connect_timeout"] <= 5 and args["read_timeout"] <= 10


def test_password_setting_wins_over_the_url_and_stays_out_of_the_target(configure):
    configure("mysql+pymysql://ro:old@mlwh.example.org:3307/mlwarehouse", password="p@ss/word%")
    url = mlwh.connection_url()
    assert url.password == "p@ss/word%"
    assert mlwh.describe_target(url) == "ro@mlwh.example.org:3307/mlwarehouse"


def test_plain_mysql_url_gets_the_pymysql_driver(configure):
    configure("mysql://ro@mlwh.example.org/mlwarehouse")
    assert mlwh.connection_url().drivername == "mysql+pymysql"
    assert mlwh.describe_target(mlwh.connection_url()) == "ro@mlwh.example.org:3306/mlwarehouse"


def test_engine_is_built_lazily_without_connecting(configure):
    # An unreachable host: building the engine must not try to connect.
    configure("mysql+pymysql://ro@127.0.0.1:1/mlwarehouse")
    engine = mlwh.get_engine()
    assert engine is mlwh.get_engine()


@pytest.mark.parametrize("url", ["not a url", "postgresql://ro@host/db"])
def test_unusable_url_is_a_config_error(configure, url):
    configure(url)
    with pytest.raises(mlwh.MlwhConfigError):
        mlwh.connection_url()
