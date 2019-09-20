import * as mqtt from 'mqtt';
import * as shuffle from 'shuffle-array';
import * as tipbot from './api/tipbotApi';
import * as twitter from './api/twitterApi';
import * as config from './config/config';
import * as util from './util';

import consoleStamp = require("console-stamp");
consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

const nodePersist = require('node-persist');

let mqttClient: mqtt.Client;
let friendList:string[] = [];

let tipQueue:any[] = [];
let processingTip = false;
let processingRemaining = false;

let processRemainingTimeout:NodeJS.Timeout;
let splitTipsTimeout:NodeJS.Timeout;

let twitterRealAPI:twitter.TwitterApi;
let twitterBotAPI: twitter.TwitterApi;

let botAccounts:string[] = ['1059563470952247296', '1088476019399577602', '1077305457268658177', '1131106826819444736', '1082115799840632832', '1106106412713889792','52249814', '1038519523077484545'];
let noTweetUsers:string[] = ['1023321496670883840']

let storage:any;

initBot();

async function initBot() {
    //check if all environment variables are set
    try {
        if(!checkEnvironmentVariables()) {
            process.stdin.resume();
            return;
        }

        //init storage
        storage = nodePersist.create({dir: 'storage/tips'});
        await storage.init();

        //check if there is still a tip queue -> if so, reload it so no tips get lost!
        if(await storage.getItem('tipQueue'))
            tipQueue = await storage.getItem('tipQueue');

        writeToConsole("loaded tipQueue with " + JSON.stringify(tipQueue.length) + " tips.");

        //init twitter and tipbot api
        let initSuccessfull = await initTwitterAndTipbot();
        writeToConsole("friendList: " + JSON.stringify(friendList));
        if(!initSuccessfull) {
            writeToConsole("Could not init twitter or tipbot. Bot not working.")
            process.stdin.resume();
        }
        else if(friendList && friendList.length<=0) {
            writeToConsole("The twitter user does not follow anyone. Bot not working.")
            process.stdin.resume();
        }
        else {
            //everything is fine - connect to MQTT and listen for transactions
            initMQTT();
        }
    } catch(err) {
        this.writeToConsole(JSON.stringify(err));
    }

}

function initMQTT() {
    mqttClient = mqtt.connect(config.MQTT_URL);
    mqttClient.on('connect', () => {
        //when connection sucessfull then subscribe to transactions for the user
        writeToConsole("MQTT connected. Subscribing to topics:");
        writeToConsole("subscribing to topic: " + 'tip/received/twitter/'+config.MQTT_TOPIC_USER);
        writeToConsole("subscribing to topic: " + 'deposit/twitter/'+config.MQTT_TOPIC_USER);
        mqttClient.subscribe('tip/received/twitter/'+config.MQTT_TOPIC_USER);
        mqttClient.subscribe('tip/received/twitter/'+config.MQTT_TOPIC_USER.toLowerCase());
        mqttClient.subscribe('deposit/twitter/'+config.MQTT_TOPIC_USER);
        mqttClient.subscribe('deposit/twitter/'+config.MQTT_TOPIC_USER.toLowerCase());

        writeToConsole("Waiting for tips...");

        //call splitTips every 15 seconds to try to split received tips. if no tips, no action
        splitTipsTimeout = setInterval(() => splitTips(), 15000);
    });

    mqttClient.on('close', () => {
        writeToConsole("MQTT closed.");
        //stop trying to split tips if mqtt is not available
        if(splitTipsTimeout)
            clearInterval(splitTipsTimeout);
    });

    mqttClient.on('error', err => {
        writeToConsole("MQTT not ready: " + err);
        process.stdin.resume();
    });

    mqttClient.on('message', async (topic, message) => {
        let newTip = JSON.parse(message.toString());
        //new tip came in, pushing to queue
        writeToConsole("");
        writeToConsole("received a new tip. pushing to queue " + newTip.xrp + " xrp.")
        writeToConsole("");
        tipQueue.push(newTip);
        try {
            await storage.setItem('tipQueue', tipQueue);
        } catch(err) {
            this.writeToConsole(JSON.stringify(err));
        }
    });
}

