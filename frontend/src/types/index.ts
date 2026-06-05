export interface User {
  id: number;
  username: string;
  email: string;
  role: 'user' | 'admin';
  is_active: boolean;
  created_at: string;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface AuthResponse {
  user: User;
  tokens: Tokens;
}

export interface TaskResponse {
  id: number;
  original_filename: string;
  file_size: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  progress_message: string | null;
  chapter_count: number | null;
  llm_provider: string | null;
  llm_model: string | null;
  error_message: string | null;
  screenplay_id: number | null;
  score: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskListResponse {
  items: TaskResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface CharacterData {
  id: string;
  name: string;
  aliases: string[];
  role: string;
  gender: string;
  age_range: string;
  traits: string[];
  description: string;
  relationships: { character_id: string; relation: string; description: string }[];
  first_appearance_scene: number | null;
}

export interface ContentElement {
  type: 'action' | 'dialogue' | 'parenthetical' | 'transition' | 'note';
  text: string;
  character_id?: string;
  character_name?: string;
  delivery?: string;
  severity?: string;
}

export interface SceneData {
  scene_number: number;
  scene_heading: string;
  location: string;
  time_of_day: string;
  characters_present: string[];
  summary: string;
  content: ContentElement[];
}

export interface ActData {
  act_number: number;
  title: string;
  scenes: SceneData[];
}

export interface ScreenplayData {
  meta: Record<string, unknown>;
  characters: CharacterData[];
  acts: ActData[];
}

export interface EvaluationData {
  score: number | null;
  summary: string;
}

export interface SystemStats {
  total_users: number;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  processing_tasks: number;
  success_rate: number;
  recent_tasks: { id: number; username: string; original_filename: string; status: string; created_at: string }[];
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  task_count: number;
  created_at: string;
}

export interface AdminUserList {
  items: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}
