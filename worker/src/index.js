// Minimal Cloudflare Worker to serve static assets and implement critical API endpoints.
// Critical scope for MVP:
// - GET /api/fish and GET /api/fish/:id
// - POST /api/vote
// - POST /uploadfish (multipart) -> store image in R2, record in D1
// - Auth: minimal email/password reset endpoints

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

    // Auth: forgot/reset password
    if (url.pathname === '/auth/forgot-password' && method === 'POST') {
        return forgotPassword(request, env);
    }
    if (url.pathname === '/auth/reset-password' && method === 'POST') {
        return resetPassword(request, env);
    }
	if (url.pathname === '/auth/register' && method === 'POST') {
		return register(request, env);
	}
	if (url.pathname === '/auth/login' && method === 'POST') {
		return login(request, env);
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
function unauthorized(message) { return json({ error: message }, 401); }
function conflict(message) { return json({ error: message }, 409); }

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

// ===== Auth: forgot/reset password =====

async function forgotPassword(request, env) {
    const body = await safeJson(request);
    if (!body || !body.email) return badRequest('email is required');
    const email = String(body.email).trim().toLowerCase();

    // Check if user exists
    const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();
    // To avoid user enumeration, proceed silently even if not exists

    // Create token valid for 30 minutes
    const token = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const createdAt = now.toISOString();

    await env.DB.prepare(
        'INSERT INTO password_resets (token, email, createdAt, expiresAt, used) VALUES (?, ?, ?, ?, 0)'
    ).bind(token, email, createdAt, expiresAt).run();

    // Build reset URL
    const baseUrl = body.baseUrl || new URL(request.url).origin; // allow override for staging
    const resetUrl = `${baseUrl}/reset-password.html?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    // Send email using Resend or Email Routing binding
    try {
        await sendResetEmail(env, email, resetUrl);
    } catch (e) {
        // Still return 200 to avoid leaking info; log error
        console.log('Failed to send reset email:', e);
    }
    return json({ success: true });
}

async function resetPassword(request, env) {
    const body = await safeJson(request);
    if (!body || !body.email || !body.token || !body.newPassword) {
        return badRequest('email, token and newPassword are required');
    }
    const email = String(body.email).trim().toLowerCase();
    const token = String(body.token);
    const newPassword = String(body.newPassword);
    if (newPassword.length < 6) return badRequest('password too short');

    const rec = await env.DB.prepare('SELECT token, email, expiresAt, used FROM password_resets WHERE token = ? AND email = ?')
        .bind(token, email).first();
    if (!rec) return unauthorized('invalid token');
    if (rec.used === 1) return unauthorized('token already used');
    if (new Date(rec.expiresAt).getTime() < Date.now()) return unauthorized('token expired');

    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (!user) return unauthorized('invalid user');

    const passwordHash = await hashPassword(newPassword);
    await env.DB.prepare('UPDATE users SET passwordHash = ? WHERE email = ?').bind(passwordHash, email).run();
    await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').bind(token).run();

    return json({ success: true });
}

async function hashPassword(password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
    const hashBytes = new Uint8Array(bits);
    // Store as base64: iterations.salt.hash
    const b64 = (u) => btoa(String.fromCharCode(...u));
    return `100000.${b64(salt)}.${b64(hashBytes)}`;
}

async function verifyPassword(password, stored) {
    const enc = new TextEncoder();
    const [iterStr, saltB64, hashB64] = String(stored).split('.');
    const iterations = parseInt(iterStr, 10);
    if (!iterations || !saltB64 || !hashB64) return false;
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const expected = Uint8Array.from(atob(hashB64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    const derived = new Uint8Array(bits);
    if (derived.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
    return diff === 0;
}

async function sendResetEmail(env, toEmail, resetUrl) {
    // Preferred: Resend API via RESEND_API_KEY and RESEND_FROM
    if (env.RESEND_API_KEY && env.RESEND_FROM) {
        const subject = 'Reset your duomoyu.life password';
        const html = `<p>Click the link below to reset your password. This link expires in 30 minutes.</p>
<p><a href="${resetUrl}">Reset Password</a></p>
<p>If you did not request this, you can ignore this email.</p>`;
        const payload = {
            from: env.RESEND_FROM,
            to: toEmail,
            subject,
            html
        };
        const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`Resend failed: ${resp.status} ${txt}`);
        }
        return;
    }
    // Alternative: Cloudflare Email Routing binding (if configured)
    if (env.RESET_EMAIL && env.SENDER_EMAIL && env.SENDER_NAME && env.RECIPIENT_OVERRIDE) {
        // Placeholder for Email Routing send via binding, if added later
        // For now, fallback not implemented to avoid silent failures
        throw new Error('Email Routing send not configured in this Worker');
    }
    throw new Error('No email sending configured');
}

// ===== Auth: register/login with email/password =====

async function register(request, env) {
    const body = await safeJson(request);
    if (!body || !body.email || !body.password) return badRequest('email and password are required');
    const email = String(body.email).trim().toLowerCase();
    const password = String(body.password);
    const displayName = String(body.displayName || 'Anonymous');
    if (password.length < 6) return badRequest('password too short');

    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) return conflict('email already registered');

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
        'INSERT INTO users (id, email, passwordHash, displayName, isAdmin, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
    ).bind(id, email, passwordHash, displayName, createdAt).run();

    // Optional: merge anonymous fish
    if (body.userId) {
        try {
            await env.DB.prepare('UPDATE fish SET userId = ? WHERE userId = ?').bind(id, String(body.userId)).run();
        } catch (e) { console.log('merge anon fish failed:', e); }
    }

    const token = await signJwt({ sub: id, email }, env.JWT_SECRET);
    return json({ token, user: { id, email, displayName, isAdmin: false } });
}

async function login(request, env) {
    const body = await safeJson(request);
    if (!body || !body.email || !body.password) return badRequest('email and password are required');
    const email = String(body.email).trim().toLowerCase();
    const password = String(body.password);

    const user = await env.DB.prepare('SELECT id, email, passwordHash, displayName, isAdmin FROM users WHERE email = ?')
        .bind(email).first();
    if (!user) return unauthorized('invalid credentials');

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return unauthorized('invalid credentials');

    // Optional: merge anonymous fish on first login
    if (body.userId) {
        try {
            await env.DB.prepare('UPDATE fish SET userId = ? WHERE userId = ?').bind(user.id, String(body.userId)).run();
        } catch (e) { console.log('merge anon fish failed:', e); }
    }

    const token = await signJwt({ sub: user.id, email: user.email, isAdmin: user.isAdmin === 1 }, env.JWT_SECRET);
    return json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, isAdmin: user.isAdmin === 1 } });
}

async function signJwt(payload, secret) {
    if (!secret) throw new Error('JWT_SECRET not configured');
    // Minimal HS256 JWT
    const enc = new TextEncoder();
    const header = { alg: 'HS256', typ: 'JWT' };
    const nowSec = Math.floor(Date.now() / 1000);
    const withExp = { ...payload, iat: nowSec, exp: nowSec + 60 * 60 * 24 * 7 }; // 7 days
    const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const data = `${b64url(header)}.${b64url(withExp)}`;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${data}.${sigB64}`;
}


