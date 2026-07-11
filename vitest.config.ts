import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**"],
			thresholds: {
				statements: 80,
				branches: 74,
				functions: 83,
				lines: 82,
			},
		},
	},
});