async function initTwitterAndTipbot(): Promise<boolean> {
    try {
        writeToConsole("init REAL")
        //init twitter and get friend list
        twitterRealAPI = new twitter.TwitterApi(config.TWITTER_CONSUMER_KEY, config.TWITTER_CONSUMER_SECRET, config.TWITTER_ACCESS_TOKEN, config.TWITTER_ACCESS_SECRET, "real");
        await twitterRealAPI.initTwitter();

        writeToConsole("init BOT")
        twitterBotAPI = new twitter.TwitterApi(config.TWITTER_CONSUMER_KEY_BOTS, config.TWITTER_CONSUMER_SECRET_BOTS, config.TWITTER_ACCESS_TOKEN_BOTS, config.TWITTER_ACCESS_SECRET_BOTS, "bots");
        await twitterBotAPI.initTwitter();

        let followerResponse = await twitterRealAPI.getCurrentFollowers();
        if(followerResponse && followerResponse.data && followerResponse.data.users) {
            let followers = followerResponse.data.users;
            //get all accounts which the bot follows
            for(let i = 0; i<followers.length;i++)
                friendList.push(followers[i].screen_name);
        } else {
            writeToConsole("could not get friends list");
            return false;
        }

        //init tipbot
        //check if balance is accessible, if not do login to activate token
        let balance = await tipbot.getBalance();
        if(balance<0) {
            //activate token
            await tipbot.login();
            //check if token is working now
            let balance2 = await tipbot.getBalance();

            if(balance2<0) //something went wrong, check tipbot api
                return false;
        }
    } catch(err) {
        //initialization failed
        writeToConsole("error: " + JSON.stringify(err));
        return false;
    }
    
    return true;
}

async function splitTips() {
    //try to split tips. Check queue if we have tips but do not take action when we are still processing another tip!
    if(!processingTip && !processingRemaining && tipQueue.length > 0) {
        writeToConsole("");
        writeToConsole("we have tips in queue, go for it! " + tipQueue.length);
        processingTip = true;
        try {
            let newTip = tipQueue[0];
            writeToConsole("");
            writeToConsole("splitting a new " + newTip.type + " of " + newTip.xrp + " XRP by " + newTip.user);

            //check if balance is higher than current tip amount. this avoids uneven split tips.
            //this can happen when the "remainingBalanceChecker" already split an incoming tip. (There is some delay where this could happen)
            let currentBalance = await tipbot.getBalance();
            if(currentBalance >= newTip.xrp) {
                //get amount for each charity in drops
                //multiply by 1,000,000 to get the perfect rounding (always calculate in drops!)
                let dropsForEachCharity:number = calculateDropsForEachCharity(newTip.xrp*config.DROPS);

                if(dropsForEachCharity>0) {
                    writeToConsole("Sending " + dropsForEachCharity/config.DROPS + " XRP to each charity!");
                    for(let i = 0;i<friendList.length;i++) {
                        //send out tips in sync with delay to not stess the xrptipbot api too much
                        await new Promise(async resolve => {
                            await tipbot.sendTip('twitter', friendList[i], dropsForEachCharity);
                            setTimeout(resolve, 500);
                        });
                    }
                    //delete the just sent put tip from the queue
                    tipQueue = tipQueue.slice(1);
                    await storage.setItem('tipQueue', tipQueue);

                    //after successfully sent out the tip -> try to tweet!
                    sendOutTweet(newTip, dropsForEachCharity);
                } else {
                    //tip is less than 6 drops. this cannot be split and will be ignored
                    writeToConsole("tip too small to split. ignoring.")
                    tipQueue = tipQueue.slice(1);
                    await storage.setItem('tipQueue', tipQueue);
                }
            } else {
                //this can happen when the "remainingBalanceChecker" was just running when a new tip came in.
                writeToConsole("### We have a new tip but not enought balance to split equally!! ###");
                writeToConsole("current balance: " + currentBalance + " XRP and xrp to split: " + newTip.xrp + " XRP");
                tipQueue = tipQueue.slice(1);
                await storage.setItem('tipQueue', tipQueue);

                //but still send out the tweet so no one misses out! (it`s not the users fault that the tips was split already)
                let dropsForEachCharity:number = calculateDropsForEachCharity(newTip.xrp*config.DROPS);
                sendOutTweet(newTip, dropsForEachCharity);
            }
        } catch (err) {
            writeToConsole(JSON.stringify(err));
            processingTip = false;
        }

        processingTip = false;

        //check remaining balance (only if we don`t have any more tips to split) with a delay of some seconds!
        if(tipQueue.length == 0) {
            writeToConsole("no tips anymore, set timer for remaining balance!");
            //cancel last timer if it exist (when a new tip came in before the old timer was executed)
            if(processRemainingTimeout) clearTimeout(processRemainingTimeout);

            //check 2 min after last received tip if remaining balance can be split
            processRemainingTimeout = setTimeout(() => checkForRemainingBalance(),120000);
        }

    } else {
        if(tipQueue.length > 0) {
            writeToConsole("Could not process tip. Still processing something else!");
            writeToConsole("processingTip: " + processingTip);
            writeToConsole("processingRemaining: " + processingRemaining);
            writeToConsole("tipQueue: " + tipQueue.length);
        }
    }
}

