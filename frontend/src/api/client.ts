const API_BASE = import.meta.env.VITE_API_BASE || "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export function imageUrl(id: string): string {
  return `${API_BASE}/api/images/${id}`;
}

// Goes through a backend endpoint that forces Content-Disposition: attachment.
// The HTML `download` attribute on a plain <a> is silently ignored when the
// href is cross-origin (our S3 public URLs), so the file would open as a
// preview instead of downloading.
export function imageDownloadUrl(id: string, filename: string): string {
  const params = new URLSearchParams({ filename });
  return `${API_BASE}/api/images/${id}/download?${params}`;
}

export const api = {
  health: () => request<{ status: string; db: string; storage: string }>("/api/health"),

  characters: {
    list: () => request<Character[]>("/api/characters"),
    get: (id: string) => request<Character>(`/api/characters/${id}`),
    create: (data: CharacterCreateRequest) =>
      request<CharacterCreateResponse>("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    expandReferences: (id: string, target_count: number) =>
      request<{ job_id: string; status: "pending"; missing_roles: string[] }>(
        `/api/characters/${id}/expand-references`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_count, provider: "openai" }),
        },
      ),
    delete: (id: string) =>
      request<void>(`/api/characters/${id}`, { method: "DELETE" }),
  },

  wardrobe: {
    list: (category?: string) => {
      const params = category ? `?category=${category}` : "";
      return request<{ items: WardrobeItem[]; total: number }>(`/api/wardrobe${params}`);
    },
    create: (formData: FormData) =>
      request<WardrobeItem>("/api/wardrobe", {
        method: "POST",
        body: formData,
      }),
    addImage: (itemId: string, formData: FormData) =>
      request<WardrobeItem>(`/api/wardrobe/${itemId}/images`, {
        method: "POST",
        body: formData,
      }),
    removeImage: (itemId: string, imageRecordId: string) =>
      request<void>(`/api/wardrobe/${itemId}/images/${imageRecordId}`, {
        method: "DELETE",
      }),
    update: (id: string, data: Partial<Pick<WardrobeItem, "name" | "category" | "notes">>) =>
      request<WardrobeItem>(`/api/wardrobe/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/api/wardrobe/${id}`, { method: "DELETE" }),
  },

  mood: {
    list: () => request<MoodReference[]>("/api/mood"),
    upload: (formData: FormData) =>
      request<MoodReference>("/api/mood", {
        method: "POST",
        body: formData,
      }),
    delete: (id: string) =>
      request<void>(`/api/mood/${id}`, { method: "DELETE" }),
  },

  world: {
    list: () => request<{ items: WorldLocation[]; total: number }>("/api/world"),
    create: (formData: FormData) =>
      request<WorldLocation>("/api/world", {
        method: "POST",
        body: formData,
      }),
    addImage: (locationId: string, formData: FormData) =>
      request<WorldLocation>(`/api/world/${locationId}/images`, {
        method: "POST",
        body: formData,
      }),
    removeImage: (locationId: string, imageRecordId: string) =>
      request<void>(`/api/world/${locationId}/images/${imageRecordId}`, {
        method: "DELETE",
      }),
    update: (id: string, data: Partial<Pick<WorldLocation, "name" | "notes">>) =>
      request<WorldLocation>(`/api/world/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/api/world/${id}`, { method: "DELETE" }),
  },

  compose: (data: ComposeRequest) =>
    request<ComposeResponse>("/api/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  feed: {
    list: (limit = 27, offset = 0) =>
      request<{ posts: FeedPost[]; total: number }>(`/api/feed?limit=${limit}&offset=${offset}`),
    create: (
      data: Pick<FeedPost, "character_id" | "image_id" | "slots" | "scene"> & {
        compose_params?: FeedPost["compose_params"];
      },
    ) =>
      request<FeedPost>("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (id: string, data: FeedPostUpdate) =>
      request<FeedPost>(`/api/feed/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/api/feed/${id}`, { method: "DELETE" }),
  },

  jobs: {
    list: (limit = 50, offset = 0) =>
      request<GenerationJob[]>(`/api/jobs?limit=${limit}&offset=${offset}`),
    get: (id: string) => request<GenerationJob>(`/api/jobs/${id}`),
    stats: () => request<JobStats>("/api/jobs/stats"),
  },

  instagram: {
    // Returns the authorize URL the browser should redirect to + a
    // CSRF state token the callback page should verify.
    startAuth: () => request<InstagramAuthStart>("/api/auth/instagram/start"),
    // Called by the callback page after Instagram redirects back with a
    // ?code= param. Backend exchanges the code for a long-lived token
    // and upserts an InstagramAccount row.
    completeAuth: (code: string) =>
      request<InstagramAccount>(
        `/api/auth/instagram/callback?code=${encodeURIComponent(code)}`,
      ),
    accounts: () => request<InstagramAccount[]>("/api/instagram/accounts"),
    deleteAccount: (id: string) =>
      request<void>(`/api/instagram/accounts/${id}`, { method: "DELETE" }),
    updateLabel: (id: string, label: string | null) =>
      request<InstagramAccount>(`/api/instagram/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      }),
    publish: (
      feedPostId: string,
      payload: {
        account_id: string;
        caption?: string | null;
        hashtags?: string[];
      },
    ) =>
      request<InstagramPublishResult>(`/api/instagram/publish/${feedPostId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    publishCarousel: (payload: {
      feed_post_ids: string[];
      account_id: string;
      caption?: string | null;
      hashtags?: string[];
    }) =>
      request<InstagramPublishResult & { count: number }>(
        "/api/instagram/publish-carousel",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      ),
  },
};

// Re-export types for convenience
import type {
  Character,
  WardrobeItem,
  MoodReference,
  WorldLocation,
  FeedPost,
  FeedPostUpdate,
  GenerationJob,
  ComposeRequest,
  ComposeResponse,
  CharacterCreateResponse,
  CharacterCreateRequest,
  InstagramAccount,
  InstagramAuthStart,
  InstagramPublishResult,
  JobStats,
} from "@/types";
