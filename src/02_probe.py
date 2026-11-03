"""Calls the notes MCP server through API Management as the signed-in user, every few seconds, and prints one line per
round with the outcome and its timing: run it while blocking and unblocking the server in the admin center (02).

    uv run python src/02_probe.py | tee docs/experiments/assets/02-probe.log

Each round is what an MCP client does first: initialize, list the tools, and call list_notes. The user's token for
the gateway comes from the Azure CLI (pre-authorized on the gateway's app registration) and is renewed as needed.
(azure-identity's AzureCliCredential timed out here although `az` answers in 2 s, so the probe calls `az` itself.)
"""

import json
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime

INTERVAL_SECONDS = 5
RENEW_BEFORE_SECONDS = 300


def azd_value(name: str) -> str:
    return subprocess.run(["azd", "env", "get-value", name], capture_output=True, text=True, check=True).stdout.strip()


class UserToken:
    """The signed-in user's token for the gateway, from the Azure CLI, renewed five minutes before it expires."""

    def __init__(self, scope: str):
        self.scope = scope
        self.value = ""
        self.expires_on = 0

    def get(self) -> str:
        if time.time() > self.expires_on - RENEW_BEFORE_SECONDS:
            command = ["az", "account", "get-access-token", "--scope", self.scope, "-o", "json"]
            token = json.loads(subprocess.run(command, capture_output=True, text=True, check=True).stdout)
            self.value, self.expires_on = token["accessToken"], token["expires_on"]
        return self.value


def rpc(url: str, token: str, request_id: int, method: str, params: dict | None = None) -> tuple[int, dict]:
    """One JSON-RPC request over Streamable HTTP; returns the HTTP status and the JSON body (or its error text)."""
    message = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
    request = urllib.request.Request(
        url,
        data=json.dumps(message).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-06-18",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, {"error": {"message": error.read().decode(errors="replace")[:200]}}
    except (urllib.error.URLError, TimeoutError) as error:
        # No HTTP answer at all (connection reset, DNS, timeout): reported as status 0, the probe goes on.
        return 0, {"error": {"message": str(getattr(error, "reason", error))[:200]}}


def probe_round(url: str, token: str) -> str:
    """The outcome of one round, as one line: ok with the tools, or the first refusal (status, JSON-RPC error)."""
    initialize = {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "1"}}
    steps = [
        ("initialize", initialize),
        ("tools/list", None),
        ("tools/call", {"name": "list_notes", "arguments": {"limit": 1}}),
    ]
    tools = []
    for request_id, (method, params) in enumerate(steps, start=1):
        status, body = rpc(url, token, request_id, method, params)
        if status != 200 or "error" in body:
            error = body.get("error", {})
            code = (error.get("data") or {}).get("code", error.get("code", ""))
            return f"refused  {method} HTTP {status} {code} {str(error.get('message', ''))[:90]}"
        if method == "tools/list":
            tools = sorted(tool["name"] for tool in body["result"]["tools"])
        if method == "tools/call" and body["result"].get("isError"):
            return f"tool error  {body['result']['content'][0]['text'][:90]}"
    return f"ok  tools={tools}"


def main() -> None:
    url = azd_value("APIM_MCP_NOTES_URL")
    scope = azd_value("APIM_GATEWAY_SCOPE")
    token = UserToken(scope)
    print(f"probing {url} every {INTERVAL_SECONDS} s", flush=True)
    while True:
        started = time.monotonic()
        line = probe_round(url, token.get())
        print(f"{datetime.now():%H:%M:%S} {time.monotonic() - started:4.1f}s {line}", flush=True)
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
