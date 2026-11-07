import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import admin, auth, customer, live, orders, outlets, party_orders
from app.core.config import get_settings
from app.services.escalation import escalation_loop

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    escalation_task = asyncio.create_task(escalation_loop())
    try:
        yield
    finally:
        escalation_task.cancel()
        with suppress(asyncio.CancelledError):
            await escalation_task


app = FastAPI(title="Hyderabad Biryani API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(outlets.router)
app.include_router(orders.router)
app.include_router(orders.kitchen_router)
app.include_router(live.router)
app.include_router(admin.router)
app.include_router(party_orders.router)
app.include_router(customer.router)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.status_code, "message": message}},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": 422,
                "message": "Request validation failed.",
                "details": [
                    {
                        "field": ".".join(str(part) for part in error["loc"]),
                        "message": error["msg"],
                    }
                    for error in exc.errors()
                ],
            }
        },
    )


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
