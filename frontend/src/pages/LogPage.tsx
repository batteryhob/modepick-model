import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import type { GenerationJob } from "@/types";

export default function LogPage() {
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api.jobs.list(50, 0),
  });

  const { data: stats } = useQuery({
    queryKey: ["jobs", "stats"],
    queryFn: api.jobs.stats,
  });

  const formatMoney = (value: number | undefined | null, digits = 2) =>
    `$${(value ?? 0).toFixed(digits)}`;

  const formatDuration = (value: number | undefined | null) =>
    value && value > 0 ? `${(value / 1000).toFixed(1)}s` : "-";

  return (
    <div>
      <PageHeader title="생성 로그" subtitle="작업 이력과 비용" />

      {/* Cost Summary */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="border rounded-lg p-4 bg-white">
            <p className="text-xs font-mono text-gray-400">전체 작업</p>
            <p className="text-2xl font-semibold mt-1">{stats.total_jobs}</p>
          </div>
          <div className="border rounded-lg p-4 bg-white">
            <p className="text-xs font-mono text-gray-400">총 비용</p>
            <p className="text-2xl font-semibold mt-1">{formatMoney(stats.total_cost_usd)}</p>
          </div>
          <div className="border rounded-lg p-4 bg-white">
            <p className="text-xs font-mono text-gray-400">이번 달</p>
            <p className="text-2xl font-semibold mt-1">{formatMoney(stats.cost_this_month)}</p>
          </div>
          <div className="border rounded-lg p-4 bg-white">
            <p className="text-xs font-mono text-gray-400">평균 소요</p>
            <p className="text-2xl font-semibold mt-1">
              {formatDuration(stats.avg_duration_ms)}
            </p>
          </div>
        </div>
      )}

      {isLoading && <p className="text-gray-500">로딩 중...</p>}

      {/* Job List */}
      <div className="space-y-2">
        {jobs.map((job: GenerationJob) => (
          <div key={job.id} className="border rounded-lg p-4 bg-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full ${
                    job.status === "success"
                      ? "bg-emerald-500"
                      : job.status === "failed"
                      ? "bg-red-500"
                      : "bg-amber-500"
                  }`}
                />
                <div>
                  <p className="text-sm font-medium">
                    {job.type.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-gray-400">
                    {job.provider} / {job.model} / {new Date(job.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{formatMoney(job.cost_estimate_usd, 4)}</p>
                {job.duration_ms && (
                  <p className="text-xs text-gray-400">
                    {formatDuration(job.duration_ms)}
                  </p>
                )}
              </div>
            </div>
            {job.error_message && (
              <p className="text-xs text-red-500 mt-2">{job.error_message}</p>
            )}
          </div>
        ))}
      </div>

      {jobs.length === 0 && !isLoading && (
        <p className="text-center py-8 text-gray-400">아직 생성 작업이 없습니다.</p>
      )}
    </div>
  );
}
