import { create } from "zustand";

interface AppState {
  // Current selections
  currentDatasetId: string | null;
  currentModelId: string | null;
  currentJobId: string | null;

  // Actions
  setDataset: (id: string | null) => void;
  setModel: (id: string | null) => void;
  setJob: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentDatasetId: null,
  currentModelId: null,
  currentJobId: null,

  setDataset: (id) => set({ currentDatasetId: id }),
  setModel: (id) => set({ currentModelId: id }),
  setJob: (id) => set({ currentJobId: id }),
}));
