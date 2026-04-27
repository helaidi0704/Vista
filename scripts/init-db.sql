-- ═══════════════════════════════════════════════════════════════════════════════
-- VISTA — Database Schema (PostgreSQL 15)
-- 8 tables couvrant tout le cycle: users → datasets → images → annotations
--                                  → training_jobs → ml_models → inference_logs → deployments
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. Users ────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255),
    role            VARCHAR(50) NOT NULL DEFAULT 'client'
                    CHECK (role IN ('client', 'engineer', 'admin')),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. Datasets ─────────────────────────────────────────────────────────────
CREATE TABLE datasets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    image_count     INTEGER DEFAULT 0,
    annotated_count INTEGER DEFAULT 0,
    defect_classes  JSONB DEFAULT '[]'::jsonb,
    split_config    JSONB DEFAULT '{"train": 0.7, "val": 0.2, "test": 0.1}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 3. Images ───────────────────────────────────────────────────────────────
CREATE TABLE images (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id      UUID REFERENCES datasets(id) ON DELETE CASCADE,
    filename        VARCHAR(512) NOT NULL,
    storage_path    VARCHAR(1024) NOT NULL,
    thumbnail_path  VARCHAR(1024),
    width           INTEGER,
    height          INTEGER,
    format          VARCHAR(10) DEFAULT 'jpg',
    file_size_bytes BIGINT,
    split           VARCHAR(10) DEFAULT 'train'
                    CHECK (split IN ('train', 'val', 'test')),
    metadata        JSONB DEFAULT '{}'::jsonb,
    uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_images_dataset ON images(dataset_id);
CREATE INDEX idx_images_split ON images(dataset_id, split);

-- ─── 4. Annotations ──────────────────────────────────────────────────────────
CREATE TABLE annotations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    image_id        UUID REFERENCES images(id) ON DELETE CASCADE,
    author_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    shape           VARCHAR(20) NOT NULL DEFAULT 'bbox'
                    CHECK (shape IN ('bbox', 'polygon', 'freehand', 'mask')),
    coordinates     JSONB NOT NULL,
    -- bbox: {"nx": 0.1, "ny": 0.2, "nw": 0.3, "nh": 0.15}
    -- polygon: {"points": [[x1,y1], [x2,y2], ...]}
    defect_class    VARCHAR(100) NOT NULL,
    severity        VARCHAR(20) DEFAULT 'medium'
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_annotations_image ON annotations(image_id);
CREATE INDEX idx_annotations_class ON annotations(defect_class);

-- ─── 5. Training Jobs ────────────────────────────────────────────────────────
CREATE TABLE training_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255),
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    dataset_id      UUID REFERENCES datasets(id) ON DELETE SET NULL,
    architecture    VARCHAR(100) NOT NULL,
    -- 'yolov8n', 'yolov8s', 'yolov8m', 'resnet50', 'unet', 'vit_b_16'
    task_type       VARCHAR(50) NOT NULL DEFAULT 'detection'
                    CHECK (task_type IN ('detection', 'classification', 'segmentation')),
    hyperparams     JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- {"epochs": 100, "batch_size": 16, "lr": 0.001, "optimizer": "AdamW", ...}
    augmentations   JSONB DEFAULT '[]'::jsonb,
    -- [{"type": "HorizontalFlip", "p": 0.5}, {"type": "RandomRotate90"}, ...]
    status          VARCHAR(20) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    current_epoch   INTEGER DEFAULT 0,
    total_epochs    INTEGER,
    best_metric     FLOAT,
    metrics_history JSONB DEFAULT '[]'::jsonb,
    -- [{"epoch": 1, "train_loss": 1.2, "val_loss": 0.9, "map50": 0.42}, ...]
    celery_task_id  VARCHAR(255),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_training_jobs_status ON training_jobs(status);
CREATE INDEX idx_training_jobs_owner ON training_jobs(owner_id);

