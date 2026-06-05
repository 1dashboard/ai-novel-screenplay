import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getTasks, deleteTask, downloadYaml } from '../api/conversion';
import ExportMenu from '../components/conversion/ExportMenu';
import type { TaskResponse } from '../types';
import FileUploader from '../components/conversion/FileUploader';
import StatusBadge from '../components/common/StatusBadge';
import ProgressBar from '../components/common/ProgressBar';
import Pagination from '../components/common/Pagination';
import { TaskListSkeleton } from '../components/common/Skeleton';
import { useToast } from '../contexts/ToastContext';

const FILTERS: [string, string][] = [
  ['', '全部'],
  ['completed', '已完成'],
  ['processing', '处理中'],
  ['failed', '失败'],
];

export default function DashboardPage() {
  const [tasks, setTasks] = useState<TaskResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 10;
  const { error: toastError } = useToast();

  const fetchTasks = useCallback(async () => {
    try {
      const res = await getTasks(statusFilter || undefined, limit, offset);
      setTasks(res.items);
      setTotal(res.total);
    } catch {
      toastError('加载任务列表失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, offset, toastError]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Poll for in-progress tasks
  useEffect(() => {
    const hasProcessing = tasks.some(t => t.status === 'pending' || t.status === 'processing');
    if (!hasProcessing) return;
    const timer = setInterval(fetchTasks, 3000);
    return () => clearInterval(timer);
  }, [tasks, fetchTasks]);

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此任务？')) return;
    try {
      await deleteTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
    } catch {
      toastError('删除失败，请重试');
    }
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
  };

  const handleFilterChange = (key: string) => {
    setStatusFilter(key);
    setOffset(0);
  };

  const handleDownload = (task: TaskResponse) => {
    const filename = task.original_filename.replace(/\.[^.]+$/, '') + '_screenplay.yaml';
    downloadYaml(task.id, filename);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">我的任务</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">上传小说文件，AI 自动转换为剧本</p>
      </div>

      <FileUploader onUploaded={fetchTasks} />

      {/* Filters */}
      <div className="flex items-center gap-1.5 mb-6 bg-white dark:bg-gray-900 rounded-xl p-1 border border-gray-200 dark:border-gray-800 w-fit">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => handleFilterChange(key)}
            className={`px-3.5 py-1.5 text-sm rounded-lg font-medium transition-all ${
              statusFilter === key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && <TaskListSkeleton count={3} />}

      {/* Empty state */}
      {!loading && tasks.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📄</div>
          <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
            {statusFilter ? '没有匹配的任务' : '尚无任务'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {statusFilter ? '换个筛选条件试试' : '上传一个小说文件开始转换'}
          </p>
        </div>
      )}

      {/* Task list */}
      {!loading && tasks.length > 0 && (
        <div className="space-y-3">
          {tasks.map(task => (
            <div
              key={task.id}
              className="group bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-700 transition-all"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/tasks/${task.id}`}
                    className="font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 truncate block transition-colors"
                  >
                    {task.original_filename}
                  </Link>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <StatusBadge status={task.status} />
                    <span>{new Date(task.created_at).toLocaleString('zh-CN')}</span>
                    {task.chapter_count && <span>{task.chapter_count} 章</span>}
                    {task.score != null && task.status === 'completed' && (
                      <span className="font-semibold text-green-600 dark:text-green-400">评分 {task.score}/100</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {(task.status === 'pending' || task.status === 'processing') && (
                    <div className="w-40 hidden sm:block">
                      <ProgressBar progress={task.progress} />
                    </div>
                  )}
                  {task.status === 'completed' && (
                    <ExportMenu
                      taskId={task.id}
                      title={task.original_filename}
                      yamlAvailable
                      onDownloadYaml={() => handleDownload(task)}
                    />
                  )}
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="text-sm px-3 py-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title="删除任务"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
              {/* Mobile progress bar */}
              {(task.status === 'pending' || task.status === 'processing') && (
                <div className="mt-3 sm:hidden">
                  <ProgressBar progress={task.progress} />
                </div>
              )}
            </div>
          ))}
          <Pagination total={total} limit={limit} offset={offset} onPageChange={handlePageChange} />
        </div>
      )}
    </div>
  );
}
