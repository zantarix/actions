import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export async function downloadArtifact(version, artifact, destPath) {
	const url = `https://github.com/zantarix/cursus/releases/download/cursus@${version}/${artifact}`;

	mkdirSync(dirname(destPath), { recursive: true });

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`,
		);
	}

	const writer = createWriteStream(destPath);
	await pipeline(Readable.fromWeb(response.body), writer);
}
