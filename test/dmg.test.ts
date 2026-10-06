import { describe, expect, it } from "bun:test";
import { parseMountPointsFromPlist } from "../src/dmg.ts";

describe("dmg module", () => {
	it("parses mount points from hdiutil plist output", () => {
		const samplePlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>system-entities</key>
	<array>
		<dict>
			<key>dev-entry</key>
			<string>/dev/disk4</string>
		</dict>
		<dict>
			<key>dev-entry</key>
			<string>/dev/disk4s1</string>
			<key>mount-point</key>
			<string>/Volumes/Cursor</string>
		</dict>
	</array>
</dict>
</plist>`;

		const mountPoints = parseMountPointsFromPlist(samplePlist);
		expect(mountPoints).toEqual(["/Volumes/Cursor"]);
	});

	it("returns empty array when no mount points in plist", () => {
		const plist = "<dict></dict>";
		const mountPoints = parseMountPointsFromPlist(plist);
		expect(mountPoints).toEqual([]);
	});
});
