/**
 * @name AutoQuestComplete
 * @description Automatically completes quests for you ... btw first u have to accept the quest manually...okay...
 * @version 0.9.1
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
        version: "0.9.1",
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
        // {
        //     title: "New Features & Improvements",
        //     type: "added",
        //     items: [
        //         "Quest notifications now show the game icon, reward (with the Nitro orb bonus), task type & time, publisher, and how soon the quest expires - so you know what you're getting before opening it.",
        //         "Quests now load in the background automatically, so you get notified without having to open the Quests page first."
        //     ]
        // }
        {
            title: "Fix",
            type: "fixed",
            items: [
                "Fixed unsupported quests model button open new browser window instead client",
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
        this._activeQuestName = null;
        this._unsupportedQuests = new Set();
        this._notifiedQuests = new Set();
        this._remindersTime = new Map();
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

            const quests = [...this._questsStore.quests.values()]
            
            for (const q of quests) {
              if (!this.isQuestSupported(q)) this._unsupportedQuests.add(q.id);
            }

            const quest = quests.find(x =>
                x.userStatus?.enrolledAt &&
                !x.userStatus?.completedAt &&
                new Date(x.config.expiresAt).getTime() > Date.now()
            );

            if (this._questsStore && quest) {
                this._activeQuestId = quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id;
                this._activeQuestName = this.getQuestName(quest);
                this.runQuest(quest);
            }
        } catch (e) {
            Logger.error(this._config.info.name, "Error while starting AutoQuestComplete", e);
            UI.showToast("Error while starting AutoQuestComplete", {type:"error"});
        }
    }

    stop() {
        if (this._questsStore && this._questsStore.removeChangeListener) {
            this._questsStore.removeChangeListener(this._boundHandleQuestChange);
            this._questsStore.removeChangeListener(this._boundNewQuestHandler);
        }
        for (const [questId, timeout] of this._remindersTime.entries()) {
            clearTimeout(timeout);
        }
        this._unsupportedQuests.clear();
        this._notifiedQuests.clear();
        this._remindersTime.clear();
    }

    _flattenSettings(settings = this._config.settingsPanel) {
        return settings.flatMap(setting =>
            setting.type === "category" && Array.isArray(setting.settings)
                ? this._flattenSettings(setting.settings)
                : [setting]
        );
    }

    isQuestSupported(quest) {
      const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE", "ACHIEVEMENT_IN_ACTIVITY"]
          .find(x => quest.config.taskConfigV2.tasks[x] != null);
      return taskName && taskName !== "ACHIEVEMENT_IN_ACTIVITY" ? true : false
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


    getQuestApplicationId(quest) {
        const tasks = quest?.config?.taskConfigV2?.tasks ?? {};
        for (const task of Object.values(tasks)) {
            const id = task?.applications?.[0]?.id;
            if (id) return id;
        }
        return quest?.config?.application?.id ?? null;
    }

    
    getQuestName(quest) {
        return quest?.config?.messages?.questName ?? quest?.config?.messages?.gameTitle ?? "Unknown Quest";
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
        const intro = `Accept "${this.getQuestName(quest)}" to start auto-completing.`;
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
        const quest = [...this._questsStore.quests.values()].find(x =>
            x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );

        const new_quest = [...this._questsStore.quests.values()].find(x =>
            !x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );

        if (new_quest && new_quest !== quest && this.settings.enableNotify && !this._notifiedQuests.has(new_quest.config.application?.id ?? this.getQuestApplicationId(new_quest) ?? new_quest.id)) {
            if (!this.shouldNotifyForQuest(new_quest)) return;
            // UI.showNotice("New quest available! Please accept it to start auto completing.", {
            //     type: "info",
            //     timeout: 5 * 60 * 1000,
            //     buttons: [
            //         {
            //             label: "Go to Quests",
            //             onClick: () => {
            //                 open(`/quests/${new_quest.id}`);
            //             }
            //         }
            //     ]
            // });
            this._notifiedQuests.add(new_quest.config.application?.id ?? this.getQuestApplicationId(new_quest) ?? new_quest.id);
            this.showQuestNotification(new_quest);
        }
    }


    async openQuests() {
        try {
            const quest_link = document.querySelector('a[href="/quest-home"]');

            if (quest_link) {
                quest_link.click();
                await new Promise(r => setTimeout(r, 300));
                if (location.pathname.startsWith("/quest")) return;
            }

            const Router = Webpack.getModule(m => m?.transitionTo && m?.replaceWith && m?.getHistory, { searchExports: true });
            if (Router?.transitionTo) {
                Router.transitionTo("/quest-home");
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
                    setTimeout(highlight_container, 250);
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
    }


    showQuestNotification(quest, reminder = false) {
        if (!quest) return;
        const title = reminder ? `Reminder: New Quest Available!` : `New Quest Available!`;
        
        UI.showNotification({
            title: title,
            content: this.buildNotificationContent(quest),
            icon: this.buildQuestIcon(quest),
            type: "info",
            duration: 5 * 60 * 1000,
            actions: [
                {
                    label: "Go to Quests",
                    onClick: async () => {
                        await this.openQuests();
                        this.focusQuestContainer(quest);
                    }
                },
                {
                    label: "Remind Me Later",
                    onClick: () => {
                        const existing_reminder = this._remindersTime.get(quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id);
                        if (existing_reminder) clearTimeout(existing_reminder);
                        const reminderTimeout = setTimeout(() => {
                            this._remindersTime.delete(quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id);
                            this.showQuestNotification(quest, true);
                        }, 60 * 60 * 1000);
                        this._remindersTime.set(quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id, reminderTimeout);
                    }
                }
            ]
        })
    }

    handleQuestChange() {
        const quest = [...this._questsStore.quests.values()].find(x =>
            !this._unsupportedQuests.has(x.id) &&
            x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );
        // Logger.info(this._config.info.name, "Quest: ", quest);

        if (quest && (quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id) !== this._activeQuestId) {
            this._activeQuestId = quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id;
            this._activeQuestName = this.getQuestName(quest);
            this._activeAppId = this.getQuestApplicationId(quest);
            UI.showToast(`New quest found: ${this._activeQuestName}`, {type:"info"});
            this.runQuest(quest);
        }
    }

    runQuest(quest) {
        try {
            delete window.$;

            let ApplicationStreamingStore = Webpack.Stores.ApplicationStreamingStore;
            let FluxDispatcher = Webpack.getByKeys('dispatch', 'subscribe', 'register', { searchExports: true });
            let api = Webpack.getModule(m => m?.Bo?.get)?.Bo;
            let RunningGameStore = Webpack.Stores.RunningGameStore;

            if (!quest) {
                Logger.info(this._config.info.name, "No uncompleted quests found.");
                UI.showToast("No uncompleted quests found.", { type: "info" });
                return;
            }

            if (this._remindersTime.has(quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id)) {
                clearTimeout(this._remindersTime.get(quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id));
                this._remindersTime.delete(quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id);
            }

            if (this._notifiedQuests.has(quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id)) {
                this._notifiedQuests.delete(quest.config.application?.id ?? this.getQuestApplicationId(quest) ?? quest.id);
            }

            const pid = Math.floor(Math.random() * 30000) + 1000;
            // const tasked = quest.config.taskConfigV2 ?? quest.config.taskConfig;
            const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE", "ACHIEVEMENT_IN_ACTIVITY"]
                .find(x => quest.config.taskConfigV2.tasks[x] != null);

            if (!taskName) {
                if (this._unsupportedQuests.has(quest.id)) return;
                this._unsupportedQuests.add(quest.id);
                const taskList = Object.keys(quest.config.taskConfigV2.tasks).join(", ");
                Logger.info(this._config.info.name, `${this._activeQuestName} is not supported by this plugin. "Xbox and Playstation" Task.`);
                UI.showToast(`Skipping ${this._activeQuestName}.`, { type: "warning" });
                setTimeout(() => this.handleQuestChange(), 1000);
                return;
            }

            const secondsNeeded = quest.config.taskConfigV2.tasks[taskName].target;
            let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

            if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
                const speed = 7;
                const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
                let isFinished = false;

                (async () => {
                    while (true) {
                        const remain = Math.min(speed, secondsNeeded - secondsDone);
                        await new Promise(resolve => setTimeout(resolve, remain * 1000));
                        const timestamp = secondsDone + speed;


                            const response = await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) } });
                            isFinished = response.body.completed_at != null;
                            secondsDone = Math.min(secondsNeeded, timestamp);


                        if (timestamp >= secondsNeeded) {
                            break;
                        }
                    }
                    if (!isFinished) {
                        await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } });
                    }
                    Logger.info(this._config.info.name, "Quest completed!");
                    UI.showToast("Quest completed!", { type: "success" });
                })();

                Logger.info(this._config.info.name, `Spoofing video for ${this._activeQuestName}.`);
                UI.showToast(`Spoofing video for ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / speed)} sec.`, { type: "info" });
            }
            else if (taskName === "PLAY_ON_DESKTOP") {
                if (!this._activeQuestId) {
                    Logger.error(this._config.info.name, `Could not resolve the application id for "${this._activeQuestName}".`);
                    UI.showToast(`Could not resolve the application id for "${this._activeQuestName}".`, { type: "error" });
                    return;
                }
                api.get({ url: `/applications/public?application_ids=${this._activeQuestId}` }).then(res => {
                    const appData = res.body[0];
                    const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");
                    const fakeGame = {
                        cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                        exeName,
                        exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                        hidden: false,
                        isLauncher: false,
                        id: this._activeQuestId,
                        name: appData.name,
                        pid: pid,
                        pidPath: [pid],
                        processName: appData.name,
                        start: Date.now(),
                    };
                    const realGames = RunningGameStore.getRunningGames();
                    const fakeGames = [fakeGame];
                    const realGetRunningGames = RunningGameStore.getRunningGames;
                    const realGetGameForPID = RunningGameStore.getGameForPID;
                    //games.push(fakeGame);
                    RunningGameStore.getRunningGames = () => fakeGames;
                    RunningGameStore.getGameForPID = (pid) => fakeGames.find(x => x.pid === pid);
                    FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames });

                    let fn = data => {
                        let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value);
                        Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                        UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, { type: "info" });
                        if (progress >= secondsNeeded) {
                            Logger.info(this._config.info.name, "Quest completed!");
                            UI.showToast("Quest completed!", { type: "success" });
                            // const idx = games.indexOf(fakeGame);
                            // if(idx > -1) {
                            //     games.splice(idx, 1);
                            //     FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: []});
                            // }
                            RunningGameStore.getRunningGames = realGetRunningGames;
                            RunningGameStore.getGameForPID = realGetGameForPID;
                            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] });
                            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                        }
                    };
                    FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    Logger.info(this._config.info.name, `Spoofed game to ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min.`);
                    UI.showToast(`Spoofed game to ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min.`, { type: "info" });
                });
            }
            else if (taskName === "STREAM_ON_DESKTOP") {
                this._originalStreamerFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
                ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
                    id: this._activeQuestId,
                    pid,
                    sourceName: null
                });
                let fn = data => {
                    let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value);
                    Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                    UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, { type: "info" });
                    if (progress >= secondsNeeded) {
                        Logger.info(this._config.info.name, "Quest completed!");
                        UI.showToast("Quest completed!", { type: "success" });
                        ApplicationStreamingStore.getStreamerActiveStreamMetadata = this._originalStreamerFunc;
                        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    }
                };
                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                Logger.info(this._config.info.name, `Spoofed stream to ${this._activeQuestName}. Stream ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min. (Need at least one VC peer)`);
                UI.showToast(`Spoofed stream to ${this._activeQuestName}. Stream ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min. (Need at least one VC peer)`, { type: "info" });
            }
            else if (taskName === "PLAY_ACTIVITY") {
                const channelId = Webpack.Stores.ChannelStore.getSortedPrivateChannels()[0]?.id ||
                    Object.values(Webpack.Stores.GuildChannelStore.getAllGuilds()).find(x => x && x.VOCAL.length > 0).VOCAL[0].channel.id;
                const streamKey = `call:${channelId}:1`;
                (async () => {
                    Logger.info(this._config.info.name, "Completing quest", this._activeQuestName, "-", quest.config.messages.questName);
                    UI.showToast(`Completing quest ${this._activeQuestName} - ${quest.config.messages.questName}`, { type: "info" });
                    while (true) {
                        const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
                        const progress = res.body.progress.PLAY_ACTIVITY.value;
                        Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                        UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, { type: "info" });
                        await new Promise(resolve => setTimeout(resolve, 20000));
                        if (progress >= secondsNeeded) {
                            await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
                            break;
                        }
                    }
                    Logger.info(this._config.info.name, "Quest completed!");
                    UI.showToast("Quest completed!", { type: "success" });
                })();
            }
            else if (taskName === "ACHIEVEMENT_IN_ACTIVITY") {
                if (this._unsupportedQuests.has(quest.id)) return;
                this._unsupportedQuests.add(quest.id);

                UI.showConfirmationModal("Unsupported Quest Task", [`The quest "${this._activeQuestName}" has an unsupported Quest type: ${taskName}.`, "AutoQuestComplete will not be able to complete this quest. Because it's a server-side quest.\n  **Please complete it manually**."], {
                    confirmText: "Go to Quest",
                    onConfirm: async (e) => {
                        await new Promise(resolve => {
                            const started = Date.now();
                            const check = () => {
                                if (!document.querySelector('[role="dialog"]') || Date.now() - started > 3000) return resolve();
                                setTimeout(check, 100);
                            };
                            check();
                        });
                        await this.openQuests();
                        this.focusQuestContainer(quest);
                    }
                });
                setTimeout(() => this.handleQuestChange(), 5000);
            }
        } catch (err) {
            UI.showConfirmationModal("Error", ["An error occurred while trying to complete the quest. Please reach out to developer with the following information:", `Quest Name: ${this._activeQuestName}`, `Error: ${err.message}`, `Or click to send report to create an issue on github`], {
                confirmText: "Report Issue",
                onConfirm: async () => {
                    const issueTitle = encodeURIComponent(`Error while completing quest: ${this._activeQuestName}`);
                    const issueBody = encodeURIComponent(`**Quest Name:** ${this._activeQuestName}\n**Error:** ${err.message}\n**Stack Trace:**\n\`\`\`${err.stack}\`\`\``);
                    const issueUrl = `https://github.com/xenoncolt/AutoQuestComplete/issues/new?title=${issueTitle}&body=${issueBody}`;
                    open(issueUrl);
                },
            })
        }
    }

    async checkForUpdate() {
        try {
            let fileContent = await (await fetch(this._config.info.github_raw, { headers: { "User-Agent": "BetterDiscord" } })).text();
            let remoteMeta = this.parseMeta(fileContent);
            if (Utils.semverCompare(this._config.info.version, remoteMeta.version) > 0) {
                this.newUpdateNotify(remoteMeta, fileContent);
            }
        }
        catch (err) {
            Logger.error(this._config.info.name, err);
        }

    }

    newUpdateNotify(remoteMeta, remoteFile) {
        Logger.info(this._config.info.name, "A new update is available!");

        // UI.showConfirmationModal("Update Available", [`Update ${remoteMeta.version} is now available for AutoQuestComplete!`, "Press Download Now to update!"], {
        //     confirmText: "Download Now",
        //     onConfirm: async (e) => {
        //         if (remoteFile) {
        //             await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, `${this._config.info.name}.plugin.js`), remoteFile, r));
        //             try {
        //                 let currentVersionInfo = Data.load(this._config.info.name, "currentVersionInfo");
        //                 currentVersionInfo.hasShownChangelog = false;
        //                 Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);
        //             } catch (err) {
        //                 UI.showToast("An error occurred when trying to download the update!", { type: "error" });
        //             }
        //         }
        //     }
        // });
        UI.showNotification({
            title: `${this._config.info.name} Update Available!`,
            content: `Version ${remoteMeta.version} is now available!`,
            type: "info",
            duration: 1/0,
            actions: [
                {
                    label: "Update Now",
                    onClick: async (e) => {
                        if (remoteFile) {
                            await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, `${this._config.info.name}.plugin.js`), remoteFile, r));
                            try {
                                let currentVersionInfo = Data.load(this._config.info.name, "currentVersionInfo");
                                currentVersionInfo.hasShownChangelog = false;
                                Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);
                            } catch (err) {
                                UI.showToast("An error occurred when trying to download the update!", { type: "error" });
                                Logger.error(this._config.info.name, "An error occurred when trying to download the update!", err);
                            }
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

