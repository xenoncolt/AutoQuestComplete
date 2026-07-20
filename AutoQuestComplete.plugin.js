/**
 * @name AutoQuestComplete
 * @description Automatically completes quests for you ... btw first u have to accept the quest manually...okay...
 * @version 0.8.1
 * @author @aamiaa published by Xenon Colt
 * @authorLink https://github.com/aamiaa
 * @website https://github.com/xenoncolt/AutoQuestComplete
 * @source https://raw.githubusercontent.com/xenoncolt/AutoQuestComplete/main/AutoQuestComplete.plugin.js
 * @invite vJRe78YmN8
 */

const config = {
    main: 'AutoQuestComplete.plugin.js',
    info: {
        name: 'AutoQuestComplete',
        authorId: "709210314230726776",
        website: "https://xenoncolt.dev",
        version: "0.8.1",
        description: "Automatically completes quests for you",
        author: [
            {
                name: "@aamiaa",
                plugin_author: "Xenon Colt",
                github_username: "xenoncolt",
            }
        ],
        github: "https://github.com/xenoncolt/AutoQuestComplete",
        invite: "vJRe78YmN8",
        github_raw: "https://raw.githubusercontent.com/xenoncolt/AutoQuestComplete/main/AutoQuestComplete.plugin.js"
    },
    changelog: [
        {
            title: "New Features & Improvements",
            type: "added",
            items: [
                "Quest notifications now show the game icon, reward (with the Nitro orb bonus), task type & time, publisher, and how soon the quest expires - so you know what you're getting before opening it.",
                "Quests now load in the background automatically, so you get notified without having to open the Quests page first.",
                "Quest runs now clean up temporary Discord hooks when stopped or when a request fails.",
                "Fixed update detection and made update-write failures visible."
            ]
        }
        // {
        //     title: "Fix",
        //     type: "fixed",
        //     items: [
        //         "Fix where quest notification keeps showing again - unaipalma",
        //         "Fix the Report issue button - Moonl1qht"
        //     ]
        // }
        // {
        //     title: "Big Change And Warnings",
        //     type: "changed",
        //     items: [
        //         "As of April 7th 2026, Discord has expressed their intent to crack down on automating quest completion. Use the script at your own risk. You most likely WILL get flagged by doing so. Read here https://github.com/xenoncolt/AutoQuestComplete/blob/main/README.md",
        //         "Slower the video spoofing speed to reduce the risk of being flagged."
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
            type: "category",
            id: "notifyRewardTypes",
            name: "Notification Reward Types", // thanks to discord.food
            collapsible: true,
            shown: false,
            settings: [
                {
                    type: "switch",
                    id: 4, // VIRTUAL_CURRENCY
                    name: "Orbs",
                    note: "Notify for quests that reward Discord Orbs.",
                    value: true
                },
                {
                    type: "switch",
                    id: 1, // REWARD_CODE
                    name: "Redeemable Code",
                    note: "Notify for quests that reward a redeemable in-game code.",
                    value: true
                },
                {
                    type: "switch",
                    id: 2, // IN_GAME
                    name: "In-Game Reward",
                    note: "Notify for quests that reward an item directly in the promoted game.",
                    value: true
                },
                {
                    type: "switch", 
                    id: 3, // COLLECTIBLE
                    name: "Collectible",
                    note: "Notify for quests that reward a Discord collectible (e.g. an avatar decoration).",
                    value: true
                },
                {
                    type: "switch",
                    id: 5, // FRACTIONAL_PREMIUM
                    name: "Nitro Trial",
                    note: "Notify for quests that reward a free Nitro (premium) trial.",
                    value: true
                }
            ]
        }
    ]
}

const { Webpack, UI, Logger, Data, Utils, React } = BdApi;

