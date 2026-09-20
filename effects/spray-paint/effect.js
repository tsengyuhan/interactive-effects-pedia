import { createController } from './controller.mjs';
import { createHost } from './host.mjs';

const shell = Shell.init({ id: 'spray-paint' });
document.body.classList.add('spray-page');
// 手機需要完整控制面積，操作說明仍可由既有資訊按鈕開啟。
document.querySelector('.shell-close-button')?.click();
const app = document.createElement('main');
app.className = 'spray-app'; shell.container.append(app);
const controller = new URLSearchParams(location.search).get('controller') === '1';
const dispose = controller ? createController(app) : createHost(app);
window.addEventListener('pagehide', dispose, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
