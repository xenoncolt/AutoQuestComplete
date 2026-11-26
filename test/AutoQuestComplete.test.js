const { test, describe, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loggedErrors = [];
const patchResults = [];

function compareSemver(current, remote) {
    const a = current.split(".").map(Number);
    const b = remote.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if (b[i] > a[i]) return 1;
        if (b[i] < a[i]) return -1;
    }
    return 0;
}

class BdApiMock {
    static version = "1.14.5";

    constructor() {
        this.Logger = { info() { }, warn() { }, error: (...args) => loggedErrors.push(args) };
        this.UI = { showToast() { }, showNotification() { } };
        this.Data = { load() { }, save() { } };
        this.Patcher = { instead: () => (patchResults.length ? patchResults.shift() : () => { }), unpatchAll() { } };
        this.Webpack = { Stores: {} };
        this.Utils = { semverCompare: compareSemver };
        this.React = {};
    }
}

global.BdApi = BdApiMock;
const AutoQuestComplete = require(path.join(__dirname, "..", "AutoQuestComplete.plugin.js"));

const createPlugin = (meta = { version: "1.0.0", source: "https://example.com/plugin.js" }) => new AutoQuestComplete(meta);

describe("addCleanup / runCleanups / endRun", () => {
    test("runs a cleanup exactly once, on demand or via its scope", () => {
        const plugin = createPlugin();
        let calls = 0;
        const run = plugin.addCleanup(() => calls++);
        run();
        plugin.runCleanups();
        assert.equal(calls, 1);
    });

    test("registers in the given scope and not in the default one", () => {
        const plugin = createPlugin();
        let calls = 0;
        plugin.addCleanup(() => calls++, plugin._runCleanups);
        plugin.runCleanups();
        assert.equal(calls, 0);
        plugin.endRun();
        assert.equal(calls, 1);
    });

    test("a failing cleanup does not stop the others", () => {
        const plugin = createPlugin();
        let calls = 0;
        plugin.addCleanup(() => { throw new Error("boom"); });
        plugin.addCleanup(() => calls++);
        plugin.runCleanups();
        assert.equal(calls, 1);
    });

    test("startRun aborts the previous run", () => {
        const plugin = createPlugin();
        const first = plugin.startRun();
        const second = plugin.startRun();
        assert.equal(first.aborted, true);
        assert.equal(second.aborted, false);
    });
});

describe("formatRelativeTime", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    beforeEach(() => mock.method(Date, "now", () => now));
    afterEach(() => mock.restoreAll());

    const at = offsetMs => new Date(now + offsetMs).toISOString();
    const minute = 60 * 1000;

    test("formats minutes, hours and days", () => {
        const plugin = createPlugin();
        assert.equal(plugin.formatRelativeTime(at(45 * minute)), "45m");
        assert.equal(plugin.formatRelativeTime(at(125 * minute)), "2h 5m");
        assert.equal(plugin.formatRelativeTime(at((2 * 24 * 60 + 3 * 60) * minute)), "2d 3h");
    });

    test("returns null for past or invalid dates", () => {
        const plugin = createPlugin();
        assert.equal(plugin.formatRelativeTime(at(-minute)), null);
        assert.equal(plugin.formatRelativeTime("not a date"), null);
    });
});

describe("retry helpers", () => {
    test("getBackoffDelay doubles per attempt and honors retry_after", () => {
        const plugin = createPlugin();
        assert.equal(plugin.getBackoffDelay({}, 0), 2000);
        assert.equal(plugin.getBackoffDelay({}, 2), 8000);
        assert.equal(plugin.getBackoffDelay({ body: { retry_after: 5 } }, 0), 5000);
    });

    test("getBackoffDelay is capped", () => {
        const plugin = createPlugin();
        assert.equal(plugin.getBackoffDelay({}, 10), 30000);
        assert.equal(plugin.getBackoffDelay({ body: { retry_after: 600 } }, 0), 30000);
    });

    test("isRetryableError retries network, rate limit and server errors only", () => {
        const plugin = createPlugin();
        assert.equal(plugin.isRetryableError(new Error("offline")), true);
        assert.equal(plugin.isRetryableError({ status: 429 }), true);
        assert.equal(plugin.isRetryableError({ status: 503 }), true);
        assert.equal(plugin.isRetryableError({ status: 400 }), false);
        assert.equal(plugin.isRetryableError({ status: 404 }), false);
    });
});

describe("text helpers", () => {
    test("sanitizeStack removes local user paths", () => {
        const plugin = createPlugin();
        const stack = "Error\n at C:\\Users\\Alice\\AppData\\file.js:1\n at /home/bob/x.js:2\n at /Users/carol/y.js:3";
        const result = plugin.sanitizeStack(stack);
        assert.doesNotMatch(result, /Alice|bob|carol/);
        assert.match(result, /<user>/);
    });

    test("sanitizeStack handles missing stacks and truncates", () => {
        const plugin = createPlugin();
        assert.equal(plugin.sanitizeStack(undefined), "No stack trace available");
        assert.ok(plugin.sanitizeStack("x".repeat(10000)).length <= 1500);
    });

    test("pluralize uses the singular only for one", () => {
        const plugin = createPlugin();
        assert.equal(plugin.pluralize(1, "quest"), "1 quest");
        assert.equal(plugin.pluralize(0, "quest"), "0 quests");
        assert.equal(plugin.pluralize(3, "quest"), "3 quests");
    });

    test("getErrorMessage prefers the API body message", () => {
        const plugin = createPlugin();
        assert.equal(plugin.getErrorMessage({ body: { message: "api" }, message: "x" }), "api");
        assert.equal(plugin.getErrorMessage(new Error("plain")), "plain");
        assert.equal(plugin.getErrorMessage(undefined), "Unknown error");
    });
});

