const assert = require("assert");
const path = require("path");

const pluginPath = path.join(__dirname, "..", "AutoQuestComplete.plugin.js");

function makeQuest({ id = "quest-1", applicationId = "app-1", task = "PLAY_ON_DESKTOP", target = 60, enrolled = true, legacy = false } = {}) {
    const taskConfig = { tasks: { [task]: { target } } };
    return {
        id,
        config: {
            application: { id: applicationId, name: `Game ${applicationId}` },
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            configVersion: 2,
            messages: { questName: "Test quest" },
            ...(legacy ? { taskConfig } : { taskConfigV2: taskConfig })
        },
        userStatus: enrolled ? { enrolledAt: new Date().toISOString(), progress: { [task]: { value: 0 } } } : { progress: {} }
    };
}

function makeEnvironment({ quests = [], privateChannels = [], guilds = {}, api = {} } = {}) {
    const notifications = [];
    const toasts = [];
    const modals = [];
    const dispatched = [];
    const subscribers = new Set();
    const opened = [];
    const realGame = { pid: 999, name: "Real game" };
    const questStore = {
        quests: new Map(quests.map(quest => [quest.id, quest])),
        addChangeListener: () => {},
        removeChangeListener: () => {}
    };
    const runningGameStore = {
        getRunningGames: () => [realGame],
        getGameForPID: pid => pid === realGame.pid ? realGame : undefined
    };
    const streamingStore = { getStreamerActiveStreamMetadata: () => null };
    const dispatcher = {
        dispatch: event => dispatched.push(event),
        subscribe: (_event, fn) => subscribers.add(fn),
        unsubscribe: (_event, fn) => subscribers.delete(fn),
        register: () => {}
    };
    const questApi = {
        get: async () => ({ body: [{ name: "Test App", executables: [] }] }),
        post: async () => ({ body: { completed_at: null, progress: { PLAY_ACTIVITY: { value: 0 } } } }),
        ...api
    };

    global.BdApi = {
        Webpack: {
            Stores: {
                QuestStore: questStore,
                RunningGameStore: runningGameStore,
                ApplicationStreamingStore: streamingStore,
                ChannelStore: { getSortedPrivateChannels: () => privateChannels },
                GuildChannelStore: { getAllGuilds: () => guilds }
            },
            getByKeys: () => dispatcher,
            getModule: () => ({ Bo: questApi })
        },
        UI: {
            showToast: (...args) => toasts.push(args),
            showNotification: notification => notifications.push(notification),
            showConfirmationModal: (...args) => modals.push(args),
            showChangelogModal: () => {},
            buildSettingsPanel: options => options
        },
        Logger: { error: () => {}, info: () => {} },
        Data: {
            load: (_plugin, key) => key === "currentVersionInfo" ? { version: "0.8.1", hasShownChangelog: true } : null,
            save: () => {}
        },
        Utils: {
            semverCompare: (left, right) => {
                const a = left.split(".").map(Number);
                const b = right.split(".").map(Number);
                for (let index = 0; index < 3; index++) {
                    if (a[index] !== b[index]) return a[index] - b[index];
                }
                return 0;
            }
        },
        React: null,
        Plugins: { folder: __dirname }
    };
    global.open = url => opened.push(url);
    global.fetch = async () => ({ ok: true, status: 200, text: async () => "/**\n * @name AutoQuestComplete\n * @version 0.8.1\n */" });
    delete require.cache[pluginPath];
    const Plugin = require(pluginPath);
    const plugin = new Plugin();
    plugin._started = true;
    plugin.settings = { enableNotify: true, 1: true, 2: true, 3: true, 4: true, 5: true };
    return { plugin, runningGameStore, streamingStore, subscribers, dispatched, notifications, toasts, modals, opened };
}

async function tick() {
    await new Promise(resolve => setImmediate(resolve));
}

async function testUpdateDetection() {
    const { plugin } = makeEnvironment();
    let shown = 0;
    plugin.newUpdateNotify = () => { shown += 1; };
    global.fetch = async () => ({ ok: true, status: 200, text: async () => "/**\n * @name AutoQuestComplete\n * @version 0.8.2\n */" });
    await plugin.checkForUpdate();
    assert.strictEqual(shown, 1, "a newer remote version must show an update notification");
}

