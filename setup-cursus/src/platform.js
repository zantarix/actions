const PLATFORM_MAP = {
	'Linux+X64': 'cursus-linux-x86_64',
	'Linux+ARM64': 'cursus-linux-aarch64',
	'macOS+X64': 'cursus-osx-x86_64',
	'macOS+ARM64': 'cursus-osx-aarch64',
	'Windows+X64': 'cursus-windows-x86_64.exe',
	'Windows+ARM64': 'cursus-windows-aarch64.exe',
};

const SUPPORTED = Object.keys(PLATFORM_MAP)
	.map(k => k.replace('+', '/'))
	.join(', ');

export function detectPlatform(
	os = process.env.RUNNER_OS,
	arch = process.env.RUNNER_ARCH,
) {
	const key = `${os}+${arch}`;
	const artifact = PLATFORM_MAP[key];
	if (!artifact) {
		throw new Error(
			`Unsupported platform: RUNNER_OS=${os}, RUNNER_ARCH=${arch}.\n` +
			`Supported combinations: ${SUPPORTED}`,
		);
	}
	// The Sigstore bundle asset is named by appending `.sigstore.json` to the full
	// binary filename, including any `.exe` suffix (e.g. `cursus-windows-x86_64.exe`
	// → `cursus-windows-x86_64.exe.sigstore.json`). Confirmed against cursus@0.9.0.
	return { artifact, bundle: `${artifact}.sigstore.json`, isWindows: os === 'Windows' };
}
