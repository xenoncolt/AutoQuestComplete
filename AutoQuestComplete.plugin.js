/**
 * @name AutoQuestComplete
 * @description Automatically completes quests for you ... btw first u have to accept the quest manually...okay...
 * @version 0.2.5
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
        website: "https://xenoncolt.live",
        version: "0.2.5",
        description: "Automatically completes quests for you",
        author: [
            {
                name: "@aamiaa",
                plugin_author: "Xenon Colt",
                github_username: "xenoncolt",
                link: "https://xenoncolt.live"
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
        //         "Now mobile video quest works too. But u can accept only on mobile. If possible turn on the video quest on mobile and then use this plugin to complete it.",
        //         "I will figure out how to accept video quest on desktop later."
        //     ]
        // },
        {
            title: "Hot Fixes",
            type: "fixed",
            items: [
                "Fixed where video quest was not completing properly.",
            ]
        }
        // {
        //     title: "Changed Few Things",
        //     type: "changed",
        //     items: [
        //         "Changed the author name and update description",
        //     ]
        // }
    ],
}

const { Webpack, UI, Logger, Data, Utils } = BdApi;

class AutoQuestComplete {
    constructor() {
        this._config = config;
        this._questsStore = Webpack.getStore("QuestsStore");
        this._boundHandleQuestChange = this.handleQuestChange.bind(this);
        this._activeQuestId = null;
        this._activeQuestName = null;

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
        try {
            if (this._questsStore && this._questsStore.addChangeListener) {
                this._questsStore.addChangeListener(this._boundHandleQuestChange);
            }
            const quest = [...this._questsStore.quests.values()].find(x =>
                x.id !== "1248385850622869556" &&
                x.userStatus?.enrolledAt &&
                !x.userStatus?.completedAt &&
                new Date(x.config.expiresAt).getTime() > Date.now()
            );

            // Run Immediately in case a quest is already accepted
            if (this._questsStore && quest) {
                this._activeQuestId = quest.config.application.id;
                this._activeQuestName = quest.config.application.name;
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
        }

    }

    handleQuestChange() {
        const quest = [...this._questsStore.quests.values()].find(x =>
            x.id !== "1248385850622869556" &&
            x.userStatus?.enrolledAt &&
            !x.userStatus?.completedAt &&
            new Date(x.config.expiresAt).getTime() > Date.now()
        );

        if (quest && quest.config.application.id !== this._activeQuestId) {
            this._activeQuestId = quest.config.application.id;
            this._activeQuestName = quest.config.application.name;
            UI.showToast(`New quest found: ${this._activeQuestName}`, {type:"info"});
            this.runQuest(quest);
        }
    }

    runQuest(quest) {
        delete window.$;

        let ApplicationStreamingStore = Webpack.getStore("ApplicationStreamingStore");
        let FluxDispatcher = Webpack.getByKeys('dispatch', 'subscribe', 'register');
        let api = Webpack.getModule(m => m?.tn?.get)?.tn;
        let RunningGameStore = Webpack.getStore("RunningGameStore");

        if (!quest) {
            Logger.info(this._config.info.name, "No uncompleted quests found.");
            UI.showToast("No uncompleted quests found.", {type:"info"});
            return;
        }

        const pid = Math.floor(Math.random() * 30000) + 1000;
        const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"]
            .find(x => quest.config.taskConfigV2.tasks[x] != null);
        const secondsNeeded = quest.config.taskConfigV2.tasks[taskName].target;
        let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

        if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
            const maxPreview = 10, speed = 7, intervalTime = 1;
            const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
            let isFinished = false;

            (async () => {
                while (true) {
                    const maxAllowedTime = Math.floor((Date.now() - enrolledAt)/ 1000) + maxPreview;
                    const diff = maxAllowedTime - secondsDone;
                    const timestamp = secondsDone + speed;

                    if (diff >= speed) {
                        const response = await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: Math.min(secondsNeeded, timestamp + Math.random())}});
                        isFinished = response.body.completed_at != null;
                        secondsDone = Math.min(secondsNeeded, timestamp);
                    }

                    if (timestamp >= secondsNeeded) {
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, intervalTime * 1000));
                }
                if (!isFinished) {
                    await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: secondsNeeded}});
                }
                Logger.info(this._config.info.name, "Quest completed!");
                UI.showToast("Quest completed!", {type:"success"});
            })();

            Logger.info(this._config.info.name, `Spoofing video for ${this._activeQuestName}.`);
            UI.showToast(`Spoofing video for ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone)/speed)} sec.`, {type:"info"});
        }
        else if (taskName === "PLAY_ON_DESKTOP") {
            api.get({url: `/applications/public?application_ids=${this._activeQuestId}`}).then(res => {
                const appData = res.body[0];
                const exeName = appData.executables.find(x => x.os === "win32").name.replace(">","");
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
                FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames});
                
                let fn = data => {
                    let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value);
                    Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                    UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, {type:"info"});
                    if(progress >= secondsNeeded) {
                        Logger.info(this._config.info.name, "Quest completed!");
                        UI.showToast("Quest completed!", {type:"success"});
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
                Logger.info(this._config.info.name, `Spoofed game to ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone)/60)} min.`);
                UI.showToast(`Spoofed game to ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone)/60)} min.`, {type:"info"});
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
                UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, {type:"info"});
                if(progress >= secondsNeeded) {
                    Logger.info(this._config.info.name, "Quest completed!");
                    UI.showToast("Quest completed!", {type:"success"});
                    ApplicationStreamingStore.getStreamerActiveStreamMetadata = this._originalStreamerFunc;
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                }
            };
            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
            Logger.info(this._config.info.name, `Spoofed stream to ${this._activeQuestName}. Stream ~${Math.ceil((secondsNeeded - secondsDone)/60)} min. (Need at least one VC peer)`);
            UI.showToast(`Spoofed stream to ${this._activeQuestName}. Stream ~${Math.ceil((secondsNeeded - secondsDone)/60)} min. (Need at least one VC peer)`, {type:"info"});
        }
        else if (taskName === "PLAY_ACTIVITY") {
            const channelId = Webpack.getStore("ChannelStore").getSortedPrivateChannels()[0]?.id ||
                Object.values(Webpack.getStore("GuildChannelStore").getAllGuilds()).find(x => x && x.VOCAL.length > 0).VOCAL[0].channel.id;
            const streamKey = `call:${channelId}:1`;
            (async () => {
                Logger.info(this._config.info.name, "Completing quest", this._activeQuestName, "-", quest.config.messages.questName);
                UI.showToast(`Completing quest ${this._activeQuestName} - ${quest.config.messages.questName}`, {type:"info"});
                while(true) {
                    const res = await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: false}});
                    const progress = res.body.progress.PLAY_ACTIVITY.value;
                    Logger.info(this._config.info.name, `Quest progress: ${progress}/${secondsNeeded}`);
                    UI.showToast(`Quest progress: ${progress}/${secondsNeeded}`, {type:"info"});
                    await new Promise(resolve => setTimeout(resolve, 20000));
                    if(progress >= secondsNeeded) {
                        await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: true}});
                        break;
                    }
                }
                Logger.info(this._config.info.name, "Quest completed!");
                UI.showToast("Quest completed!", {type:"success"});
            })();
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

        UI.showConfirmationModal("Update Available", [`Update ${remoteMeta.version} is now available for AutoQuestComplete!`, "Press Download Now to update!"], {
            confirmText: "Download Now",
            onConfirm: async (e) => {
                if (remoteFile) {
                    await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, `${this._config.info.name}.plugin.js`), remoteFile, r));
                    try {
                        let currentVersionInfo = Data.load(this._config.info.name, "currentVersionInfo");
                        currentVersionInfo.hasShownChangelog = false;
                        Data.save(this._config.info.name, "currentVersionInfo", currentVersionInfo);
                    } catch (err) {
                        UI.showToast("An error occurred when trying to download the update!", { type: "error" });
                    }
                }
            }
        });
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