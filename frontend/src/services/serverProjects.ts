import { buildVlxPayload, importVlxFile, type VlxPayload } from '../utils/vlxFile';

export interface ServerProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
}

let active: ServerProjectMeta | null = null;
const BASE = '/api/local-projects';

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Project request failed (${response.status})`);
  return data as T;
}

export const activeServerProject = () => active;
export const clearActiveServerProject = () => { active = null; };

export async function listServerProjects(): Promise<ServerProjectMeta[]> {
  return (await jsonRequest<{ projects: ServerProjectMeta[] }>('')).projects;
}

export async function saveServerProject(name: string, newProject = false): Promise<ServerProjectMeta> {
  const id = !newProject && active ? active.id : crypto.randomUUID();
  const project = buildVlxPayload({ name });
  const saved = await jsonRequest<ServerProjectMeta>(`/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, project }),
  });
  active = saved;
  return saved;
}

export async function openServerProject(id: string): Promise<ServerProjectMeta> {
  const record = await jsonRequest<ServerProjectMeta & { project: VlxPayload }>(`/${id}`);
  // Reuse the same validation and store hydration as a downloaded .vlx file.
  await importVlxFile(new File([JSON.stringify(record.project)], `${record.name}.vlx`, { type: 'application/json' }), { fromServer: true });
  active = { id: record.id, name: record.name, updatedAt: record.updatedAt };
  return active;
}

export async function deleteServerProject(id: string): Promise<void> {
  await jsonRequest(`/${id}`, { method: 'DELETE' });
  if (active?.id === id) active = null;
}
