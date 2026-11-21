import './styles/fonts.css';
import './styles/tokens.css';
import './styles/palettes.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/backgrounds.css';
import { createBackend } from './api';
import { installImageFallback } from './lib/dom';
import { Router } from './router';
import { routes } from './routes';
import { mountShell } from './ui/shell/shell';

async function boot(): Promise<void> {
  installImageFallback();
  const backend = await createBackend();
  if (backend.mode === 'demo') document.documentElement.dataset.demo = '';

  let router: Router | undefined;
  const shell = mountShell({ backend, navigate: p => router?.navigate(p) });
  router = new Router({ routes, backend, shell, view: shell.view });

  shell.setUser(backend.currentUser());
  backend.onAuthChange(u => { shell.setUser(u); router?.reguard(); });
  router.start();
}

void boot();
