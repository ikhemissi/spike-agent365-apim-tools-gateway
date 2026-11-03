"""With NOTES_ALLOWED_CALLER_ID set, only the gateway's tokens reach /mcp. Tokens are signed here with a test key."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from starlette.testclient import TestClient

import server
from tests.fakes import FakeTable

TENANT = "00000000-0000-4000-8000-000000000001"
SERVER_APP = "00000000-0000-4000-8000-000000000002"
GATEWAY = "00000000-0000-4000-8000-000000000003"
ENV = {"NOTES_AUTH_TENANT_ID": TENANT, "NOTES_AUTH_AUDIENCE": f"api://{SERVER_APP}", "NOTES_ALLOWED_CALLER_ID": GATEWAY}
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}},
}


def token(key=KEY, **overrides):
    now = int(time.time())
    claims = {
        "aud": f"api://{SERVER_APP}",
        "iss": f"https://sts.windows.net/{TENANT}/",
        "oid": GATEWAY,
        "iat": now,
        "exp": now + 600,
        **overrides,
    }
    return jwt.encode(claims, key, algorithm="RS256")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(server, "notes_table", lambda: FakeTable())
    app = server.create_app(env=ENV, signing_key_for=lambda _: KEY.public_key())
    with TestClient(app) as test_client:
        yield test_client


def call(client, bearer=None):
    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return client.post("/mcp", json=INITIALIZE, headers=headers)


def test_the_gateway_token_is_accepted_in_v1_and_v2_form(client):
    assert call(client, token()).status_code == 200
    v2 = token(aud=SERVER_APP, iss=f"https://login.microsoftonline.com/{TENANT}/v2.0")
    assert call(client, v2).status_code == 200


@pytest.mark.parametrize(
    "bearer",
    [
        None,
        "not-a-token",
        token(oid="00000000-0000-4000-8000-000000000009"),
        token(aud="api://another-app"),
        token(iss="https://sts.windows.net/00000000-0000-4000-8000-000000000008/"),
        token(exp=int(time.time()) - 60),
        token(key=rsa.generate_private_key(public_exponent=65537, key_size=2048)),
    ],
    ids=["no token", "not a JWT", "another caller", "another audience", "another tenant", "expired", "another key"],
)
def test_anything_but_the_gateway_token_is_refused(client, bearer):
    response = call(client, bearer)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_the_health_probe_needs_no_token(client):
    assert client.get("/health").json() == {"status": "ok"}
