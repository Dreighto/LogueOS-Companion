import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs';
import path from 'node:path';
import {
	ensureThumb,
	findArtifactMetadata,
	getTraceWorkspacePath,
	listArtifactsForTrace,
	metadataHeaders,
	mimeFromExtension,
	resolveArtifactFile
} from '../../_artifactService';

export const GET: RequestHandler = async ({ params, url, request }) => {
	const traceId = params.trace_id;
	const filepathParts = params.filepath ? params.filepath.split('/') : [];
	const joined = filepathParts.join('/');

	const listing = listArtifactsForTrace(traceId);
	if (!listing) {
		return error(404, 'trace_not_found');
	}

	if (joined.includes('..')) {
		return error(403, 'forbidden');
	}

	const workspacePath = getTraceWorkspacePath(traceId);
	if (!workspacePath) {
		return error(404, 'trace_not_found');
	}

	let absolutePath: string;
	try {
		absolutePath = resolveArtifactFile(workspacePath, filepathParts);
	} catch (e) {
		const status = (e as { status?: number }).status ?? 403;
		return error(status, 'forbidden');
	}

	const found = findArtifactMetadata(traceId, filepathParts);
	if (!found) {
		return error(404, 'not found');
	}

	if (found.absolutePath !== absolutePath) {
		return error(403, 'forbidden');
	}

	const { meta } = found;

	if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
		return error(404, 'not found');
	}

	// ?thumb=1 → serve a cached 240px webp thumbnail of an image/svg artifact,
	// generated lazily on first request. Non-thumbable types fall through to the
	// full file so the client always gets something.
	if (url.searchParams.get('thumb') === '1') {
		const thumbExt = path.extname(absolutePath).slice(1).toLowerCase();
		const thumbPath = await ensureThumb(absolutePath, thumbExt);
		if (thumbPath) {
			const tstat = fs.statSync(thumbPath);
			const tbuf = fs.readFileSync(thumbPath);
			const tbody = tbuf.buffer.slice(
				tbuf.byteOffset,
				tbuf.byteOffset + tbuf.byteLength
			) as ArrayBuffer;
			return new Response(tbody, {
				status: 200,
				headers: {
					'content-type': 'image/webp',
					'content-length': String(tstat.size),
					'cache-control': 'public, max-age=31536000, immutable',
					'x-content-type-options': 'nosniff'
				}
			});
		}
	}

	if (url.searchParams.get('meta') === '1') {
		return json(meta, { headers: metadataHeaders(meta) });
	}

	const ext = path.extname(absolutePath).slice(1).toLowerCase();
	const download = url.searchParams.get('download') === '1';
	const filename = path.basename(absolutePath).replace(/[^\w.\- ]/g, '_') || 'download';

	const stat = fs.statSync(absolutePath);
	const buf = fs.readFileSync(absolutePath);
	const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

	const headers: Record<string, string> = {
		...metadataHeaders(meta),
		'content-type': mimeFromExtension(ext),
		'content-length': String(stat.size),
		'content-disposition': download
			? `attachment; filename="${filename}"`
			: `inline; filename="${filename}"`,
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff'
	};

	// Best-effort Range support — full body if range parsing fails.
	const rangeHeader = request.headers.get('range');
	if (rangeHeader && !download) {
		const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
		if (match) {
			const total = stat.size;
			const start = match[1] ? Number.parseInt(match[1], 10) : 0;
			const end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
			if (
				Number.isFinite(start) &&
				Number.isFinite(end) &&
				start >= 0 &&
				end >= start &&
				end < total
			) {
				const slice = buf.subarray(start, end + 1);
				const sliceBody = slice.buffer.slice(
					slice.byteOffset,
					slice.byteOffset + slice.byteLength
				) as ArrayBuffer;
				headers['content-range'] = `bytes ${start}-${end}/${total}`;
				headers['content-length'] = String(slice.length);
				headers['accept-ranges'] = 'bytes';
				return new Response(sliceBody, { status: 206, headers });
			}
		}
	}

	return new Response(body, { status: 200, headers });
};
