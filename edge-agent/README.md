# VISTA Edge Agent

Lightweight inference service for factory deployment. Runs on any machine with Docker.

## Quick Start

```bash
# 1. Build the edge agent
docker build -t vista-edge .

# 2. Create a watch directory (simulates camera output)
mkdir -p /tmp/camera_output

# 3. Run the agent
docker run -v /tmp/camera_output:/watch vista-edge \
  --api-url http://YOUR_VISTA_IP:8000 \
  --model-id YOUR_MODEL_UUID \
  --email admin@vista.ai \
  --password admin123

# 4. Drop images into /tmp/camera_output — agent detects and inspects them
cp casting_part.jpg /tmp/camera_output/
```

## How it works

1. Authenticates with VISTA Cloud API (JWT)
2. Downloads model information
3. Loads YOLOv8 locally for fast inference
4. Watches a directory for new images (simulates camera feed)
5. Runs inference on each new image (<50ms on GPU, ~1.5s on CPU)
6. Logs results with verdict (OK/DEFECT), confidence, bounding boxes
7. Saves results as JSON for integration with PLC/SCADA systems

## For NVIDIA Jetson (edge GPU)

```bash
# Use Jetson-optimized base image
# Modify Dockerfile: FROM nvcr.io/nvidia/l4t-pytorch:r35.2.1-pth2.0-py3
# Inference drops from ~1.5s to ~20ms
```

## Integration with production line

The agent saves JSON results in `_vista_results/`. Your PLC/SCADA system reads these:

```json
{
  "image": "part_001.jpg",
  "verdict": "anomaly",
  "detections": [{"class": "Porosité", "confidence": 0.87, "bbox": [120, 80, 200, 160]}],
  "latency_ms": 45.2
}
```

Map `verdict == "anomaly"` to a reject signal via Modbus/OPC-UA/GPIO.
