import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import type { InstagramAccount } from "@/types";

type Status =
  | { kind: "loading" }
  | { kind: "success"; account: InstagramAccount }
  | { kind: "error"; message: string };

export default function InstagramCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  // Instagram auth codes are single-use. React StrictMode in dev mounts
  // effects twice, which would consume the code twice and fail the second
  // call with "This authorization code has been used". Guard with a ref
  // so the exchange runs exactly once per page load.
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    if (error) {
      setStatus({
        kind: "error",
        message: `Instagram이 인증을 거부했습니다: ${error} (${
          params.get("error_description") || ""
        })`,
      });
      return;
    }

    if (!code) {
      setStatus({
        kind: "error",
        message: "Instagram에서 인증 코드를 받지 못했습니다.",
      });
      return;
    }

    // CSRF check — the state we sent must match what came back.
    const expectedState = sessionStorage.getItem("ig_oauth_state");
    if (expectedState && state && expectedState !== state) {
      setStatus({
        kind: "error",
        message: "보안 검증 실패 (state mismatch). 다시 시도해 주세요.",
      });
      sessionStorage.removeItem("ig_oauth_state");
      return;
    }
    sessionStorage.removeItem("ig_oauth_state");

    api.instagram
      .completeAuth(code)
      .then((account) => setStatus({ kind: "success", account }))
      .catch((err: Error) =>
        setStatus({ kind: "error", message: err.message }),
      );
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 max-w-md w-full">
        {status.kind === "loading" && (
          <>
            <h1 className="text-lg font-semibold mb-2">Instagram 연결 중...</h1>
            <p className="text-sm text-gray-500">잠시만 기다려 주세요.</p>
          </>
        )}

        {status.kind === "success" && (
          <>
            <h1 className="text-lg font-semibold mb-2">연결 완료</h1>
            <p className="text-sm text-gray-600 mb-1">
              <span className="font-mono">@{status.account.username}</span> 계정이
              연결되었습니다.
            </p>
            <p className="text-xs text-gray-400 mb-4">
              토큰 만료:{" "}
              {new Date(status.account.token_expires_at).toLocaleDateString()}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => navigate("/instagram")}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800"
              >
                계정 관리로
              </button>
              <button
                onClick={() => navigate("/feed")}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
              >
                피드로
              </button>
            </div>
          </>
        )}

        {status.kind === "error" && (
          <>
            <h1 className="text-lg font-semibold mb-2 text-red-600">
              연결 실패
            </h1>
            <p className="text-sm text-gray-700 whitespace-pre-wrap mb-4">
              {status.message}
            </p>
            <button
              onClick={() => navigate("/instagram")}
              className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
            >
              계정 관리로 돌아가기
            </button>
          </>
        )}
      </div>
    </div>
  );
}
