import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, imageUrl } from "@/api/client";
import { useToast } from "@/components/Toast";
import type { InstagramAccount } from "@/types";

interface Props {
  feedPostIds: string[];
  // Optional preview thumbnails so the user sees what they're publishing
  // in the modal. Order must match feedPostIds.
  imageIds?: string[];
  onClose: () => void;
  onPublished: () => void;
}

export function PublishToInstagramModal({
  feedPostIds,
  imageIds,
  onClose,
  onPublished,
}: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [caption, setCaption] = useState("");
  const [hashtagsText, setHashtagsText] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["instagram-accounts"],
    queryFn: api.instagram.accounts,
  });

  // Pick the first account by default once accounts load.
  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  // ESC closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isCarousel = feedPostIds.length > 1;

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error("계정을 선택하세요");
      const hashtags = parseHashtags(hashtagsText);
      if (isCarousel) {
        return api.instagram.publishCarousel({
          feed_post_ids: feedPostIds,
          account_id: accountId,
          caption: caption.trim() || null,
          hashtags,
        });
      }
      return api.instagram.publish(feedPostIds[0], {
        account_id: accountId,
        caption: caption.trim() || null,
        hashtags,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      toast.success(isCarousel ? "캐러셀 발행 완료" : "인스타에 발행됨");
      onPublished();
    },
    onError: (err: Error) =>
      toast.error(`발행 실패: ${err.message.slice(0, 200)}`),
  });

  if (accounts.length === 0) {
    return (
      <ModalShell onClose={onClose}>
        <h3 className="text-lg font-semibold mb-2">인스타 계정 필요</h3>
        <p className="text-sm text-gray-600 mb-4">
          발행하려면 먼저 Instagram 계정을 연결하세요.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
          >
            닫기
          </button>
          <Link
            to="/instagram"
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800"
          >
            계정 연결하러 가기
          </Link>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">
          {isCarousel
            ? `Instagram 캐러셀 발행 (${feedPostIds.length}장)`
            : "Instagram 발행"}
        </h3>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="w-8 h-8 rounded-md hover:bg-gray-100 text-lg"
        >
          ×
        </button>
      </div>

      {imageIds && imageIds.length > 0 && (
        <div className="flex gap-1 mb-3 overflow-x-auto">
          {imageIds.map((id, i) => (
            <img
              key={id}
              src={imageUrl(id)}
              alt=""
              className="w-16 h-20 object-cover rounded border flex-shrink-0"
              title={isCarousel ? `${i + 1}/${imageIds.length}` : undefined}
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-xs font-mono text-gray-400 block mb-1">
            계정
          </label>
          <select
            value={accountId ?? ""}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={publishMutation.isPending}
            className="w-full text-sm border rounded-md px-2 py-1.5"
          >
            {accounts.map((a: InstagramAccount) => (
              <option key={a.id} value={a.id}>
                {a.label ? `${a.label} (@${a.username})` : `@${a.username}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-mono text-gray-400 block mb-1">
            캡션{isCarousel && " (캐러셀 전체에 적용)"}
          </label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="인스타그램 캡션을 입력하세요..."
            rows={4}
            disabled={publishMutation.isPending}
            className="w-full text-sm border rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="text-xs font-mono text-gray-400 block mb-1">
            해시태그 (쉼표 또는 공백 구분, 최대 30개)
          </label>
          <input
            value={hashtagsText}
            onChange={(e) => setHashtagsText(e.target.value)}
            placeholder="ootd, fashion, seoul"
            disabled={publishMutation.isPending}
            className="w-full text-sm border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          {hashtagsText.trim() && (
            <p className="text-[10px] text-gray-400 mt-1">
              {parseHashtags(hashtagsText).length}개 해시태그
            </p>
          )}
        </div>

        <p className="text-[11px] text-gray-400">
          입력한 캡션 / 해시태그는 저장되지 않고 발행 시점에만 인스타로
          전송됩니다.
        </p>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button
          onClick={onClose}
          disabled={publishMutation.isPending}
          className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          취소
        </button>
        <button
          onClick={() => publishMutation.mutate()}
          disabled={publishMutation.isPending || !accountId}
          className="px-4 py-2 text-sm bg-pink-600 text-white rounded-md hover:bg-pink-700 disabled:opacity-50"
        >
          {publishMutation.isPending
            ? "발행 중..."
            : isCarousel
              ? "캐러셀 발행"
              : "발행"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg w-full max-w-md p-5 sm:p-6 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        {children}
      </div>
    </div>
  );
}

function parseHashtags(input: string): string[] {
  return input
    .split(/[,\s\n]+/)
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 30);
}