async function sendOutTweet(newTip: any, dropsForEachCharity: number) {
    if(!noTweetUsers.includes(newTip.user_id)) {
        writeToConsole("Generating new tweet");
        //generate main tweet
        let tweetString = "";
        let user = 'discord'===newTip.user_network ? newTip.user_id : newTip.user;
        let user_network = newTip.user_network ? newTip.user_network : newTip.network;
        let transaction_network = newTip.user_network ? newTip.network : null;
        if('deposit'===newTip.type) {
            tweetString = '.@'+config.MQTT_TOPIC_USER+' just received a direct deposit of ' + newTip.xrp + ' XRP.\n\n';
        } else {
            //handle tips from twitter users
            if('twitter'===user_network)
                tweetString = '.@'+newTip.user+' donated ' + newTip.xrp + ' XRP '+(transaction_network ? ('via '+transaction_network+' ') : '')+'to @'+config.MQTT_TOPIC_USER+'.\n\n';
            //handle tips from discord and reddit users
            else
                tweetString = user + ' from '+ user_network+' donated ' + newTip.xrp + ' XRP '+(transaction_network ? ('via '+transaction_network+' ') : '')+'to @'+config.MQTT_TOPIC_USER+'.\n\n';
        }

        //shuffle charities before putting into new tweet
        let shuffledCharities = shuffle(friendList, { 'copy': true });
        for(let i = 0; i<shuffledCharities.length;i++)
            tweetString+= '@'+ shuffledCharities[i]+ ' +' + dropsForEachCharity/config.DROPS + ' XRP\n';

        //add some greetings text (keep randomness for each api)
        let greetingText = "";
        if(botAccounts.includes(newTip.user_id))
            greetingText = '\n'+twitterBotAPI.getRandomGreetingsText()+'\n'+twitterBotAPI.getRandomHashtagText();
        else
            greetingText = '\n'+twitterRealAPI.getRandomGreetingsText()+'\n'+twitterRealAPI.getRandomHashtagText();

        //push new tweet to queue for sending it out later to the defined api
        if(botAccounts.includes(newTip.user_id)) {
            writeToConsole("Pushing to BotAPI")
            twitterBotAPI.pushToQueue(tweetString, greetingText, user, user_network, newTip.network, newTip.xrp);
        }
        else {
            writeToConsole("Pushing to RealAPI")
            twitterRealAPI.pushToQueue(tweetString, greetingText, user, user_network, newTip.network, newTip.xrp);
        }
    } else {
        writeToConsole("No tweet generated for this user.")
    }
}

