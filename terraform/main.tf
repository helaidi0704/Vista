terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" { default = "ai-use-cases-486914" }
variable "region" { default = "europe-west4" }
variable "zone" { default = "europe-west4-a" }
variable "environment" { default = "prod" }

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

resource "google_compute_network" "vista_network" {
  name                    = "vista-network"
  auto_create_subnetworks = true
}

resource "google_compute_firewall" "allow_vista_ports" {
  name    = "allow-vista-ports"
  network = google_compute_network.vista_network.name
  allow {
    protocol = "tcp"
    ports    = ["22", "80", "443", "3000", "3001", "5000", "8000", "9000", "9001", "9090"]
  }
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["vista-server"]
}

resource "google_compute_instance" "vista_server" {
  name         = "vista-server"
  machine_type = "n1-standard-8"
  zone         = var.zone
  tags         = ["vista-server"]
  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 100
      type  = "pd-balanced"
    }
  }
  network_interface {
    network = google_compute_network.vista_network.name
    access_config {}
  }
  service_account { scopes = ["cloud-platform"] }
  labels = { app = "vista", environment = var.environment }
}

resource "google_artifact_registry_repository" "vista_repo" {
  location      = var.region
  repository_id = "vista-repo"
  format        = "DOCKER"
}

resource "google_container_cluster" "vista_cluster" {
  name     = "vista-cluster"
  location = var.zone
  remove_default_node_pool = true
  initial_node_count       = 1
  networking_mode = "VPC_NATIVE"
  network         = google_compute_network.vista_network.name
  ip_allocation_policy {}
}

resource "google_container_node_pool" "vista_nodes" {
  name       = "vista-node-pool"
  location   = var.zone
  cluster    = google_container_cluster.vista_cluster.name
  node_count = 2
  autoscaling { min_node_count = 2; max_node_count = 5 }
  node_config {
    machine_type = "e2-standard-4"
    disk_size_gb = 50
    tags         = ["vista-k8s"]
    oauth_scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
  management { auto_repair = true; auto_upgrade = true }
}

output "vm_ip" { value = google_compute_instance.vista_server.network_interface[0].access_config[0].nat_ip }
output "gke_cluster" { value = google_container_cluster.vista_cluster.name }
output "registry_url" { value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.vista_repo.repository_id}" }
