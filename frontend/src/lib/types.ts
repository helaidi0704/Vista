// ═══════════════════════════════════════════════════════════════════
// VISTA — Brique 01 Types
// ═══════════════════════════════════════════════════════════════════

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  image_count: number;
  annotated_count: number;
  defect_classes: string[];
  created_at: string;
}

export interface VImage {
  id: string;
  dataset_id: string;
  filename: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  format: string;
  uploaded_at: string;
}

export interface Annotation {
  id?: string;
  image_id: string;
  shape: "bbox" | "polygon" | "freehand" | "mask";
  coordinates: BBoxCoords | FreehandCoords;
  defect_class: string;
  severity: "low" | "medium" | "high" | "critical";
  description?: string;
  created_at?: string;
  // Client-side only
  _fabricId?: string;
  _saved?: boolean;
}

export interface BBoxCoords {
  nx: number; // normalized x [0,1]
  ny: number;
  nw: number;
  nh: number;
}

export interface FreehandCoords {
  points: [number, number][]; // normalized [[x,y], ...]
}

export type AnnotationTool = "select" | "bbox" | "freehand" | "pan" | "zoom";

export const SEVERITY_CONFIG = {
  low: { label: "Faible", color: "#3B82F6", bg: "#3B82F620" },
  medium: { label: "Moyen", color: "#EAB308", bg: "#EAB30820" },
  high: { label: "Élevé", color: "#E06C00", bg: "#E06C0020" },
  critical: { label: "Critique", color: "#EF4444", bg: "#EF444420" },
} as const;

export const DEFAULT_DEFECT_CLASSES = [
  "Rayure",
  "Bavure",
  "Porosité",
  "Fissure",
  "Déformation",
  "Tache",
  "OK",
];
