import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // When true, the confirm button is red (delete / destructive intent)
  // and defaults to label "삭제". When false / unset, it's neutral.
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((input) => {
    const opts: ConfirmOptions =
      typeof input === "string" ? { message: input } : input;
    return new Promise<boolean>((resolve) => {
      // If a previous dialog is still open (shouldn't happen in normal
      // flows), resolve it as cancelled before showing the new one so
      // its promise doesn't dangle.
      setPending((prev) => {
        prev?.resolve(false);
        return { opts, resolve };
      });
    });
  }, []);

  const close = useCallback(
    (result: boolean) => {
      setPending((prev) => {
        prev?.resolve(result);
        return null;
      });
    },
    [],
  );

  // ESC = cancel, Enter = confirm. We attach the listener only while a
  // dialog is open so it doesn't interfere with page shortcuts.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4"
          onClick={() => close(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg w-full max-w-sm p-5 shadow-xl"
          >
            {pending.opts.title && (
              <h3 className="text-base font-semibold mb-2">
                {pending.opts.title}
              </h3>
            )}
            <p className="text-sm text-gray-700 mb-5 whitespace-pre-line">
              {pending.opts.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
              >
                {pending.opts.cancelLabel ?? "취소"}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                autoFocus
                className={`px-4 py-2 text-sm text-white rounded-md ${
                  pending.opts.destructive
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-gray-900 hover:bg-gray-800"
                }`}
              >
                {pending.opts.confirmLabel ??
                  (pending.opts.destructive ? "삭제" : "확인")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return ctx;
}
