import { create } from "zustand";
import type { ComposerSlots, ComposeView } from "@/types";

interface ComposerState {
  activeCharacterId: string | null;
  slots: ComposerSlots;
  scene: string;
  provider: "openai" | "gemini";
  quality: "low" | "medium" | "high";
  view: ComposeView;

  setActiveCharacter: (id: string | null) => void;
  setSlot: (key: keyof ComposerSlots, value: string | null) => void;
  setScene: (scene: string) => void;
  setProvider: (provider: "openai" | "gemini") => void;
  setQuality: (quality: "low" | "medium" | "high") => void;
  setView: (view: ComposeView) => void;
  clearSlots: () => void;
}

const emptySlots: ComposerSlots = {
  top: null,
  bottom: null,
  outerwear: null,
  dress: null,
  bag: null,
  shoes: null,
  mood: null,
};

export const useComposerStore = create<ComposerState>((set) => ({
  activeCharacterId: null,
  slots: { ...emptySlots },
  scene: "",
  provider: "openai",
  quality: "medium",
  view: "RANDOM",

  setActiveCharacter: (id) => set({ activeCharacterId: id }),
  setSlot: (key, value) =>
    set((state) => ({ slots: { ...state.slots, [key]: value } })),
  setScene: (scene) => set({ scene }),
  setProvider: (provider) => set({ provider }),
  setQuality: (quality) => set({ quality }),
  setView: (view) => set({ view }),
  clearSlots: () => set({ slots: { ...emptySlots }, scene: "" }),
}));
