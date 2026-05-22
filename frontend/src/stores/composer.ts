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
  // The feed post's own image_id. Used as the anchor so the user lands
  // on /composer ready to make a variation of THIS exact result, not
  // whatever the original compose had anchored at the time.
  anchorImageId: string;
}

interface ComposerState {
  // "look" = standard person-in-outfit compose. "mood" = character-less
  // ambient / still-life feed image (food, drinks, spaces). The toggle
  // controls which inputs the page surfaces and which endpoint runs.
  mode: "look" | "mood";
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
  // Number of variants (1–4) to generate per click. Default 1; higher
  // values let the user pick the best from a batch at proportional cost.
  count: number;
  // anchorImageId — when set, the next compose call uses this image as a
  // reference so the look (hair / makeup / outfit styling) stays
  // consistent across a variation series.
  anchorImageId: string | null;

  setMode: (mode: "look" | "mood") => void;
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
  setCount: (count: number) => void;
  setAnchorImageId: (id: string | null) => void;
  // Bulk-load every compose-related field from a FeedPost so the user can
  // edit + re-generate. Avoids the noise of calling 10 setters in sequence.
  hydrateFromFeedPost: (input: HydrationInput) => void;
  clearSlots: () => void;
}

const emptySlots: ComposerSlots = {
  hat: null,
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
  mode: "look",
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
  count: 1,
  anchorImageId: null,

  setMode: (mode) => set({ mode }),
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
  setCount: (count) => set({ count: Math.max(1, Math.min(4, count)) }),
  setAnchorImageId: (id) => set({ anchorImageId: id }),
  hydrateFromFeedPost: ({ characterId, slots, scene, params, anchorImageId }) =>
    set({
      mode: params.mode === "mood" ? "mood" : "look",
      activeCharacterId: characterId,
      selectedReferenceIds: params.character_reference_ids ?? [],
      slots: { ...emptySlots, ...slots },
      scene,
      view: params.view ?? "RANDOM",
      captureStyle: params.capture_style ?? "AUTO",
      weather: params.weather ?? "AUTO",
      season: params.season ?? "AUTO",
      timeOfDay: params.time_of_day ?? "AUTO",
      // Anchor the next compose on the feed post's own image so the user
      // is set up to make a variation of this exact result. (We ignore
      // params.anchor_image_id — that was the anchor at the time the
      // post was saved, which is now history.) Anchor doesn't apply to
      // mood shots, but we set it for "look" rehydrations.
      anchorImageId: params.mode === "mood" ? null : anchorImageId,
      quality: params.quality ?? "medium",
    }),
  clearSlots: () => set({ slots: { ...emptySlots }, scene: "" }),
}));
