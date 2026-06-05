import { useState, useEffect } from 'react';
import { getStats } from '../api/admin';
import type { SystemStats } from '../types';
import StatusBadge from '../components/common/StatusBadge';
import { TableSkeleton } from '../components/common/Skeleton';
import { useToast } from '../contexts/ToastContext';

export default function AdminDashboardPage() {
  const { error: toastError } = useToast();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch(() => toastError('加载统计数据失败'))
      .finally(() => setLoading(false));
  }, [toastError]);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">管理面板</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 space-y-2">
              <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded h-8 w-16" />
              <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded h-4 w-20" />
            </div>
          ))}
        </div>
        <h2 className="text-lg font-bold mb-4">最近任务</h2>
        <TableSkeleton rows={5} cols={5} />
      </div>
    );
  }
  if (!stats) return <p className="text-red-600">加载统计数据失败</p>;

  const cards = [
    { label: '用户总数', value: stats.total_users, color: 'text-blue-600' },
    { label: '转换任务', value: stats.total_tasks, color: 'text-purple-600' },
    { label: '成功率', value: `${stats.success_rate}%`, color: 'text-green-600' },
    { label: '处理中', value: stats.processing_tasks, color: 'text-yellow-600' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">管理面板</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(c => (
          <div key={c.label} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
            <p className={`text-3xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-sm text-gray-500 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold mb-4">最近任务</h2>
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
              <th className="text-left px-4 py-3">ID</th>
              <th className="text-left px-4 py-3">用户</th>
              <th className="text-left px-4 py-3">文件</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">时间</th>
            </tr>
          </thead>
          <tbody>
            {stats.recent_tasks.map(t => (
              <tr key={t.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="px-4 py-3">{t.id}</td>
                <td className="px-4 py-3">{t.username}</td>
                <td className="px-4 py-3 max-w-xs truncate">{t.original_filename}</td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-gray-500">{new Date(t.created_at).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
