import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVersion } from './src/version.js';
import { detectPlatform } from './src/platform.js';
import { downloadArtifact } from './src/download.js';
import { verifyArtifact } from './src/verify.js';
import { install } from './src/install.js';

function fail(message) {
	process.stderr.write(`Error: ${message}\n`);
	process.exitCode = 1;
}

async function run() {
	const version = resolveVersion();
	const { artifact, isWindows } = detectPlatform();

	const toolCache = process.env.RUNNER_TOOL_CACHE;
	if (!toolCache) {
		throw new Error('RUNNER_TOOL_CACHE is not set. This action must run inside a GitHub Actions workflow.');
	}
	if (!process.env.GITHUB_PATH) {
		throw new Error('GITHUB_PATH is not set. This action must run inside a GitHub Actions workflow.');
	}

	const platformKey = artifact.replace(/\.exe$/, '');
	const binDir = join(toolCache, 'setup-cursus', version, platformKey, 'bin');
	const binName = isWindows ? 'cursus.exe' : 'cursus';
	const binPath = join(binDir, binName);

	if (existsSync(binPath)) {
		// Cache hit — re-verify before using; treat failure as a poisoned cache.
		if (verifyArtifact(binPath, version)) {
			install(binPath, binDir, isWindows);
			return;
		}
		unlinkSync(binPath);
	}

	await downloadArtifact(version, artifact, binPath);

	// Verification failure after a fresh download is unrecoverable.
	if (!verifyArtifact(binPath, version)) {
		try { unlinkSync(binPath); } catch { }
		throw new Error(
			'Attestation verification failed for the downloaded artifact. ' +
			'This is unrecoverable. The file has been removed.',
		);
	}

	install(binPath, binDir, isWindows);
}

run().catch(err => fail(err.message));
