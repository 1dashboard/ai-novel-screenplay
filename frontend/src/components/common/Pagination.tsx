interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (offset: number) => void;
}

export default function Pagination({ total, limit, offset, onPageChange }: PaginationProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);

  const pages: number[] = [];
  const maxVisible = 5;
  let rangeStart = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let rangeEnd = Math.min(totalPages, rangeStart + maxVisible - 1);
  if (rangeEnd - rangeStart + 1 < maxVisible) {
    rangeStart = Math.max(1, rangeEnd - maxVisible + 1);
  }
  for (let i = rangeStart; i <= rangeEnd; i++) {
    pages.push(i);
  }

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-4 mt-6 text-sm">
      <span className="text-gray-500 dark:text-gray-400">
        共 {total} 条，显示 {start}–{end}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          上一页
        </button>
        {rangeStart > 1 && (
          <>
            <button
              onClick={() => onPageChange(0)}
              className="w-9 h-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              1
            </button>
            {rangeStart > 2 && <span className="px-1 text-gray-400">...</span>}
          </>
        )}
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange((p - 1) * limit)}
            className={`w-9 h-9 rounded-lg transition-colors font-medium ${
              p === currentPage
                ? 'bg-blue-600 text-white shadow-sm'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {p}
          </button>
        ))}
        {rangeEnd < totalPages && (
          <>
            {rangeEnd < totalPages - 1 && <span className="px-1 text-gray-400">...</span>}
            <button
              onClick={() => onPageChange((totalPages - 1) * limit)}
              className="w-9 h-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {totalPages}
            </button>
          </>
        )}
        <button
          onClick={() => onPageChange(offset + limit)}
          disabled={offset + limit >= total}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
