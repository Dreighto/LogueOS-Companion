import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildBundleZip, bundleFilename } from '../../_artifactService';

export const GET: RequestHandler = async ({ params }) => {
	const traceId = params.trace_id;
	const zip = buildBundleZip(traceId);
	if (!zip) {
		return error(404, 'trace_not_found');
	}

	const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'application/zip',
			'content-length': String(zip.length),
			'content-disposition': `attachment; filename="${bundleFilename(traceId)}"`,
			'cache-control': 'no-store'
		}
	});
};
