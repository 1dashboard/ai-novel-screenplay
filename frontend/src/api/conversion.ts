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
