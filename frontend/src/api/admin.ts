import client from './client';
import type { SystemStats, AdminUserList, AdminUser } from '../types';

export async function getStats(): Promise<SystemStats> {
  const { data } = await client.get('/admin/stats');
  return data;
}

export async function getUsers(search = '', role = '', limit = 20, offset = 0): Promise<AdminUserList> {
  const { data } = await client.get('/admin/users', { params: { search, role, limit, offset } });
  return data;
}

export async function getUser(userId: number): Promise<AdminUser> {
  const { data } = await client.get(`/admin/users/${userId}`);
  return data;
}

export async function updateUser(userId: number, updates: { role?: string; is_active?: boolean }): Promise<AdminUser> {
  const { data } = await client.put(`/admin/users/${userId}`, updates);
  return data;
}

export async function deleteUser(userId: number): Promise<void> {
  await client.delete(`/admin/users/${userId}`);
}
