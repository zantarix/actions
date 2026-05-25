import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVersion } from './src/version.js';
import { detectPlatform } from './src/platform.js';
import { downloadArtifact } from './src/download.js';
import { verifyArtifact } from './src/verify.js';
import { bundleVerificationSupported } from './src/bundle.js';
import { install } from './src/install.js';

function fail(message) {
	process.stderr.write(`Error: ${message}\n`);
	process.exitCode = 1;
}

async function run() {
	const version = resolveVersion();
	const { artifact, bundle, isWindows } = detectPlatform();

	const toolCache = process.env.RUNNER_TOOL_CACHE;
	if (!toolCache) {
		throw new Error('RUNNER_TOOL_CACHE is not set. This action must run inside a GitHub Actions workflow.');
	}
	if (!process.env.GITHUB_PATH) {
		throw new Error('GITHUB_PATH is not set. This action must run inside a GitHub Actions workflow.');
	}

	// Versions >= 0.9.0 publish a Sigstore bundle asset and verify it offline; older
	// versions retain gh attestation-API discovery (ADR-004).
	const useBundle = bundleVerificationSupported(version);
	const runnerTemp = process.env.RUNNER_TEMP;
	if (useBundle && !runnerTemp) {
		throw new Error('RUNNER_TEMP is not set. This action must run inside a GitHub Actions workflow.');
	}

	const platformKey = artifact.replace(/\.exe$/, '');
	const binDir = join(toolCache, 'setup-cursus', version, platformKey, 'bin');
	const binName = isWindows ? 'cursus.exe' : 'cursus';
	const binPath = join(binDir, binName);

	// On the bundle path the bundle must be present locally for every verification —
	// including cache hits — so it is downloaded fresh into RUNNER_TEMP and kept out of
	// RUNNER_TOOL_CACHE (off the cache-poisoning surface). Verification stays mandatory
	// and offline on this path; the legacy path verifies via the attestations API.
	async function verify() {
		if (!useBundle) {
			return verifyArtifact(binPath, version);
		}
		const bundlePath = join(runnerTemp, bundle);
		await downloadArtifact(version, bundle, bundlePath);
		return verifyArtifact(binPath, version, bundlePath);
	}

	if (existsSync(binPath)) {
		// Cache hit — re-verify before using; treat failure as a poisoned cache.
		if (await verify()) {
			install(binPath, binDir, isWindows);
			return;
		}
		unlinkSync(binPath);
	}

	await downloadArtifact(version, artifact, binPath);

	// Verification failure after a fresh download is unrecoverable.
	if (!await verify()) {
		try { unlinkSync(binPath); } catch { }
		throw new Error(
			'Attestation verification failed for the downloaded artifact. ' +
			'This is unrecoverable. The file has been removed.',
		);
	}

	install(binPath, binDir, isWindows);
}

run().catch(err => fail(err.message));
