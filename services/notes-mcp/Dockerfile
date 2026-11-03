# Notes MCP server (server.py) on port 8080, as a non-root user.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY notes.py server.py caller_auth.py ./
RUN useradd --create-home --uid 10001 app
USER app
EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
