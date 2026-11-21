/**
 * @name AutoQuestComplete
 * @description Automatically completes quests for you. WARNING: Discord prohibits automating quest completion; using this plugin may get your account flagged or banned. Use at your own risk. Based on a script by @aamiaa.
 * @version 0.10.0
 * @author Xenon Colt
 * @authorId 709210314230726776
 * @authorLink https://github.com/xenoncolt
 * @website https://github.com/xenoncolt/AutoQuestComplete
 * @source https://raw.githubusercontent.com/xenoncolt/AutoQuestComplete/main/AutoQuestComplete.plugin.js
 * @invite vJRe78YmN8
 */

const config = {
    main: 'AutoQuestComplete.plugin.js',
    info: {
        name: 'AutoQuestComplete',
        github: "https://github.com/xenoncolt/AutoQuestComplete",
        github_raw: "https://raw.githubusercontent.com/xenoncolt/AutoQuestComplete/main/AutoQuestComplete.plugin.js"
    },
    changelog: [
        // {
        //     title: "New Features & Improvements",
        //     type: "added",
        //     items: [
        //         "Quest notifications now show the game icon, reward (with the Nitro orb bonus), task type & time, publisher, and how soon the quest expires - so you know what you're getting before opening it.",
        //         "Quests now load in the background automatically, so you get notified without having to open the Quests page first."
        //     ]
        // }
        {
            title: "New Features & Improvements",
            type: "added",
            items: [
                "The quests AutoQuestComplete can't complete, like \"launch the game\" achievement quests and PlayStation/Xbox quests, no longer trigger the new quest notification",
                "New **Notify For Unsupported Quests** setting (off by default)",
                "The **Unsupported Quest Task** popup is now saved on config, so it only shows once per quest instead of every time Discord starts",
                "Thanks for the help griffinsectio and Thanks for creating issue TouhouJevil"
            ]
        }
        // {
        //     title: "Change And Warnings",
        //     type: "changed",
        //     items: [
        //         "Discord probably implement quest only for Playstation and Xbox. I am not sure how its gonna works. But for now this plugin will ignore this type of quest"
        //     ]
        // }
    ],
    settingsPanel: [
        {
            type: "switch",
            id: "enableNotify",
            name: "New Quest Notification",
            note: "Enable/Disable notification when a new quest is available.",
            value: true
        },
        {
            type: "switch",
            id: "notifyUnsupported",
            name: "Notify For Unsupported Quests",
            note: "Notify for quests this plugin can't complete for you (launch the game achievement quests, PlayStation/Xbox quests)",
            value: false
        },
        {
            type: "category",
            id: "notifyRewardTypes",
            name: "Notification Reward Types", // thanks to discord.food
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "switch",
                    id: "reward_4", // VIRTUAL_CURRENCY
                    name: "Orbs",
                    note: "Notify for quests that reward Discord Orbs.",
                    value: true
                },
                {
                    type: "switch",
                    id: "reward_1", // REWARD_CODE
                    name: "Redeemable Code",
                    note: "Notify for quests that reward a redeemable in-game code.",
                    value: true
                },
                {
                    type: "switch",
                    id: "reward_2", // IN_GAME
                    name: "In-Game Reward",
                    note: "Notify for quests that reward an item directly in the promoted game.",
                    value: true
                },
                {
                    type: "switch", 
                    id: "reward_3", // COLLECTIBLE
                    name: "Collectible",
                    note: "Notify for quests that reward a Discord collectible (e.g. an avatar decoration).",
                    value: true
                },
                {
                    type: "switch",
                    id: "reward_5", // FRACTIONAL_PREMIUM
                    name: "Nitro Trial",
                    note: "Notify for quests that reward a free Nitro (premium) trial.",
                    value: true
                }
            ]
        }
    ]
}

const { Webpack, UI, Logger, Data, Utils, React, Patcher } = BdApi;


const SUPPORTED_TASKS = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"];
const API_MAX_RETRIES = 3;
const API_BASE_BACKOFF_MS = 2000;
const API_MAX_BACKOFF_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 20000;
const HEARTBEAT_EXTRA_ATTEMPTS = 10;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const NOTIFICATION_ID = "AutoQuestComplete-new-quests";
const NOTIFICATION_DURATION_MS = 5 * 60 * 1000;
const REMINDER_DELAY_MS = 60 * 60 * 1000;
const NOTIFY_DEBOUNCE_MS = 750;
const NOTIFY_RETRY_MS = 300;
const NOTIFY_MAX_RETRIES = 3;
const MAX_LISTED_QUESTS = 5;
const REWARD_SETTING_PREFIX = "reward_";
const FAKE_PID_MIN = 1000;
const FAKE_PID_RANGE = 30000;
const MAX_REPORT_STACK_LENGTH = 1500;
const UPDATE_TIMEOUT_MS = 15000;
const UPDATE_NOTIFICATION_ID = "AutoQuestComplete-update";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

class AutoQuestComplete {
    constructor(meta) {
        this._version = meta?.version ?? "0.0.0";
        this._config = config;
        this._questsStore = null;
        this._router = null;
        this._boundHandleQuestChange = this.handleQuestChange.bind(this);
        this._boundNewQuestHandler = this.scheduleNewQuestCheck.bind(this);
        this._activeQuestId = null;
        this._activeAppId = null;
        this._activeQuestName = null;
        this._unsupportedQuests = new Set();
        this._storedUnsupportedQuests = {};
        this._notifiedQuests = new Set();
        this._notifyDebounce = null;
        this._notification = null;
        this._notificationQuestIds = null;
        this._notifyRetries = 0;
        this._timers = new Set();
        this._cleanups = new Set();
        this._runCleanups = new Set();
        this._runController = null;
        this._abortController = null;
        this.settings = null;
    }

