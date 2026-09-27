"""Error format for every endpoint (Schema §5.1): {"error": {"code", "message", "details"}}."""
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details or {}


def _body(code: str, message: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


async def api_error_handler(_req: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=_body(exc.code, exc.message, exc.details))


async def validation_handler(_req: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content=_body("VALIDATION_ERROR", "invalid request", {"errors": exc.errors()}))
