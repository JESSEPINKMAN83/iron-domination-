import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['server/multiplayer-server.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT ?? '8787' } }),
  spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true }),
];

const stop = (code = 0) => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
};

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) stop(code);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