    showChangelogOnce() {
        const { name } = this._config.info;
        const version = this._version;
        try {
            const stored = Data.load(name, "currentVersionInfo");
            const versionInfo = { hasShownChangelog: false, ...stored, version };
            if (stored?.version !== version) versionInfo.hasShownChangelog = false;

            if (!versionInfo.hasShownChangelog) {
                UI.showChangelogModal({
                    title: "AutoQuestComplete Changelog",
                    subtitle: version,
                    changes: this._config.changelog
                });
                versionInfo.hasShownChangelog = true;
            }
            Data.save(name, "currentVersionInfo", versionInfo);
        } catch (err) {
            Logger.error(name, "Could not show the changelog", err);
        }
    }

    start() {
        this._abortController = new AbortController();
        this.showChangelogOnce();
        this.checkForUpdate();
        this.loadSettings();
        this.loadUnsupportedQuests();
        this._questsStore = Webpack.Stores.QuestStore;
        try {
            if (!this._questsStore?.quests || !this._questsStore.addChangeListener) {
                Logger.error(this._config.info.name, "QuestStore is unavailable, Discord may have changed.");
                UI.showToast("AutoQuestComplete could not find the quest store.", { type: "error" });
                return;
            }
            this._questsStore.addChangeListener(this._boundHandleQuestChange);
            this._questsStore.addChangeListener(this._boundNewQuestHandler);

            const quest = this.getQuests().find(x =>
                !this._unsupportedQuests.has(x.id) &&
                x.userStatus?.enrolledAt &&
                !x.userStatus?.completedAt &&
                new Date(x.config.expiresAt).getTime() > Date.now()
            );

            if (quest) {
                this.activateQuest(quest);
                this.runQuest(quest);
            }
        } catch (e) {
            Logger.error(this._config.info.name, "Error while starting AutoQuestComplete", e);
            UI.showToast("Error while starting AutoQuestComplete", {type:"error"});
        }
    }

    stop() {
        this._abortController?.abort();
        this._abortController = null;
        if (this._questsStore && this._questsStore.removeChangeListener) {
            this._questsStore.removeChangeListener(this._boundHandleQuestChange);
            this._questsStore.removeChangeListener(this._boundNewQuestHandler);
        }
        for (const timeout of this._timers) {
            clearTimeout(timeout);
        }
        this._timers.clear();
        this._notification?.close?.();
        this._notification = null;
        this._notificationQuestIds = null;
        this._notifyRetries = 0;
        this.endRun();
        this.runCleanups();
        Patcher.unpatchAll(this._config.info.name);
        this._activeQuestId = null;
        this._activeQuestName = null;
        this._activeAppId = null;
        this._notifiedQuests.clear();
    }

    clearTimer(timer) {
        clearTimeout(timer);
        this._timers.delete(timer);
    }

    setTimer(callback, delay) {
        const timer = setTimeout(() => {
            this._timers.delete(timer);
            callback();
        }, delay);
        this._timers.add(timer);
        return timer;
    }

