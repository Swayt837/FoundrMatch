FROM python:3.11-slim

# Serve `server:socket_app`, not `server:app`: the former is the Socket.io wrapper
# around the latter, and picking the wrong one silently disables chat, match
# notifications and call signalling while every HTTP route keeps working.

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so a code-only change reuses the cached layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The platform assigns the port; 8001 is only the local default.
ENV PORT=8001
EXPOSE 8001

CMD uvicorn server:socket_app --host 0.0.0.0 --port ${PORT}
