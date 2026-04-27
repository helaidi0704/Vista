import { useEffect, useRef, useState, useCallback } from "react";

interface TrainingMetrics {
  epoch: number;
  total_epochs: number;
  train_loss: number;
  val_loss: number;
  map50: number;
  precision: number;
  recall: number;
  best_map: number;
  eta_seconds: number;
  status: string;
}

/**
 * Hook to subscribe to real-time training metrics via WebSocket.
 * Matches SEQ 2, Step 2.7 — connects to /ws/training/{jobId}
 */
export function useTrainingWebSocket(jobId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [metrics, setMetrics] = useState<TrainingMetrics[]>([]);
  const [latest, setLatest] = useState<TrainingMetrics | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (!jobId) return;

    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
    const ws = new WebSocket(`${wsUrl}/api/v1/ws/training/${jobId}`);

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      try {
        const data: TrainingMetrics = JSON.parse(event.data);
        setLatest(data);
        setMetrics((prev) => [...prev, data]);
      } catch (e) {
        console.error("Failed to parse WS message:", e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    wsRef.current = ws;
  }, [jobId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
  }, []);

  return { metrics, latest, connected, disconnect };
}
