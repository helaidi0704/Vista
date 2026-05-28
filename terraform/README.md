# VISTA — Infrastructure as Code (Terraform)

Deploy all VISTA infrastructure on GCP with one command.

## What it creates
- VPC Network + Firewall Rules
- Compute Engine VM (n1-standard-8, Docker Compose)
- GKE Cluster (2-5 auto-scaling nodes)
- Artifact Registry (Docker images)

## Quick Start
```bash
cd terraform/
terraform init
terraform plan
terraform apply    # Creates everything (~5 min)
terraform destroy  # Tears down everything ($0)
```
