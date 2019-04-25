import * as mqtt from 'mqtt';
import * as shuffle from 'shuffle-array';
import * as storage from 'node-persist';
import * as tipbot from './api/tipbotApi';
import * as twitter from './api/twitterApi';
import * as config from './config/config';
import * as util from './util';

import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

let mqttClient: mqtt.Client;
let friendList:string[] = [];

let tipQueue:any[] = [];
let processingTip = false;
let processingRemaining = false;

let processRemainingTimeout:NodeJS.Timeout;
let splitTipsTimeout:NodeJS.Timeout;

initBot();

async function initBot() {
    //check if all environment variables are set
    if(!checkEnvironmentVariables()) {
        process.stdin.resume();
        return;
    }

    //init storage
    await storage.init({dir: 'storage'});

    //check if there is still a tip queue
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

}

function initMQTT() {
    mqttClient = mqtt.connect(config.MQTT_URL);
    mqttClient.on('connect', () => {
        writeToConsole("MQTT connected. Subscribing to topics:");
        writeToConsole("subscribing to topic: " + 'tip/received/twitter/'+config.MQTT_TOPIC_USER);
        writeToConsole("subscribing to topic: " + 'deposit/twitter/'+config.MQTT_TOPIC_USER);
        mqttClient.subscribe('tip/received/twitter/'+config.MQTT_TOPIC_USER);
        mqttClient.subscribe('deposit/twitter/'+config.MQTT_TOPIC_USER);

        writeToConsole("Waiting for tips...");

        splitTipsTimeout = setInterval(() => splitTips(), 15000);
    });

    mqttClient.on('close', () => {
        writeToConsole("MQTT closed.");
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
        await storage.setItem('tipQueue', tipQueue);
    });
}

async function initTwitterAndTipbot(): Promise<boolean> {
    //init twitter
    try {
        await twitter.initTwitter();

        let followerResponse = await twitter.getCurrentFollowers();
        if(followerResponse && followerResponse.data && followerResponse.data.users) {
            let followers = followerResponse.data.users;
            //get all accounts which the bot follows
            for(let i = 0; i<followers.length;i++)
                friendList.push(followers[i].screen_name);
        } else {
            writeToConsole("could not get follower list");
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
            if(balance2<0)
                //something went wrong, check tipbot api
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
    if(!processingTip && !processingRemaining && tipQueue.length > 0) {
        writeToConsole("");
        writeToConsole("we have tips in queue, go for it! " + tipQueue.length);
        processingTip = true;
        try {
            let newTip = tipQueue[0];
            writeToConsole("");
            writeToConsole("splitting a new " + newTip.type + " of " + newTip.xrp + " XRP by " + newTip.user);

            let currentBalance = await tipbot.getBalance();
            if(currentBalance >= newTip.xrp) {
                //get amount for each charity
                //multiply by 1,000,000 to get the perfect rounding (always calculate in drops!)
                let dropsForEachCharity:number = calculateDropsForEachCharity(newTip.xrp*config.DROPS);

                if(dropsForEachCharity>0) {
                    writeToConsole("Sending " + dropsForEachCharity/config.DROPS + " XRP to each charity!");
                    for(let i = 0;i<friendList.length;i++) {
                        //send out tips sync with delay!
                        await new Promise(async resolve => {
                            await tipbot.sendTip('twitter', friendList[i], dropsForEachCharity);
                            setTimeout(resolve, 500);
                        });
                    }
                    tipQueue = tipQueue.splice(1);
                    await storage.setItem('tipQueue', tipQueue);

                    //after successfully sent out the tips, try to tweet!
                    sendOutTweet(newTip, dropsForEachCharity);
                } else {
                    writeToConsole("tip too small to split. ignoring.")
                    tipQueue = tipQueue.splice(1);
                    await storage.setItem('tipQueue', tipQueue);
                }
            } else {
                writeToConsole("### We have a new tip but not enought balance to split equally!! ###");
                writeToConsole("current balance: " + currentBalance + " XRP and xrp to split: " + newTip.xrp + " XRP");
                tipQueue = tipQueue.splice(1);
                await storage.setItem('tipQueue', tipQueue);
            }
        } catch {
            processingTip = false;
        }

        processingTip = false;

        //check balance only if we don`t have any more tips to split with a delay of some seconds!
        if(tipQueue.length == 0) {
            writeToConsole("no tips anymore, set timer for remaining balance!");
            //set new check remaining balance timeout when we are done sending out all tips
            if(processRemainingTimeout) clearTimeout(processRemainingTimeout);

            //check 2 min after last received tip if resuming balance can be split
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
    writeToConsole("Generating new tweet");
    //send out tweet
    let tweetString = "";
    if('deposit'===newTip.type) {
        tweetString = '.@'+config.MQTT_TOPIC_USER+' just received a direct deposit of ' + newTip.xrp + ' XRP.\n\n';
    } else {
        //handle tips from twitter users
        if('twitter'===newTip.network || 'twitter'===newTip.user_network)
            tweetString = '.@'+newTip.user+' donated ' + newTip.xrp + ' XRP to @'+config.MQTT_TOPIC_USER+'.\n\n';
        //handle tips from discord and reddit users
        else
            tweetString = ('discord'===newTip.user_network ? newTip.user_id : newTip.user) +' from '+newTip.user_network+' donated ' + newTip.xrp + ' XRP to @'+config.MQTT_TOPIC_USER+'.\n\n';
    }

    //shuffle charities before putting out a new tweet!
    let shuffledCharities = shuffle(friendList, { 'copy': true });
    for(let i = 0; i<shuffledCharities.length;i++)
        tweetString+= '@'+ shuffledCharities[i]+ ' +' + dropsForEachCharity/config.DROPS + ' XRP\n';

    let greetingText = '\n'+twitter.getRandomGreetingsText()+'\n'+twitter.getRandomHashtagText();

    twitter.pushToQueue(tweetString,greetingText);
}

async function checkForRemainingBalance() {
    if(tipQueue.length == 0 && !processingTip && !processingRemaining) {
        writeToConsole("checking remaining balance");
        processingRemaining = true;
        try {
            //check if there is some balance left and forward it when amount can get equaly divided by all charities
            let remainingXRPToForward = await tipbot.getBalance();
            let remainingDropsToForward = remainingXRPToForward*config.DROPS;
            if(remainingDropsToForward > 0 && remainingDropsToForward%friendList.length == 0) {
                //ok perfect, the amount can be divided by the number of charities. we can send out another tip to all charities
                let remainingDropsEachCharity = calculateDropsForEachCharity(remainingDropsToForward);
                writeToConsole("Account balance could be divided. Sending " + remainingDropsEachCharity/config.DROPS + " XRP to each charity.")
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
        } catch {
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

    return !(!config.MQTT_URL
                || !config.MQTT_TOPIC_USER
                    || !config.TIPBOT_URL
                        || !config.TIPBOT_API_KEY
                            || !config.TWITTER_CONSUMER_KEY
                                || !config.TWITTER_CONSUMER_SECRET
                                    || !config.TWITTER_ACCESS_TOKEN
                                            || !config.TWITTER_ACCESS_SECRET);
}

function writeToConsole(message:string) {
    util.writeConsoleLog('[MAIN] ', message);
}