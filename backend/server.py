"""
CoFoundr Backend API — application composition.

This module only assembles the app: middleware, lifespan, and the routers. Endpoint
logic lives in `routers/`, the Socket.io server in `realtime`, shared guards in
`access` / `moderation` / `entitlements`. Nothing under `routers/` imports this
module, so there are no cycles.

Routers, in the order they are mounted:
    premium, account         payments, settings, moderation
    auth_routes              register / login / OAuth / session
    profiles                 onboarding, photos, profile read & edit
    uploads                  signed URLs for images going to object storage
    notifications           push token registration
    verification            email, GitHub and website proofs
    discovery                swipe feed, swipes, matches
    chat                     message history, read receipts, sending
    calls                    WebRTC ICE configuration (signalling lives in realtime)
    deal_rooms               matched-pair workspace (Premium)
    projects                 cofounder opportunity postings
    ai_routes                compatibility narrative, deep report, ideas, copilot
"""
import os
from contextlib import asynccontextmanager

import socketio
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from account import router as account_router
from database import create_indexes, run_migrations
from premium import router as premium_router, webhook_router as premium_webhook_router
from realtime import sio
from routers import (
    ai_routes,
    auth_routes,
    calls,
    chat,
    deal_rooms,
    discovery,
    profiles,
    projects,
    uploads,
    notifications,
    verification,
)

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_indexes()
    print("✅ Database indexes created")
    await run_migrations()
    yield
    print("Shutting down...")


app = FastAPI(title="CoFoundr API", lifespan=lifespan)

# Allowed origins come from the environment. `*` stays the default for local
# development, but it is incompatible with credentialed requests — browsers
# reject that combination — so credentials are only enabled for an explicit list.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]
_allow_any_origin = "*" in ALLOWED_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=not _allow_any_origin,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Payments and account management
app.include_router(premium_router)
app.include_router(premium_webhook_router)
app.include_router(account_router)

# Product domains
app.include_router(auth_routes.router)
app.include_router(profiles.router)
app.include_router(uploads.router)
app.include_router(notifications.router)
app.include_router(verification.router)
app.include_router(discovery.router)
app.include_router(chat.router)
app.include_router(calls.router)
app.include_router(deal_rooms.router)
app.include_router(projects.router)
app.include_router(ai_routes.router)

# Socket.io wraps the FastAPI app; this is the ASGI callable to serve.
socket_app = socketio.ASGIApp(sio, app)


# ===== HEALTH CHECK =====

@app.get("/api/health")
async def health():
    return {"status": "healthy", "service": "CoFoundr API"}


@app.get("/api")
async def root():
    return {"message": "CoFoundr API - Find your perfect business partner"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:socket_app", host="0.0.0.0", port=8001, reload=True)
