"""Database schema and connection helpers for the campus event demo.

This is a fictional sample project written for the Archify showcase, so the
storage layer is a single local SQLite file and no real student data exists.
"""

import sqlite3

DATABASE_PATH = "campus_events.db"


def connect():
    """Open a connection whose rows can be read by column name."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn):
    """Create the four tables the demo needs, if they do not exist."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS students (
            student_id INTEGER PRIMARY KEY,
            full_name  TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS events (
            event_id        INTEGER PRIMARY KEY,
            title           TEXT NOT NULL,
            capacity        INTEGER NOT NULL,
            seats_remaining INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS registrations (
            registration_id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id        INTEGER NOT NULL REFERENCES events(event_id),
            student_id      INTEGER NOT NULL REFERENCES students(student_id),
            standing        TEXT NOT NULL,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (event_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id      INTEGER NOT NULL REFERENCES students(student_id),
            message         TEXT NOT NULL,
            sent_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )
    conn.commit()
