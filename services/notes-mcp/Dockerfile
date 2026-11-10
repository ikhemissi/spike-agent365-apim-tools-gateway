# Notes MCP server (server.py) on port 8080, as a non-root user.
# Built on Azure Linux and run on its distroless Python image (no shell, no package manager): both stages have the same
# interpreter (/usr/bin/python3), so the virtual environment built here runs as is.
FROM mcr.microsoft.com/azurelinux/base/python:3.12 AS build
WORKDIR /app
RUN python3 -m venv /app/.venv
COPY requirements.txt .
# pip is only needed to build: removing it keeps the runtime image free of its findings.
RUN /app/.venv/bin/pip install --no-cache-dir -r requirements.txt && /app/.venv/bin/pip uninstall --yes pip
COPY notes.py server.py caller_auth.py ./

# The nonroot variant runs as uid 65532.
FROM mcr.microsoft.com/azurelinux/distroless/python:3.12-nonroot
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
