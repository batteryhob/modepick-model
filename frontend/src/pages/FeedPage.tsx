import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, imageDownloadUrl, imageUrl } from "@/api/client";
import { PublishToInstagramModal } from "@/components/PublishToInstagramModal";
import IconButton from "@/components/IconButton";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { useComposerStore } from "@/stores/composer";
import type { FeedPost } from "@/types";

export default function FeedPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Array (not Set) so we preserve the order the user clicked things in —
  // that order becomes the carousel page order on Instagram.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // We track viewer state as IDs (not snapshotted post objects) so that
  // React Query refetches after PATCH/DELETE flow back into the carousel.
  const [viewerPostIds, setViewerPostIds] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // The PublishToInstagramModal is opened from two places: (a) the viewer's
  // single-post toolbar, (b) the header's "선택 발행" button when 2+ are
  // selected. Holding the target ids here lets one modal component serve both.
  const [publishTargetIds, setPublishTargetIds] = useState<string[] | null>(null);

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
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      setViewerPostIds((prev) => prev.filter((x) => x !== id));
      toast.success("삭제됨");
    },
    onError: (err: Error) => toast.error(`삭제 실패: ${err.message}`),
  });

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const openSingle = useCallback((post: FeedPost) => {
    setViewerPostIds([post.id]);
    setViewerIndex(0);
  }, []);

  const openSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    // Keep the click order intact, but drop any ids whose posts have been
    // deleted in the background since selection.
    const valid = new Set(posts.map((p) => p.id));
    const ordered = selectedIds.filter((id) => valid.has(id));
    if (ordered.length === 0) return;
    setViewerPostIds(ordered);
    setViewerIndex(0);
  }, [posts, selectedIds]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  return (
    <div>
      <PageHeader
        title="피드"
        subtitle={`총 ${data?.total ?? 0}개 — 인스타그램에 올릴 게시물 모음`}
        action={
          selectedIds.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-500 hidden sm:inline">
                {selectedIds.length}개 선택
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
                선택 보기 ({selectedIds.length})
              </button>
              {selectedIds.length > 10 && (
                <span className="text-[11px] text-amber-600">
                  인스타 캐러셀은 최대 10장
                </span>
              )}
            </div>
          ) : null
        }
      />

      {isLoading && <p className="text-gray-500">로딩 중...</p>}

      <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-[2px] sm:gap-1">
        {posts.map((post: FeedPost) => {
          const selectionOrder = selectedIds.indexOf(post.id); // -1 if not selected
          const selected = selectionOrder !== -1;
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
                title={
                  selected
                    ? `${selectionOrder + 1}번째로 선택됨 — 캐러셀에서도 이 순서로 올라감`
                    : "선택"
                }
                className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono transition-opacity ${
                  selected
                    ? "bg-gray-900 text-white opacity-100"
                    : "bg-white/90 text-gray-600 opacity-0 group-hover:opacity-100 hover:bg-white"
                }`}
              >
                {selected ? selectionOrder + 1 : "+"}
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
          onRequestPublish={(ids) => setPublishTargetIds(ids)}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {publishTargetIds && (
        <PublishToInstagramModal
          feedPostIds={publishTargetIds}
          imageIds={publishTargetIds
            .map((id) => posts.find((p) => p.id === id)?.image_id)
            .filter(Boolean) as string[]}
          onClose={() => setPublishTargetIds(null)}
          onPublished={() => {
            setPublishTargetIds(null);
            setSelectedIds([]);
          }}
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
  onRequestPublish: (ids: string[]) => void;
  isDeleting: boolean;
}

function CarouselViewer({
  posts,
  index,
  setIndex,
  onClose,
  onDelete,
  onRequestPublish,
  isDeleting,
}: CarouselProps) {
  const navigate = useNavigate();
  const hydrateFromFeedPost = useComposerStore((s) => s.hydrateFromFeedPost);
  const post = posts[index];

  const handleRecompose = () => {
    if (!post) return;
    hydrateFromFeedPost({
      characterId: post.character_id,
      slots: post.slots,
      scene: post.scene,
      params: post.compose_params,
      // Anchor the next compose on this exact post's image so the user
      // lands on /composer ready to generate a variation of THIS result,
      // not whatever the source compose originally anchored on.
      anchorImageId: post.image_id,
    });
    onClose();
    navigate("/composer");
  };
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
            <IconButton onClick={onClose} aria-label="닫기" variant="subtle">
              ×
            </IconButton>
          </div>

          {/* Body: prompt + read-only meta. Caption/hashtags are entered
              at publish time, not persisted on the post. */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
            <div className="flex gap-2 flex-wrap justify-end items-center">
              {/* Publish history is informational only — re-publishing the same
                  image is intentionally allowed (the user can run the same look
                  through multiple accounts / repost campaigns / etc). */}
              {post.ig_media_id && (
                <span
                  title={`마지막 IG media: ${post.ig_media_id}`}
                  className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-200"
                >
                  ✓ 발행 이력
                </span>
              )}
              {posts.length > 10 ? (
                <span className="px-3 py-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md">
                  캐러셀은 최대 10장
                </span>
              ) : posts.length > 1 ? (
                <button
                  onClick={() => onRequestPublish(posts.map((p) => p.id))}
                  className="px-3 py-1.5 text-xs bg-pink-600 text-white rounded-md hover:bg-pink-700"
                  title="이 N장을 한 캐러셀 게시물로 발행"
                >
                  이 {posts.length}장을 캐러셀로 발행
                </button>
              ) : (
                <button
                  onClick={() => onRequestPublish([post.id])}
                  className="px-3 py-1.5 text-xs bg-pink-600 text-white rounded-md hover:bg-pink-700"
                >
                  {post.ig_media_id ? "다시 발행" : "IG에 발행"}
                </button>
              )}
              <button
                onClick={handleRecompose}
                title="이 게시물의 모든 설정을 합성 페이지로 불러옵니다"
                className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-50"
              >
                이 설정으로 합성
              </button>
              <a
                href={imageDownloadUrl(post.image_id, `feed_${post.id}.png`)}
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

