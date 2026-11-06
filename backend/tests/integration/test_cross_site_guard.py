"""The cross-site write guard (main.block_cross_site_writes): with no auth, any /api write must
carry the X-RunNx header the frontend always sends, so a foreign page can't drive the API from a
lab user's browser. Reads stay open."""
import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app

BLOCKED = "Request blocked: missing X-RunNx header (cross-site protection)"


@pytest.fixture
def bare_client(db_session):
    """A client that, unlike conftest's `client`, sends no X-RunNx header - a cross-site request."""

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_write_without_header_is_blocked_before_reaching_the_route(bare_client, db_session, method):
    resp = bare_client.request(method, "/api/samples", json={"pool_id": "X1"})
    assert resp.status_code == 403
    assert resp.json() == {"detail": BLOCKED}


def test_blocked_write_changes_nothing(bare_client, client):
    resp = bare_client.post("/api/samples", json={"pool_id": "CROSS-SITE", "barcodes": ["bc1001"]})
    assert resp.status_code == 403
    assert client.get("/api/samples", params={"q": "CROSS-SITE"}).json()["total"] == 0


def test_write_with_header_passes(bare_client):
    resp = bare_client.post("/api/samples", json={"pool_id": "SAME-SITE", "barcodes": ["bc1001"]}, headers={"X-RunNx": "1"})
    assert resp.status_code == 201, resp.text


def test_wrong_header_value_is_blocked(bare_client):
    resp = bare_client.post("/api/samples", json={"pool_id": "X1"}, headers={"X-RunNx": "yes"})
    assert resp.status_code == 403


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
def test_reads_need_no_header(bare_client, method):
    resp = bare_client.request(method, "/api/health")
    assert resp.status_code != 403


def test_non_api_paths_are_not_guarded(bare_client):
    # Only /api/* is guarded; anything else falls through to normal routing (here: no such route).
    assert bare_client.post("/not-api").status_code == 404
