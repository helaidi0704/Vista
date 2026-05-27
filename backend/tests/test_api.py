"""
VISTA — Unit & Integration Tests
Tests all major API endpoints.
Run: cd backend && python -m pytest tests/ -v
"""
import pytest
from httpx import AsyncClient


# ═══════════════════════════════════════════════════════════════
# HEALTH CHECK TESTS
# ═══════════════════════════════════════════════════════════════

class TestHealth:
    """Test health check endpoint."""

    @pytest.mark.asyncio
    async def test_health_returns_200(self, client: AsyncClient):
        response = await client.get("/health")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_health_has_required_fields(self, client: AsyncClient):
        response = await client.get("/health")
        data = response.json()
        assert "status" in data
        assert "service" in data
        assert data["service"] == "vista-api"

    @pytest.mark.asyncio
    async def test_health_database_connected(self, client: AsyncClient):
        response = await client.get("/health")
        data = response.json()
        assert data["database"] == "connected"


# ═══════════════════════════════════════════════════════════════
# AUTHENTICATION TESTS
# ═══════════════════════════════════════════════════════════════

class TestAuth:
    """Test authentication endpoints."""

    @pytest.mark.asyncio
    async def test_register_new_user(self, client: AsyncClient):
        response = await client.post("/api/v1/auth/register", json={
            "email": "newuser@test.com",
            "password": "securepass123",
            "full_name": "New User",
        })
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["user"]["email"] == "newuser@test.com"
        assert data["user"]["full_name"] == "New User"

    @pytest.mark.asyncio
    async def test_register_with_organization(self, client: AsyncClient):
        response = await client.post("/api/v1/auth/register", json={
            "email": "orgadmin@test.com",
            "password": "securepass123",
            "full_name": "Org Admin",
            "organization_name": "Test Company",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["role"] == "admin"
        assert data["user"]["organization"] == "Test Company"

    @pytest.mark.asyncio
    async def test_register_duplicate_email_fails(self, client: AsyncClient):
        # Register first time
        await client.post("/api/v1/auth/register", json={
            "email": "duplicate@test.com",
            "password": "pass123",
            "full_name": "First User",
        })
        # Register again with same email
        response = await client.post("/api/v1/auth/register", json={
            "email": "duplicate@test.com",
            "password": "pass456",
            "full_name": "Second User",
        })
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_login_valid_credentials(self, client: AsyncClient):
        # Register
        await client.post("/api/v1/auth/register", json={
            "email": "logintest@test.com",
            "password": "mypassword",
            "full_name": "Login Test",
        })
        # Login
        response = await client.post("/api/v1/auth/login", json={
            "email": "logintest@test.com",
            "password": "mypassword",
        })
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    @pytest.mark.asyncio
    async def test_login_wrong_password_fails(self, client: AsyncClient):
        await client.post("/api/v1/auth/register", json={
            "email": "wrongpass@test.com",
            "password": "correctpass",
            "full_name": "Wrong Pass",
        })
        response = await client.post("/api/v1/auth/login", json={
            "email": "wrongpass@test.com",
            "password": "incorrectpass",
        })
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_protected_endpoint_without_token(self, client: AsyncClient):
        response = await client.get("/api/v1/auth/me")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_protected_endpoint_with_token(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/auth/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "user" in data
        assert "organization" in data


# ═══════════════════════════════════════════════════════════════
# DATASET TESTS
# ═══════════════════════════════════════════════════════════════

class TestDatasets:
    """Test dataset CRUD endpoints."""

    @pytest.mark.asyncio
    async def test_list_datasets_empty(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/datasets", headers=auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_create_dataset(self, client: AsyncClient, auth_headers):
        response = await client.post("/api/v1/datasets", json={
            "name": "Test Dataset",
            "description": "A test dataset for unit tests",
            "defect_classes": ["crack", "porosity", "OK"],
        }, headers=auth_headers)
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Test Dataset"
        assert data["defect_classes"] == ["crack", "porosity", "OK"]
        assert data["image_count"] == 0

    @pytest.mark.asyncio
    async def test_create_dataset_without_name_fails(self, client: AsyncClient, auth_headers):
        response = await client.post("/api/v1/datasets", json={
            "description": "No name",
        }, headers=auth_headers)
        assert response.status_code == 422


# ═══════════════════════════════════════════════════════════════
# MODEL TESTS
# ═══════════════════════════════════════════════════════════════

class TestModels:
    """Test model endpoints."""

    @pytest.mark.asyncio
    async def test_list_models(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/models", headers=auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_get_nonexistent_model(self, client: AsyncClient):
        response = await client.get("/api/v1/models/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 404


# ═══════════════════════════════════════════════════════════════
# METRICS & MONITORING TESTS
# ═══════════════════════════════════════════════════════════════

class TestMetrics:
    """Test Prometheus metrics endpoint."""

    @pytest.mark.asyncio
    async def test_metrics_returns_prometheus_format(self, client: AsyncClient):
        response = await client.get("/api/v1/metrics")
        assert response.status_code == 200
        text = response.text
        assert "vista_models_total" in text
        assert "vista_images_total" in text
        assert "vista_users_total" in text

    @pytest.mark.asyncio
    async def test_metrics_has_training_jobs(self, client: AsyncClient):
        response = await client.get("/api/v1/metrics")
        text = response.text
        assert "vista_training_jobs" in text


# ═══════════════════════════════════════════════════════════════
# DASHBOARD TESTS
# ═══════════════════════════════════════════════════════════════

class TestDashboard:
    """Test live dashboard endpoint."""

    @pytest.mark.asyncio
    async def test_live_dashboard(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/dashboard/live", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "today" in data
        assert "last_hour" in data
        assert "performance" in data
        assert "weekly_trend" in data
        assert len(data["weekly_trend"]) == 7

    @pytest.mark.asyncio
    async def test_dashboard_has_pass_rate(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/dashboard/live", headers=auth_headers)
        data = response.json()
        assert "pass_rate" in data["today"]
        assert "defect_rate" in data["today"]


# ═══════════════════════════════════════════════════════════════
# EXPORT TESTS
# ═══════════════════════════════════════════════════════════════

class TestExport:
    """Test CSV export endpoints."""

    @pytest.mark.asyncio
    async def test_export_dashboard_csv(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/export/dashboard?days=7", headers=auth_headers)
        assert response.status_code == 200
        assert "text/csv" in response.headers.get("content-type", "")
        lines = response.text.strip().split("\n")
        assert len(lines) >= 2  # Header + at least 1 data row
        assert "date" in lines[0]
        assert "inspections" in lines[0]


# ═══════════════════════════════════════════════════════════════
# COMPARISON TESTS
# ═══════════════════════════════════════════════════════════════

class TestComparison:
    """Test image comparison endpoint."""

    @pytest.mark.asyncio
    async def test_compare_requires_two_images(self, client: AsyncClient):
        response = await client.post("/api/v1/compare/images")
        assert response.status_code == 422


# ═══════════════════════════════════════════════════════════════
# UI CONFIG TESTS (Role-based)
# ═══════════════════════════════════════════════════════════════

class TestUIConfig:
    """Test role-based UI configuration."""

    @pytest.mark.asyncio
    async def test_ui_config_returns_role(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/ui/config", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "ui" in data
        assert "role" in data["ui"]
        assert "nav" in data["ui"]
        assert "features" in data["ui"]

    @pytest.mark.asyncio
    async def test_admin_has_all_nav_items(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/ui/config", headers=auth_headers)
        data = response.json()
        nav = data["ui"]["nav"]
        assert "home" in nav
        assert "training" in nav
        assert "deployment" in nav


# ═══════════════════════════════════════════════════════════════
# WEBHOOK TESTS
# ═══════════════════════════════════════════════════════════════

class TestWebhooks:
    """Test webhook registration."""

    @pytest.mark.asyncio
    async def test_create_webhook(self, client: AsyncClient, auth_headers):
        response = await client.post(
            "/api/v1/webhooks?url=https://hooks.slack.com/test&event=defect_detected&name=Test+Hook",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["url"] == "https://hooks.slack.com/test"
        assert data["event"] == "defect_detected"


# ═══════════════════════════════════════════════════════════════
# AUDIT LOG TESTS
# ═══════════════════════════════════════════════════════════════

class TestAuditLog:
    """Test audit log endpoints."""

    @pytest.mark.asyncio
    async def test_create_audit_entry(self, client: AsyncClient, auth_headers):
        response = await client.post(
            "/api/v1/audit-log?action=test.action&resource_type=test&resource_id=123",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["action"] == "test.action"

    @pytest.mark.asyncio
    async def test_get_audit_log(self, client: AsyncClient, auth_headers):
        # Create an entry first
        await client.post(
            "/api/v1/audit-log?action=test.read&resource_type=test",
            headers=auth_headers
        )
        # Read it
        response = await client.get("/api/v1/audit-log?days=1", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "logs" in data


# ═══════════════════════════════════════════════════════════════
# EMAIL NOTIFICATION TESTS
# ═══════════════════════════════════════════════════════════════

class TestEmailNotifications:
    """Test email notification endpoints."""

    @pytest.mark.asyncio
    async def test_preview_daily_report(self, client: AsyncClient, auth_headers):
        response = await client.get(
            "/api/v1/notifications/email/preview-daily",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "no_config"
        assert "body_preview" in data


# ═══════════════════════════════════════════════════════════════
# EXPORT FORMAT TESTS
# ═══════════════════════════════════════════════════════════════

class TestExportFormats:
    """Test model export format listing."""

    @pytest.mark.asyncio
    async def test_nonexistent_model_export(self, client: AsyncClient):
        response = await client.get(
            "/api/v1/models/00000000-0000-0000-0000-000000000000/export-formats"
        )
        assert response.status_code == 404
