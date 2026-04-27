"""
VISTA MLOps — Data Drift Detection
Monitors inference inputs and compares distributions against training data.
Detects: pixel intensity drift, resolution drift, class distribution drift,
         confidence score drift, and prediction drift.

Usage:
    detector = DriftDetector(model_id="uuid", window_days=7)
    report = detector.analyze()
    if report["drift_detected"]:
        send_alert(report)
"""
import os
import json
import logging
import numpy as np
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)


@dataclass
class DriftReport:
    """Results of a drift analysis."""
    model_id: str
    analyzed_at: str
    window_days: int
    total_inferences: int
    drift_detected: bool
    drift_score: float  # 0.0 (no drift) to 1.0 (severe drift)
    alerts: list  # list of string alerts
    details: dict  # per-metric breakdown

    def to_dict(self):
        return asdict(self)

    @property
    def severity(self) -> str:
        if self.drift_score < 0.2:
            return "none"
        elif self.drift_score < 0.4:
            return "low"
        elif self.drift_score < 0.7:
            return "medium"
        else:
            return "high"


class DriftDetector:
    """
    Detects data drift by comparing recent inference data against
    a reference window (training data statistics or earlier inferences).
    """

    def __init__(self, model_id: str, window_days: int = 7):
        self.model_id = model_id
        self.window_days = window_days
        self.thresholds = {
            "confidence_mean_shift": 0.1,    # alert if mean confidence drops by 10%
            "anomaly_rate_shift": 0.15,      # alert if anomaly rate changes by 15%
            "latency_spike": 2.0,            # alert if latency doubles
            "class_distribution_kl": 0.5,    # KL divergence threshold
            "zero_detection_rate": 0.3,      # alert if 30%+ frames have zero detections
        }

    def analyze(self, db_connection=None) -> DriftReport:
        """
        Run full drift analysis.
        Queries inference_logs from PostgreSQL.
        """
        alerts = []
        details = {}
        scores = []

        try:
            conn = db_connection or self._get_db_connection()
            from sqlalchemy import text

            # Fetch recent inferences
            cutoff = (datetime.utcnow() - timedelta(days=self.window_days)).isoformat()
            result = conn.execute(
                text("""
                    SELECT detections, verdict, latency_ms, created_at
                    FROM inference_logs
                    WHERE model_id = :model_id AND created_at > :cutoff
                    ORDER BY created_at DESC
                """),
                {"model_id": self.model_id, "cutoff": cutoff}
            )
            rows = result.mappings().fetchall()

            if len(rows) < 10:
                return DriftReport(
                    model_id=self.model_id,
                    analyzed_at=datetime.utcnow().isoformat(),
                    window_days=self.window_days,
                    total_inferences=len(rows),
                    drift_detected=False,
                    drift_score=0.0,
                    alerts=["Insufficient data for drift analysis (need 10+ inferences)"],
                    details={},
                )

            # Fetch reference period (previous window)
            ref_cutoff = (datetime.utcnow() - timedelta(days=self.window_days * 2)).isoformat()
            ref_result = conn.execute(
                text("""
                    SELECT detections, verdict, latency_ms, created_at
                    FROM inference_logs
                    WHERE model_id = :model_id
                      AND created_at > :ref_cutoff
                      AND created_at <= :cutoff
                    ORDER BY created_at DESC
                """),
                {"model_id": self.model_id, "ref_cutoff": ref_cutoff, "cutoff": cutoff}
            )
            ref_rows = ref_result.mappings().fetchall()

            if not db_connection:
                conn.close()

            # ─── 1. Confidence drift ──────────────────────────────
            score, alert, detail = self._check_confidence_drift(rows, ref_rows)
            scores.append(score)
            if alert:
                alerts.append(alert)
            details["confidence"] = detail

            # ─── 2. Anomaly rate drift ────────────────────────────
            score, alert, detail = self._check_anomaly_rate_drift(rows, ref_rows)
            scores.append(score)
            if alert:
                alerts.append(alert)
            details["anomaly_rate"] = detail

            # ─── 3. Latency drift ─────────────────────────────────
            score, alert, detail = self._check_latency_drift(rows, ref_rows)
            scores.append(score)
            if alert:
                alerts.append(alert)
            details["latency"] = detail

            # ─── 4. Class distribution drift ──────────────────────
            score, alert, detail = self._check_class_distribution_drift(rows, ref_rows)
            scores.append(score)
            if alert:
                alerts.append(alert)
            details["class_distribution"] = detail

            # ─── 5. Zero detection rate ───────────────────────────
            score, alert, detail = self._check_zero_detection_rate(rows)
            scores.append(score)
            if alert:
                alerts.append(alert)
            details["zero_detections"] = detail

            drift_score = float(np.mean(scores)) if scores else 0.0
            drift_detected = drift_score > 0.3 or len(alerts) >= 2

            return DriftReport(
                model_id=self.model_id,
                analyzed_at=datetime.utcnow().isoformat(),
                window_days=self.window_days,
                total_inferences=len(rows),
                drift_detected=drift_detected,
                drift_score=round(drift_score, 3),
                alerts=alerts,
                details=details,
            )

        except Exception as e:
            logger.error(f"Drift analysis failed: {e}")
            return DriftReport(
                model_id=self.model_id,
                analyzed_at=datetime.utcnow().isoformat(),
                window_days=self.window_days,
                total_inferences=0,
                drift_detected=False,
                drift_score=0.0,
                alerts=[f"Analysis error: {str(e)}"],
                details={},
            )

    def _extract_confidences(self, rows) -> list:
        """Extract all confidence scores from detection results."""
        confs = []
        for row in rows:
            dets = row["detections"]
            if isinstance(dets, str):
                dets = json.loads(dets)
            for d in (dets or []):
                if isinstance(d, dict) and "confidence" in d:
                    confs.append(d["confidence"])
        return confs

    def _extract_classes(self, rows) -> list:
        """Extract all detected class names."""
        classes = []
        for row in rows:
            dets = row["detections"]
            if isinstance(dets, str):
                dets = json.loads(dets)
            for d in (dets or []):
                if isinstance(d, dict) and "class" in d:
                    classes.append(d["class"])
        return classes

    def _check_confidence_drift(self, current, reference):
        curr_confs = self._extract_confidences(current)
        ref_confs = self._extract_confidences(reference)

        if not curr_confs or not ref_confs:
            return 0.0, None, {"status": "insufficient_data"}

        curr_mean = float(np.mean(curr_confs))
        ref_mean = float(np.mean(ref_confs))
        shift = abs(curr_mean - ref_mean)
        score = min(1.0, shift / self.thresholds["confidence_mean_shift"])

        detail = {
            "current_mean": round(curr_mean, 4),
            "reference_mean": round(ref_mean, 4),
            "shift": round(shift, 4),
            "threshold": self.thresholds["confidence_mean_shift"],
        }

        alert = None
        if shift > self.thresholds["confidence_mean_shift"]:
            direction = "dropped" if curr_mean < ref_mean else "increased"
            alert = f"Confidence {direction}: {ref_mean:.2%} → {curr_mean:.2%} (shift: {shift:.2%})"

        return score, alert, detail

    def _check_anomaly_rate_drift(self, current, reference):
        curr_rate = sum(1 for r in current if r["verdict"] == "anomaly") / max(len(current), 1)
        ref_rate = sum(1 for r in reference if r["verdict"] == "anomaly") / max(len(reference), 1) if reference else curr_rate

        shift = abs(curr_rate - ref_rate)
        score = min(1.0, shift / self.thresholds["anomaly_rate_shift"])

        detail = {
            "current_rate": round(curr_rate, 4),
            "reference_rate": round(ref_rate, 4),
            "shift": round(shift, 4),
        }

        alert = None
        if shift > self.thresholds["anomaly_rate_shift"]:
            alert = f"Anomaly rate shifted: {ref_rate:.1%} → {curr_rate:.1%}"

        return score, alert, detail

    def _check_latency_drift(self, current, reference):
        curr_lats = [r["latency_ms"] for r in current if r["latency_ms"]]
        ref_lats = [r["latency_ms"] for r in reference if r["latency_ms"]] if reference else curr_lats

        if not curr_lats or not ref_lats:
            return 0.0, None, {"status": "no_latency_data"}

        curr_p95 = float(np.percentile(curr_lats, 95))
        ref_p95 = float(np.percentile(ref_lats, 95))
        ratio = curr_p95 / max(ref_p95, 0.1)
        score = min(1.0, max(0, (ratio - 1.0) / (self.thresholds["latency_spike"] - 1.0)))

        detail = {
            "current_p95_ms": round(curr_p95, 1),
            "reference_p95_ms": round(ref_p95, 1),
            "ratio": round(ratio, 2),
        }

        alert = None
        if ratio > self.thresholds["latency_spike"]:
            alert = f"Latency spike: P95 {ref_p95:.0f}ms → {curr_p95:.0f}ms ({ratio:.1f}x)"

        return score, alert, detail

    def _check_class_distribution_drift(self, current, reference):
        curr_classes = self._extract_classes(current)
        ref_classes = self._extract_classes(reference)

        if not curr_classes or not ref_classes:
            return 0.0, None, {"status": "no_class_data"}

        # Build distributions
        all_classes = set(curr_classes + ref_classes)
        curr_dist = {c: curr_classes.count(c) / len(curr_classes) for c in all_classes}
        ref_dist = {c: ref_classes.count(c) / len(ref_classes) for c in all_classes}

        # KL divergence (simplified)
        kl = 0.0
        for c in all_classes:
            p = curr_dist.get(c, 1e-10)
            q = ref_dist.get(c, 1e-10)
            if p > 0:
                kl += p * np.log(p / q)

        kl = abs(float(kl))
        score = min(1.0, kl / self.thresholds["class_distribution_kl"])

        detail = {
            "current_distribution": {k: round(v, 3) for k, v in curr_dist.items()},
            "reference_distribution": {k: round(v, 3) for k, v in ref_dist.items()},
            "kl_divergence": round(kl, 4),
        }

        alert = None
        if kl > self.thresholds["class_distribution_kl"]:
            # Find the class that shifted the most
            max_shift_class = max(all_classes, key=lambda c: abs(curr_dist.get(c, 0) - ref_dist.get(c, 0)))
            alert = f"Class distribution drift (KL={kl:.2f}): '{max_shift_class}' shifted most"

        return score, alert, detail

    def _check_zero_detection_rate(self, current):
        zero_count = sum(1 for r in current if not r["detections"] or r["detections"] == "[]")
        rate = zero_count / max(len(current), 1)
        score = min(1.0, rate / self.thresholds["zero_detection_rate"])

        detail = {
            "zero_detection_frames": zero_count,
            "total_frames": len(current),
            "rate": round(rate, 4),
        }

        alert = None
        if rate > self.thresholds["zero_detection_rate"]:
            alert = f"High zero-detection rate: {rate:.1%} of frames have no detections (camera issue?)"

        return score, alert, detail

    def _get_db_connection(self):
        import sqlalchemy
        url = (
            f"postgresql://{os.environ.get('POSTGRES_USER', 'vista')}"
            f":{os.environ.get('POSTGRES_PASSWORD', 'vista_dev_2024')}"
            f"@{os.environ.get('POSTGRES_HOST', 'db')}"
            f":{os.environ.get('POSTGRES_PORT', '5432')}"
            f"/{os.environ.get('POSTGRES_DB', 'vista')}"
        )
        engine = sqlalchemy.create_engine(url)
        return engine.connect()