    sleep(delay, signal) {
        return new Promise(resolve => {
            if (signal.aborted) {
                resolve();
                return;
            }
            const onAbort = () => {
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            }, delay);
            signal.addEventListener("abort", onAbort, { once: true });
        });
    }

    // Registers a cleanup that runs once, either on demand via the returned function or when its scope is flushed.
    addCleanup(cleanup, scope = this._cleanups) {
        const run = () => {
            if (!scope.delete(run)) return;
            try {
                cleanup();
            } catch (err) {
                Logger.error(this._config.info.name, "Cleanup failed", err);
            }
        };
        this._cleanups.add(run);
        return run;
    }

    runCleanups(scope = this._cleanups) {
        for (const run of [...scope]) run();
    }

    // Cancels the running quest (loops, spoofing hooks, subscribers) so only one run is active at a time.
    endRun() {
        this._runController?.abort();
        this._runController = null;
        this.runCleanups(this._runCleanups);
    }

    startRun() {
        this.endRun();
        this._runController = new AbortController();
        return this._runController.signal;
    }




    _flattenSettings(settings = this._config.settingsPanel) {
        return settings.flatMap(setting =>
            setting.type === "category" && Array.isArray(setting.settings)
                ? this._flattenSettings(setting.settings)
                : [setting]
        );
    }

    loadSettings() {
        const defaults = Object.fromEntries(this._flattenSettings().map(setting => [setting.id, setting.value]));
        let stored = null;
        try {
            stored = Data.load(this._config.info.name, "settings");
        } catch (err) {
            Logger.error(this._config.info.name, "Failed to load settings, using defaults", err);
        }
        const saved = stored && typeof stored === "object" ? stored : {};
        for (const id of Object.keys(defaults)) {
            const legacyKey = id.replace(REWARD_SETTING_PREFIX, "");
            if (id.startsWith(REWARD_SETTING_PREFIX) && !(id in saved) && legacyKey in saved) saved[id] = saved[legacyKey];
        }
        this.settings = Object.assign(defaults, saved);
    }

    withCurrentValues(settings) {
        return settings.map(setting => setting.type === "category" && Array.isArray(setting.settings)
            ? { ...setting, settings: this.withCurrentValues(setting.settings) }
            : { ...setting, value: this.settings[setting.id] ?? setting.value });
    }

    getSettingsPanel() {
        if (!this.settings) this.loadSettings();

        return UI.buildSettingsPanel({
            settings: this.withCurrentValues(this._config.settingsPanel),
            onChange: (category, id, value) => {
                this.settings[id] = value;
                try {
                    Data.save(this._config.info.name, "settings", this.settings);
                } catch (err) {
                    Logger.error(this._config.info.name, "Failed to save settings", err);
                }
            }
        });
    }


    loadUnsupportedQuests() {
        let stored = {};
        try {
            stored = Data.load(this._config.info.name, "unsupportedQuests") || {};
        } catch (err) {
            stored = {};
        }

        const now = Date.now();
        this._storedUnsupportedQuests = {};
        for (const [questId, expiresAt] of Object.entries(stored)) {
            if (typeof expiresAt !== "number" || expiresAt <= now) continue; 
            this._storedUnsupportedQuests[questId] = expiresAt;
            this._unsupportedQuests.add(questId);
        }

        this.saveUnsupportedQuests();
    }

    markQuestUnsupported(quest) {
        this._unsupportedQuests.add(quest.id);
        const expires_at = new Date(quest?.config?.expiresAt).getTime();
        this._storedUnsupportedQuests[quest.id] = Number.isFinite(expires_at) ? expires_at : Date.now() + 7 * 24 * 60 * 60 * 1000;
        this.saveUnsupportedQuests();
    }

    saveUnsupportedQuests() {
        try {
            Data.save(this._config.info.name, "unsupportedQuests", this._storedUnsupportedQuests);
        } catch (err) {
            Logger.error(this._config.info.name, "Failed to save unsupported quests", err);
        }
    }


    getQuestApplicationId(quest) {
        const tasks = quest?.config?.taskConfigV2?.tasks ?? {};
        for (const task of Object.values(tasks)) {
            const id = task?.applications?.[0]?.id;
            if (id) return id;
        }
        return quest?.config?.application?.id ?? null;
    }

    
    resolveApplicationId(quest) {
        return quest?.config?.application?.id ?? this.getQuestApplicationId(quest);
    }

    activateQuest(quest) {
        this._activeQuestId = quest.id;
        this._activeAppId = this.resolveApplicationId(quest);
        this._activeQuestName = this.getQuestName(quest);
    }

    getQuestName(quest) {
        return quest?.config?.messages?.questName ?? quest?.config?.messages?.gameTitle ?? "Unknown Quest";
    }

    getQuestRewards(quest) {
        return quest?.config?.rewardsConfig?.rewards ?? [];
    }

    isQuestSupported(quest) {
        const tasks = quest?.config?.taskConfigV2?.tasks ?? {};
        return SUPPORTED_TASKS.some(x => tasks[x] != null);
    }

    shouldNotifyForQuest(quest) {
        const rewards = this.getQuestRewards(quest);
        if (!rewards.length) return true;
        return rewards.some(reward => this.settings[`${REWARD_SETTING_PREFIX}${reward?.type}`] !== false);
    }

    getRewardText(quest) {
        const parts = this.getQuestRewards(quest).map(reward => {
            if (typeof reward?.orbQuantity === "number" && reward.orbQuantity > 0) {
                return reward.premiumOrbQuantity && reward.premiumOrbQuantity !== reward.orbQuantity 
                ? `${reward.orbQuantity} Orbs (${reward.premiumOrbQuantity} with Nitro)` : `${reward.orbQuantity} Orbs`;
            }
            return reward?.messages?.name;
        }).filter(Boolean);

        return parts.length ? parts.join(", ") : null;
    }

    getQuestTaskInfo(quest) {
        const tasks = quest?.config?.taskConfigV2?.tasks ?? {};
        const labels = {
            WATCH_VIDEO: "Watch a video",
            WATCH_VIDEO_ON_MOBILE: "Watch a video (mobile)",
            PLAY_ON_DESKTOP: "Play the game",
            STREAM_ON_DESKTOP: "Stream the game",
            PLAY_ACTIVITY: "Play an activity",
            ACHIEVEMENT_IN_ACTIVITY: "Earn an achievement",
            PLAY_ON_PLAYSTATION: "Play on PlayStation",
            PLAY_ON_XBOX: "Play on Xbox"
        };
        const taskName = Object.keys(labels).find(x => tasks[x] != null);
        if (!taskName) return null;
        const seconds = tasks[taskName]?.target ?? 0;
        if (!seconds) return labels[taskName];
        const duration = seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} sec`;
        return `${labels[taskName]} (~${duration})`;
    }

    formatRelativeTime(dateStr) {
        const ms = new Date(dateStr).getTime() - Date.now();
        if (!Number.isFinite(ms) || ms <= 0) return null;
        const minutes = Math.floor(ms / 60000);
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor((minutes % 1440) / 60);
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m`;
    }

    getQuestIconUrl(quest) {
        const assets = quest?.config?.assets ?? {};
        const file = assets.gameTileLight || assets.gameTileDark || assets.logotypeLight;
        if (!file) return null;
        return `https://cdn.discordapp.com/${file}`;
    }

    buildQuestIcon(quest) {
        const url = this.getQuestIconUrl(quest);
        if (!url || !React) return undefined;
        return () => React.createElement("img", {
            src: url,
            width: 36,
            height: 36,
            style: { borderRadius: "8px", objectFit: "cover" },
            onError: (event) => { event.currentTarget.style.display = "none"; }
        });
    }

    buildNotificationContent(quest) {
        const intro = this.isQuestSupported(quest) ? `Accept "${this.getQuestName(quest)}" to start auto-completing.` : `"${this.getQuestName(quest)}" has to be completed manually, AutoQuestComplete can't do this quest type for you.`;
        const reward = this.getRewardText(quest);
        const task = this.getQuestTaskInfo(quest);
        const publisher = quest?.config?.messages?.gamePublisher;
        const expiresIn = this.formatRelativeTime(quest?.config?.expiresAt);

        if (!React) {
            return [intro,
                reward && `Reward: ${reward}`,
                task && `Task: ${task}`,
                publisher && `Publisher: ${publisher}`,
                expiresIn && `Expires in ${expiresIn}`
            ].filter(Boolean).join(" • ");
        }

        const e = React.createElement;
        const row = (label, value) => value
            ? e("div", { style: { opacity: 0.95 } },
                e("strong", null, `${label}: `), value)
            : null;

        return e("div", { style: { display: "flex", flexDirection: "column", gap: "3px" } },
            e("div", { style: { marginBottom: "2px" } }, intro),
            row("Reward", reward),
            row("Task", task),
            row("Publisher", publisher),
            row("Expires in", expiresIn)
        );
    }

    getQuests() {
        return [...(this._questsStore?.quests?.values() ?? [])];
    }

    resolveDependencies() {
        return {
            api: Webpack.getByKeys("get", "post", "put", "patch", "del", { searchExports: true }),
            FluxDispatcher: Webpack.getByKeys("dispatch", "subscribe", "register", { searchExports: true }),
            ApplicationStreamingStore: Webpack.Stores.ApplicationStreamingStore,
            RunningGameStore: Webpack.Stores.RunningGameStore
        };
    }

    isRetryableError(err) {
        const status = err?.status;
        return status === undefined || status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR;
    }

    getBackoffDelay(err, attempt) {
        const retryAfterSeconds = Number(err?.body?.retry_after);
        const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : API_BASE_BACKOFF_MS * 2 ** attempt;
        return Math.min(delay, API_MAX_BACKOFF_MS);
    }

    // Retries rate limits, server errors and network failures with backoff; other errors are thrown immediately.
    async request(api, method, options, signal) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await api[method](options);
            } catch (err) {
                if (signal.aborted || attempt >= API_MAX_RETRIES || !this.isRetryableError(err)) throw err;
                Logger.warn(this._config.info.name, `Request ${method.toUpperCase()} ${options.url} failed (${err?.status ?? "network"}), retrying.`);
                await this.sleep(this.getBackoffDelay(err, attempt), signal);
                if (signal.aborted) throw err;
            }
        }
    }

    reportAsyncError(err, signal) {
        if (signal.aborted) return;
        const reason = this.getErrorMessage(err);
        Logger.error(this._config.info.name, `Quest "${this._activeQuestName}" failed`, err);
        UI.showToast(`Quest "${this._activeQuestName}" failed: ${reason}`, { type: "error" });
    }

    findActivityChannelId() {
        const privateChannelId = Webpack.Stores.ChannelStore?.getSortedPrivateChannels?.()?.[0]?.id;
        if (privateChannelId) return privateChannelId;
        const guilds = Webpack.Stores.GuildChannelStore?.getAllGuilds?.() ?? {};
        for (const guild of Object.values(guilds)) {
            const voiceChannelId = guild?.VOCAL?.[0]?.channel?.id;
            if (voiceChannelId) return voiceChannelId;
        }
        return null;
    }

    hasApplicationId() {
        if (this._activeAppId) return true;
        Logger.error(this._config.info.name, `Could not resolve the application id for "${this._activeQuestName}".`);
        UI.showToast(`Could not resolve the application id for "${this._activeQuestName}".`, { type: "error" });
        return false;
    }

    createHeartbeatHandler(quest, taskName, secondsNeeded, onComplete) {
        return data => {
            const status = data?.userStatus;
            if (!status || (status.questId && status.questId !== quest.id)) return;
            const progress = quest.config.configVersion === 1 ? status.streamProgressSeconds : Math.floor(status.progress?.[taskName]?.value);
            if (!Number.isFinite(progress)) return;
            Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
            UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, { type: "info" });
            if (progress < secondsNeeded) return;
            Logger.info(this._config.info.name, "Quest completed!");
            UI.showToast("Quest completed!", { type: "success" });
            onComplete();
        };
    }

    hasDependencies(dependencies, names) {
        const missing = names.filter(name => !dependencies[name]);
        if (!missing.length) return true;
        Logger.error(this._config.info.name, `Missing Discord modules: ${missing.join(", ")}`);
        UI.showToast(`Could not find required Discord modules (${missing.join(", ")}). Discord may have changed.`, { type: "error" });
        return false;
    }

    isQuestNotifiable(quest) {
        return !quest.userStatus?.enrolledAt &&
            !quest.userStatus?.completedAt &&
            new Date(quest.config?.expiresAt).getTime() > Date.now() &&
            this.shouldNotifyForQuest(quest) &&
            (this.settings.notifyUnsupported || this.isQuestSupported(quest));
    }

    scheduleNewQuestCheck() {
        this.clearTimer(this._notifyDebounce);
        this._notifyDebounce = this.setTimer(() => this.handleNewQuest(), NOTIFY_DEBOUNCE_MS);
    }

    handleNewQuest() {
        if (!this.settings.enableNotify) return;
        const freshQuests = this.getQuests().filter(x => !this._notifiedQuests.has(x.id) && this.isQuestNotifiable(x));
        if (freshQuests.length) this.showQuestNotification(freshQuests);
    }


    async openQuests() {
        try {
            const quest_link = document.querySelector('a[href="/quest-home"]');

            if (quest_link) {
                quest_link.click();
                await new Promise(r => setTimeout(r, 300));
                if (location.pathname.startsWith("/quest")) return;
            }

            this._router ??= Webpack.getModule(m => m?.transitionTo && m?.replaceWith && m?.getHistory, { searchExports: true });
            if (this._router?.transitionTo) {
                this._router.transitionTo("/quest-home");
                return;
            }

            window.history.pushState({}, "", "/quest-home");
            window.dispatchEvent(new PopStateEvent("popstate"));

        } catch (err) {
            Logger.error(this._config.info.name, "Failed to open quests page", err);
        }
    }


    focusQuestContainer(quest) {
        const quest_title_id = `quest-tile-${quest.id}`;
        let attempts = 0;

        const highlight_container = () => {
            const quest_container = document.getElementById(quest_title_id);

            if (!quest_container) {
                if (attempts++ < 40) {
                    this.setTimer(highlight_container, 250);
                } else {
                    Logger.warn(this._config.info.name, `Gave up waiting for ${quest_title_id} to render.`);
                }
                return;
            }

            quest_container.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
            quest_container.setAttribute("tabindex", "-1");
            quest_container.focus({ preventScroll: true });

            const originalOutline = quest_container.style.outline;
            const originalOutlineOffset = quest_container.style.outlineOffset;
            const originalBoxShadow = quest_container.style.boxShadow;
            const originalTransition = quest_container.style.transition;

            const restoreStyles = this.addCleanup(() => {
                if (!quest_container.isConnected) return;
                quest_container.style.outline = originalOutline;
                quest_container.style.outlineOffset = originalOutlineOffset;
                quest_container.style.boxShadow = originalBoxShadow;
                quest_container.style.transition = originalTransition;
            });

            quest_container.style.transition = "box-shadow 180ms ease, outline 180ms ease";
            quest_container.style.outline = "3px solid rgba(88, 101, 242, 0.95)";
            quest_container.style.outlineOffset = "6px";
            quest_container.style.boxShadow = "0 0 0 8px rgba(88, 101, 242, 0.2)";

            this.setTimer(restoreStyles, 5000);
        };

        this.setTimer(highlight_container, 250);
    }


    pluralize(count, noun) {
        return `${count} ${noun}${count === 1 ? "" : "s"}`;
    }

    buildSummaryContent(quests) {
        const supported = quests.filter(x => this.isQuestSupported(x));
        const unsupportedCount = quests.length - supported.length;
        const listed = supported.slice(0, MAX_LISTED_QUESTS);
        const hiddenCount = supported.length - listed.length;
        const e = React.createElement;
        const mutedStyle = { opacity: 0.8 };
        const describe = quest => {
            const expiresIn = this.formatRelativeTime(quest.config?.expiresAt);
            const details = [this.getRewardText(quest), this.getQuestTaskInfo(quest), expiresIn && `expires in ${expiresIn}`].filter(Boolean).join(" • ");
            return details ? ` - ${details}` : "";
        };

        return e("div", { style: { display: "flex", flexDirection: "column", gap: "3px" } },
            supported.length ? e("div", { style: { marginBottom: "2px" } }, "Accept a quest to start auto-completing.") : null,
            ...listed.map(quest => e("div", { key: quest.id }, e("strong", null, this.getQuestName(quest)), describe(quest))),
            hiddenCount > 0 ? e("div", { style: mutedStyle }, `+${hiddenCount} more`) : null,
            unsupportedCount > 0 ? e("div", { style: mutedStyle }, `${this.pluralize(unsupportedCount, "unsupported quest")} (complete manually)`) : null
        );
    }

    buildNotificationAppearance(quests, reminder) {
        const prefix = reminder ? "Reminder: " : "";
        if (quests.length === 1) {
            return {
                title: `${prefix}New Quest Available!`,
                content: this.buildNotificationContent(quests[0]),
                icon: this.buildQuestIcon(quests[0])
            };
        }
        return {
            title: `${prefix}${this.pluralize(quests.length, "new quest")} available`,
            content: this.buildSummaryContent(quests)
        };
    }

    buildNotificationActions(quests) {
        const questIds = new Set(quests.map(x => x.id));
        return [
            {
                label: "Go to Quests",
                onClick: async () => {
                    await this.openQuests();
                    if (quests.length === 1) this.focusQuestContainer(quests[0]);
                }
            },
            {
                label: "Remind Me Later",
                onClick: () => {
                    this.setTimer(() => {
                        if (!this.settings.enableNotify) return;
                        this.showQuestNotification(this.getQuests().filter(x => questIds.has(x.id) && this.isQuestNotifiable(x)), true);
                    }, REMINDER_DELAY_MS);
                }
            }
        ];
    }

    // Shows one combined notification; quests of a still visible notification are merged into the new one.
    showQuestNotification(quests, reminder = false) {
        const visibleIds = this._notification?.isVisible?.() ? this._notificationQuestIds : null;
        const visibleQuests = visibleIds ? this.getQuests().filter(x => visibleIds.has(x.id) && this.isQuestNotifiable(x)) : [];
        const allQuests = [...visibleQuests, ...quests.filter(x => !visibleIds?.has(x.id))];
        if (!allQuests.length) return;

        this._notification?.close?.();
        const questIds = new Set(allQuests.map(x => x.id));
        const notification = UI.showNotification({
            id: NOTIFICATION_ID,
            ...this.buildNotificationAppearance(allQuests, reminder),
            type: "info",
            duration: NOTIFICATION_DURATION_MS,
            actions: this.buildNotificationActions(allQuests),
            onClose: () => {
                if (this._notificationQuestIds !== questIds) return;
                this._notification = null;
                this._notificationQuestIds = null;
            }
        });

        if (!notification) {
            if (this._notifyRetries++ < NOTIFY_MAX_RETRIES) this.setTimer(() => this.showQuestNotification(allQuests, reminder), NOTIFY_RETRY_MS);
            return;
        }
        this._notifyRetries = 0;
        this._notification = notification;
        this._notificationQuestIds = questIds;
        for (const quest of allQuests) this._notifiedQuests.add(quest.id);
    }

    handleQuestChange() {
        const quest = this.getQuests().find(x =>
            !this._unsupportedQuests.has(x.id) &&
            x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );
        // Logger.info(this._config.info.name, "Quest: ", quest);

        if (quest && quest.id !== this._activeQuestId) {
            this.activateQuest(quest);
            UI.showToast(`New quest found: ${this._activeQuestName}`, {type:"info"});
            this.runQuest(quest);
        }
    }

    runQuest(quest) {
        const lifecycleSignal = this._abortController?.signal;
        if (!lifecycleSignal || lifecycleSignal.aborted) return;
        const signal = this.startRun();
        try {
            const dependencies = this.resolveDependencies();
            if (!this.hasDependencies(dependencies, ["api"])) return;

            if (!quest) {
                Logger.info(this._config.info.name, "No uncompleted quests found.");
                UI.showToast("No uncompleted quests found.", { type: "info" });
                return;
            }

            this._notifiedQuests.delete(quest.id);

            const tasks = quest.config?.taskConfigV2?.tasks ?? {};
            const taskName = [...SUPPORTED_TASKS, "ACHIEVEMENT_IN_ACTIVITY"].find(x => tasks[x] != null);

            if (!taskName) {
                this.skipUnsupportedQuest(quest);
                return;
            }

            const secondsNeeded = tasks[taskName].target;
            if (taskName !== "ACHIEVEMENT_IN_ACTIVITY" && !Number.isFinite(secondsNeeded)) {
                Logger.error(this._config.info.name, `Quest "${this._activeQuestName}" has no valid target for ${taskName}.`);
                UI.showToast(`Quest "${this._activeQuestName}" has an unexpected task format.`, { type: "error" });
                return;
            }

            this.getTaskHandler(taskName)?.call(this, {
                quest,
                taskName,
                secondsNeeded,
                secondsDone: quest.userStatus?.progress?.[taskName]?.value ?? 0,
                signal,
                lifecycleSignal,
                dependencies,
                pid: this.generateFakePid(dependencies.RunningGameStore)
            });
        } catch (err) {
            this.showErrorModal(err);
        }
    }

    generateFakePid(runningGameStore) {
        const usedPids = new Set((runningGameStore?.getRunningGames?.() ?? []).map(game => game.pid));
        let pid;
        do {
            pid = Math.floor(Math.random() * FAKE_PID_RANGE) + FAKE_PID_MIN;
        } while (usedPids.has(pid));
        return pid;
    }

    getTaskHandler(taskName) {
        return {
            WATCH_VIDEO: this.runWatchVideo,
            WATCH_VIDEO_ON_MOBILE: this.runWatchVideo,
            PLAY_ON_DESKTOP: this.runPlayOnDesktop,
            STREAM_ON_DESKTOP: this.runStreamOnDesktop,
            PLAY_ACTIVITY: this.runPlayActivity,
            ACHIEVEMENT_IN_ACTIVITY: this.runAchievementInActivity
        }[taskName];
    }

    skipUnsupportedQuest(quest) {
        if (this._unsupportedQuests.has(quest.id)) return;
        this.markQuestUnsupported(quest);
        Logger.info(this._config.info.name, `${this._activeQuestName} is not supported by this plugin. "Xbox and Playstation" Task.`);
        UI.showToast(`Skipping ${this._activeQuestName}.`, { type: "warning" });
        this.setTimer(() => this.handleQuestChange(), 1000);
    }

    runWatchVideo({ quest, secondsNeeded, secondsDone, signal, lifecycleSignal, dependencies }) {
        const { api } = dependencies;
        const speed = 7;
        let isFinished = false;
        let reachedEnd = false;
        (async () => {
            while (!signal.aborted) {
                const remain = Math.min(speed, secondsNeeded - secondsDone);
                await this.sleep(remain * 1000, signal);
                if (signal.aborted) return;
                const timestamp = secondsDone + speed;

                const response = await this.request(api, "post", { url: `/quests/${quest.id}/video-progress`, body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) } }, signal);
                isFinished = response?.body?.completed_at != null;
                secondsDone = Math.min(secondsNeeded, timestamp);

                if (timestamp >= secondsNeeded) {
                    reachedEnd = true;
                    break;
                }
            }
            if (!reachedEnd || lifecycleSignal.aborted) return;
            if (!isFinished) {
                await this.request(api, "post", { url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } }, lifecycleSignal);
            }
            Logger.info(this._config.info.name, "Quest completed!");
            UI.showToast("Quest completed!", { type: "success" });
        })().catch(err => this.reportAsyncError(err, signal));

        Logger.info(this._config.info.name, `Spoofing video for ${this._activeQuestName}.`);
        UI.showToast(`Spoofing video for ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / speed)} sec.`, { type: "info" });
    }

    runPlayOnDesktop({ quest, taskName, secondsNeeded, secondsDone, signal, dependencies, pid }) {
        const { api, FluxDispatcher, RunningGameStore } = dependencies;
        if (!this.hasApplicationId()) return;
        if (!this.hasDependencies(dependencies, ["FluxDispatcher", "RunningGameStore"])) return;
        this.request(api, "get", { url: `/applications/public?application_ids=${this._activeAppId}` }, signal).then(res => {
            if (signal.aborted) return;
            const appData = res?.body?.[0];
            if (!appData?.name) throw new Error("Application data not found.");
            const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? appData.name.replace(/[/\\:*?"<>|]/g, "");
            const fakeGame = {
                cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                exeName,
                exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                hidden: false,
                isLauncher: false,
                id: this._activeAppId,
                name: appData.name,
                pid: pid,
                pidPath: [pid],
                processName: appData.name,
                start: Date.now(),
            };
            const realGames = RunningGameStore.getRunningGames();
            const fakeGames = [fakeGame];
            const unpatchGames = Patcher.instead(this._config.info.name, RunningGameStore, "getRunningGames", () => fakeGames);
            const unpatchGameForPid = Patcher.instead(this._config.info.name, RunningGameStore, "getGameForPID", (_, [gamePid]) => fakeGames.find(x => x.pid === gamePid));
            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames });

            const heartbeatHandler = this.createHeartbeatHandler(quest, taskName, secondsNeeded, () => stopSpoofing());
            const stopSpoofing = this.addCleanup(() => {
                unpatchGames?.();
                unpatchGameForPid?.();
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] });
                FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", heartbeatHandler);
            }, this._runCleanups);

            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", heartbeatHandler);
            Logger.info(this._config.info.name, `Spoofed game to ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min.`);
            UI.showToast(`Spoofed game to ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min.`, { type: "info" });
        }).catch(err => this.reportAsyncError(err, signal));
    }

    runStreamOnDesktop({ quest, taskName, secondsNeeded, secondsDone, dependencies, pid }) {
        const { FluxDispatcher, ApplicationStreamingStore } = dependencies;
        if (!this.hasApplicationId()) return;
        if (!this.hasDependencies(dependencies, ["FluxDispatcher", "ApplicationStreamingStore"])) return;
        const unpatchStream = Patcher.instead(this._config.info.name, ApplicationStreamingStore, "getStreamerActiveStreamMetadata", () => ({
            id: this._activeAppId,
            pid,
            sourceName: null
        }));
        const heartbeatHandler = this.createHeartbeatHandler(quest, taskName, secondsNeeded, () => stopSpoofing());
        const stopSpoofing = this.addCleanup(() => {
            unpatchStream?.();
            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", heartbeatHandler);
        }, this._runCleanups);
        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", heartbeatHandler);
        Logger.info(this._config.info.name, `Spoofed stream to ${this._activeQuestName}. Stream ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min. (Need at least one VC peer)`);
        UI.showToast(`Spoofed stream to ${this._activeQuestName}. Stream ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min. (Need at least one VC peer)`, { type: "info" });
    }

    runPlayActivity({ quest, secondsNeeded, secondsDone, signal, lifecycleSignal, dependencies }) {
        const { api } = dependencies;
        const channelId = this.findActivityChannelId();
        if (!channelId) {
            Logger.error(this._config.info.name, `No private or voice channel found for "${this._activeQuestName}".`);
            UI.showToast(`Could not find a channel to complete "${this._activeQuestName}". Join a server with a voice channel or open a DM.`, { type: "error" });
            return;
        }
        const streamKey = `call:${channelId}:1`;
        (async () => {
            Logger.info(this._config.info.name, "Completing quest", this._activeQuestName, "-", quest.config.messages.questName);
            UI.showToast(`Completing quest ${this._activeQuestName} - ${quest.config.messages.questName}`, { type: "info" });
            let reachedEnd = false;
            const maxHeartbeats = Math.ceil(Math.max(secondsNeeded - secondsDone, 0) / (HEARTBEAT_INTERVAL_MS / 1000)) + HEARTBEAT_EXTRA_ATTEMPTS;
            for (let heartbeat = 0; heartbeat < maxHeartbeats && !signal.aborted; heartbeat++) {
                const res = await this.request(api, "post", { url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } }, signal);
                if (signal.aborted) return;
                const progress = res?.body?.progress?.PLAY_ACTIVITY?.value;
                if (typeof progress !== "number") throw new Error("Unexpected heartbeat response.");
                Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, { type: "info" });
                await this.sleep(HEARTBEAT_INTERVAL_MS, signal);
                if (lifecycleSignal.aborted || (signal.aborted && progress < secondsNeeded)) return;
                if (progress >= secondsNeeded) {
                    await this.request(api, "post", { url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } }, lifecycleSignal);
                    reachedEnd = true;
                    break;
                }
            }
            if (!reachedEnd && !signal.aborted) throw new Error("Quest did not reach its target in the expected time.");
            if (!reachedEnd || lifecycleSignal.aborted) return;
            Logger.info(this._config.info.name, "Quest completed!");
            UI.showToast("Quest completed!", { type: "success" });
        })().catch(err => this.reportAsyncError(err, signal));
    }

    runAchievementInActivity({ quest, taskName }) {
        if (this._unsupportedQuests.has(quest.id)) return;
        this.markQuestUnsupported(quest);
        UI.showConfirmationModal("Unsupported Quest Task", [`The quest "${this._activeQuestName}" has an unsupported Quest type: ${taskName}.`, "AutoQuestComplete will not be able to complete this quest. Because it's a server-side quest.\n  **Please complete it manually**."], {
            confirmText: "Go to Quest",
            onConfirm: async () => {
                await new Promise(resolve => {
                    const started = Date.now();
                    const check = () => {
                        if (!document.querySelector('[role="dialog"]') || Date.now() - started > 3000) return resolve();
                        this.setTimer(check, 100);
                    };
                    check();
                });
                await this.openQuests();
                this.focusQuestContainer(quest);
            }
        });
        this.setTimer(() => this.handleQuestChange(), 5000);
    }

    getErrorMessage(err) {
        return err?.body?.message ?? err?.message ?? String(err ?? "Unknown error");
    }

    // Removes local user paths so the report does not leak them.
    sanitizeStack(stack) {
        return String(stack ?? "No stack trace available")
            .replace(/[A-Za-z]:\\Users\\[^\\\s)]+/g, "<user>")
            .replace(/\/(?:Users|home)\/[^/\s)]+/g, "/<user>")
            .slice(0, MAX_REPORT_STACK_LENGTH);
    }

    showErrorModal(err) {
        const questName = this._activeQuestName ?? "Unknown Quest";
        const message = this.getErrorMessage(err);
        UI.showConfirmationModal("Error", [
            "An error occurred while trying to complete the quest. Please reach out to the developer with the following information:",
            `Quest Name: ${questName}`,
            `Error: ${message}`,
            "Report Issue opens a prefilled GitHub issue with the error and a stack trace (local user paths removed). Review it before submitting."
        ], {
            confirmText: "Report Issue",
            onConfirm: () => {
                const title = encodeURIComponent(`Error while completing quest: ${questName}`);
                const body = encodeURIComponent(`**Quest Name:** ${questName}\n**Error:** ${message}\n**Stack Trace:**\n\`\`\`\n${this.sanitizeStack(err?.stack)}\n\`\`\``);
                window.open(`${this._config.info.github}/issues/new?title=${title}&body=${body}`, "_blank", "noopener,noreferrer");
            }
        });
    }

    async fetchRemotePlugin() {
        const signal = AbortSignal.any([this._abortController.signal, AbortSignal.timeout(UPDATE_TIMEOUT_MS)]);
        const response = await fetch(this._config.info.github_raw, { signal });
        if (!response.ok) throw new Error(`Update server responded with ${response.status}`);
        const fileContent = await response.text();
        return { fileContent, remoteMeta: this.parseMeta(fileContent) };
    }

    // The remote file must be this plugin and a newer, valid semver version before it is offered.
    isValidUpdate(remoteMeta) {
        return remoteMeta.name === this._config.info.name &&
            SEMVER_PATTERN.test(remoteMeta.version ?? "") &&
            Utils.semverCompare(this._version, remoteMeta.version) > 0;
    }

    async checkForUpdate() {
        if (!this._abortController) return;
        try {
            const { fileContent, remoteMeta } = await this.fetchRemotePlugin();
            if (this.isValidUpdate(remoteMeta)) this.newUpdateNotify(remoteMeta, fileContent);
        } catch (err) {
            if (!this._abortController || err?.name === "AbortError") return;
            Logger.error(this._config.info.name, "Update check failed", err);
        }
    }

    async installUpdate(remoteFile) {
        const { name } = this._config.info;
        const target = require("path").join(BdApi.Plugins.folder, `${name}.plugin.js`);
        try {
            await require("fs").promises.writeFile(target, remoteFile);
        } catch (err) {
            UI.showToast("An error occurred when trying to download the update!", { type: "error" });
            Logger.error(name, "Could not write the update file", err);
            return;
        }
        try {
            const versionInfo = Data.load(name, "currentVersionInfo") ?? {};
            Data.save(name, "currentVersionInfo", { ...versionInfo, hasShownChangelog: false });
        } catch (err) {
            Logger.error(name, "Could not reset the changelog flag", err);
        }
    }

    newUpdateNotify(remoteMeta, remoteFile) {
        Logger.info(this._config.info.name, "A new update is available!");

        UI.showNotification({
            title: `${this._config.info.name} Update Available!`,
            content: `Version ${remoteMeta.version} is now available!`,
            id: UPDATE_NOTIFICATION_ID,
            type: "info",
            duration: Infinity,
            actions: [
                {
                    label: "Update Now",
                    onClick: () => this.installUpdate(remoteFile)
                },
                {
                    label: "Update Later",
                    onClick: () => { }
                }
            ]
        });
    }

    parseMeta(fileContent) {
        const meta = {};
        const header = fileContent.match(/^\s*\/\*\*[\s\S]*?\*\//)?.[0] ?? "";
        for (const match of header.matchAll(/@([a-zA-Z]+)[ \t]+(.+)/g)) {
            meta[match[1]] = match[2].trim();
        }
        return meta;
    }
}

module.exports = AutoQuestComplete;