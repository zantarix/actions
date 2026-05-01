import { chmodSync, appendFileSync } from 'node:fs';
import os from 'node:os';

export function install(binPath, binDir, isWindows) {
	if (!isWindows) {
		chmodSync(binPath, 0o755);
	}
	appendFileSync(process.env.GITHUB_PATH, binDir + os.EOL);
}
