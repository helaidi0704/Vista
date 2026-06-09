-- VISTA Database Initialization Script
-- Run on fresh deployment to create all tables and seed data

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations table (multi-tenant)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'free',
    max_images INTEGER DEFAULT 500,
    max_models INTEGER DEFAULT 5,
    max_users INTEGER DEFAULT 5,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add organization_id to all tables that need it
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE inference_logs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE annotations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Pipelines table
CREATE TABLE IF NOT EXISTS pipelines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    blocks JSONB DEFAULT '[]',
    connections JSONB DEFAULT '[]',
    hyperparams JSONB DEFAULT '{}',
    user_id UUID,
    organization_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data: organizations
INSERT INTO organizations (id, name, slug, plan, max_images, max_models, max_users)
VALUES ('a0000000-0000-0000-0000-000000000001', 'VISTA Demo', 'vista-demo', 'pro', 10000, 50, 20)
ON CONFLICT DO NOTHING;

-- Seed data: default dataset
INSERT INTO datasets (id, name, description, organization_id, image_count)
VALUES ('650e1981-b5ef-49a8-aca8-778d29c60e2b', 'Kaggle Casting Product (MVTec)', 'Industrial casting defect images', 'a0000000-0000-0000-0000-000000000001', 0)
ON CONFLICT DO NOTHING;
