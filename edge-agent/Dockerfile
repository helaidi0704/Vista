FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    ultralytics==8.2.50 \
    requests==2.31.0 \
    torch==2.3.0 --index-url https://download.pytorch.org/whl/cpu \
    torchvision==0.18.0 --index-url https://download.pytorch.org/whl/cpu

COPY agent.py .

RUN mkdir -p /watch /results

ENTRYPOINT ["python", "agent.py"]
CMD ["--api-url", "http://localhost:8000", "--model-id", "none", "--watch-dir", "/watch"]
