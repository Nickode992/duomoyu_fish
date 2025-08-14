// Minimal Cloudflare Worker to serve static assets and implement critical API endpoints.
// Critical scope for MVP:
// - GET /api/fish and GET /api/fish/:id
// - POST /api/vote
// - POST /uploadfish (multipart) -> store image in R2, record in D1
// - Auth: accept optional Authorization Bearer (no full auth yet)

/**
 * @typedef {import('@cloudflare/workers-types').D1Database} D1Database
 * @typedef {import('@cloudflare/workers-types').R2Bucket} R2Bucket
 */

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		try {
			// Route API first
			if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth') || url.pathname === '/uploadfish' || url.pathname.startsWith('/r2/')) {
				return await handleApi(request, env, ctx);
			}
			// Serve ONNX model from R2 to avoid asset size limits
			if (url.pathname === '/fish_doodle_classifier.onnx') {
				const proxyReq = new Request(new URL('/r2/models/fish_doodle_classifier.onnx', url.origin), request);
				return await getR2Object(proxyReq, env);
			}
			// Otherwise, serve static assets
			return await env.ASSETS.fetch(request);
		} catch (e) {
			return new Response(JSON.stringify({ error: 'Internal error', message: String(e && e.message || e) }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
		}
	},
};

/**
 * @param {Request} request
 * @param {{ DB: D1Database, BUCKET: R2Bucket, ASSETS: Fetcher, JWT_SECRET?: string }} env
 */
async function handleApi(request, env) {
	const url = new URL(request.url);
	const method = request.method.toUpperCase();

	// Routing
	if (url.pathname === '/api/fish' && method === 'GET') {
		return listFish(request, env);
	}
	if (url.pathname.startsWith('/api/fish/') && method === 'GET') {
		const id = url.pathname.split('/').pop();
		return getFishById(env, id);
	}
	if (url.pathname === '/api/vote' && method === 'POST') {
		return voteFish(request, env);
	}
	if (url.pathname.startsWith('/uploadfish') && method === 'POST') {
		return uploadFish(request, env);
	}
	if (url.pathname.startsWith('/r2/') && method === 'GET') {
		return getR2Object(request, env);
	}
	if (url.pathname.startsWith('/r2/') && method === 'OPTIONS') {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Range',
				'Access-Control-Max-Age': '86400',
			},
		});
	}
	if (url.pathname === '/api/report' && method === 'POST') {
		return reportFish(request, env);
	}

	// Not implemented yet
	return json({ error: 'Not implemented' }, 404);
}

function json(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
	});
}

function badRequest(message) { return json({ error: message }, 400); }

async function listFish(request, env) {
	// Supports orderBy, order, limit, random, isVisible, deleted, startAfter, userId
	const url = new URL(request.url);
	const orderBy = url.searchParams.get('orderBy') || 'CreatedAt';
	const order = (url.searchParams.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10), 100);
	const userId = url.searchParams.get('userId');
	const isVisible = url.searchParams.get('isVisible');
	const deleted = url.searchParams.get('deleted');
	const random = url.searchParams.get('random') === 'true';

	const validOrderBy = ['CreatedAt', 'score', 'hotScore'];
	const orderCol = validOrderBy.includes(orderBy) ? orderBy : 'CreatedAt';

	let where = [];
	let params = [];
	if (userId) { where.push('userId = ?'); params.push(userId); }
	if (isVisible != null) { where.push('isVisible = ?'); params.push(isVisible === 'true' ? 1 : 0); }
	if (deleted != null) { where.push('deleted = ?'); params.push(deleted === 'true' ? 1 : 0); }
	const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

	let sql;
	if (random) {
		sql = `SELECT * FROM fish ${whereSql} ORDER BY RANDOM() LIMIT ?`;
		params.push(limit);
	} else {
		sql = `SELECT * FROM fish ${whereSql} ORDER BY ${orderCol} ${order} LIMIT ?`;
		params.push(limit);
	}

	const stmt = env.DB.prepare(sql).bind(...params);
	const res = await stmt.all();
	const data = (res.results || []).map(rowToFishItem);
	return json({ data });
}

