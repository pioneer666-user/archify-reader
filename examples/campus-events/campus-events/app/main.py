"""HTTP entry point for the campus event registration demo.

Run with: uvicorn app.main:app  (fictional sample, no real data).
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app import service
from app.models import connect

app = FastAPI(title="Campus Event Registration")


class RegistrationRequest(BaseModel):
    student_id: int


@app.post("/events/{event_id}/registrations")
def register(event_id: int, body: RegistrationRequest):
    """Register a student for an event and report the resulting standing."""
    conn = connect()
    try:
        result = service.register_student(conn, event_id, body.student_id)
    except service.RegistrationRejected as rejected:
        raise HTTPException(status_code=403, detail=rejected.reason)
    finally:
        conn.close()
    return result
