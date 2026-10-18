import { appcast } from "./chatgpt.ts";

describe("chatgpt", () => {
	it("selects full appcast archives for the requested architecture, never deltas", () => {
		const xml = `<rss><item><sparkle:hardwareRequirements>x64</sparkle:hardwareRequirements><sparkle:shortVersionString>3.0</sparkle:shortVersionString><enclosure url="https://example.com/intel.zip"/></item><item><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements><sparkle:shortVersionString>2.0</sparkle:shortVersionString><enclosure url="https://example.com/full.zip"/><sparkle:deltas><enclosure url="https://example.com/delta"/></sparkle:deltas></item></rss>`;
		expect(appcast(xml, "arm64")).toEqual({
			url: "https://example.com/full.zip",
			version: "2.0",
		});
		expect(() => appcast("<rss/>", "arm64")).toThrow();
	});
});