describe("update helpers", () => {
    test("parseMeta only reads the header comment", () => {
        const plugin = createPlugin();
        const file = "/**\n * @name Foo\n * @version 2.0.0\n */\nconst x = '@name Evil';";
        assert.deepEqual(plugin.parseMeta(file), { name: "Foo", version: "2.0.0" });
    });

    test("isValidUpdate accepts only this plugin with a newer semver", () => {
        const plugin = createPlugin({ version: "1.0.0" });
        assert.equal(plugin.isValidUpdate({ name: "AutoQuestComplete", version: "1.0.1" }), true);
        assert.equal(plugin.isValidUpdate({ name: "AutoQuestComplete", version: "1.0.0" }), false);
        assert.equal(plugin.isValidUpdate({ name: "AutoQuestComplete", version: "0.9.0" }), false);
        assert.equal(plugin.isValidUpdate({ name: "Other", version: "9.0.0" }), false);
        assert.equal(plugin.isValidUpdate({ name: "AutoQuestComplete", version: "latest" }), false);
    });

    test("getRawSourceUrl maps a GitHub file link to its raw URL", () => {
        const blob = "https://github.com/xenoncolt/AutoQuestComplete/blob/main/AutoQuestComplete.plugin.js";
        const raw = "https://raw.githubusercontent.com/xenoncolt/AutoQuestComplete/main/AutoQuestComplete.plugin.js";
        assert.equal(createPlugin({ version: "1.0.0", source: blob }).getRawSourceUrl(), raw);
        assert.equal(createPlugin({ version: "1.0.0", source: raw }).getRawSourceUrl(), raw);
    });

    test("getRawSourceUrl rejects missing, non-GitHub and insecure sources", () => {
        assert.equal(createPlugin({ version: "1.0.0" }).getRawSourceUrl(), null);
        assert.equal(createPlugin({ version: "1.0.0", source: "https://example.com/x.js" }).getRawSourceUrl(), null);
        assert.equal(createPlugin({ version: "1.0.0", source: "http://github.com/a/b/blob/main/x.js" }).getRawSourceUrl(), null);
    });

    test("fetchRemotePlugin rejects a missing or unsupported @source", async () => {
        const plugin = createPlugin({ version: "1.0.0", source: "http://example.com/x.js" });
        plugin._abortController = new AbortController();
        await assert.rejects(() => plugin.fetchRemotePlugin(), /@source/);
    });
});

describe("task maps", () => {
    test("getTaskHandler resolves supported tasks and ignores unknown ones", () => {
        const plugin = createPlugin();
        assert.equal(plugin.getTaskHandler("WATCH_VIDEO"), plugin.runWatchVideo);
        assert.equal(plugin.getTaskHandler("WATCH_VIDEO_ON_MOBILE"), plugin.runWatchVideo);
        assert.equal(plugin.getTaskHandler("PLAY_ON_XBOX"), undefined);
        assert.equal(plugin.getTaskHandler("toString"), undefined);
    });

    test("getQuestTaskInfo builds the label with the duration", () => {
        const plugin = createPlugin();
        const quest = target => ({ config: { taskConfigV2: { tasks: { PLAY_ON_DESKTOP: { target } } } } });
        assert.equal(plugin.getQuestTaskInfo(quest(900)), "Play the game (~15 min)");
        assert.equal(plugin.getQuestTaskInfo(quest(30)), "Play the game (~30 sec)");
        assert.equal(plugin.getQuestTaskInfo(quest(0)), "Play the game");
        assert.equal(plugin.getQuestTaskInfo({}), null);
    });
    test("patchInstead reverts earlier patches and throws when one patch fails", () => {
        const plugin = createPlugin();
        let reverted = 0;
        patchResults.push(() => reverted++, null);
        const target = { a() { }, b() { } };
        assert.throws(() => plugin.patchInstead([[target, "a", () => { }], [target, "b", () => { }]]), /Could not patch b/);
        assert.equal(reverted, 1);
    });

    test("patchInstead returns one function that reverts every patch", () => {
        const plugin = createPlugin();
        let reverted = 0;
        patchResults.push(() => reverted++, () => reverted++);
        const target = { a() { }, b() { } };
        plugin.patchInstead([[target, "a", () => { }], [target, "b", () => { }]])();
        assert.equal(reverted, 2);
    });
});

describe("isBetterDiscordSupported", () => {
    afterEach(() => { BdApiMock.version = "1.14.5"; });

    test("accepts the minimum and newer versions, rejects older ones", () => {
        const plugin = createPlugin();
        BdApiMock.version = "1.14.5";
        assert.equal(plugin.isBetterDiscordSupported(), true);
        BdApiMock.version = "1.15.0";
        assert.equal(plugin.isBetterDiscordSupported(), true);
        BdApiMock.version = "1.13.9";
        assert.equal(plugin.isBetterDiscordSupported(), false);
    });

    test("does not block on a non-semver version string", () => {
        const plugin = createPlugin();
        BdApiMock.version = "canary";
        assert.equal(plugin.isBetterDiscordSupported(), true);
    });
});
