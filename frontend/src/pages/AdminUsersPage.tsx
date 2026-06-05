import { useState, useEffect, useCallback } from 'react';
import { getUsers, updateUser, deleteUser } from '../api/admin';
import type { AdminUser } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import Pagination from '../components/common/Pagination';
import { TableSkeleton } from '../components/common/Skeleton';

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const { error: toastError } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 10;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getUsers(search, '', limit, offset);
      setUsers(res.items);
      setTotal(res.total);
    } catch {
      toastError('加载用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [search, offset, toastError]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRoleToggle = async (userId: number, newRole: string) => {
    try {
      await updateUser(userId, { role: newRole });
      fetchUsers();
    } catch {
      toastError('更新用户角色失败');
    }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm('确定删除此用户？所有相关数据将被删除。')) return;
    try {
      await deleteUser(userId);
      fetchUsers();
    } catch {
      toastError('删除用户失败');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">用户管理</h1>

      <div className="flex gap-4 mb-6">
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }}
          placeholder="搜索用户名或邮箱..."
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent" />
        <span className="text-sm text-gray-500 self-center">共 {total} 个用户</span>
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
                <th className="text-left px-4 py-3">ID</th>
                <th className="text-left px-4 py-3">用户名</th>
                <th className="text-left px-4 py-3">邮箱</th>
                <th className="text-left px-4 py-3">角色</th>
                <th className="text-left px-4 py-3">任务数</th>
                <th className="text-left px-4 py-3">状态</th>
                <th className="text-left px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-3">{u.id}</td>
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <select value={u.role} onChange={e => handleRoleToggle(u.id, e.target.value)}
                      disabled={u.id === me?.id}
                      className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-transparent">
                      <option value="user">用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">{u.task_count}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${u.is_active ? 'text-green-600' : 'text-red-600'}`}>
                      {u.is_active ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                      className="text-xs text-blue-600 hover:underline mr-3">
                      {u.is_active ? '禁用' : '启用'}
                    </button>
                    {u.id !== me?.id && (
                      <button onClick={() => handleDelete(u.id)}
                        className="text-xs text-red-600 hover:underline">
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-4">
            <Pagination total={total} limit={limit} offset={offset} onPageChange={setOffset} />
          </div>
        </div>
      )}
    </div>
  );
}
