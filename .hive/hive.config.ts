import type { HiveProjectConfig } from '@hive/types/project-config';

/**
 * Hive configuration for T3code
 *
 * This file configures how Hive manages instances for this project.
 * See spec/project-setup.md for full documentation.
 */
const config: HiveProjectConfig = {
	project: {
		name: 't3code',
		displayName: 'T3code',
	},

	nix: {
		flake: '.',
		shell: 'default',
		env: {},
		resourceLimits: {},
	},

	ports: [
		{ name: 'app', port: 3000, label: 'App' }
	],

	paths: {
		copyFiles: [
			// Add files to copy from project root to worktrees:
			// '.env.local',
		],
		autostartDir: '.hive/autostart',
	},

	git: {
		baseBranch: 'main',
		remoteName: 'origin',
	},
};

export default config;