async function testNotificationsCoverEveryQuest() {
    const quests = [makeQuest({ id: "new-1", enrolled: false }), makeQuest({ id: "new-2", applicationId: "app-2", enrolled: false })];
    const { plugin, notifications } = makeEnvironment({ quests });
    plugin.handleNewQuest();
    assert.strictEqual(notifications.length, 2, "all newly available quests must be notified");
    plugin.handleNewQuest();
    assert.strictEqual(notifications.length, 2, "a quest must only notify once");
}

async function testLegacyTaskConfig() {
    const { plugin } = makeEnvironment();
    assert.match(plugin.getQuestTaskInfo(makeQuest({ legacy: true, task: "WATCH_VIDEO" })), /Watch a video/);
}

async function testDesktopRunPreservesGamesAndCleansUpOnStop() {
    const quest = makeQuest();
    const { plugin, runningGameStore, subscribers, dispatched } = makeEnvironment({ quests: [quest] });
    const originalGetRunningGames = runningGameStore.getRunningGames;
    const originalGetGameForPID = runningGameStore.getGameForPID;
    plugin.runQuest(quest);
    await tick();
    assert.notStrictEqual(runningGameStore.getRunningGames, originalGetRunningGames, "desktop quest must install its temporary game hook");
    assert.strictEqual(runningGameStore.getRunningGames().length, 2, "temporary game must not hide real running games");
    assert.strictEqual(subscribers.size, 1, "desktop quest must subscribe once");
    assert.deepStrictEqual(dispatched[0].removed, [], "adding a fake game must not report real games as removed");
    plugin.stop();
    assert.strictEqual(runningGameStore.getRunningGames, originalGetRunningGames, "stop must restore getRunningGames");
    assert.strictEqual(runningGameStore.getGameForPID, originalGetGameForPID, "stop must restore getGameForPID");
    assert.strictEqual(subscribers.size, 0, "stop must unsubscribe the heartbeat handler");
}

async function testStreamingRunCleansUpOnStop() {
    const quest = makeQuest({ task: "STREAM_ON_DESKTOP" });
    const { plugin, streamingStore, subscribers } = makeEnvironment({ quests: [quest] });
    const original = streamingStore.getStreamerActiveStreamMetadata;
    plugin.runQuest(quest);
    assert.notStrictEqual(streamingStore.getStreamerActiveStreamMetadata, original, "stream quest must install its temporary stream hook");
    assert.strictEqual(subscribers.size, 1, "stream quest must subscribe once");
    plugin.stop();
    assert.strictEqual(streamingStore.getStreamerActiveStreamMetadata, original, "stop must restore stream metadata");
    assert.strictEqual(subscribers.size, 0, "stop must unsubscribe the stream heartbeat handler");
}

async function testStoppingVideoRunCancelsPendingRequest() {
    const quest = makeQuest({ task: "WATCH_VIDEO" });
    let requests = 0;
    const { plugin } = makeEnvironment({ quests: [quest], api: { post: async () => { requests += 1; return { body: {} }; } } });
    plugin.runQuest(quest);
    plugin.stop();
    await tick();
    assert.strictEqual(requests, 0, "stop must cancel a video run before it submits further progress");
}

async function testActivityWithoutChannelShowsRecoverableError() {
    const quest = makeQuest({ task: "PLAY_ACTIVITY" });
    const { plugin, modals } = makeEnvironment({ quests: [quest] });
    plugin.runQuest(quest);
    assert.strictEqual(modals.at(-1)[0], "Error", "an activity quest without a usable channel must report a recoverable error");
}

async function testIssueReportOmitsStackTraces() {
    const quest = makeQuest();
    const { plugin, modals, opened } = makeEnvironment({ quests: [quest] });
    plugin._showQuestError(quest, new Error("token=private-value"));
    modals.at(-1)[2].onConfirm();
    const report = decodeURIComponent(opened[0]);
    assert.match(report, /token=\[redacted\]/);
    assert.doesNotMatch(report, /Stack Trace/);
}

async function main() {
    await testUpdateDetection();
    await testNotificationsCoverEveryQuest();
    await testLegacyTaskConfig();
    await testDesktopRunPreservesGamesAndCleansUpOnStop();
    await testStreamingRunCleansUpOnStop();
    await testStoppingVideoRunCancelsPendingRequest();
    await testActivityWithoutChannelShowsRecoverableError();
    await testIssueReportOmitsStackTraces();
    console.log("All AutoQuestComplete regression tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
