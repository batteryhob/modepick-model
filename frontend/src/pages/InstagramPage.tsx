import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import type { InstagramAccount } from "@/types";

export default function InstagramPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["instagram-accounts"],
    queryFn: api.instagram.accounts,
  });

  const startAuthMutation = useMutation({
    mutationFn: api.instagram.startAuth,
    onSuccess: ({ url, state }) => {
      // Track the state for CSRF verification on the callback page.
      sessionStorage.setItem("ig_oauth_state", state);
      window.location.href = url;
    },
    onError: (err: Error) => toast.error(`OAuth 시작 실패: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: api.instagram.deleteAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instagram-accounts"] });
      toast.success("계정 연결 해제됨");
    },
    onError: (err: Error) => toast.error(`삭제 실패: ${err.message}`),
  });

  return (
    <div>
      <PageHeader
        title="Instagram 계정"
        subtitle="피드 자동 발행에 사용할 IG Business / Creator 계정"
        action={
          <button
            onClick={() => startAuthMutation.mutate()}
            disabled={startAuthMutation.isPending}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {startAuthMutation.isPending ? "이동 중..." : "+ 계정 연결"}
          </button>
        }
      />

      {isLoading && <p className="text-gray-500">로딩 중...</p>}

      {accounts.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-400">
          <p>아직 연결된 Instagram 계정이 없습니다.</p>
          <p className="text-xs mt-2">
            우측 상단의 <strong>계정 연결</strong> 버튼으로 시작하세요.
          </p>
          <p className="text-xs mt-1 text-gray-300">
            연결할 계정은 Instagram 앱에서 <strong>Business 또는 Creator</strong>로
            전환되어 있어야 합니다.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {accounts.map((account: InstagramAccount) => (
          <AccountRow
            key={account.id}
            account={account}
            onDelete={() => {
              if (confirm(`@${account.username} 연결을 해제하시겠습니까?`)) {
                deleteMutation.mutate(account.id);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function AccountRow({
  account,
  onDelete,
}: {
  account: InstagramAccount;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(account.label ?? "");

  const labelMutation = useMutation({
    mutationFn: (next: string | null) =>
      api.instagram.updateLabel(account.id, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instagram-accounts"] });
      setEditing(false);
    },
    onError: (err: Error) => toast.error(`수정 실패: ${err.message}`),
  });

  const expires = new Date(account.token_expires_at);
  const now = new Date();
  const daysLeft = Math.round(
    (expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  const expiresSoon = daysLeft <= 7;

  return (
    <div className="border rounded-lg bg-white p-3 sm:p-4 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="font-mono text-sm">@{account.username}</p>
          <p className="text-xs text-gray-400">{account.ig_user_id}</p>
        </div>
        {editing ? (
          <div className="flex gap-1 mt-1 items-center">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="라벨 (예: 메인 계정)"
              className="text-xs border rounded px-2 py-0.5 flex-1 max-w-xs"
              autoFocus
            />
            <button
              onClick={() => labelMutation.mutate(label.trim() || null)}
              disabled={labelMutation.isPending}
              className="text-xs px-2 py-0.5 bg-gray-900 text-white rounded disabled:opacity-50"
            >
              저장
            </button>
            <button
              onClick={() => {
                setLabel(account.label ?? "");
                setEditing(false);
              }}
              className="text-xs px-2 py-0.5 border rounded"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-500 mt-1 hover:text-gray-700"
          >
            {account.label || "+ 라벨 추가"}
          </button>
        )}
        <p
          className={`text-xs mt-1 ${
            expiresSoon ? "text-amber-600" : "text-gray-400"
          }`}
        >
          토큰 만료: {expires.toLocaleDateString()} (
          {daysLeft > 0 ? `${daysLeft}일 남음` : "만료됨"})
        </p>
      </div>
      <button
        onClick={onDelete}
        className="text-xs text-red-600 border border-red-200 rounded-md px-3 py-1.5 hover:bg-red-50 flex-shrink-0"
      >
        연결 해제
      </button>
    </div>
  );
}
