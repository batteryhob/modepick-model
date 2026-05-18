import { create } from "zustand";
import type {
  CaptureStyle,
  ComposeParamsSnapshot,
  ComposerSlots,
  ComposeView,
  Season,
  TimeOfDay,
  Weather,
} from "@/types";

interface HydrationInput {
  characterId: string;
  slots: ComposerSlots;
  scene: string;
  params: ComposeParamsSnapshot;
}

interface ComposerState {
  activeCharacterId: string | null;
  selectedReferenceIds: string[];
  slots: ComposerSlots;
  scene: string;
  provider: "openai" | "gemini";
  quality: "low" | "medium" | "high";
  view: ComposeView;
  captureStyle: CaptureStyle;
  weather: Weather;
  season: Season;
  timeOfDay: TimeOfDay;
  // anchorImageId — when set, the next compose call uses this image as a
  // reference so the look (hair / makeup / outfit styling) stays
  // consistent across a variation series.
  anchorImageId: string | null;

  setActiveCharacter: (id: string | null, referenceIds?: string[]) => void;
  setSelectedReferenceIds: (ids: string[]) => void;
  setSlot: (key: keyof ComposerSlots, value: string | null) => void;
  setScene: (scene: string) => void;
  setProvider: (provider: "openai" | "gemini") => void;
  setQuality: (quality: "low" | "medium" | "high") => void;
  setView: (view: ComposeView) => void;
  setCaptureStyle: (style: CaptureStyle) => void;
  setWeather: (weather: Weather) => void;
  setSeason: (season: Season) => void;
  setTimeOfDay: (time: TimeOfDay) => void;
  setAnchorImageId: (id: string | null) => void;
  // Bulk-load every compose-related field from a FeedPost so the user can
  // edit + re-generate. Avoids the noise of calling 10 setters in sequence.
  hydrateFromFeedPost: (input: HydrationInput) => void;
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
  weather: "AUTO",
  season: "AUTO",
  timeOfDay: "AUTO",
  anchorImageId: null,

  setActiveCharacter: (id, referenceIds) =>
    set({
      activeCharacterId: id,
      // Switching characters always resets the ref selection — old ref ids
      // don't belong to the new character. Anchor also belongs to the
      // prior character's look so clear it too.
      selectedReferenceIds: referenceIds ?? [],
      anchorImageId: null,
    }),
  setSelectedReferenceIds: (ids) => set({ selectedReferenceIds: ids }),
  setSlot: (key, value) =>
    set((state) => ({ slots: { ...state.slots, [key]: value } })),
  setScene: (scene) => set({ scene }),
  setProvider: (provider) => set({ provider }),
  setQuality: (quality) => set({ quality }),
  setView: (view) => set({ view }),
  setCaptureStyle: (style) => set({ captureStyle: style }),
  setWeather: (weather) => set({ weather }),
  setSeason: (season) => set({ season }),
  setTimeOfDay: (time) => set({ timeOfDay: time }),
  setAnchorImageId: (id) => set({ anchorImageId: id }),
  hydrateFromFeedPost: ({ characterId, slots, scene, params }) =>
    set({
      activeCharacterId: characterId,
      selectedReferenceIds: params.character_reference_ids ?? [],
      slots: { ...emptySlots, ...slots },
      scene,
      view: params.view ?? "RANDOM",
      captureStyle: params.capture_style ?? "AUTO",
      weather: params.weather ?? "AUTO",
      season: params.season ?? "AUTO",
      timeOfDay: params.time_of_day ?? "AUTO",
      anchorImageId: params.anchor_image_id ?? null,
      quality: params.quality ?? "medium",
    }),
  clearSlots: () => set({ slots: { ...emptySlots }, scene: "" }),
}));
