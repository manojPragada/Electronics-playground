import { useEffect, useState } from 'react';
import {
  deleteServerProject,
  listServerProjects,
  openServerProject,
  type ServerProjectMeta,
} from '../../services/serverProjects';
import { showConfirmDialog } from '../../store/useMessageDialogStore';
import './ServerProjectsDialog.css';

export function ServerProjectsDialog({ open, onClose, onLoaded }: { open: boolean; onClose: () => void; onLoaded?: (id: string) => void }) {
  const [projects, setProjects] = useState<ServerProjectMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    setError('');
    void listServerProjects()
      .then(setProjects)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  }, [open]);

  if (!open) return null;

  const load = async (project: ServerProjectMeta) => {
    if (!(await showConfirmDialog(`Open “${project.name}” from the Droplet? Unsaved changes in the current workspace will be lost.`, {
      confirmLabel: 'Open project', cancelLabel: 'Cancel',
    }))) return;
    setBusy(true);
    setError('');
    try {
      await openServerProject(project.id);
      onClose();
      onLoaded?.(project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const remove = async (project: ServerProjectMeta) => {
    if (!(await showConfirmDialog(`Delete “${project.name}” from the Droplet?`, {
      kind: 'error', danger: true, confirmLabel: 'Delete', cancelLabel: 'Cancel',
    }))) return;
    setBusy(true);
    setError('');
    try {
      await deleteServerProject(project.id);
      setProjects((items) => items.filter((item) => item.id !== project.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  return (
    <div className="server-projects-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="server-projects-dialog" role="dialog" aria-modal="true" aria-label="Projects on Droplet">
        <div className="server-projects-header">
          <div><h2>Projects on Droplet</h2><p>Saved privately on your server. Export .vlx to keep a copy on your device.</p></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {error && <p className="server-projects-error" role="alert">{error}</p>}
        {busy && <p>Loading…</p>}
        {!busy && projects.length === 0 && <p>No projects saved on the Droplet yet.</p>}
        <div className="server-projects-list">
          {projects.map((project) => (
            <div className="server-projects-row" key={project.id}>
              <div><strong>{project.name}</strong><small>Saved {new Date(project.updatedAt).toLocaleString()}</small></div>
              <button type="button" disabled={busy} onClick={() => void load(project)}>Open</button>
              <button type="button" disabled={busy} onClick={() => void remove(project)}>Delete</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
