/**
 * 使用 isomorphic-git（不依赖系统 git）初始化仓库、提交并推送到 GitHub。
 * 推送需要 Personal Access Token（classic 或 fine-grained，需 repo 权限）：
 *   export GITHUB_TOKEN=ghp_xxxx
 *   node scripts/push-to-github.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

const REPO_URL = 'https://github.com/susie-factory/stove-mcp.git';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIR = new Set(['node_modules', '.git', 'dist']);

function walk(rel = '') {
  const out = [];
  const full = path.join(root, rel);
  for (const name of fs.readdirSync(full)) {
    if (SKIP_DIR.has(name)) continue;
    const r = rel ? `${rel}/${name}` : name;
    const p = path.join(root, r);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(r));
    else out.push(r.replace(/\\/g, '/'));
  }
  return out;
}

async function ensureRemote() {
  const remotes = await git.listRemotes({ fs, dir: root });
  if (!remotes.some((x) => x.remote === 'origin')) {
    await git.addRemote({ fs, dir: root, remote: 'origin', url: REPO_URL });
    console.error('Added remote origin ->', REPO_URL);
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN?.trim();

  if (!fs.existsSync(path.join(root, '.git'))) {
    await git.init({ fs, dir: root, defaultBranch: 'main' });
    console.error('Initialized git repo (branch main).');
  }

  const files = walk();
  for (const filepath of files) {
    await git.add({ fs, dir: root, filepath });
  }

  try {
    const oid = await git.commit({
      fs,
      dir: root,
      message: process.env.GIT_COMMIT_MESSAGE || 'Initial commit: Stove Protocol MCP server',
      author: {
        name: process.env.GIT_AUTHOR_NAME || 'stove-mcp',
        email: process.env.GIT_AUTHOR_EMAIL || 'stove-mcp@users.noreply.github.com',
      },
    });
    console.error('Committed:', oid);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes('nothing to commit') || msg.includes('No changes')) {
      console.error('No new changes to commit.');
    } else {
      throw e;
    }
  }

  await ensureRemote();

  if (!token) {
    console.error('\n未设置 GITHUB_TOKEN，已仅完成本地提交。推送请执行：');
    console.error('  export GITHUB_TOKEN=你的_github_token');
    console.error('  node scripts/push-to-github.mjs\n');
    process.exit(0);
  }

  await git.push({
    fs,
    http,
    dir: root,
    remote: 'origin',
    ref: 'main',
    onAuth: () => ({
      username: process.env.GITHUB_USERNAME || 'x-access-token',
      password: token,
    }),
  });
  console.error('Pushed to', REPO_URL);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
