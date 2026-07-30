# CoFound

Find the person you'll build your next company with. An Expo (iOS / Android / web)
app with a FastAPI + MongoDB backend and an AI-assisted matching engine.

Product spec: [`memory/PRD.md`](memory/PRD.md).

## Layout

```
backend/     FastAPI API, MongoDB (Motor), Socket.io, Stripe, Claude
frontend/    Expo app (expo-router) for iOS, Android and web
```

## Running it

### Backend

```sh
cd backend
pip install -r requirements.txt
cp .env.example .env          # then fill in SECRET_KEY and, optionally, EMERGENT_LLM_KEY
uvicorn server:socket_app --host 0.0.0.0 --port 8001 --reload
```

Needs a MongoDB on `MONGO_URL` (defaults to `mongodb://localhost:27017`).
Without `EMERGENT_LLM_KEY` everything still works — compatibility scoring is local
and deterministic; only the AI narrative, deep report, business ideas and copilot
are unavailable.

Seed some founders to swipe on:

```sh
python seed_profiles.py
```

### Frontend

```sh
cd frontend
yarn install
cp .env.example .env          # set EXPO_PUBLIC_BACKEND_URL
yarn web                      # or: yarn start, then open on a device
```

**On a physical device**, `localhost` refers to the phone. Point
`EXPO_PUBLIC_BACKEND_URL` at your machine's LAN address (`http://192.168.x.x:8001`)
or the socket and API calls will silently fail to connect.

## Native builds

`ios/` and `android/` are **generated** from `app.json` by config plugins
(continuous native generation) and are gitignored. Don't edit them by hand.

```sh
yarn prebuild                 # regenerate native projects locally
npx eas build --profile preview --platform ios
```

Permissions are declared in `app.json`. The app only reads the photo library, so
camera and microphone are explicitly blocked — keep that surface minimal, since
unused permission prompts are an App Store review problem. After changing a plugin,
verify what actually landed:

```sh
yarn prebuild && grep -A1 UsageDescription ios/*/Info.plist
```

## Tests

```sh
cd backend && pytest tests -o addopts='' -q     # unit suites, no services needed
cd frontend && yarn typecheck && yarn lint
```

The suites under `backend/tests` that talk to a deployed backend are skipped unless
`EXPO_PUBLIC_BACKEND_URL` is set. CI runs the same three commands.

## How matching works

Compatibility is computed in `backend/compatibility.py`: six weighted dimensions,
each over the full 0–100 range, resolved through the skill taxonomy in
`backend/skills_taxonomy.py`. It is deterministic, free, and spans a real spread —
which is why it, and not the LLM, produces the number.

Claude is used where an algorithm can't help: writing the "why you two" narrative
for a pair (on demand, cached), the premium deep report with founder-risk detection,
business ideas, deal-room roadmaps and the copilot.

The `personality_score` dimension is fed by the founder assessment in
`backend/personality.py` — ten statements on a 1–5 scale, scored into five traits.
Four of them (risk appetite, pace, structure, directness) reward *alignment*; the
fifth, builder-versus-seller orientation, rewards *difference*. Founders who haven't
taken it fall back to seniority proximity, so the score always exists but taking the
assessment measurably sharpens it.

## Deal rooms

A matched pair's workspace (Premium). Six tabs: overview, tasks, an AI-generated
90-day roadmap, documents, decisions and equity.

Documents are **links**, not uploads — there is no object storage here, and inlining
files in a document that already holds base64 photos would run into MongoDB's 16 MB
limit. Decisions and equity splits both require sign-off from both founders, and a
split is rejected unless it totals 100% across exactly the two participants; revising
one withdraws any agreement already given.
