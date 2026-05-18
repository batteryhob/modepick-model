export interface ImageAsset {
  id: string;
  storage_path: string;
  width: number;
  height: number;
  mime_type: string;
  file_size: number;
  source: "generated" | "uploaded";
  created_at: string;
}

export interface CharacterPersona {
  age: string;
  heritage: string;
  appearance: string;
  body_type: string;
  style: string;
  color_palette: string;
  location: string;
  personality: string;
}

export interface CharacterReference {
  id: string;
  character_id: string;
  role: string;
  image_id: string;
  created_at: string;
}

export interface Character {
  id: string;
  name: string;
  persona: CharacterPersona;
  base_image_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  references: CharacterReference[];
}

export interface WardrobeItemImage {
  id: string;
  image_id: string;
  sort_order: number;
}

export interface WardrobeItem {
  id: string;
  name: string;
  category: WardrobeCategory;
  notes: string | null;
  size: string | null;
  created_at: string;
  images: WardrobeItemImage[];
}

export type WardrobeCategory =
  | "hat"
  | "top"
  | "bottom"
  | "outerwear"
  | "dress"
  | "bag"
  | "shoes";

export interface MoodReference {
  id: string;
  name: string;
  tags: string;
  image_id: string;
  created_at: string;
}

export interface WorldLocationImage {
  id: string;
  image_id: string;
  sort_order: number;
}

export interface WorldLocation {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  images: WorldLocationImage[];
}

export interface GenerationJob {
  id: string;
  type: string;
  character_id: string | null;
  inputs: Record<string, unknown>;
  output_image_ids: string[];
  provider: string;
  model: string;
  cost_estimate_usd: number;
  status: "pending" | "success" | "failed";
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface CharacterCreateResponse {
  job_id: string;
  status: "pending";
}

export interface CharacterCreateRequest {
  name: string;
  persona: Record<string, string>;
  provider: "openai" | "gemini";
  reference_count: number;
}

export interface ComposeParamsSnapshot {
  character_reference_ids?: string[];
  view?: ComposeView;
  capture_style?: CaptureStyle;
  weather?: Weather;
  season?: Season;
  time_of_day?: TimeOfDay;
  anchor_image_id?: string | null;
  quality?: "low" | "medium" | "high";
}

export interface FeedPost {
  id: string;
  character_id: string;
  image_id: string;
  slots: ComposerSlots;
  scene: string;
  compose_params: ComposeParamsSnapshot;
  caption: string | null;
  hashtags: string[];
  posted_at: string | null;
  created_at: string;
}

export interface FeedPostUpdate {
  caption?: string | null;
  hashtags?: string[];
  posted?: boolean;
}

export interface ComposerSlots {
  hat: string | null;
  top: string | null;
  bottom: string | null;
  outerwear: string | null;
  dress: string | null;
  bag: string | null;
  shoes: string | null;
  mood: string | null;
  location: string | null;
}

export type ComposeView =
  | "RANDOM"
  | "FULL_BODY"
  | "HALF_BODY"
  | "THREE_QUARTER"
  | "CLOSE_UP"
  | "PROFILE"
  | "BACK"
  | "HIGH_ANGLE"
  | "LOW_ANGLE";

export type CaptureStyle = "AUTO" | "SELFIE" | "MIRROR_SELFIE" | "BY_OTHER";

export type Weather =
  | "AUTO"
  | "SUNNY"
  | "CLOUDY"
  | "RAINY"
  | "SNOWING"
  | "FOG"
  | "GOLDEN_SUNSET"
  | "BLUE_HOUR";

export type Season = "AUTO" | "SPRING" | "SUMMER" | "AUTUMN" | "WINTER";

export type TimeOfDay =
  | "AUTO"
  | "DAWN"
  | "MORNING"
  | "AFTERNOON"
  | "EVENING"
  | "NIGHT";

export interface ComposeRequest {
  character_id: string;
  slots: ComposerSlots;
  scene: string;
  provider: "openai" | "gemini";
  quality: "low" | "medium" | "high";
  character_reference_ids: string[];
  view: ComposeView;
  capture_style: CaptureStyle;
  weather: Weather;
  season: Season;
  time_of_day: TimeOfDay;
  anchor_image_id?: string | null;
}

export interface ComposeResponse {
  job_id: string;
  status: "pending";
}

export interface JobStats {
  total_jobs: number;
  total_cost_usd: number;
  cost_this_month: number;
  by_type: Record<string, { count: number; cost: number }>;
  avg_duration_ms: number;
}