async function checkForRemainingBalance() {
    //check for remaining balance if we don`t have any tip and/or are processing no tip
    if(tipQueue.length == 0 && !processingTip && !processingRemaining) {
        writeToConsole("checking remaining balance");
        processingRemaining = true;
        try {
            //check if there is some balance left and forward it when whole amount can get equaly split by all charities
            let remainingXRPToForward = await tipbot.getBalance();
            let remainingDropsToForward = remainingXRPToForward*config.DROPS;
            if(remainingDropsToForward > 0 && remainingDropsToForward%friendList.length == 0) {
                //ok perfect, the amount can be divided by the number of charities. we can send out another tip to all charities
                let remainingDropsEachCharity = calculateDropsForEachCharity(remainingDropsToForward);
                writeToConsole("Account balance could be divided equally. Sending " + remainingDropsEachCharity/config.DROPS + " XRP to each charity.")
                if(tipQueue.length == 0 && !processingTip) {
                    for(let i = 0;i<friendList.length;i++) {
                        //send out tips sync with delay!
                        await new Promise(async resolve => {
                            await tipbot.sendTip('twitter', friendList[i], remainingDropsEachCharity);
                            setTimeout(resolve, 500);
                        });
                    }
                    writeToConsole("Remaining balance was split.")
                } else {
                    writeToConsole("not splitting remaining balance because we have received a new tip");
                }
            } else {
                if(remainingDropsToForward > 0)
                    writeToConsole("balance could not be split");
                else
                    writeToConsole("no balance to split");
            }

            processingRemaining = false;
        } catch(err) {
            writeToConsole(JSON.stringify(err));
            processingRemaining = false;
        }
    }
}

function calculateDropsForEachCharity(dropsToSplit:number): number {
    //if less drops than number of friends, we cannot split!
    if(dropsToSplit < friendList.length)
        return 0;
    else
        //divide drops to split by number of accounts the bot follows
        return Math.floor(dropsToSplit/friendList.length);        
}

function checkEnvironmentVariables(): boolean {
    
    if(!config.MQTT_URL)
        writeToConsole("Please set the MQTT_URL as environment variable")

    if(!config.MQTT_TOPIC_USER)
        writeToConsole("Please set the MQTT_TOPIC_USER as environment variable")
    
    if(!config.TIPBOT_URL)
        writeToConsole("Please set the TIPBOT_URL as environment variable");

    if(!config.TIPBOT_API_KEY)
        writeToConsole("Please set the TIPBOT_API_KEY as environment variable");

    if(!config.TWITTER_CONSUMER_KEY)
        writeToConsole("Please set the TWITTER_CONSUMER_KEY as environment variable");

    if(!config.TWITTER_CONSUMER_SECRET)
        writeToConsole("Please set the TWITTER_CONSUMER_SECRET as environment variable");

    if(!config.TWITTER_ACCESS_TOKEN)
        writeToConsole("Please set the TWITTER_ACCESS_TOKEN as environment variable");

    if(!config.TWITTER_ACCESS_SECRET)
        writeToConsole("Please set the TWITTER_ACCESS_SECRET as environment variable");

    if(!config.TWITTER_CONSUMER_KEY_BOTS)
        writeToConsole("Please set the TWITTER_CONSUMER_KEY_BOTS as environment variable");

    if(!config.TWITTER_CONSUMER_SECRET_BOTS)
        writeToConsole("Please set the TWITTER_CONSUMER_SECRET_BOTS as environment variable");

    if(!config.TWITTER_ACCESS_TOKEN_BOTS)
        writeToConsole("Please set the TWITTER_ACCESS_TOKEN_BOTS as environment variable");

    if(!config.TWITTER_ACCESS_SECRET_BOTS)
        writeToConsole("Please set the TWITTER_ACCESS_SECRET_BOTS as environment variable");

    return !(!config.MQTT_URL
                || !config.MQTT_TOPIC_USER
                    || !config.TIPBOT_URL
                        || !config.TIPBOT_API_KEY
                            || !config.TWITTER_CONSUMER_KEY
                                || !config.TWITTER_CONSUMER_SECRET
                                    || !config.TWITTER_ACCESS_TOKEN
                                        || !config.TWITTER_ACCESS_SECRET
                                            || !config.TWITTER_CONSUMER_KEY_BOTS
                                                || !config.TWITTER_CONSUMER_SECRET_BOTS
                                                    || !config.TWITTER_ACCESS_TOKEN_BOTS
                                                        || !config.TWITTER_ACCESS_SECRET_BOTS);
}

function writeToConsole(message:string) {
    util.writeConsoleLog('[MAIN] ', message);
}