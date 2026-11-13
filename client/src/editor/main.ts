import './editor.css';
import { Editor } from './Editor.ts';

/** Le mappe incluse nel gioco, da aprire e modificare. */
const files = import.meta.glob('../../../content/maps/*.json', { eager: true, import: 'default' });
const bundled = new Map<string, unknown>(
  Object.entries(files)
    .map(([path, data]): [string, unknown] => [path.replace(/^.*\//, '').replace(/\.json$/, ''), data])
    .sort(([a], [b]) => a.localeCompare(b)),
);

const editor = new Editor(bundled);
if (import.meta.env.DEV) (window as unknown as { editor: Editor }).editor = editor;
