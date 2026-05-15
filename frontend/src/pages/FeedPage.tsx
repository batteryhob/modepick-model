import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, imageUrl } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import type { FeedPost } from "@/types";

export default function FeedPage() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewerPosts, setViewerPosts] = useState<FeedPost[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["feed", { limit: 27, offset: 0 }],
    queryFn: () => api.feed.list(27, 0),
  });

  const deleteMutation = useMutation({
    mutationFn: api.feed.delete,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setViewerPosts((prev) => {
        const next = prev.filter((p) => p.id !== id);
        if (next.length === 0) {
          setViewerIndex(null);
        } else if (viewerIndex !== null) {
          setViewerIndex(Math.min(viewerIndex, next.length - 1));
        }
        return next;
      });
    },
  });

  const posts = useMemo(() => data?.posts ?? [], [data]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openSingle = useCallback((post: FeedPost) => {
    setViewerPosts([post]);
    setViewerIndex(0);
  }, []);

  const openSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ordered = posts.filter((p) => selectedIds.has(p.id));
    if (ordered.length === 0) return;
    setViewerPosts(ordered);
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

      {/* Instagram-style profile grid: 3 on mobile, more cols on wider
          screens so the page doesn't leave huge empty gutters.
          `min-w-0` on each cell is critical — without it, intrinsic image
          width (1024px) pushes the grid wider than the viewport on phones. */}
      <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-[2px] sm:gap-1">
        {posts.map((post: FeedPost) => {
          const selected = selectedIds.has(post.id);
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
              {/* Selection checkbox — visible on hover or when selected. */}
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
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  if (!post) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      {/* Prev arrow */}
      {showNav && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          disabled={!hasPrev}
          aria-label="이전"
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-gray-900 text-lg z-10"
        >
          ‹
        </button>
      )}

      <div
        className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col md:flex-row overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image */}
        <div className="md:w-2/3 bg-black flex items-center justify-center min-h-[300px] md:min-h-0">
          <img
            src={imageUrl(post.image_id)}
            alt=""
            className="max-w-full max-h-[90vh] object-contain"
          />
        </div>

        {/* Info side panel */}
        <div className="md:w-1/3 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <p className="text-xs text-gray-400">
              {new Date(post.created_at).toLocaleDateString()}
            </p>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="text-gray-400 hover:text-gray-700 text-lg leading-none"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {post.scene && (
              <div>
                <p className="text-xs font-mono text-gray-400 mb-1">프롬프트</p>
                <p className="text-sm">{post.scene}</p>
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

          <div className="border-t p-3 flex items-center justify-between gap-2">
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

      {/* Next arrow */}
      {showNav && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          disabled={!hasNext}
          aria-label="다음"
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-gray-900 text-lg z-10"
        >
          ›
        </button>
      )}
    </div>
  );
}
