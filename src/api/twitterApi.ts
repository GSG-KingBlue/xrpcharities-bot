import * as Twit from 'twit';
import * as shuffle from 'shuffle-array';
import * as storage from 'node-persist';
import consoleStamp = require("console-stamp");

import * as config from '../config/config';
import * as util from '../util';


consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

let additionalTweetText:string[] = [
    "Thank you for your donation!",
    "Can we have a retweet and spread the good word?",
    "What a wonderful way to start the day.",
    "Saving the world. A few $XRP at a time.",
    "Good people do good things.",
    "Wow, what a great way to share some $XRP!",
    "Time to make it rain!",
    "We love the xrptipbot!",
    "Giving is great, giving $XRP is AMAZING!",
    "Thank you for being a Good Soul.",
    "Helping the world, one donation at a time.",
    "Your generosity is appreciated.",
    "Spreading the $XRP love.",
];

let additionalHashtags:string[] = [
    "#XRPforGood",
    "#XRPCommunity",
    "#XRP"
];

interface tweetMessage {
    message:string,
    greeting:string
}

let tweetWindow:number = 15*60*1000; //16 minutes

let tweetQueue:tweetMessage[] = [];
let lastWindowStart:number = 0;
let maxNumberOfRequestsRemaining = 0;
let isProcessingTweet = false;

let twitterClient:Twit;

export async function initTwitter() {
    twitterClient = new Twit({
        consumer_key: config.TWITTER_CONSUMER_KEY,
        consumer_secret: config.TWITTER_CONSUMER_SECRET,
        access_token: config.TWITTER_ACCESS_TOKEN,
        access_token_secret: config.TWITTER_ACCESS_SECRET
    });

    await storage.init({dir: 'storage'});

    //check if we have a queue
    if(await storage.getItem('tweetQueue'))
        tweetQueue = await storage.getItem('tweetQueue');

    if(await storage.getItem('lastWindowStart'))
        lastWindowStart = await storage.getItem('lastWindowStart');

    if(await storage.getItem('maxNumberOfRequestsRemaining'))
        maxNumberOfRequestsRemaining = await storage.getItem('maxNumberOfRequestsRemaining');

    writeToConsole("loaded tweetQueue with: " + JSON.stringify(tweetQueue.length) + " tweets.");
    writeToConsole("loaded lastWindowStart: " + lastWindowStart);
    writeToConsole("loaded maxNumberOfRequestsRemaining: " + maxNumberOfRequestsRemaining);

    //set interval timer to empty queue every 30 seconds
    setInterval(async () => emptyQueue(), 30000);
}

export async function getCurrentFollowers(): Promise<any> {
    return twitterClient.get('friends/list');
}

export async function emptyQueue(): Promise<void> {
    
    //check if we can set a new start window
    if(!isProcessingTweet && tweetQueue.length > 0 && ((lastWindowStart+tweetWindow) < Date.now())) {
        //start a new
        await setNewWindow();
    }

    //if we are already processing a tweet or we don´t have any tweets -> skip
    if(!isProcessingTweet && maxNumberOfRequestsRemaining > 0 && tweetQueue.length > 0) {
        isProcessingTweet = true;

        writeToConsole("maxNumberOfRequestsRemaining: " + maxNumberOfRequestsRemaining)
        writeToConsole("tweetQueue: " + tweetQueue.length)
        
        let newTweet:tweetMessage = tweetQueue[0];
        writeToConsole("Sending out new tweet with " + maxNumberOfRequestsRemaining + " requests remaining.");
        try {
            maxNumberOfRequestsRemaining--;
            await storage.setItem('maxNumberOfRequestsRemaining',maxNumberOfRequestsRemaining);
            await twitterClient.post('statuses/update', {status: newTweet.message+newTweet.greeting});
            writeToConsole("tweet sent out!");

            //always set latest tweet queue to storage in case the program/server crashes. So it can be restored on startup
            tweetQueue = tweetQueue.slice(1);
            await storage.setItem('tweetQueue',tweetQueue);
        } catch(err) {
            writeToConsole(JSON.stringify(err));
            writeToConsole("Could not send out tweet! Trying again.")
            if(err && err.code) {
                try {
                    if(err.code == 186) {
                        //tweet to long. try to send tweet without any greeting!
                        if(maxNumberOfRequestsRemaining > 0) {
                            maxNumberOfRequestsRemaining--;
                            await storage.setItem('maxNumberOfRequestsRemaining',maxNumberOfRequestsRemaining);
                            await twitterClient.post('statuses/update', {status: newTweet.message});
                            writeToConsole("tweet sent out!");

                            tweetQueue = tweetQueue.slice(1);
                            await storage.setItem('tweetQueue',tweetQueue);
                        }

                    } else if(err.code == 187) {
                        //duplicate tweet exception, try another greetings text
                        let greetingText = '\n'+getRandomGreetingsText() + '\n' + getRandomHashtagText();
                        writeToConsole("sending out modified message: " + newTweet.message+greetingText);

                        if(maxNumberOfRequestsRemaining > 0) {
                            maxNumberOfRequestsRemaining--;
                            await storage.setItem('maxNumberOfRequestsRemaining',maxNumberOfRequestsRemaining);
                            await twitterClient.post('statuses/update', {status:newTweet. message+greetingText});
                            writeToConsole("tweet sent out!");

                            tweetQueue = tweetQueue.slice(1);
                            await storage.setItem('tweetQueue',tweetQueue);
                        }
                    } else {
                        await handleFailedTweet();
                    }
                } catch(err) {
                    writeToConsole(JSON.stringify(err));
                    await handleFailedTweet();
                }
            } else {
                await handleFailedTweet();
            }
        }
        
        //push out message that no tweets can be sent out anymore. waiting for next window to open
        if(maxNumberOfRequestsRemaining==0)
            writeToConsole("Reached max number of tweets within 15 minutes. Waiting for next tweet window to open.")
            
        isProcessingTweet = false;
    }
}

async function handleFailedTweet(): Promise<any> {
    //give up sending any more tweets if it failed again!
    writeToConsole("sending out tweet failed again. giving up.")
    tweetQueue = tweetQueue.slice(1);
    return storage.setItem('tweetQueue',tweetQueue);
}

export async function pushToQueue(message:string, greeting:string) {
    writeToConsole("pusing new tweet to queue:");
    tweetQueue.push({message: message, greeting: greeting});
    await storage.setItem('tweetQueue', tweetQueue);
    writeToConsole("tweetQueue contains now " + tweetQueue.length + " elements.");
}

async function setNewWindow(): Promise<any> {
    writeToConsole("Resetting window")
    //reset start time
    lastWindowStart = Date.now();
    await storage.setItem('lastWindowStart',lastWindowStart);
    //reset number of possible tweets
    maxNumberOfRequestsRemaining = 15;
    return storage.setItem('maxNumberOfRequestsRemaining',maxNumberOfRequestsRemaining);
}

export function getRandomGreetingsText(): string {
    //return a random text, the range is the length of the text array
    return additionalTweetText[Math.floor(Math.random() * additionalTweetText.length)];
}

export function getRandomHashtagText(): string {
    //shuffle hashtags so we get a differnet tweet to avoid duplicate tweet exception
    let shuffledHashtags = shuffle(additionalHashtags, { 'copy': true });
    let hashtags = "";
    for(let i = 0; i<shuffledHashtags.length;i++)
        hashtags+=shuffledHashtags[i] + " ";
    
    return hashtags.trim();
}

function writeToConsole(message:string) {
    util.writeConsoleLog('[TWITTER] ', message);
}