import { create } from "zustand";
import type { CaptureStyle, ComposerSlots, ComposeView } from "@/types";

interface ComposerState {
  activeCharacterId: string | null;
  selectedReferenceIds: string[];
  slots: ComposerSlots;
  scene: string;
  provider: "openai" | "gemini";
  quality: "low" | "medium" | "high";
  view: ComposeView;
  captureStyle: CaptureStyle;

  setActiveCharacter: (id: string | null, referenceIds?: string[]) => void;
  setSelectedReferenceIds: (ids: string[]) => void;
  setSlot: (key: keyof ComposerSlots, value: string | null) => void;
  setScene: (scene: string) => void;
  setProvider: (provider: "openai" | "gemini") => void;
  setQuality: (quality: "low" | "medium" | "high") => void;
  setView: (view: ComposeView) => void;
  setCaptureStyle: (style: CaptureStyle) => void;
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
  location: null,
};

export const useComposerStore = create<ComposerState>((set) => ({
  activeCharacterId: null,
  selectedReferenceIds: [],
  slots: { ...emptySlots },
  scene: "",
  provider: "openai",
  quality: "medium",
  view: "RANDOM",
  captureStyle: "AUTO",

  setActiveCharacter: (id, referenceIds) =>
    set({
      activeCharacterId: id,
      // Switching characters always resets the ref selection — old ref ids
      // don't belong to the new character.
      selectedReferenceIds: referenceIds ?? [],
    }),
  setSelectedReferenceIds: (ids) => set({ selectedReferenceIds: ids }),
  setSlot: (key, value) =>
    set((state) => ({ slots: { ...state.slots, [key]: value } })),
  setScene: (scene) => set({ scene }),
  setProvider: (provider) => set({ provider }),
  setQuality: (quality) => set({ quality }),
  setView: (view) => set({ view }),
  setCaptureStyle: (style) => set({ captureStyle: style }),
  clearSlots: () => set({ slots: { ...emptySlots }, scene: "" }),
}));
