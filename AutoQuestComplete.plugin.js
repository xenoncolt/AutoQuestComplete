/**
 * @name AutoQuestComplete
 * @description Automatically completes quests for you.... Inspired from @aamiaa/CompleteDiscordQuest
 * @version 0.1.3
 * @author Xenon Colt
 * @authorLink https://xenoncolt.me
 * @website https://github.com/xenoncolt/AutoQuestComplete
 * @source https://raw.githubusercontent.com/xenoncolt/AutoQuestComplete/main/AutoQuestComplete.plugin.js
 * @invite vJRe78YmN8
 */

const config = {
    main: 'AutoQuestComplete.plugin.js',
    info: {
        name: 'AutoQuestComplete',
        authorId: "709210314230726776",
        website: "https://xenoncolt.me",
        version: "0.1.3",
        description: "Automatically completes quests for you",
        author: [
            {
                name: "Xenon Colt",
                inspired_from: "@aamiaa",
                github_username: "xenoncolt",
                link: "https://xenoncolt.me"
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
        //         "Added auto update feature",
        //         "Refactored the code",
        //         "Added Changelog Message",
        //     ]
        // },
        {
            title: "Fixed Few Things",
            type: "fixed",
            items: [
                "Forget to update the version (ahhhh when i will stop making this silly mistake)",
                "Also forget to update the changelog"
            ]
        },
        {
            title: "Changed Few Things",
            type: "changed",
            items: [
                "Refactor quest handling logic",
                "Improve game state management"
            ]
        }
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
            console.error("Error while starting AutoQuestComplete", e);
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
        let wpRequire;
        window.webpackChunkdiscord_app.push([[ Math.random() ], {}, (req) => { wpRequire = req; }]);

        let ApplicationStreamingStore = Webpack.getStore("ApplicationStreamingStore");
        let FluxDispatcher = Webpack.getByKeys("actionLogger");
        let api = Object.values(wpRequire.c).find(x => x?.exports?.tn?.get)?.exports?.tn;
        let RunningGameStore = Webpack.getStore("RunningGameStore");

        let isApp = typeof DiscordNative !== "undefined";
        if (!quest) {
            console.log("No uncompleted quests found.");
            UI.showToast("No uncompleted quests found.", {type:"info"});
            return;
        }

        const pid = Math.floor(Math.random() * 30000) + 1000;
        const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"]
            .find(x => quest.config.taskConfig.tasks[x] != null);
        const secondsNeeded = quest.config.taskConfig.tasks[taskName].target;
        const secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

        if (taskName === "WATCH_VIDEO") {
            const tolerance = 2, speed = 10;
            // const diff = Math.floor((Date.now() - new Date(quest.userStatus.enrolledAt).getTime())/1000);
            // const startingPoint = Math.min(Math.max(Math.ceil(secondsDone), diff), secondsNeeded);
            (async () => {
                for(let i = secondsDone; i <= secondsNeeded; i += speed) {
                    try {
                        await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: Math.min(secondsNeeded, i + Math.random())}});
                    } catch(ex) {
                        console.log("Failed at", i, ex.message);
                    }
                    await new Promise(resolve => setTimeout(resolve, tolerance * 1000));
                }
                if((secondsNeeded - secondsDone) % speed !== 0) {
                    await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: secondsNeeded}});
                }
                console.log("Quest completed!");
                UI.showToast("Quest completed!", {type:"success"});
            })();
            console.log(`Spoofing video for ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone)/speed*tolerance)} sec.`);
            UI.showToast(`Spoofing video for ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone)/speed*tolerance)} sec.`, {type:"info"});
        }
        else if (taskName === "PLAY_ON_DESKTOP") {
            if (!isApp) {
                console.log("Use the desktop app for", this._activeQuestName);
                UI.showToast(`Desktop app required for ${this._activeQuestName}`, {type:"warn"});
                return;
            }
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
                    console.log(`Quest progress: ${progress}/${secondsNeeded}`);
                    if(progress >= secondsNeeded) {
                        console.log("Quest completed!");
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
                console.log(`Spoofed game to ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone)/60)} min.`);
                UI.showToast(`Spoofed game to ${this._activeQuestName}. Wait ~${Math.ceil((secondsNeeded - secondsDone)/60)} min.`, {type:"info"});
            });
        }
        else if (taskName === "STREAM_ON_DESKTOP") {
            if (!isApp) {
                console.log("Use the desktop app for", this._activeQuestName);
                UI.showToast(`Desktop app required for ${this._activeQuestName}`, {type:"warn"});
                return;
            }
            this._originalStreamerFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
                id: this._activeQuestId,
                pid,
                sourceName: null
            });
            let fn = data => {
                let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value);
                console.log(`Quest progress: ${progress}/${secondsNeeded}`);
                if(progress >= secondsNeeded) {
                    console.log("Quest completed!");
                    UI.showToast("Quest completed!", {type:"success"});
                    ApplicationStreamingStore.getStreamerActiveStreamMetadata = this._originalStreamerFunc;
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                }
            };
            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
            console.log(`Spoofed stream to ${this._activeQuestName}. Stream ~${Math.ceil((secondsNeeded - secondsDone)/60)} min. (Need at least one VC peer)`);
            UI.showToast(`Spoofed stream to ${this._activeQuestName}. Stream ~${Math.ceil((secondsNeeded - secondsDone)/60)} min. (Need at least one VC peer)`, {type:"info"});
        }
        else if (taskName === "PLAY_ACTIVITY") {
            const channelId = Webpack.getStore("ChannelStore").getSortedPrivateChannels()[0]?.id ||
                Object.values(Webpack.getStore("GuildChannelStore").getAllGuilds()).find(x => x && x.VOCAL.length > 0).VOCAL[0].channel.id;
            const streamKey = `call:${channelId}:1`;
            (async () => {
                console.log("Completing quest", this._activeQuestName, "-", quest.config.messages.questName);
                while(true) {
                    const res = await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: false}});
                    const progress = res.body.progress.PLAY_ACTIVITY.value;
                    console.log(`Quest progress: ${progress}/${secondsNeeded}`);
                    await new Promise(resolve => setTimeout(resolve, 20000));
                    if(progress >= secondsNeeded) {
                        await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: true}});
                        break;
                    }
                }
                console.log("Quest completed!");
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