async function getFishById(env, id) {
	if (!id) return badRequest('Missing id');
	const res = await env.DB.prepare('SELECT * FROM fish WHERE id = ?').bind(id).first();
	if (!res) return json({ error: 'Not found' }, 404);
	return json({ data: rowToFishItem(res) });
}

async function voteFish(request, env) {
	const body = await safeJson(request);
	if (!body || !body.fishId || !body.vote) return badRequest('fishId and vote are required');
	const delta = body.vote === 'up' ? 1 : body.vote === 'down' ? -1 : 0;
	if (delta === 0) return badRequest('vote must be "up" or "down"');

	// Update votes atomically
	const sql = delta > 0
		? 'UPDATE fish SET upvotes = COALESCE(upvotes,0)+1, score = COALESCE(upvotes,0)+1 - COALESCE(downvotes,0) WHERE id = ?'
		: 'UPDATE fish SET downvotes = COALESCE(downvotes,0)+1, score = COALESCE(upvotes,0) - (COALESCE(downvotes,0)+1) WHERE id = ?';
	const res = await env.DB.prepare(sql).bind(body.fishId).run();
	if (res.success === false) return json({ error: 'Vote failed' }, 500);
	const after = await env.DB.prepare('SELECT * FROM fish WHERE id = ?').bind(body.fishId).first();
	return json({ success: true, data: rowToFishItem(after) });
}

async function uploadFish(request, env) {
	const form = await request.formData();
	const file = form.get('image');
	const artist = (form.get('artist') || 'Anonymous').toString();
	const needsModeration = (form.get('needsModeration') || 'false').toString() === 'true';
	const userId = form.get('userId') ? form.get('userId').toString() : crypto.randomUUID();
	if (!file || typeof file.arrayBuffer !== 'function') return badRequest('image is required');

	// Store image to R2
	const arrayBuffer = await file.arrayBuffer();
	const id = crypto.randomUUID();
	const objectKey = `fish/${id}.png`;
	await env.BUCKET.put(objectKey, arrayBuffer, {
		httpMetadata: { contentType: 'image/png' },
	});
	const publicUrl = publicR2UrlFromRequest(request, objectKey);

	// Insert DB row
	const nowIso = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO fish (id, userId, artist, image, CreatedAt, isVisible, deleted, upvotes, downvotes, score, hotScore, needsModeration)
		 VALUES (?, ?, ?, ?, ?, 1, 0, 0, 0, 0, 0, ?)`
	).bind(id, userId, artist, publicUrl, nowIso, needsModeration ? 1 : 0).run();

	return json({ success: true, data: { id, userId, artist, Image: publicUrl } }, 201);
}

async function getR2Object(request, env) {
	const key = new URL(request.url).pathname.replace(/^\/r2\//, '');
	if (!key) return badRequest('Missing key');
	const obj = await env.BUCKET.get(key);
	if (!obj) return json({ error: 'Not found' }, 404);
	const headers = new Headers();
	obj.writeHttpMetadata(headers);
	headers.set('etag', obj.httpEtag);
	// CORS for cross-origin image usage in <img crossOrigin="anonymous"> and canvas operations
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Vary', 'Origin');
	return new Response(obj.body, { headers });
}

function publicR2UrlFromRequest(request, key) {
	const origin = new URL(request.url).origin;
	return `${origin}/r2/${key}`;
}

async function safeJson(request) {
	try { return await request.json(); } catch { return null; }
}

function rowToFishItem(row) {
	return {
		id: row.id,
		data: {
			id: row.id,
			userId: row.userId,
			artist: row.artist,
			image: row.image,
			CreatedAt: row.CreatedAt,
			isVisible: row.isVisible === 1,
			deleted: row.deleted === 1,
			upvotes: row.upvotes || 0,
			downvotes: row.downvotes || 0,
			score: row.score || 0,
			hotScore: row.hotScore || 0,
			needsModeration: row.needsModeration === 1,
		},
	};
}

async function reportFish(request, env) {
	const body = await safeJson(request);
	if (!body || !body.fishId || !body.reason) return badRequest('fishId and reason are required');
	await env.DB
		.prepare(
			`INSERT INTO reports (id, fishId, reason, userAgent, url, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			body.fishId,
			body.reason,
			body.userAgent || '',
			body.url || '',
			new Date().toISOString()
		)
		.run();
	return json({ success: true });
}


