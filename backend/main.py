from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import init_db
from routes import interview, feedback, auth, billing, overlay, speech
try:
    from routes import audio_capture
    _audio_capture_available = True
except ImportError:
    _audio_capture_available = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Interview Assistant API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://interview-assistant-hrar.onrender.com",
        "https://interview-assistant-frontend.onrender.com",
        "https://interview-assistant-frontend-gcgj.onrender.com",
        "null",  # Electron renderer (file:// origin)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(billing.router)
app.include_router(interview.router)
app.include_router(feedback.router)
app.include_router(overlay.router)
app.include_router(speech.router)
if _audio_capture_available:
    app.include_router(audio_capture.router)


@app.get("/")
async def root():
    return {"status": "ok", "service": "Interview Assistant API"}


@app.get("/health")
async def health():
    return {"status": "ok"}
