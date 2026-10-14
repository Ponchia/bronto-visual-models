import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
if (existsSync('src/react/styles.css')) {
  mkdirSync('dist/react', { recursive: true });
  copyFileSync('src/react/styles.css', 'dist/react/styles.css');
}
