"""Confirmation messages recorded in the notifications table.

The demo writes the message a student would receive instead of calling a
real mail provider, so the whole flow stays runnable offline.
"""

def send_confirmation(conn, student_id, event_title, standing):
    """Record the message that matches the final standing of the entry."""
    if standing == "confirmed":
        text = "You are registered for '{}'. See you there!".format(event_title)
    else:
        text = "You are on the waitlist for '{}'.".format(event_title)

    conn.execute(
        "INSERT INTO notifications (student_id, message) VALUES (?, ?)",
        (student_id, text),
    )
    conn.commit()
