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
  anchor_character_id?: string | null;
}

export interface FeedPost {
  id: string;
  character_id: string;
  image_id: string;
  slots: ComposerSlots;
  scene: string;
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
  top: string | null;
  bottom: string | null;
  outerwear: string | null;
  dress: string | null;
  bag: string | null;
  shoes: string | null;
  mood: string | null;
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

export interface ComposeRequest {
  character_id: string;
  slots: ComposerSlots;
  scene: string;
  provider: "openai" | "gemini";
  quality: "low" | "medium" | "high";
  character_reference_ids: string[];
  view: ComposeView;
  capture_style: CaptureStyle;
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
