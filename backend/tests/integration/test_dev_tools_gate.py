"""DEV_TOOLS_ENABLED: Settings > Developer tools and every /api/admin route.

Off (the default) every admin route answers exactly like a path that doesn't exist, before any
validation, and changes nothing. GET /api/settings/features tells the frontend which it is.
The conftest turns the tools off for every test; `dev_tools_on` switches them on."""

import re

import pytest
from fastapi.routing import APIRoute

from app.api import admin
from app.config import Settings

ADMIN_ROUTES = [
    (method, route.path)
    for route in admin.router.routes
    if isinstance(route, APIRoute)
    for method in sorted(route.methods)
]


def _concrete(path: str) -> str:
    """A real URL for a route template: every {param} becomes "1"."""
    return re.sub(r"\{[^}]+\}", "1", path)


def test_setting_defaults_to_off(monkeypatch):
    monkeypatch.delenv("DEV_TOOLS_ENABLED", raising=False)
    assert Settings(_env_file=None).dev_tools_enabled is False


@pytest.mark.parametrize(("value", "expected"), [("true", True), ("1", True), ("false", False), ("0", False)])
def test_setting_reads_the_environment(monkeypatch, value, expected):
    monkeypatch.setenv("DEV_TOOLS_ENABLED", value)
    assert Settings(_env_file=None).dev_tools_enabled is expected


def test_admin_router_has_routes_to_check():
    # Guards the parametrised test below against silently checking nothing.
    assert ("GET", "/api/admin/tables") in ADMIN_ROUTES
    assert len(ADMIN_ROUTES) >= 7


def test_features_says_off_by_default(client):
    resp = client.get("/api/settings/features")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"dev_tools": False}


@pytest.mark.usefixtures("dev_tools_on")
def test_features_says_on_when_enabled(client):
    assert client.get("/api/settings/features").json() == {"dev_tools": True}


@pytest.mark.parametrize(("method", "path"), ADMIN_ROUTES)
def test_every_admin_route_is_not_found_when_off(client, method, path):
    unknown = client.get("/api/no-such-route")
    # A body that some routes would reject: the gate must answer before validation does.
    resp = client.request(method, _concrete(path), json={"values": {}})
    assert resp.status_code == 404, f"{method} {path}: {resp.status_code} {resp.text}"
    assert resp.json() == unknown.json() == {"detail": "Not Found"}


def test_writes_change_nothing_when_off(client):
    before = client.get("/api/instruments").json()
    assert before, "the fixture seeds instruments"
    assert client.post("/api/admin/tables/instruments/clear").status_code == 404
    assert client.delete(f"/api/admin/tables/instruments/rows/{before[0]['id']}").status_code == 404
    assert client.get("/api/instruments").json() == before


def test_harmless_probe_used_by_deployment_checks(client, monkeypatch):
    """The UAT/helm check sends DELETE .../instruments/rows/not-a-number: 404 when off, 400 when
    on, and never deletes anything in either state."""
    path = "/api/admin/tables/instruments/rows/not-a-number"
    assert client.delete(path).status_code == 404
    monkeypatch.setattr(admin.settings, "dev_tools_enabled", True)
    assert client.delete(path).status_code == 400


@pytest.mark.usefixtures("dev_tools_on")
def test_admin_routes_work_when_on(client):
    resp = client.get("/api/admin/tables")
    assert resp.status_code == 200, resp.text
    assert "instruments" in {t["name"] for t in resp.json()}