-- ─── 6. ML Models (trained weights) ─────────────────────────────────────────
CREATE TABLE ml_models (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    training_job_id UUID REFERENCES training_jobs(id) ON DELETE SET NULL,
    name            VARCHAR(255) NOT NULL,
    version         INTEGER DEFAULT 1,
    architecture    VARCHAR(100) NOT NULL,
    task_type       VARCHAR(50) NOT NULL,
    weights_path    VARCHAR(1024) NOT NULL,
    onnx_path       VARCHAR(1024),
    input_size      JSONB DEFAULT '{"width": 640, "height": 640}'::jsonb,
    class_names     JSONB DEFAULT '[]'::jsonb,
    -- Performance metrics
    map50           FLOAT,
    map50_95        FLOAT,
    precision_val   FLOAT,
    recall_val      FLOAT,
    f1_score        FLOAT,
    inference_ms    FLOAT,
    -- Status
    status          VARCHAR(20) DEFAULT 'ready'
                    CHECK (status IN ('ready', 'deployed', 'archived')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_models_status ON ml_models(status);

-- ─── 7. Inference Logs ───────────────────────────────────────────────────────
CREATE TABLE inference_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id        UUID REFERENCES ml_models(id) ON DELETE SET NULL,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    input_image_path VARCHAR(1024),
    detections      JSONB DEFAULT '[]'::jsonb,
    -- [{"class": "Bavure", "confidence": 0.94, "bbox": [120,340,160,380]}, ...]
    verdict         VARCHAR(20) DEFAULT 'ok'
                    CHECK (verdict IN ('ok', 'anomaly', 'uncertain')),
    gradcam_path    VARCHAR(1024),
    latency_ms      FLOAT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inference_model ON inference_logs(model_id);
CREATE INDEX idx_inference_date ON inference_logs(created_at DESC);

-- ─── 8. Deployments ──────────────────────────────────────────────────────────
CREATE TABLE deployments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id        UUID REFERENCES ml_models(id) ON DELETE CASCADE,
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    format          VARCHAR(50) NOT NULL
                    CHECK (format IN ('onnx', 'tensorrt', 'api_rest', 'docker')),
    export_path     VARCHAR(1024),
    api_endpoint    VARCHAR(512),
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'exporting', 'ready', 'active', 'failed')),
    config          JSONB DEFAULT '{}'::jsonb,
    file_size_bytes BIGINT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Seed: default admin user ────────────────────────────────────────────────
-- Password: admin123 (bcrypt hash)
INSERT INTO users (email, hashed_password, full_name, role)
VALUES (
    'admin@vista.ai',
    '$2b$12$LQv3c1yqBo9SkvXS7QTJPOoGT5KZ5v0kZ0HGwLMbqkCFlnGMW1i6i',
    'VISTA Admin',
    'admin'
);

-- ─── Seed: demo dataset ──────────────────────────────────────────────────────
INSERT INTO datasets (name, description, defect_classes)
VALUES (
    'Demo — Carter Moteur',
    'Dataset de démonstration : pièces de carter moteur avec défauts visuels (rayures, bavures, porosités).',
    '["Rayure", "Bavure", "Porosité", "Fissure", "OK"]'::jsonb
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MLOps Tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 9. Alerts (MLOps monitoring) ────────────────────────────────────────────
CREATE TABLE alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    severity        VARCHAR(20) NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info', 'warning', 'critical')),
    source          VARCHAR(50) NOT NULL,
    title           VARCHAR(512) NOT NULL,
    message         TEXT,
    model_id        UUID REFERENCES ml_models(id) ON DELETE SET NULL,
    metadata        JSONB DEFAULT '{}'::jsonb,
    acknowledged    BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_date ON alerts(created_at DESC);

-- ─── 10. Dataset Versions (reproducibility) ─────────────────────────────────
CREATE TABLE dataset_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id      UUID REFERENCES datasets(id) ON DELETE CASCADE,
    version_name    VARCHAR(255) NOT NULL,
    description     TEXT,
    content_hash    VARCHAR(64) NOT NULL,
    image_count     INTEGER DEFAULT 0,
    annotation_count INTEGER DEFAULT 0,
    snapshot_path   VARCHAR(1024),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dataset_versions ON dataset_versions(dataset_id, created_at DESC);

-- ─── 11. Drift Reports ──────────────────────────────────────────────────────
CREATE TABLE drift_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id        UUID REFERENCES ml_models(id) ON DELETE CASCADE,
    window_days     INTEGER DEFAULT 7,
    drift_detected  BOOLEAN DEFAULT false,
    drift_score     FLOAT DEFAULT 0.0,
    alerts          JSONB DEFAULT '[]'::jsonb,
    details         JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_drift_model ON drift_reports(model_id, created_at DESC);