class AutoQuestComplete {
    constructor() {
        this._config = config;
        this._questsStore = Webpack.Stores.QuestStore;
        this._boundHandleQuestChange = this.handleQuestChange.bind(this);
        this._boundNewQuestHandler = this.handleNewQuest.bind(this);
        this._activeQuestId = null;
        this._activeApplicationId = null;
        this._activeQuestName = null;
        this._unsupportedQuests = new Set();
        this._notifiedQuests = new Set();
        this._remindersTime = new Map();
        this._activeRun = null;
        this._unsupportedQuestRetry = null;
        this._started = false;
        this.settings;

        try {
            let currentVersionInfo = {};
            try {
                currentVersionInfo = Object.assign({}, { version: this._config.info.version, hasShownChangelog: false }, Data.load(this._config.info.name, "currentVersionInfo"));
            } catch (err) {
                currentVersionInfo = { version: this._config.info.version, hasShownChangelog: false };
            }
            if (this._config.info.version != currentVersionInfo.version) currentVersionInfo.hasShownChangelog = false;
            currentVersionInfo.version = this._config.info.version;
            Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);

            this.checkForUpdate();

            if (!currentVersionInfo.hasShownChangelog) {
                UI.showChangelogModal({
                    title: "AutoQuestComplete Changelog",
                    subtitle: this._config.info.version,
                    changes: this._config.changelog
                });
                currentVersionInfo.hasShownChangelog = true;
                Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);
            }
        }
        catch (err) {
            Logger.error(this._config.info.name, err);
        }
    }

    start() {
        this._started = true;
        const defaultSettings = this._flattenSettings().reduce((acc, setting) => {
            acc[setting.id] = setting.value;
            return acc;
        }, {});
        this.settings = Object.assign(defaultSettings, Data.load(this._config.info.name, "settings") || {});
        try {
            if (this._questsStore && this._questsStore.addChangeListener) {
                this._questsStore.addChangeListener(this._boundHandleQuestChange);
                this._questsStore.addChangeListener(this._boundNewQuestHandler);
            }

            const quest = this._getQuestValues().find(x =>
                x.id !== "1248385850622869556" &&
                x.userStatus?.enrolledAt &&
                !x.userStatus?.completedAt &&
                new Date(x.config.expiresAt).getTime() > Date.now()
            );

            if (this._questsStore && quest) {
                this._setActiveQuest(quest);
                this.runQuest(quest);
            }
        } catch (e) {
            Logger.error(this._config.info.name, "Error while starting AutoQuestComplete", e);
            UI.showToast("Error while starting AutoQuestComplete", {type:"error"});
        }
    }

    stop() {
        this._started = false;
        this._cancelActiveRun();
        if (this._questsStore && this._questsStore.removeChangeListener) {
            this._questsStore.removeChangeListener(this._boundHandleQuestChange);
            this._questsStore.removeChangeListener(this._boundNewQuestHandler);
        }
        for (const [questId, timeout] of this._remindersTime.entries()) {
            clearTimeout(timeout);
        }
        if (this._unsupportedQuestRetry) clearTimeout(this._unsupportedQuestRetry);
        this._unsupportedQuests.clear();
        this._notifiedQuests.clear();
        this._remindersTime.clear();
        this._unsupportedQuestRetry = null;
        this._activeQuestId = null;
        this._activeApplicationId = null;
        this._activeQuestName = null;
    }

    _flattenSettings(settings = this._config.settingsPanel) {
        return settings.flatMap(setting =>
            setting.type === "category" && Array.isArray(setting.settings)
                ? this._flattenSettings(setting.settings)
                : [setting]
        );
    }

    _getQuestValues() {
        return this._questsStore?.quests ? [...this._questsStore.quests.values()] : [];
    }

    _getQuestApplicationId(quest) {
        return quest?.config?.application?.id ?? null;
    }

    _getQuestName(quest) {
        return quest?.config?.application?.name ?? quest?.config?.messages?.questName ?? "this quest";
    }

    _getQuestTasks(quest) {
        return quest?.config?.taskConfigV2?.tasks ?? quest?.config?.taskConfig?.tasks ?? {};
    }

    _getQuestTaskName(quest) {
        const supportedTasks = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE", "ACHIEVEMENT_IN_ACTIVITY"];
        const tasks = this._getQuestTasks(quest);
        return supportedTasks.find(taskName => tasks[taskName] != null) ?? null;
    }

    _setActiveQuest(quest) {
        this._activeQuestId = quest.id;
        this._activeApplicationId = this._getQuestApplicationId(quest);
        this._activeQuestName = this._getQuestName(quest);
    }

    _startRun(quest) {
        this._cancelActiveRun();
        const run = { questId: quest.id, cancelled: false, cleanups: new Set(), delays: new Map() };
        this._activeRun = run;
        return run;
    }

    _isRunActive(run) {
        return this._started && this._activeRun === run && !run.cancelled;
    }

    _addRunCleanup(run, cleanup) {
        run.cleanups.add(cleanup);
        return () => run.cleanups.delete(cleanup);
    }

    _delay(run, milliseconds) {
        return new Promise(resolve => {
            if (!this._isRunActive(run)) return resolve(false);
            const timeout = setTimeout(() => {
                run.delays.delete(timeout);
                resolve(this._isRunActive(run));
            }, Math.max(0, milliseconds));
            run.delays.set(timeout, resolve);
        });
    }

    _cancelActiveRun() {
        const run = this._activeRun;
        if (!run) return;
        run.cancelled = true;
        this._activeRun = null;
        for (const [timeout, resolve] of run.delays) {
            clearTimeout(timeout);
            resolve(false);
        }
        run.delays.clear();
        for (const cleanup of run.cleanups) {
            try {
                cleanup();
            } catch (err) {
                Logger.error(this._config.info.name, "Failed to clean up a quest run", err);
            }
        }
        run.cleanups.clear();
    }

    _completeRun(run) {
        if (this._activeRun === run) this._cancelActiveRun();
    }

    getSettingsPanel() {
        for (const setting of this._flattenSettings()) {
            setting.value = this.settings[setting.id];
        }

        return UI.buildSettingsPanel({
            settings: this._config.settingsPanel,
            onChange: (category, id, value) => {
                this.settings[id] = value;
                Data.save(this._config.info.name, "settings", this.settings);
            }
        });
    }

    getQuestRewards(quest) {
        return quest?.config?.rewardsConfig?.rewards ?? [];
    }

    shouldNotifyForQuest(quest) {
        const rewards = this.getQuestRewards(quest);
        if (!rewards.length) return true;
        return rewards.some(reward => this.settings[reward?.type] !== false);
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
        const tasks = this._getQuestTasks(quest);
        const labels = {
            WATCH_VIDEO: "Watch a video",
            WATCH_VIDEO_ON_MOBILE: "Watch a video (mobile)",
            PLAY_ON_DESKTOP: "Play the game",
            STREAM_ON_DESKTOP: "Stream the game",
            PLAY_ACTIVITY: "Play an activity",
            ACHIEVEMENT_IN_ACTIVITY: "Earn an achievement"
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
        const intro = `Accept "${quest.config.application.name}" to start auto-completing.`;
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

    handleNewQuest() {
        const newQuests = this._getQuestValues().filter(x =>
            x.id !== "1248385850622869556" &&
            !x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );

        for (const newQuest of newQuests) {
            if (!this.settings.enableNotify || this._notifiedQuests.has(newQuest.id)) continue;
            if (!this.shouldNotifyForQuest(newQuest)) continue;
            this._notifiedQuests.add(newQuest.id);
            this.showQuestNotification(newQuest);
        }
    }

    showQuestNotification(quest, reminder = false) {
        if (!quest) return;
        const title = reminder ? `Reminder: New Quest Available!` : `New Quest Available!`;
        const openQuests = () => {
            try {
                const quest_link = document.querySelector('a[href="/quest-home"]');

                if (quest_link) {
                    quest_link.click();
                    return;
                }

                // fallback
                window.history.pushState({}, "", "/quest-home");
                window.dispatchEvent(new PopStateEvent("popstate"));

            } catch (err) {
                Logger.error(this._config.info.name, "Failed to open quests page", err);
            }
        };
        const focusQuestContainer = () => {
            const quest_title_id = `quest-tile-${quest.id}`;
            let attempts = 0;

            const highlight_container = () => {
                const quest_container = document.getElementById(quest_title_id);

                if (!quest_container) {
                    if (attempts++ < 20) {
                        setTimeout(highlight_container, 250);
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

                quest_container.style.transition = "box-shadow 180ms ease, outline 180ms ease";
                quest_container.style.outline = "3px solid rgba(88, 101, 242, 0.95)";
                quest_container.style.outlineOffset = "6px";
                quest_container.style.boxShadow = "0 0 0 8px rgba(88, 101, 242, 0.2)";

                setTimeout(() => {
                    if (!quest_container.isConnected) return;
                    quest_container.style.outline = originalOutline;
                    quest_container.style.outlineOffset = originalOutlineOffset;
                    quest_container.style.boxShadow = originalBoxShadow;
                    quest_container.style.transition = originalTransition;
                }, 5000);
            };

            setTimeout(highlight_container, 250);
        };
        UI.showNotification({
            title: title,
            content: this.buildNotificationContent(quest),
            icon: this.buildQuestIcon(quest),
            type: "info",
            duration: 5 * 60 * 1000,
            actions: [
                {
                    label: "Go to Quests",
                    onClick: () => {
                        openQuests();
                        focusQuestContainer();
                    }
                },
                {
                    label: "Remind Me Later",
                    onClick: () => {
                        const existing_reminder = this._remindersTime.get(quest.id);
                        if (existing_reminder) clearTimeout(existing_reminder);
                        const reminderTimeout = setTimeout(() => {
                            this._remindersTime.delete(quest.id);
                            this.showQuestNotification(quest, true);
                        }, 60 * 60 * 1000);
                        this._remindersTime.set(quest.id, reminderTimeout);
                    }
                }
            ]
        })
    }

    handleQuestChange() {
        const quest = this._getQuestValues().find(x =>
            x.id !== "1248385850622869556" && !this._unsupportedQuests.has(x.id) &&
            x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );
        // Logger.info(this._config.info.name, "Quest: ", quest);

        if (quest && quest.id !== this._activeQuestId) {
            this._setActiveQuest(quest);
            UI.showToast(`New quest found: ${this._activeQuestName}`, {type:"info"});
            this.runQuest(quest);
        }
    }

    _showUnsupportedQuest(quest, taskName) {
        if (this._unsupportedQuests.has(quest.id)) return;
        this._unsupportedQuests.add(quest.id);
        UI.showConfirmationModal("Unsupported Quest Task", [`The quest "${this._getQuestName(quest)}" has an unsupported quest type: ${taskName ?? "unknown"}.`, "AutoQuestComplete cannot complete this server-side quest. Please complete it manually."], {
            confirmText: "Go to Quest",
            onConfirm: () => open(`/quests/${quest.id}`)
        });
        if (this._unsupportedQuestRetry) clearTimeout(this._unsupportedQuestRetry);
        this._unsupportedQuestRetry = setTimeout(() => {
            this._unsupportedQuestRetry = null;
            if (this._started) this.handleQuestChange();
        }, 5000);
    }

    _getSafeErrorMessage(err) {
        return String(err?.message ?? err ?? "Unknown error")
            .replace(/\b(mfa\.[A-Za-z0-9_-]+)\b/g, "[redacted]")
            .replace(/\b(authorization|token|password|secret)\s*[:=]\s*[^\s,]+/gi, "$1=[redacted]");
    }

    _showQuestError(quest, err) {
        const questName = this._getQuestName(quest);
        const errorMessage = this._getSafeErrorMessage(err);
        UI.showConfirmationModal("Error", ["An error occurred while trying to complete the quest. Please report the details below to the developer.", `Quest Name: ${questName}`, `Error: ${errorMessage}`, "The report deliberately excludes stack traces because they can contain private local data."], {
            confirmText: "Report Issue",
            onConfirm: () => {
                const issueTitle = encodeURIComponent(`Error while completing quest: ${questName}`);
                const issueBody = encodeURIComponent(`**Quest Name:** ${questName}\n**Quest ID:** ${quest.id}\n**Error:** ${errorMessage}\n\n_Stack traces are intentionally omitted to avoid exposing private local data._`);
                open(`https://github.com/xenoncolt/AutoQuestComplete/issues/new?title=${issueTitle}&body=${issueBody}`);
            }
        });
    }

    _handleRunError(run, quest, err) {
        if (!this._isRunActive(run)) return;
        Logger.error(this._config.info.name, `Failed to complete ${this._getQuestName(quest)}`, err);
        this._cancelActiveRun();
        this._showQuestError(quest, err);
    }

    runQuest(quest) {
        if (!quest) {
            Logger.info(this._config.info.name, "No uncompleted quests found.");
            UI.showToast("No uncompleted quests found.", { type: "info" });
            return;
        }

        const run = this._startRun(quest);
        try {
            const ApplicationStreamingStore = Webpack.Stores.ApplicationStreamingStore;
            const FluxDispatcher = Webpack.getByKeys('dispatch', 'subscribe', 'register', { searchExports: true });
            const api = Webpack.getModule(m => m?.Bo?.get)?.Bo;
            const RunningGameStore = Webpack.Stores.RunningGameStore;
            const taskName = this._getQuestTaskName(quest);
            const tasks = this._getQuestTasks(quest);
            const secondsNeeded = Number(tasks[taskName]?.target);
            const applicationId = this._getQuestApplicationId(quest);
            const questName = this._getQuestName(quest);
            let secondsDone = Number(quest.userStatus?.progress?.[taskName]?.value ?? 0);

            if (!taskName || taskName === "ACHIEVEMENT_IN_ACTIVITY") {
                this._showUnsupportedQuest(quest, taskName);
                this._completeRun(run);
                return;
            }
            if (!Number.isFinite(secondsNeeded) || secondsNeeded <= 0) throw new Error("The quest does not contain a valid task duration.");
            if (!applicationId) throw new Error("The quest does not contain an application ID.");
            if (!Number.isFinite(secondsDone) || secondsDone < 0) secondsDone = 0;

            if (this._remindersTime.has(quest.id)) {
                clearTimeout(this._remindersTime.get(quest.id));
                this._remindersTime.delete(quest.id);
            }
            this._notifiedQuests.delete(quest.id);

            if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
                if (!api?.post) throw new Error("Discord's quest API is unavailable.");
                const speed = 7;
                void (async () => {
                    try {
                        let isFinished = false;
                        while (this._isRunActive(run)) {
                            const remain = Math.max(0, Math.min(speed, secondsNeeded - secondsDone));
                            if (!await this._delay(run, remain * 1000)) return;
                            const timestamp = Math.min(secondsNeeded, secondsDone + remain);
                            try {
                                const response = await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp } });
                                if (!this._isRunActive(run)) return;
                                isFinished = response?.body?.completed_at != null;
                                secondsDone = timestamp;
                            } catch (err) {
                                Logger.error(this._config.info.name, "Error sending video progress; retrying in 5 seconds.", err);
                                UI.showToast("Unable to update video progress. Retrying in 5 seconds...", { type: "error" });
                                if (!await this._delay(run, 5000)) return;
                                continue;
                            }
                            if (isFinished || timestamp >= secondsNeeded) break;
                        }
                        if (!this._isRunActive(run)) return;
                        if (!isFinished) await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } });
                        if (!this._isRunActive(run)) return;
                        Logger.info(this._config.info.name, "Quest completed!");
                        UI.showToast("Quest completed!", { type: "success" });
                        this._completeRun(run);
                    } catch (err) {
                        this._handleRunError(run, quest, err);
                    }
                })();
                Logger.info(this._config.info.name, `Completing video quest for ${questName}.`);
                UI.showToast(`Completing video quest for ${questName}. Wait ~${Math.max(0, Math.ceil((secondsNeeded - secondsDone) / speed))} sec.`, { type: "info" });
            }
            else if (taskName === "PLAY_ON_DESKTOP") {
                if (!api?.get || !FluxDispatcher?.dispatch || !FluxDispatcher?.subscribe || !FluxDispatcher?.unsubscribe || !RunningGameStore?.getRunningGames || !RunningGameStore?.getGameForPID) throw new Error("Discord's game or quest modules are unavailable.");
                void (async () => {
                    try {
                        const res = await api.get({ url: `/applications/public?application_ids=${applicationId}` });
                        if (!this._isRunActive(run)) return;
                        const appData = res?.body?.[0];
                        if (!appData?.name) throw new Error("Discord did not return application metadata for this quest.");
                        const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");
                        const realGetRunningGames = RunningGameStore.getRunningGames;
                        const realGetGameForPID = RunningGameStore.getGameForPID;
                        const realGames = realGetRunningGames.call(RunningGameStore) ?? [];
                        const usedPids = new Set(realGames.map(game => game?.pid));
                        let pid = Math.floor(Math.random() * 30000) + 1000;
                        while (usedPids.has(pid)) pid = Math.floor(Math.random() * 30000) + 1000;
                        const fakeGame = {
                            cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                            exeName,
                            exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                            hidden: false,
                            isLauncher: false,
                            id: applicationId,
                            name: appData.name,
                            pid,
                            pidPath: [pid],
                            processName: appData.name,
                            start: Date.now()
                        };
                        const fakeGames = [...realGames, fakeGame];
                        const patchedGetRunningGames = () => fakeGames;
                        const patchedGetGameForPID = processId => processId === pid ? fakeGame : realGetGameForPID.call(RunningGameStore, processId);
                        let cleaned = false;
                        let fn;
                        const cleanup = () => {
                            if (cleaned) return;
                            cleaned = true;
                            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                            if (RunningGameStore.getRunningGames === patchedGetRunningGames) RunningGameStore.getRunningGames = realGetRunningGames;
                            if (RunningGameStore.getGameForPID === patchedGetGameForPID) RunningGameStore.getGameForPID = realGetGameForPID;
                            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: realGetRunningGames.call(RunningGameStore) ?? [] });
                        };
                        RunningGameStore.getRunningGames = patchedGetRunningGames;
                        RunningGameStore.getGameForPID = patchedGetGameForPID;
                        fn = data => {
                            if (data?.questId && data.questId !== quest.id) return;
                            const progress = quest.config.configVersion === 1 ? Number(data?.userStatus?.streamProgressSeconds) : Math.floor(Number(data?.userStatus?.progress?.PLAY_ON_DESKTOP?.value));
                            if (!Number.isFinite(progress)) return;
                            Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                            UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, { type: "info" });
                            if (progress >= secondsNeeded) {
                                Logger.info(this._config.info.name, "Quest completed!");
                                UI.showToast("Quest completed!", { type: "success" });
                                this._completeRun(run);
                            }
                        };
                        this._addRunCleanup(run, cleanup);
                        FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [], added: [fakeGame], games: fakeGames });
                        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                        Logger.info(this._config.info.name, `Running game quest for ${questName}. Wait ~${Math.max(0, Math.ceil((secondsNeeded - secondsDone) / 60))} min.`);
                        UI.showToast(`Running game quest for ${questName}. Wait ~${Math.max(0, Math.ceil((secondsNeeded - secondsDone) / 60))} min.`, { type: "info" });
                    } catch (err) {
                        this._handleRunError(run, quest, err);
                    }
                })();
            }
            else if (taskName === "STREAM_ON_DESKTOP") {
                if (!ApplicationStreamingStore?.getStreamerActiveStreamMetadata || !FluxDispatcher?.subscribe || !FluxDispatcher?.unsubscribe) throw new Error("Discord's streaming or quest modules are unavailable.");
                const pid = Math.floor(Math.random() * 30000) + 1000;
                const originalStreamerFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
                const patchedStreamerFunc = () => ({ id: applicationId, pid, sourceName: null });
                let cleaned = false;
                let fn;
                const cleanup = () => {
                    if (cleaned) return;
                    cleaned = true;
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    if (ApplicationStreamingStore.getStreamerActiveStreamMetadata === patchedStreamerFunc) ApplicationStreamingStore.getStreamerActiveStreamMetadata = originalStreamerFunc;
                };
                ApplicationStreamingStore.getStreamerActiveStreamMetadata = patchedStreamerFunc;
                fn = data => {
                    if (data?.questId && data.questId !== quest.id) return;
                    const progress = quest.config.configVersion === 1 ? Number(data?.userStatus?.streamProgressSeconds) : Math.floor(Number(data?.userStatus?.progress?.STREAM_ON_DESKTOP?.value));
                    if (!Number.isFinite(progress)) return;
                    Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                    UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, { type: "info" });
                    if (progress >= secondsNeeded) {
                        Logger.info(this._config.info.name, "Quest completed!");
                        UI.showToast("Quest completed!", { type: "success" });
                        this._completeRun(run);
                    }
                };
                this._addRunCleanup(run, cleanup);
                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                Logger.info(this._config.info.name, `Streaming quest for ${questName}. Stream ~${Math.max(0, Math.ceil((secondsNeeded - secondsDone) / 60))} min. (Need at least one VC peer)`);
                UI.showToast(`Streaming quest for ${questName}. Stream ~${Math.max(0, Math.ceil((secondsNeeded - secondsDone) / 60))} min. (Need at least one VC peer)`, { type: "info" });
            }
            else if (taskName === "PLAY_ACTIVITY") {
                if (!api?.post) throw new Error("Discord's quest API is unavailable.");
                const privateChannel = Webpack.Stores.ChannelStore?.getSortedPrivateChannels?.()[0];
                const guilds = Object.values(Webpack.Stores.GuildChannelStore?.getAllGuilds?.() ?? {});
                const voiceChannel = guilds.flatMap(guild => guild?.VOCAL ?? []).map(entry => entry?.channel).find(channel => channel?.id);
                const channelId = privateChannel?.id ?? voiceChannel?.id;
                if (!channelId) throw new Error("No usable direct-message or voice channel was found for this activity quest.");
                const streamKey = `call:${channelId}:1`;
                void (async () => {
                    try {
                        Logger.info(this._config.info.name, "Completing activity quest", questName, "-", quest.config.messages?.questName);
                        UI.showToast(`Completing activity quest ${questName} - ${quest.config.messages?.questName ?? ""}`, { type: "info" });
                        while (this._isRunActive(run)) {
                            const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
                            if (!this._isRunActive(run)) return;
                            const progress = Number(res?.body?.progress?.PLAY_ACTIVITY?.value);
                            if (!Number.isFinite(progress)) throw new Error("Discord returned invalid activity quest progress.");
                            Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                            UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, { type: "info" });
                            if (progress >= secondsNeeded) {
                                await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
                                if (!this._isRunActive(run)) return;
                                Logger.info(this._config.info.name, "Quest completed!");
                                UI.showToast("Quest completed!", { type: "success" });
                                this._completeRun(run);
                                return;
                            }
                            if (!await this._delay(run, 20000)) return;
                        }
                    } catch (err) {
                        this._handleRunError(run, quest, err);
                    }
                })();
            }
        } catch (err) {
            this._handleRunError(run, quest, err);
        }
    }

    async checkForUpdate() {
        try {
            const response = await fetch(this._config.info.github_raw, { headers: { "User-Agent": "BetterDiscord" } });
            if (!response.ok) throw new Error(`Update request failed with status ${response.status}.`);
            const fileContent = await response.text();
            const remoteMeta = this.parseMeta(fileContent);
            if (!remoteMeta.version || remoteMeta.name !== this._config.info.name) throw new Error("The update file does not contain valid plugin metadata.");
            if (Utils.semverCompare(this._config.info.version, remoteMeta.version) < 0) {
                this.newUpdateNotify(remoteMeta, fileContent);
            }
        }
        catch (err) {
            Logger.error(this._config.info.name, err);
        }

    }

    newUpdateNotify(remoteMeta, remoteFile) {
        Logger.info(this._config.info.name, "A new update is available!");

        UI.showNotification({
            title: `${this._config.info.name} Update Available!`,
            content: `Version ${remoteMeta.version} is now available!`,
            type: "info",
            duration: 1/0,
            actions: [
                {
                    label: "Update Now",
                    onClick: async () => {
                        try {
                            if (!remoteFile) throw new Error("The update file is empty.");
                            const fs = require("fs");
                            const path = require("path");
                            await fs.promises.writeFile(path.join(BdApi.Plugins.folder, this._config.main), remoteFile, "utf8");
                            const currentVersionInfo = Object.assign({}, Data.load(this._config.info.name, "currentVersionInfo") || {});
                            currentVersionInfo.version = remoteMeta.version;
                            currentVersionInfo.hasShownChangelog = false;
                            Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);
                            UI.showToast(`Updated to version ${remoteMeta.version}. Restart the plugin to load it.`, { type: "success" });
                        } catch (err) {
                            UI.showToast("An error occurred while downloading the update.", { type: "error" });
                            Logger.error(this._config.info.name, "An error occurred while downloading the update!", err);
                        }
                    }
                },
                {
                    label: "Update Later",
                    onClick: () => { }
                }
            ]
        })
    }

    parseMeta(fileContent) {
        const meta = {};
        const regex = /@([a-zA-Z]+)\s+(.+)/g;
        let match;
        while ((match = regex.exec(fileContent)) !== null) {
            meta[match[1]] = match[2].trim();
        }
        return meta;
    }
}

module.exports = AutoQuestComplete;
