export default function ProgressBar({ progress, message }: { progress: number; message?: string | null }) {
  const pct = Math.min(100, Math.max(0, progress));

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-600 dark:text-gray-400 truncate">{message || '处理中...'}</span>
        <span className="text-gray-500 tabular-nums ml-2">{pct}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
