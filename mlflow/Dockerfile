FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    mlflow==2.14.0 \
    psycopg2-binary==2.9.9 \
    boto3==1.34.131

EXPOSE 5000

CMD ["mlflow", "server", \
     "--host", "0.0.0.0", \
     "--port", "5000", \
     "--backend-store-uri", "${MLFLOW_BACKEND_STORE_URI}", \
     "--default-artifact-root", "${MLFLOW_DEFAULT_ARTIFACT_ROOT}", \
     "--serve-artifacts"]
