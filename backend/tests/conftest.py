import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from app.core.database import engine, get_db
from app.main import app


@pytest.fixture()
def client() -> TestClient:
    """A TestClient wired to a DB session that rolls back all changes on teardown.

    Uses the standard SQLAlchemy "join a session into an external transaction"
    recipe (outer transaction + SAVEPOINTs) so tests can freely call
    `session.commit()` (as the repositories do) while staying isolated from
    each other and from real dev data.
    """
    connection = engine.connect()
    outer_transaction = connection.begin()

    testing_session_local = sessionmaker(
        bind=connection, autoflush=False, autocommit=False, future=True
    )
    session = testing_session_local()

    nested = connection.begin_nested()

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, trans):  # noqa: ANN001
        nonlocal nested
        if not nested.is_active:
            nested = connection.begin_nested()

    def _override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        session.close()
        outer_transaction.rollback()
        connection.close()
