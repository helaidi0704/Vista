"""
VISTA MLOps — Alerting & Notifications
Sends alerts when drift, performance degradation, or system issues are detected.
Supports: Slack webhook, email (SMTP), and in-app notifications (Redis Pub/Sub).
"""
import os
import json
import logging
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)


@dataclass
class Alert:
    severity: str       # "info", "warning", "critical"
    source: str         # "drift_detector", "training", "inference", "system"
    title: str
    message: str
    model_id: Optional[str] = None
    metadata: Optional[dict] = None
    timestamp: Optional[str] = None

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat()


class AlertManager:
    """
    Central alert dispatcher.

    Usage:
        alerter = AlertManager()
        alerter.send(Alert(
            severity="warning",
            source="drift_detector",
            title="Data drift detected",
            message="Confidence dropped 12% on YOLOv8_Detect_v3",
            model_id="uuid"
        ))
    """

    def __init__(self):
        self.slack_webhook = os.environ.get("SLACK_WEBHOOK_URL")
        self.smtp_host = os.environ.get("SMTP_HOST")
        self.smtp_to = os.environ.get("ALERT_EMAIL_TO")
        self.redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
        self.channels = []

        if self.slack_webhook:
            self.channels.append("slack")
        if self.smtp_host and self.smtp_to:
            self.channels.append("email")
        self.channels.append("redis")  # always available

    def send(self, alert: Alert):
        """Dispatch alert to all configured channels."""
        logger.info(
            f"ALERT [{alert.severity.upper()}] {alert.source}: {alert.title}"
        )

        if "redis" in self.channels:
            self._send_redis(alert)
        if "slack" in self.channels:
            self._send_slack(alert)
        if "email" in self.channels:
            self._send_email(alert)

        # Log to DB
        self._log_to_db(alert)

    def _send_redis(self, alert: Alert):
        """Publish alert to Redis Pub/Sub for real-time in-app notifications."""
        try:
            import redis
            r = redis.from_url(self.redis_url)
            r.publish("vista:alerts", json.dumps(asdict(alert)))
            # Also store in a list for history
            r.lpush("vista:alert_history", json.dumps(asdict(alert)))
            r.ltrim("vista:alert_history", 0, 99)  # keep last 100
        except Exception as e:
            logger.warning(f"Redis alert failed: {e}")

    def _send_slack(self, alert: Alert):
        """Send alert to Slack via webhook."""
        try:
            import urllib.request

            emoji = {"info": "ℹ️", "warning": "⚠️", "critical": "🚨"}.get(
                alert.severity, "📋"
            )
            color = {"info": "#3B82F6", "warning": "#EAB308", "critical": "#EF4444"}.get(
                alert.severity, "#6B7280"
            )

            payload = {
                "attachments": [{
                    "color": color,
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": (
                                    f"{emoji} *VISTA — {alert.title}*\n"
                                    f"{alert.message}\n"
                                    f"_Source: {alert.source} · "
                                    f"{alert.timestamp}_"
                                ),
                            },
                        }
                    ],
                }],
            }

            req = urllib.request.Request(
                self.slack_webhook,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
            logger.info("Slack alert sent")
        except Exception as e:
            logger.warning(f"Slack alert failed: {e}")

    def _send_email(self, alert: Alert):
        """Send alert via SMTP email."""
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"[VISTA {alert.severity.upper()}] {alert.title}"
            msg["From"] = os.environ.get("SMTP_FROM", "vista@localhost")
            msg["To"] = self.smtp_to

            body = f"""
            <h2>VISTA Alert — {alert.title}</h2>
            <p><strong>Severity:</strong> {alert.severity}</p>
            <p><strong>Source:</strong> {alert.source}</p>
            <p><strong>Message:</strong> {alert.message}</p>
            <p><strong>Time:</strong> {alert.timestamp}</p>
            {f'<p><strong>Model:</strong> {alert.model_id}</p>' if alert.model_id else ''}
            """
            msg.attach(MIMEText(body, "html"))

            smtp_port = int(os.environ.get("SMTP_PORT", 587))
            with smtplib.SMTP(self.smtp_host, smtp_port) as server:
                if os.environ.get("SMTP_TLS", "true").lower() == "true":
                    server.starttls()
                smtp_user = os.environ.get("SMTP_USER")
                smtp_pass = os.environ.get("SMTP_PASSWORD")
                if smtp_user and smtp_pass:
                    server.login(smtp_user, smtp_pass)
                server.sendmail(msg["From"], [self.smtp_to], msg.as_string())

            logger.info(f"Email alert sent to {self.smtp_to}")
        except Exception as e:
            logger.warning(f"Email alert failed: {e}")

    def _log_to_db(self, alert: Alert):
        """Persist alert in PostgreSQL for audit trail."""
        try:
            import sqlalchemy
            url = (
                f"postgresql://{os.environ.get('POSTGRES_USER', 'vista')}"
                f":{os.environ.get('POSTGRES_PASSWORD', 'vista_dev_2024')}"
                f"@{os.environ.get('POSTGRES_HOST', 'db')}"
                f":{os.environ.get('POSTGRES_PORT', '5432')}"
                f"/{os.environ.get('POSTGRES_DB', 'vista')}"
            )
            engine = sqlalchemy.create_engine(url)
            with engine.connect() as conn:
                conn.execute(
                    sqlalchemy.text("""
                        INSERT INTO alerts (severity, source, title, message, model_id, metadata, created_at)
                        VALUES (:sev, :src, :title, :msg, :model, :meta, :ts)
                    """),
                    {
                        "sev": alert.severity,
                        "src": alert.source,
                        "title": alert.title,
                        "msg": alert.message,
                        "model": alert.model_id,
                        "meta": json.dumps(alert.metadata or {}),
                        "ts": alert.timestamp,
                    }
                )
                conn.commit()
        except Exception:
            pass  # alerts table might not exist yet


def check_and_alert(model_id: str, window_days: int = 7):
    """
    Convenience function: run drift detection and send alerts if needed.
    Designed to be called as a periodic Celery task.
    """
    from mlops.drift_detector import DriftDetector

    detector = DriftDetector(model_id=model_id, window_days=window_days)
    report = detector.analyze()
    alerter = AlertManager()

    if report.drift_detected:
        alerter.send(Alert(
            severity="warning" if report.drift_score < 0.7 else "critical",
            source="drift_detector",
            title=f"Data drift detected (score: {report.drift_score:.2f})",
            message="\n".join(report.alerts),
            model_id=model_id,
            metadata=report.details,
        ))

    return report.to_dict()
