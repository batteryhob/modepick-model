import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, imageUrl } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import type { FeedPost } from "@/types";

export default function FeedPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // We track viewer state as IDs (not snapshotted post objects) so that
  // React Query refetches after PATCH/DELETE flow back into the carousel.
  const [viewerPostIds, setViewerPostIds] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["feed", { limit: 27, offset: 0 }],
    queryFn: () => api.feed.list(27, 0),
  });

  const posts = useMemo(() => data?.posts ?? [], [data]);

  const viewerPosts = useMemo(
    () => viewerPostIds.map((id) => posts.find((p) => p.id === id)).filter(Boolean) as FeedPost[],
    [viewerPostIds, posts],
  );

  // If the post at the current viewer index disappeared (deleted), shift the
  // index in-bounds; if nothing left, close the viewer.
  useEffect(() => {
    if (viewerIndex === null) return;
    if (viewerPosts.length === 0) {
      setViewerIndex(null);
    } else if (viewerIndex >= viewerPosts.length) {
      setViewerIndex(viewerPosts.length - 1);
    }
  }, [viewerPosts.length, viewerIndex]);

  const deleteMutation = useMutation({
    mutationFn: api.feed.delete,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setViewerPostIds((prev) => prev.filter((x) => x !== id));
      toast.success("삭제됨");
    },
    onError: (err: Error) => toast.error(`삭제 실패: ${err.message}`),
  });

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openSingle = useCallback((post: FeedPost) => {
    setViewerPostIds([post.id]);
    setViewerIndex(0);
  }, []);

  const openSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ordered = posts.filter((p) => selectedIds.has(p.id)).map((p) => p.id);
    if (ordered.length === 0) return;
    setViewerPostIds(ordered);
    setViewerIndex(0);
  }, [posts, selectedIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return (
    <div>
      <PageHeader
        title="피드"
        subtitle={`총 ${data?.total ?? 0}개 — 인스타그램에 올릴 게시물 모음`}
        action={
          selectedIds.size > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 hidden sm:inline">
                {selectedIds.size}개 선택
              </span>
              <button
                onClick={clearSelection}
                className="px-3 py-1.5 text-sm text-gray-600 border rounded-md hover:bg-gray-50"
              >
                해제
              </button>
              <button
                onClick={openSelected}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800"
              >
                선택 보기 ({selectedIds.size})
              </button>
            </div>
          ) : null
        }
      />

      {isLoading && <p className="text-gray-500">로딩 중...</p>}

      <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-[2px] sm:gap-1">
        {posts.map((post: FeedPost) => {
          const selected = selectedIds.has(post.id);
          const isPosted = !!post.posted_at;
          return (
            <div
              key={post.id}
              className="relative group min-w-0 aspect-[4/5] bg-gray-100 overflow-hidden cursor-pointer"
              onClick={() => openSingle(post)}
            >
              <img
                src={imageUrl(post.image_id)}
                alt=""
                className={`w-full h-full object-contain transition-all ${
                  selected ? "opacity-60" : "group-hover:opacity-85"
                }`}
              />
              {isPosted && (
                <span
                  title="인스타그램에 올림"
                  className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 bg-emerald-600 text-white rounded font-mono"
                >
                  ✓ 올림
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(post.id);
                }}
                aria-label={selected ? "선택 해제" : "선택"}
                className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-xs transition-opacity ${
                  selected
                    ? "bg-gray-900 text-white opacity-100"
                    : "bg-white/90 text-gray-600 opacity-0 group-hover:opacity-100 hover:bg-white"
                }`}
              >
                {selected ? "✓" : "+"}
              </button>
            </div>
          );
        })}
      </div>

      {posts.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-400">
          <p>아직 게시물이 없습니다. 합성 탭에서 룩을 생성해보세요.</p>
        </div>
      )}

      {viewerIndex !== null && viewerPosts[viewerIndex] && (
        <CarouselViewer
          posts={viewerPosts}
          index={viewerIndex}
          setIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onDelete={(id) => {
            if (confirm("이 게시물을 삭제하시겠습니까?")) {
              deleteMutation.mutate(id);
            }
          }}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

interface CarouselProps {
  posts: FeedPost[];
  index: number;
  setIndex: (i: number) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

function CarouselViewer({
  posts,
  index,
  setIndex,
  onClose,
  onDelete,
  isDeleting,
}: CarouselProps) {
  const post = posts[index];
  const hasPrev = index > 0;
  const hasNext = index < posts.length - 1;
  const showNav = posts.length > 1;

  const goPrev = useCallback(() => {
    if (hasPrev) setIndex(index - 1);
  }, [hasPrev, index, setIndex]);

  const goNext = useCallback(() => {
    if (hasNext) setIndex(index + 1);
  }, [hasNext, index, setIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack arrows when the user is typing in caption/hashtags.
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "Escape") onClose();
      else if (!inField && e.key === "ArrowLeft") goPrev();
      else if (!inField && e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  if (!post) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] flex flex-col md:flex-row overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative md:w-2/3 bg-black flex items-center justify-center flex-shrink-0">
          <img
            src={imageUrl(post.image_id)}
            alt=""
            className="max-w-full max-h-[50vh] md:max-h-[90vh] object-contain"
          />
          {showNav && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                disabled={!hasPrev}
                aria-label="이전"
                className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center text-white text-lg backdrop-blur-sm transition-colors"
              >
                ‹
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                disabled={!hasNext}
                aria-label="다음"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center text-white text-lg backdrop-blur-sm transition-colors"
              >
                ›
              </button>
            </>
          )}
        </div>

        <div className="md:w-1/3 flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400">
                {new Date(post.created_at).toLocaleDateString()}
              </p>
              {post.posted_at && (
                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">
                  ✓ 올림
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="text-gray-400 hover:text-gray-700 text-lg leading-none"
            >
              ×
            </button>
          </div>

          {/* Body: caption / hashtags / posted toggle + read-only meta */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <PostMetaEditor key={post.id} post={post} />

            {post.scene && (
              <div>
                <p className="text-xs font-mono text-gray-400 mb-1">프롬프트</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{post.scene}</p>
              </div>
            )}

            {post.slots &&
              Object.keys(post.slots).some(
                (k) => post.slots[k as keyof typeof post.slots],
              ) && (
                <div>
                  <p className="text-xs font-mono text-gray-400 mb-1">슬롯</p>
                  <ul className="text-xs text-gray-500 space-y-0.5">
                    {Object.entries(post.slots).map(([k, v]) =>
                      v ? (
                        <li key={k}>
                          <span className="text-gray-400">{k}</span>: {v}
                        </li>
                      ) : null,
                    )}
                  </ul>
                </div>
              )}
          </div>

          <div className="border-t p-3 flex items-center justify-between gap-2 flex-shrink-0">
            {showNav ? (
              <span className="text-xs text-gray-500">
                {index + 1} / {posts.length}
              </span>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <a
                href={imageUrl(post.image_id)}
                download={`feed_${post.id}.png`}
                className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-50"
              >
                다운로드
              </a>
              <button
                onClick={() => onDelete(post.id)}
                disabled={isDeleting}
                className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-50"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostMetaEditor({ post }: { post: FeedPost }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [caption, setCaption] = useState(post.caption ?? "");
  const [hashtagsText, setHashtagsText] = useState(post.hashtags.join(", "));

  const update = useMutation({
    mutationFn: (data: Parameters<typeof api.feed.update>[1]) =>
      api.feed.update(post.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const dirty =
    (caption ?? "").trim() !== (post.caption ?? "").trim() ||
    parseHashtags(hashtagsText).join(",") !== post.hashtags.join(",");

  const saveText = () => {
    const cleaned = parseHashtags(hashtagsText);
    update.mutate(
      { caption: caption.trim() || null, hashtags: cleaned },
      {
        onSuccess: () => {
          setHashtagsText(cleaned.join(", "));
          toast.success("저장됨");
        },
        onError: (err: Error) => toast.error(`저장 실패: ${err.message}`),
      },
    );
  };

  const togglePosted = () => {
    update.mutate(
      { posted: !post.posted_at },
      {
        onSuccess: () => {
          toast.success(post.posted_at ? "올림 표시 해제" : "올림으로 표시");
        },
        onError: (err: Error) => toast.error(`변경 실패: ${err.message}`),
      },
    );
  };

  const copyForInsta = async () => {
    const tagLine = post.hashtags.map((h) => `#${h}`).join(" ");
    const text = [caption?.trim(), tagLine].filter(Boolean).join("\n\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("클립보드에 복사됨");
    } catch {
      toast.error("복사 실패 — 수동으로 복사하세요");
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-mono text-gray-400">캡션</p>
          <button
            onClick={copyForInsta}
            disabled={!caption?.trim() && post.hashtags.length === 0}
            className="text-[11px] text-gray-500 hover:text-gray-900 disabled:opacity-30"
          >
            IG 복사
          </button>
        </div>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="인스타그램 캡션..."
          rows={3}
          className="w-full text-sm px-2 py-1.5 border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>

      <div>
        <p className="text-xs font-mono text-gray-400 mb-1">해시태그</p>
        <input
          type="text"
          value={hashtagsText}
          onChange={(e) => setHashtagsText(e.target.value)}
          placeholder="ootd, fashion, seoul"
          className="w-full text-sm px-2 py-1.5 border rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
        {post.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {post.hashtags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={togglePosted}
          disabled={update.isPending}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            post.posted_at
              ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
              : "border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {post.posted_at ? "✓ 올림" : "올림으로 표시"}
        </button>
        <button
          onClick={saveText}
          disabled={!dirty || update.isPending}
          className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-30"
        >
          {update.isPending ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

function parseHashtags(input: string): string[] {
  return input
    .split(/[,\s\n]+/)
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean);
}
