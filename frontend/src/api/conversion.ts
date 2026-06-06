import client from './client';
import type { TaskListResponse, TaskResponse, ScreenplayData, EvaluationData } from '../types';

export async function uploadFile(file: File, model?: string): Promise<{ task_id: number; status: string }> {
  const form = new FormData();
  form.append('file', file);
  if (model) form.append('model', model);
  const { data } = await client.post('/conversion/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function getTasks(status?: string, limit = 20, offset = 0): Promise<TaskListResponse> {
  const { data } = await client.get('/conversion/tasks', { params: { status, limit, offset } });
  return data;
}

export async function getTask(taskId: number): Promise<TaskResponse> {
  const { data } = await client.get(`/conversion/tasks/${taskId}`);
  return data;
}

export async function getScreenplay(taskId: number): Promise<ScreenplayData> {
  const { data } = await client.get(`/conversion/tasks/${taskId}/screenplay`);
  return data;
}

export async function getEvaluation(taskId: number): Promise<EvaluationData> {
  const { data } = await client.get(`/conversion/tasks/${taskId}/evaluation`);
  return data;
}

export async function deleteTask(taskId: number): Promise<void> {
  await client.delete(`/conversion/tasks/${taskId}`);
}

export async function getYamlContent(taskId: number): Promise<string> {
  const { data } = await client.get(`/conversion/tasks/${taskId}/yaml`, {
    responseType: 'text',
  });
  return data;
}

export async function downloadYaml(taskId: number, filename: string): Promise<void> {
  const { data } = await client.get(`/conversion/tasks/${taskId}/yaml`, {
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export interface UpdateScreenplayResult {
  title: string;
  character_count: number;
  act_count: number;
  scene_count: number;
}

export async function updateScreenplay(taskId: number, yaml_content: string): Promise<UpdateScreenplayResult> {
  const { data } = await client.put(`/conversion/tasks/${taskId}/screenplay`, { yaml_content });
  return data;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChangeItem {
  type: 'modify' | 'add' | 'delete';
  target: string;
  description: string;
}

export interface ChatEditResponse {
  modified_yaml: string;
  change_summary: string;
  changes: ChangeItem[];
  session_id?: number;
}

export async function chatEdit(
  taskId: number,
  instruction: string,
  currentYaml: string,
  conversationHistory?: ChatMessage[],
  sessionId?: number,
): Promise<ChatEditResponse> {
  const { data } = await client.post(`/conversion/tasks/${taskId}/chat`, {
    instruction,
    current_yaml: currentYaml,
    conversation_history: conversationHistory || [],
    session_id: sessionId ?? null,
  });
  return data;
}

// Chat session / history types

export interface ChatMessageResponse {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  change_summary?: string | null;
  changes?: ChangeItem[] | null;
  accepted?: boolean | null;
  rejected?: boolean | null;
  created_at: string;
}

export interface ChatSessionResponse {
  session_id: number;
  title?: string | null;
  message_count: number;
  messages: ChatMessageResponse[];
  created_at: string;
  updated_at: string;
}

export async function getChatSession(taskId: number): Promise<ChatSessionResponse> {
  const { data } = await client.get(`/conversion/tasks/${taskId}/chat/session`);
  return data;
}

export async function deleteChatSession(taskId: number): Promise<void> {
  await client.delete(`/conversion/tasks/${taskId}/chat/session`);
}

export async function exportChatSession(taskId: number, format: 'json' | 'markdown' = 'json'): Promise<void> {
  const { data } = await client.get(`/conversion/tasks/${taskId}/chat/session/export`, {
    params: { format },
    responseType: 'blob',
  });
  const ext = format === 'markdown' ? 'md' : 'json';
  const mime = format === 'markdown' ? 'text/markdown' : 'application/json';
  const url = window.URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `chat_export.${ext}`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
