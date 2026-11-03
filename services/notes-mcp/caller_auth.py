"""Only the gateway may call the MCP endpoint. When NOTES_ALLOWED_CALLER_ID is set (the server has external ingress),
every request to /mcp must carry an Entra access token for this server (NOTES_AUTH_AUDIENCE, its app ID URI),
issued in NOTES_AUTH_TENANT_ID to that one caller (its object id: the gateway's managed identity); anything else gets
401. Without the setting (internal ingress, reachable only inside the Container Apps environment) nothing is checked.

Plain ASGI middleware rather than Starlette's BaseHTTPMiddleware, so that MCP's streamed responses pass untouched."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

import jwt
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

# Entra signs v1 tokens (managed identities get them by default) and v2 tokens with the keys published here.
KEYS_URL = "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"


@dataclass(frozen=True)
class CallerPolicy:
    tenant_id: str
    audience: str
    caller_id: str

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "CallerPolicy | None":
        caller_id = env.get("NOTES_ALLOWED_CALLER_ID", "")
        if not caller_id:
            return None
        return cls(tenant_id=env["NOTES_AUTH_TENANT_ID"], audience=env["NOTES_AUTH_AUDIENCE"], caller_id=caller_id)

    def check(self, token: str, signing_key: object) -> None:
        """Raises jwt.InvalidTokenError unless the token is for this server and from the allowed caller."""
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            # v1 tokens name the app ID URI (api://<client id>), v2 tokens the client id alone.
            audience=[self.audience, self.audience.removeprefix("api://")],
            issuer=[f"https://sts.windows.net/{self.tenant_id}/", f"https://login.microsoftonline.com/{self.tenant_id}/v2.0"],
            options={"require": ["exp", "iat", "oid"]},
        )
        if claims["oid"] != self.caller_id:
            raise jwt.InvalidTokenError("caller not allowed")


class RequireCaller:
    """Refuses requests to /mcp that the policy does not allow; /health stays open for the container's probe."""

    def __init__(self, app: ASGIApp, policy: CallerPolicy, signing_key_for: Callable[[str], object] | None = None):
        self.app = app
        self.policy = policy
        keys = jwt.PyJWKClient(KEYS_URL.format(tenant=policy.tenant_id), cache_keys=True)
        self.signing_key_for = signing_key_for or (lambda token: keys.get_signing_key_from_jwt(token).key)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/mcp"):
            await self.app(scope, receive, send)
            return
        authorization = dict(scope["headers"]).get(b"authorization", b"").decode()
        scheme, _, token = authorization.partition(" ")
        try:
            if scheme.lower() != "bearer" or not token:
                raise jwt.InvalidTokenError("no bearer token")
            self.policy.check(token, self.signing_key_for(token))
        except (jwt.InvalidTokenError, jwt.PyJWKClientError):
            response = JSONResponse({"error": "unauthorized"}, status_code=401, headers={"WWW-Authenticate": "Bearer"})
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
