"""Registration business rules: eligibility, capacity, and record creation.

One call to :func:`register_student` runs the whole attempt for a single
student. The rules are intentionally small so the diagram stays readable.
"""

import sqlite3

from app import notify


class RegistrationRejected(Exception):
    """Raised when a student may not register; carries a student-facing reason."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def register_student(conn, event_id, student_id):
    """Run one registration attempt and return the resulting standing."""
    _fail_if_not_eligible(conn, event_id, student_id)

    try:
        conn.execute("BEGIN IMMEDIATE")
        event = _lock_event(conn, event_id)
        if event["seats_remaining"] > 0:
            standing = "confirmed"
            conn.execute(
                "UPDATE events SET seats_remaining = seats_remaining - 1 "
                "WHERE event_id = ?",
                (event_id,),
            )
        else:
            standing = "waitlisted"

        cursor = conn.execute(
            "INSERT INTO registrations (event_id, student_id, standing) "
            "VALUES (?, ?, ?)",
            (event_id, student_id, standing),
        )
        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        raise

    try:
        notify.send_confirmation(conn, student_id, event["title"], standing)
    except sqlite3.Error:
        # The registration row is already committed; a broken notification
        # must not turn a saved registration into an error for the student.
        pass

    return {"registration_id": cursor.lastrowid, "standing": standing}


def _fail_if_not_eligible(conn, event_id, student_id):
    """Reject before any write when the student may not register at all."""
    student = conn.execute(
        "SELECT status FROM students WHERE student_id = ?", (student_id,)
    ).fetchone()
    if student is None:
        raise RegistrationRejected("Unknown student account.")
    if student["status"] != "active":
        raise RegistrationRejected("This account cannot register for events.")

    duplicate = conn.execute(
        "SELECT 1 FROM registrations WHERE event_id = ? AND student_id = ?",
        (event_id, student_id),
    ).fetchone()
    if duplicate is not None:
        raise RegistrationRejected("You are already registered for this event.")


def _lock_event(conn, event_id):
    """Read the event row inside the transaction so the seat count is stable."""
    event = conn.execute(
        "SELECT event_id, title, seats_remaining FROM events WHERE event_id = ?",
        (event_id,),
    ).fetchone()
    if event is None:
        raise RegistrationRejected("This event does not exist.")
    return event
