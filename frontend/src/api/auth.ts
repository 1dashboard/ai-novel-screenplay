import client from './client';
import type { AuthResponse, User } from '../types';

export async function register(username: string, email: string, password: string): Promise<AuthResponse> {
  const { data } = await client.post('/auth/register', { username, email, password });
  return data;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const { data } = await client.post('/auth/login', { username, password });
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await client.get('/auth/me');
  return data;
}

export async function logout(refreshToken: string): Promise<void> {
  await client.post('/auth/logout', { refresh_token: refreshToken });
}

export async function forgotPassword(email: string): Promise<{ detail: string; token?: string }> {
  const { data } = await client.post('/auth/forgot-password', { email });
  return data;
}

export async function resetPassword(token: string, new_password: string): Promise<{ detail: string }> {
  const { data } = await client.post('/auth/reset-password', { token, new_password });
  return data;
}
