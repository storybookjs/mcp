// Minimal static file server with SPA history fallback.
//
// Deliberately not `vite preview`: the app under test has been modified by an
// agent, and its vite config / node_modules are part of what may be broken.
// Serving the built `build/` directory with Node's own http module removes the
// app's tooling from the measurement path entirely.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.map': 'application/json; charset=utf-8',
};

/** Serve `root` on an ephemeral port. Returns { url, close, requests }. */
export async function serveStatic(root) {
	const requests = [];

	const server = createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost');
		// Reject traversal before touching the filesystem.
		const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
		let file = join(root, rel);

		if (!file.startsWith(root + sep) && file !== root) {
			res.writeHead(403).end('forbidden');
			return;
		}

		if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');

		// SPA fallback: unknown paths without a file extension are client routes.
		if (!existsSync(file)) {
			if (extname(rel) === '') {
				file = join(root, 'index.html');
			} else {
				requests.push({ path: url.pathname, status: 404 });
				res.writeHead(404).end('not found');
				return;
			}
		}

		requests.push({ path: url.pathname, status: 200 });
		res.writeHead(200, {
			'content-type': MIME[extname(file)] ?? 'application/octet-stream',
			'cache-control': 'no-store',
		});
		createReadStream(file).pipe(res);
	});

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();

	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}
